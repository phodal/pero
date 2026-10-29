// Package artifacts owns the bounded, immutable file-export contract. It does
// not read files, grant execution authority, or infer storage fencing from Pod
// deletion. Project is the current collaboration security scope.
package artifacts

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

var (
	ErrInvalid  = errors.New("invalid artifact export")
	ErrConflict = errors.New("artifact identity or receipt conflict")
	ErrNotReady = errors.New("artifact export is not ready")
)

const (
	MaxFiles               = 256
	MaxFileBytes     int64 = 128 << 20
	MaxTotalBytes    int64 = 1 << 30
	MaxManifestBytes       = 1 << 20
)

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
var digestPattern = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var revisionPattern = regexp.MustCompile(`^[a-f0-9]{40}$|^[a-f0-9]{64}$`)

// Source is populated by the trusted runtime from persisted Run and observed
// resource identities, never from an Agent publication request. WorkspaceRevision
// is build provenance; it does not attest the modified workspace contents.
type Source struct {
	ProjectID         string `json:"project_id"`
	TaskID            string `json:"task_id"`
	RunID             string `json:"run_id"`
	Generation        int64  `json:"generation"`
	ClusterID         string `json:"cluster_id"`
	Namespace         string `json:"namespace"`
	SandboxUID        string `json:"sandbox_uid"`
	PodUID            string `json:"pod_uid"`
	PVCName           string `json:"pvc_name"`
	PVCUID            string `json:"pvc_uid"`
	VolumeName        string `json:"volume_name"`
	ImageDigest       string `json:"image_digest"`
	TemplateDigest    string `json:"template_digest"`
	WorkspaceRevision string `json:"workspace_revision"`
}

func (s Source) Validate() error {
	for _, key := range []string{s.ProjectID, s.TaskID, s.RunID, s.ClusterID, s.Namespace, s.SandboxUID, s.PodUID, s.PVCName, s.PVCUID, s.VolumeName} {
		if !keyPattern.MatchString(key) {
			return ErrInvalid
		}
	}
	if s.Generation < 1 || !digestPattern.MatchString(s.ImageDigest) || !digestPattern.MatchString(s.TemplateDigest) || !revisionPattern.MatchString(s.WorkspaceRevision) {
		return ErrInvalid
	}
	return nil
}

// Policy selects exact regular files relative to the sole output root. There is
// intentionally no recursive directory, archive, home-directory, or glob export.
// The limits are operator-owned, with hard ceilings to bound the first backend.
type Policy struct {
	Paths         []string `json:"paths"`
	MaxFiles      int      `json:"max_files"`
	MaxFileBytes  int64    `json:"max_file_bytes"`
	MaxTotalBytes int64    `json:"max_total_bytes"`
	AllowMissing  bool     `json:"allow_missing"`
}

func (p Policy) Canonical() (Policy, error) {
	if p.MaxFiles < 1 || p.MaxFiles > MaxFiles || len(p.Paths) == 0 || len(p.Paths) > p.MaxFiles || p.MaxFileBytes < 1 || p.MaxFileBytes > MaxFileBytes || p.MaxTotalBytes < 1 || p.MaxTotalBytes > MaxTotalBytes || p.MaxFileBytes > p.MaxTotalBytes {
		return Policy{}, ErrInvalid
	}
	p.Paths = slices.Clone(p.Paths)
	slices.Sort(p.Paths)
	seen := map[string]bool{}
	for _, path := range p.Paths {
		if ValidatePath(path) != nil || seen[strings.ToLower(path)] {
			return Policy{}, ErrInvalid
		}
		seen[strings.ToLower(path)] = true
	}
	return p, nil
}

// ValidatePath rejects ambiguous cross-platform names as well as traversal.
// Filesystem containment and symlink/hardlink rejection belong to the trusted
// collector's handle-relative opens, not a subsequent string-prefix check.
func ValidatePath(path string) error {
	if path == "" || len(path) > 1024 || !utf8.ValidString(path) || strings.ContainsAny(path, "\\:") {
		return ErrInvalid
	}
	for _, r := range path {
		if unicode.IsControl(r) {
			return ErrInvalid
		}
	}
	parts := strings.Split(path, "/")
	if len(parts) > 32 {
		return ErrInvalid
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || len(part) > 255 || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") {
			return ErrInvalid
		}
		lower := strings.ToLower(part)
		if lower == ".git" || lower == ".ssh" || lower == ".aws" || lower == ".kube" || lower == ".env" {
			return ErrInvalid
		}
		base, _, _ := strings.Cut(lower, ".")
		if base == "con" || base == "prn" || base == "aux" || base == "nul" || len(base) == 4 && (strings.HasPrefix(base, "com") || strings.HasPrefix(base, "lpt")) && base[3] >= '1' && base[3] <= '9' {
			return ErrInvalid
		}
	}
	return nil
}

