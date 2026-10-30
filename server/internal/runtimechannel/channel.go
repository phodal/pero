// Package runtimechannel owns one-shot, exact-Run ACP transport authority. It
// never schedules a Run, authenticates a Kubernetes token, or grants tool access.
package runtimechannel

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"regexp"
	"time"
)

var ErrAuthority = errors.New("runtime channel authority is unavailable")
var ErrConflict = errors.New("runtime channel identity or operation conflicts")
var ErrBudget = errors.New("runtime provider budget exhausted")
var key = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
var sha = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

const (
	Profile        = "isolated-agent-v1"
	Audience       = "pero-runtime"
	Reserved       = "reserved"
	Attached       = "attached"
	Started        = "started"
	Closed         = "closed"
	Lost           = "lost"
	MaxLineBytes   = 256 << 10
	MaxStreamBytes = 64 << 20
	MaxDuration    = 15 * time.Minute
)

type Scope struct {
	RunID             string `json:"run_id"`
	SessionID         string `json:"session_id"`
	Generation        int64  `json:"generation"`
	WorkerID          string `json:"worker_id"`
	InstanceID        string `json:"instance_id"`
	ProjectID         string `json:"project_id"`
	Namespace         string `json:"namespace"`
	ServiceAccount    string `json:"service_account"`
	ServiceAccountUID string `json:"service_account_uid"`
	Audience          string `json:"audience"`
	PodUID            string `json:"pod_uid"`
	RuntimeDigest     string `json:"runtime_digest"`
}

func (s Scope) Validate() error {
	for _, value := range []string{s.RunID, s.SessionID, s.WorkerID, s.InstanceID, s.ProjectID, s.Namespace, s.ServiceAccount, s.ServiceAccountUID, s.PodUID} {
		if !key.MatchString(value) {
			return ErrAuthority
		}
	}
	if s.RunID != s.SessionID || s.Generation < 1 || s.Audience != Audience || !sha.MatchString(s.RuntimeDigest) {
		return ErrAuthority
	}
	return nil
}

// PodIdentity contains only fields authenticated by an online TokenReview, not
// self-reported headers, decoded JWT claims, node claims, or Downward API values.
type PodIdentity struct {
	Namespace         string
	ServiceAccount    string
	ServiceAccountUID string
	PodUID            string
	Audience          string
}

func (s Scope) Accepts(p PodIdentity) bool {
	return s.Namespace == p.Namespace && s.ServiceAccount == p.ServiceAccount && s.ServiceAccountUID == p.ServiceAccountUID && s.PodUID == p.PodUID && s.Audience == p.Audience
}

type ProviderBudget struct {
	MaxRequests      int   `json:"max_requests"`
	MaxConcurrent    int   `json:"max_concurrent"`
	MaxOutputTokens  int   `json:"max_output_tokens"`
	MaxRequestBytes  int64 `json:"max_request_bytes"`
	MaxResponseBytes int64 `json:"max_response_bytes"`
	TimeoutSeconds   int   `json:"timeout_seconds"`
}

func (b ProviderBudget) Validate() error {
	if b.MaxRequests < 1 || b.MaxRequests > 1000 || b.MaxConcurrent < 1 || b.MaxConcurrent > 4 || b.MaxConcurrent > b.MaxRequests || b.MaxOutputTokens < 1 || b.MaxOutputTokens > 32768 || b.MaxRequestBytes < 1 || b.MaxRequestBytes > 8<<20 || b.MaxResponseBytes < 1 || b.MaxResponseBytes > 16<<20 || b.TimeoutSeconds < 1 || b.TimeoutSeconds > 300 {
		return ErrBudget
	}
	return nil
}

type Session struct {
	Scope          Scope          `json:"scope"`
	SecretHash     string         `json:"-"`
	State          string         `json:"state"`
	WorkerAttached bool           `json:"worker_attached"`
	AgentAttached  bool           `json:"agent_attached"`
	CreatedAt      time.Time      `json:"created_at"`
	Budget         ProviderBudget `json:"budget"`
	Requests       int            `json:"requests"`
	ActiveRequests int            `json:"active_requests"`
}

func SecretHash(secret string) (string, error) {
	raw, err := hex.DecodeString(secret)
	if err != nil || len(raw) != 32 || hex.EncodeToString(raw) != secret {
		return "", ErrAuthority
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:]), nil
}
func New(scope Scope, secret string, budget ProviderBudget, now time.Time) (Session, error) {
	if scope.Validate() != nil || budget.Validate() != nil {
		return Session{}, ErrAuthority
	}
	digest, err := SecretHash(secret)
	if err != nil {
		return Session{}, err
	}
	return Session{Scope: scope, SecretHash: digest, State: Reserved, CreatedAt: now, Budget: budget}, nil
}
func (s Session) CheckSecret(secret string) bool {
	digest, err := SecretHash(secret)
	return err == nil && subtle.ConstantTimeCompare([]byte(digest), []byte(s.SecretHash)) == 1
}
func (s Session) Live(now time.Time) bool {
	return (s.State == Reserved || s.State == Attached || s.State == Started) && !now.Before(s.CreatedAt) && now.Before(s.CreatedAt.Add(MaxDuration))
}

// Attach is persisted before either peer can send ACP bytes. Even a disconnected
// first peer consumes its attachment; a repeated attach never resumes execution.
func (s Session) Attach(role string, now time.Time) (Session, error) {
	if !s.Live(now) || s.State == Started {
		return s, ErrAuthority
	}
	switch role {
	case "worker":
		if s.WorkerAttached {
			return s, ErrConflict
		}
		s.WorkerAttached = true
	case "agent":
		if s.AgentAttached {
			return s, ErrConflict
		}
		s.AgentAttached = true
	default:
		return s, ErrAuthority
	}
	s.State = Attached
	if s.WorkerAttached && s.AgentAttached {
		s.State = Started
	}
	return s, nil
}
func (s Session) Stop(unexpected bool) Session {
	if s.State == Closed || s.State == Lost {
		return s
	}
	s.State = Closed
	if unexpected {
		s.State = Lost
	}
	return s
}

// Reservation happens before the HTTP attempt. Unknown upstream outcomes still
// spend one request; never refund or automatically retry that external effect.
func (s Session) ReserveProvider(now time.Time) (Session, error) {
	if !s.Live(now) || s.State != Started {
		return s, ErrAuthority
	}
	if s.Requests >= s.Budget.MaxRequests || s.ActiveRequests >= s.Budget.MaxConcurrent {
		return s, ErrBudget
	}
	s.Requests++
	s.ActiveRequests++
	return s, nil
}
func (s Session) FinishProvider() Session {
	if s.ActiveRequests > 0 {
		s.ActiveRequests--
	}
	return s
}
