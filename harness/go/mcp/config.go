package mcp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

const (
	defaultMCPReconnectInitialDelayMS = 500
	defaultMCPReconnectMaxDelayMS     = 30_000
	defaultMCPReconnectMaxAttempts    = 10
	maxMCPTimerDelayMS                = 2_147_483_647
	// CommandTransport may spend two five-second grace windows before its
	// final kill. One extra second proves that generation has quiesced before
	// another child is allowed to start.
	mcpGenerationCloseTimeout = 11 * time.Second
)

// MCPReconnectConfig controls automatic recovery after one MCP connection is
// lost. Nil fields use the DeepSeek Harness defaults.
type MCPReconnectConfig struct {
	Enabled        *bool `json:"enabled,omitempty"`
	InitialDelayMS int   `json:"initialDelayMs,omitempty"`
	MaxDelayMS     int   `json:"maxDelayMs,omitempty"`
	MaxAttempts    int   `json:"maxAttempts,omitempty"`
}

type ReconnectPolicy struct {
	Enabled      bool
	InitialDelay time.Duration
	MaxDelay     time.Duration
	MaxAttempts  int
}

func ResolveReconnectPolicy(config *MCPReconnectConfig) (ReconnectPolicy, error) {
	policy := ReconnectPolicy{
		Enabled:      true,
		InitialDelay: defaultMCPReconnectInitialDelayMS * time.Millisecond,
		MaxDelay:     defaultMCPReconnectMaxDelayMS * time.Millisecond,
		MaxAttempts:  defaultMCPReconnectMaxAttempts,
	}
	if config == nil {
		return policy, nil
	}
	if config.Enabled != nil {
		policy.Enabled = *config.Enabled
	}
	if config.InitialDelayMS != 0 {
		policy.InitialDelay = time.Duration(config.InitialDelayMS) * time.Millisecond
	}
	if config.MaxDelayMS != 0 {
		policy.MaxDelay = time.Duration(config.MaxDelayMS) * time.Millisecond
	}
	if config.MaxAttempts != 0 {
		policy.MaxAttempts = config.MaxAttempts
	}
	if config.InitialDelayMS < 0 || config.InitialDelayMS > maxMCPTimerDelayMS {
		return ReconnectPolicy{}, errors.New("initialDelayMs must be a positive timer duration")
	}
	if config.MaxDelayMS < 0 || config.MaxDelayMS > maxMCPTimerDelayMS {
		return ReconnectPolicy{}, errors.New("maxDelayMs must be a positive timer duration")
	}
	if policy.InitialDelay > policy.MaxDelay {
		return ReconnectPolicy{}, errors.New("initialDelayMs must not exceed maxDelayMs")
	}
	if config.MaxAttempts < 0 || policy.MaxAttempts < 1 {
		return ReconnectPolicy{}, errors.New("maxAttempts must be a positive integer")
	}
	return policy, nil
}

type MCPTransport string

const (
	MCPStdio          MCPTransport = "stdio"
	MCPStreamableHTTP MCPTransport = "streamable-http"
	MCPSSE            MCPTransport = "sse"
)

func NormalizeServerName(name string) string {
	valid := name != "" && len(name) <= 32
	for _, char := range name {
		if !(char == '_' || char == '-' || unicode.IsLetter(char) && char <= unicode.MaxASCII || unicode.IsDigit(char) && char <= unicode.MaxASCII) {
			valid = false
			break
		}
	}
	if valid {
		return name
	}
	var slug strings.Builder
	for _, char := range norm.NFKD.String(name) {
		if unicode.IsLetter(char) && char <= unicode.MaxASCII || unicode.IsDigit(char) && char <= unicode.MaxASCII || char == '_' || char == '-' {
			slug.WriteRune(char)
		} else if slug.Len() > 0 && !strings.HasSuffix(slug.String(), "_") {
			slug.WriteByte('_')
		}
		if slug.Len() >= 20 {
			break
		}
	}
	prefix := strings.Trim(slug.String(), "_")
	if prefix == "" {
		prefix = "server"
	}
	digest := sha256.Sum256([]byte(name))
	return prefix + "_" + hex.EncodeToString(digest[:4])
}

// ErrAuthentication requires an explicit operator credential/configuration change.
// It is not a transient connection failure and must never trigger automatic login.
var ErrAuthentication = errors.New("MCP authentication rejected; operator action required")

// SafeError keeps machine-readable causes without displaying endpoint URLs,
// response bodies, command arguments, or other operator secrets in diagnostics.
func SafeError(err error) error {
	if err == nil {
		return nil
	}
	return safeError{cause: err}
}

type safeError struct{ cause error }

func (e safeError) Unwrap() error { return e.cause }
func (e safeError) Error() string {
	switch {
	case errors.Is(e.cause, ErrAuthentication):
		return ErrAuthentication.Error()
	case errors.Is(e.cause, context.Canceled):
		return "MCP request canceled"
	case errors.Is(e.cause, context.DeadlineExceeded):
		return "MCP request timed out"
	case errors.Is(e.cause, ErrInstructionLimit):
		return ErrInstructionLimit.Error()
	default:
		return "MCP operation failed (details withheld)"
	}
}