func Digest(value any) (string, error) {
	b, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(h[:]), nil
}

func EntryID(path string) string {
	h := sha256.Sum256([]byte(path))
	return hex.EncodeToString(h[:])
}

// ObjectKey contains only authority-derived identity and digests, never a user
// path or a URL. There is no cross-project content deduplication.
func ObjectKey(source Source, operationID, path, digest string) string {
	return fmt.Sprintf("projects/%s/runs/%s/g%d/%s/%s/%s", source.ProjectID, source.RunID, source.Generation, operationID, EntryID(path), strings.TrimPrefix(digest, "sha256:"))
}

type Entry struct {
	ID        string `json:"id"`
	Path      string `json:"path"`
	Bytes     int64  `json:"bytes"`
	SHA256    string `json:"sha256"`
	ObjectKey string `json:"object_key"`
}

type Manifest struct {
	Schema       string    `json:"schema"`
	Source       Source    `json:"source"`
	OperationID  string    `json:"operation_id"`
	PolicyDigest string    `json:"policy_digest"`
	Outcome      string    `json:"outcome"` // complete or partial, not Run success
	Entries      []Entry   `json:"entries"`
	Missing      []string  `json:"missing"`
	TotalBytes   int64     `json:"total_bytes"`
	CreatedAt    time.Time `json:"created_at"`
	Digest       string    `json:"digest"`
}

// NewManifest accounts for every selected path exactly once. Missing files are
// explicit partial evidence, not silently omitted successful output.
func NewManifest(source Source, policy Policy, operationID string, entries []Entry, missing []string, now time.Time) (Manifest, error) {
	p, err := policy.Canonical()
	if err != nil || source.Validate() != nil || !keyPattern.MatchString(operationID) || now.IsZero() {
		return Manifest{}, ErrInvalid
	}
	if len(missing) > 0 && !p.AllowMissing {
		return Manifest{}, ErrNotReady
	}
	m := Manifest{Schema: "pero.artifact-manifest.v1", Source: source, OperationID: operationID, Outcome: "complete", Entries: slices.Clone(entries), Missing: slices.Clone(missing), CreatedAt: now.UTC()}
	m.PolicyDigest, _ = Digest(p)
	slices.SortFunc(m.Entries, func(a, b Entry) int { return strings.Compare(a.Path, b.Path) })
	slices.Sort(m.Missing)
	if m.Entries == nil {
		m.Entries = []Entry{}
	}
	if m.Missing == nil {
		m.Missing = []string{}
	}
	if len(m.Missing) > 0 {
		m.Outcome = "partial"
	}
	selected := map[string]bool{}
	for _, path := range p.Paths {
		selected[path] = true
	}
	for i := range m.Entries {
		e := &m.Entries[i]
		if !selected[e.Path] || e.Bytes < 0 || e.Bytes > p.MaxFileBytes || !digestPattern.MatchString(e.SHA256) {
			return Manifest{}, ErrInvalid
		}
		delete(selected, e.Path)
		id, key := EntryID(e.Path), ObjectKey(source, operationID, e.Path, e.SHA256)
		if e.ID != "" && e.ID != id || e.ObjectKey != "" && e.ObjectKey != key {
			return Manifest{}, ErrConflict
		}
		e.ID, e.ObjectKey = id, key
		if e.Bytes > p.MaxTotalBytes-m.TotalBytes {
			return Manifest{}, ErrInvalid
		}
		m.TotalBytes += e.Bytes
	}
	for _, path := range m.Missing {
		if !selected[path] {
			return Manifest{}, ErrInvalid
		}
		delete(selected, path)
	}
	if len(selected) != 0 {
		return Manifest{}, ErrInvalid
	}
	m.Digest, _ = Digest(m)
	b, _ := json.Marshal(m)
	if len(b) > MaxManifestBytes {
		return Manifest{}, ErrInvalid
	}
	return m, nil
}

func (m Manifest) Validate(policy Policy) error {
	next, err := NewManifest(m.Source, policy, m.OperationID, m.Entries, m.Missing, m.CreatedAt)
	if err != nil {
		return err
	}
	got, _ := json.Marshal(m)
	want, _ := json.Marshal(next)
	if string(got) != string(want) {
		return ErrConflict
	}
	return nil
}
