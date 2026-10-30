// Adapted from phodal/point@edff76d7dd39b2900cff707af1896fe8ff9fd2dc; see ../SOURCE_REFERENCES.md.
// Package model defines portable environment identities and invariants. It has
// no dependency on a particular agent, deployment client, or authorization system.
package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"
)

var (
	ErrInvalid  = errors.New("invalid environment record")
	ErrNotFound = errors.New("environment record not found")
	ErrIdentity = errors.New("resource or execution identity changed")
)

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
var digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func ValidKey(value string) bool { return keyPattern.MatchString(value) }
func ValidText(value string) bool {
	return value != "" && len(value) <= 512 && !strings.ContainsAny(value, "\x00\r\n")
}

// Ref is a reference to an existing consumer, artifact, state version, receipt,
// or lease. It never contains a bearer credential or grants authority.
type Ref struct {
	Kind     string `json:"kind"`
	ID       string `json:"id"`
	Revision string `json:"revision,omitempty"`
	Digest   string `json:"digest,omitempty"`
}

func (r Ref) Validate() error {
	if !ValidKey(r.Kind) || !ValidText(r.ID) || len(r.Revision) > 512 || strings.ContainsAny(r.Revision, "\x00\r\n") || r.Digest != "" && !digestPattern.MatchString(r.Digest) {
		return ErrInvalid
	}
	return nil
}

// Owner is the stable authority identity, not its current process generation.
type Owner struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

func (o Owner) Validate() error {
	if !ValidKey(o.Kind) || !ValidText(o.ID) {
		return ErrInvalid
	}
	return nil
}

type ResourceRef struct {
	Owner       Owner  `json:"owner"`
	Kind        string `json:"kind"`
	Scope       string `json:"scope"`
	ID          string `json:"id"`
	Incarnation string `json:"incarnation"`
}

func (r ResourceRef) Validate() error {
	if r.Owner.Validate() != nil || !ValidKey(r.Kind) || !ValidText(r.Scope) || !ValidText(r.ID) || !ValidText(r.Incarnation) {
		return ErrInvalid
	}
	return nil
}

type Condition struct {
	Status string `json:"status"` // True / False / Unknown
	Reason string `json:"reason"`
}

func (c Condition) Validate() error {
	if c.Status != "True" && c.Status != "False" && c.Status != "Unknown" || !ValidKey(c.Reason) {
		return ErrInvalid
	}
	return nil
}

// Observation is an allowlisted Owner projection. Runtime identifies the
// execution incarnation separately from the potentially surviving resource.
type Observation struct {
	Resource   ResourceRef `json:"resource"`
	Runtime    *Ref        `json:"runtime,omitempty"`
	Receipt    Ref         `json:"receipt"`
	ObservedAt time.Time   `json:"observedAt"`
	Ready      Condition   `json:"ready"`
	States     []Ref       `json:"states,omitempty"`
	// Artifacts are the deployed artifacts the Owner itself observed running
	// (each with a digest). A Use that pins a Subject is admitted only if one of
	// them has the expected digest; the claim of the consumer is never evidence.
	Artifacts []Ref `json:"artifacts,omitempty"`
	// Attributes are Owner-supplied provenance labels. They never authorize and
	// never replace identity fields; they are part of the snapshot digest.
	Attributes map[string]string `json:"attributes,omitempty"`
	// LeaseExpiresAt is the Owner's own expiry of the resource (for example a
	// claim's shutdown time). It is distinct from a Use's expiry; this module
	// never destroys on expiry and never infers cleanup from it.
	LeaseExpiresAt *time.Time `json:"leaseExpiresAt,omitempty"`
}

var attributeKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_.-]{0,63}$`)

func (o Observation) Validate() error {
	if o.Resource.Validate() != nil || o.Receipt.Validate() != nil || o.Ready.Validate() != nil || o.ObservedAt.IsZero() || o.Runtime != nil && o.Runtime.Validate() != nil {
		return ErrInvalid
	}
	if len(o.States) > 64 || len(o.Artifacts) > 64 {
		return ErrInvalid
	}
	for _, artifact := range o.Artifacts {
		if artifact.Validate() != nil || artifact.Digest == "" {
			return ErrInvalid
		}
	}
	for _, ref := range o.States {
		if ref.Validate() != nil {
			return ErrInvalid
		}
	}
	if len(o.Attributes) > 32 {
		return ErrInvalid
	}
	for key, value := range o.Attributes {
		if !attributeKeyPattern.MatchString(key) || len(value) > 256 || strings.ContainsAny(value, "\x00\r\n") {
			return ErrInvalid
		}
	}
	return nil
}

func Digest(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

// Clone prevents callers or adapters from mutating committed records or frozen
// snapshots through shared slices and pointers.
func Clone[T any](value T) T {
	data, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	var result T
	if err := json.Unmarshal(data, &result); err != nil {
		panic(err)
	}
	return result
}
