// Package resourceref names an App object on one owner.
// A reference is not a grant, a path, or a runtime incarnation.
// Scientific bytes stay with the domain source passed into ReadPaper.
package resourceref

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
)

const (
	PaperEvidence       = "pero-paper-evidence-v1"
	PaperDigest         = "34ad712113ddbb4f4c4dc5f46380924a5ff69f53e0e5bc1b63e03c5bb6d44f90"
	DomainProvenance    = "domain:paper"
	ClassImmutable      = "immutable"
	ClassObserved       = "observed"
	OpRead              = "read"
	OpCreate            = "create"
	OpDevice            = "device"
	ErrMissing          = Error("missing")
	ErrStale            = Error("stale")
	ErrRevoked          = Error("revoked")
	ErrOwnerUnavailable = Error("owner_unavailable")
	ErrMissingPolicy    = Error("missing_policy")
	ErrWrongProject     = Error("wrong_project")
	ErrDisabledApp      = Error("disabled_app")
	ErrUngranted        = Error("ungranted")
	ErrTraversal        = Error("traversal")
	ErrSpoofed          = Error("spoofed")
	ErrNotEvidence      = Error("not_evidence")
	ErrUnsupported      = Error("unsupported")
)

type Error string

func (e Error) Error() string { return string(e) }

type Qualified struct {
	OwnerHost     string `json:"ownerHost"`
	SharedProject string `json:"sharedProject"`
	LocalProject  string `json:"localProject"`
	App           string `json:"app"`
	AppInstance   string `json:"appInstance"`
	AppVersion    string `json:"appVersion"`
	Kind          string `json:"kind"`
	ID            string `json:"id"`
	Revision      string `json:"revision"`
	Class         string `json:"class"`
}

type Grant struct {
	SharedProject string
	App           string
	ID            string
}

type Evidence struct {
	Digest    string
	MediaType string
	Body      []byte
}

type Cache struct {
	OwnerHost  string
	Revision   string
	Provenance string
	Digest     string
	Body       []byte
}

type ReadInput struct {
	Resource       Qualified
	Project        string
	Member         bool
	AppEnabled     bool
	Grants         []Grant
	Evidence       *Evidence
	Cache          *Cache
	OwnerAvailable bool
}

type ReadResult struct {
	OwnerHost  string `json:"ownerHost"`
	Revision   string `json:"revision"`
	Digest     string `json:"digest"`
	MediaType  string `json:"mediaType"`
	Body       []byte `json:"body"`
	Provenance string `json:"provenance"`
}

type Local struct {
	App      string
	Kind     string
	ID       string
	Revision string
	Class    string
}

type Binding struct {
	OwnerHost     string
	SharedProject string
	LocalProject  string
	AppInstance   string
	AppVersion    string
}

func Qualify(local Local, binding *Binding) (Qualified, error) {
	if binding == nil {
		return Qualified{}, ErrMissingPolicy
	}
	qualified := Qualified{
		OwnerHost: binding.OwnerHost, SharedProject: binding.SharedProject, LocalProject: binding.LocalProject,
		App: local.App, AppInstance: binding.AppInstance, AppVersion: binding.AppVersion,
		Kind: local.Kind, ID: local.ID, Revision: local.Revision, Class: local.Class,
	}
	return qualified, qualified.fields()
}

func Resolve(operation string, existing *Qualified, policy string, available bool) (string, error) {
	if existing != nil {
		if err := existing.fields(); err != nil {
			return "", err
		}
		if !available {
			return "", ErrOwnerUnavailable
		}
		return existing.OwnerHost, nil
	}
	if operation == OpDevice {
		return "local", nil
	}
	if operation == OpCreate {
		if policy == "" {
			return "", ErrMissingPolicy
		}
		if traversed(policy) {
			return "", ErrTraversal
		}
		if !available {
			return "", ErrOwnerUnavailable
		}
		if policy == "local" || token(policy) {
			return policy, nil
		}
		return "", ErrMissingPolicy
	}
	return "", ErrMissing
}

func ReadPaper(in ReadInput) (ReadResult, error) {
	resource := in.Resource
	if err := resource.fields(); err != nil {
		return ReadResult{}, err
	}
	if !in.Member {
		return ReadResult{}, ErrRevoked
	}
	if resource.SharedProject == "" || resource.SharedProject != in.Project {
		return ReadResult{}, ErrWrongProject
	}
	if !in.AppEnabled {
		return ReadResult{}, ErrDisabledApp
	}
	if resource.App != "paper-agent" || resource.Kind != "paper" {
		return ReadResult{}, ErrUnsupported
	}
	if resource.Class != ClassImmutable || !digest(resource.Revision) {
		return ReadResult{}, ErrNotEvidence
	}
	granted := false
	for _, grant := range in.Grants {
		if grant.SharedProject == resource.SharedProject && grant.App == resource.App && grant.ID == resource.ID {
			granted = true
		}
	}
	if !granted {
		return ReadResult{}, ErrUngranted
	}
	owner, err := Resolve(OpRead, &resource, "", in.OwnerAvailable)
	if err != nil {
		return ReadResult{}, err
	}
	if owner != resource.OwnerHost {
		return ReadResult{}, ErrOwnerUnavailable
	}
	if in.Evidence == nil {
		return ReadResult{}, ErrOwnerUnavailable
	}
	sum := sha256.Sum256(in.Evidence.Body)
	if in.Evidence.Digest != resource.Revision || in.Evidence.Digest != hex.EncodeToString(sum[:]) {
		return ReadResult{}, ErrStale
	}
	if in.Cache != nil {
		matches := in.Cache.OwnerHost == resource.OwnerHost && in.Cache.Revision == resource.Revision &&
			in.Cache.Digest == in.Evidence.Digest && in.Cache.Provenance == DomainProvenance &&
			string(in.Cache.Body) == string(in.Evidence.Body)
		if !matches {
			return ReadResult{}, ErrStale
		}
	}
	return ReadResult{
		OwnerHost: resource.OwnerHost, Revision: resource.Revision, Digest: in.Evidence.Digest,
		MediaType: in.Evidence.MediaType, Body: append([]byte(nil), in.Evidence.Body...), Provenance: DomainProvenance,
	}, nil
}

func (r Qualified) Validate() error { return r.fields() }

func (r Qualified) fields() error {
	values := []string{r.OwnerHost, r.SharedProject, r.LocalProject, r.App, r.AppInstance, r.AppVersion, r.Kind, r.ID, r.Revision, r.Class}
	for _, value := range values {
		if traversed(value) {
			return ErrTraversal
		}
	}
	if r.Class != ClassImmutable && r.Class != ClassObserved {
		return ErrMissing
	}
	for _, value := range []string{r.OwnerHost, r.SharedProject, r.LocalProject, r.App, r.AppInstance, r.AppVersion, r.Kind, r.ID, r.Revision} {
		if !token(value) {
			return ErrMissing
		}
	}
	return nil
}

func token(value string) bool {
	if value == "" || len(value) > 128 || strings.ContainsAny(value, "/\\:") {
		return false
	}
	for i := 0; i < len(value); i++ {
		if value[i] < 0x21 || value[i] > 0x7e {
			return false
		}
	}
	return !strings.Contains(value, "..")
}

func digest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for i := 0; i < len(value); i++ {
		c := value[i]
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

func traversed(value string) bool {
	return strings.Contains(value, "..") || strings.ContainsAny(value, "/\\\x00")
}
