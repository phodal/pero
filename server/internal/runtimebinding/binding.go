// Package runtimebinding binds one existing Run to an observed trusted Worker
// Pod. It does not grant execution, schedule work, or attest an untrusted Pod.
package runtimebinding

import (
	"errors"
	"reflect"
	"regexp"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/environments/ports"
)

var ErrInvalid = errors.New("invalid sandbox runtime configuration or binding")
var ErrIdentity = model.ErrIdentity

const (
	Pending        = "pending"
	Ready          = "ready"
	Reconcile      = "reconcile"
	CleanupPending = "cleanup_pending"
	Released       = "released"
	// FreshFor bounds cached observation authority even when the API is down.
	FreshFor = 15 * time.Second
)

// Config is operator-owned, never Task-supplied. ImageDigest is verified against
// the kubelet observation; WorkspaceRevision and TemplateDigest are reviewed
// build provenance, not claims that Kubernetes attests checkout contents.
type Config struct {
	Profile           string `json:"profile,omitempty"`
	RuntimeClass      string `json:"runtime_class,omitempty"`
	ServiceAccount    string `json:"service_account,omitempty"`
	ServiceAccountUID string `json:"service_account_uid,omitempty"`
	Audience          string `json:"audience,omitempty"`
	ControlURL        string `json:"control_url,omitempty"`
	ControlCAFile     string `json:"control_ca_file,omitempty"`
	ImageRef          string `json:"image_ref,omitempty"`
	Model             string `json:"model,omitempty"`
	StorageClass      string `json:"storage_class,omitempty"`
	StorageAccessMode string `json:"storage_access_mode,omitempty"`
	VolumeSize        string `json:"volume_size,omitempty"`
	ClusterID         string `json:"cluster_id"`
	Namespace         string `json:"namespace"`
	WarmPool          string `json:"warm_pool"`
	WorkerID          string `json:"worker_id"`
	ProjectID         string `json:"project_id"`
	WorkspaceKey      string `json:"workspace_key"`
	AgentID           string `json:"agent_id"`
	ImageDigest       string `json:"image_digest"`
	WorkspaceRevision string `json:"workspace_revision"`
	TemplateDigest    string `json:"template_digest"`
	TTLSeconds        int64  `json:"ttl_seconds"`
}

var dns = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)
var revision = regexp.MustCompile(`^[a-f0-9]{40}$|^[a-f0-9]{64}$`)
var digest = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

func (c Config) IsIsolated() bool { return c.Profile == "isolated-agent-v1" }
func (c Config) Validate() error {
	if c.Profile != "" && c.Profile != "trusted-worker-pod" && !c.IsIsolated() {
		return ErrInvalid
	}
	if !model.ValidKey(c.ClusterID) || !dns.MatchString(c.Namespace) || (c.IsIsolated() && (!dns.MatchString(c.RuntimeClass) || !dns.MatchString(c.ServiceAccount) || !model.ValidKey(c.ServiceAccountUID) || c.Audience != "pero-runtime" || c.ControlURL == "" || c.ImageRef == "" || c.Model == "" || c.StorageClass == "" || c.VolumeSize == "")) || (!c.IsIsolated() && !dns.MatchString(c.WarmPool)) || !model.ValidKey(c.WorkerID) || !model.ValidKey(c.ProjectID) || !model.ValidKey(c.WorkspaceKey) || !model.ValidKey(c.AgentID) || !digest.MatchString(c.ImageDigest) || !digest.MatchString(c.TemplateDigest) || !revision.MatchString(c.WorkspaceRevision) || c.TTLSeconds < 60 || c.TTLSeconds > 7*24*3600 {
		return ErrInvalid
	}
	return nil
}

func (c Config) Recipe() *model.Ref {
	return &model.Ref{Kind: "sandbox-template", ID: c.WarmPool, Revision: "agent-sandbox/v1.0.2", Digest: c.TemplateDigest}
}

// Binding is persisted before create. RequestID can never change, and a resumed
// pending binding only reconciles its original create; absence is not retry.
type Binding struct {
	RunID              string             `json:"run_id"`
	RequestID          string             `json:"request_id"`
	Version            int64              `json:"version"`
	Config             Config             `json:"config"`
	Phase              string             `json:"phase"`
	Reason             string             `json:"reason"`
	CreatedAt          time.Time          `json:"created_at"`
	Volume             *VolumeBinding     `json:"volume,omitempty"`
	Resource           *model.ResourceRef `json:"resource,omitempty"`
	Snapshot           *model.Observation `json:"snapshot,omitempty"`
	ValidUntil         *time.Time         `json:"valid_until,omitempty"`
	ReleaseRequested   bool               `json:"release_requested"`
	ComputeReceipt     *model.Ref         `json:"compute_receipt,omitempty"`
	DataCleanupReceipt *model.Ref         `json:"data_cleanup_receipt,omitempty"`
	CleanupReceipt     *model.Ref         `json:"cleanup_receipt,omitempty"`
}

func New(runID string, config Config, now time.Time) Binding {
	return Binding{RunID: runID, RequestID: runID, Version: 1, Config: config, Phase: Pending, Reason: "CreateReserved", CreatedAt: now}
}
func (b Binding) Spec() ports.ProvisionSpec {
	return ports.ProvisionSpec{EnvironmentID: b.RunID, SlotID: "worker", ResourceKind: "kubernetes.sandboxclaim", Acquisition: "pool", Recipe: b.Config.Recipe()}
}
func (b Binding) WithResource(resource model.ResourceRef) (Binding, error) {
	kind := "kubernetes.sandboxclaim"
	if b.Config.IsIsolated() {
		kind = "kubernetes.sandbox"
	}
	if resource.Validate() != nil || resource.Kind != kind || resource.Scope != b.Config.Namespace || resource.Owner != (model.Owner{Kind: "kubernetes", ID: b.Config.ClusterID}) || b.Resource != nil && *b.Resource != resource {
		return b, ErrIdentity
	}
	b.Resource = &resource
	return b, nil
}

// Observe freezes the first executable incarnation. Later UID, container ID,
// restart count, or image changes never silently rebind or replay that Run.
func (b Binding) Observe(observation model.Observation, now time.Time) Binding {
	if b.Phase == Released || b.Phase == Reconcile {
		return b
	}
	if b.Resource == nil || observation.Resource != *b.Resource || observation.Validate() != nil {
		return b.Failed("IdentityMismatch")
	}
	if b.Snapshot != nil && (observation.Runtime == nil || b.Snapshot.Runtime == nil || *observation.Runtime != *b.Snapshot.Runtime) {
		return b.Failed("RuntimeChanged")
	}
	if observation.Ready.Status != "True" || observation.Runtime == nil || observation.LeaseExpiresAt == nil || !observation.LeaseExpiresAt.After(now) {
		return b.Failed("RuntimeNotReady")
	}
	containerName := "worker"
	if b.Config.IsIsolated() {
		containerName = "agent"
	}
	imageOK := false
	for _, artifact := range observation.Artifacts {
		if artifact.Kind == "container-image" && artifact.Revision == containerName && artifact.Digest == b.Config.ImageDigest {
			imageOK = true
		}
	}
	if !imageOK {
		return b.Failed("ImageDigestMismatch")
	}
	if b.Snapshot == nil {
		snapshot := model.Clone(observation)
		b.Snapshot = &snapshot
	}
	until := now.Add(FreshFor)
	if until.After(*observation.LeaseExpiresAt) {
		until = *observation.LeaseExpiresAt
	}
	b.ValidUntil = &until
	b.Phase = Ready
	if b.ReleaseRequested {
		b.Phase = CleanupPending
	}
	b.Reason = "ObservedReady"
	return b
}
func (b Binding) Failed(reason string) Binding {
	b.ValidUntil = nil
	b.Reason = reason
	if b.Snapshot != nil || reason == "IdentityMismatch" || reason == "ImageDigestMismatch" {
		b.Phase = Reconcile
	}
	return b
}
func (b Binding) RequestRelease() Binding {
	if b.Phase == Released {
		return b
	}
	b.ReleaseRequested = true
	b.Phase = CleanupPending
	b.Reason = "ReleaseRequested"
	return b
}
func (b Binding) Cleanup(receipt model.Ref) Binding {
	b.Phase = Released
	b.Reason = "OriginalClaimGone"
	b.ValidUntil = nil
	b.CleanupReceipt = &receipt
	return b
}

// ValidateNext owns the persisted transition invariants. Store supplies the
// previous record and only performs the compare-and-swap and Run lease effects.
func (b Binding) ValidateNext(previous Binding) error {
	if b.RunID != previous.RunID || b.RequestID != previous.RequestID || b.Version != previous.Version || b.Config != previous.Config || !b.CreatedAt.Equal(previous.CreatedAt) || previous.ReleaseRequested && !b.ReleaseRequested {
		return ErrIdentity
	}
	if err := b.validateVolume(previous); err != nil {
		return err
	}
	if previous.Resource != nil && (b.Resource == nil || *b.Resource != *previous.Resource) {
		return ErrIdentity
	}
	if previous.Snapshot != nil && !reflect.DeepEqual(b.Snapshot, previous.Snapshot) {
		return ErrIdentity
	}
	if previous.CleanupReceipt != nil && !reflect.DeepEqual(b.CleanupReceipt, previous.CleanupReceipt) {
		return ErrIdentity
	}
	allowed := map[string]map[string]bool{
		Pending:        {Pending: true, Ready: true, Reconcile: true, CleanupPending: true},
		Ready:          {Ready: true, Reconcile: true, CleanupPending: true},
		Reconcile:      {Reconcile: true, CleanupPending: true},
		CleanupPending: {CleanupPending: true, Reconcile: true, Released: true},
		Released:       {Released: true},
	}
	if !allowed[previous.Phase][b.Phase] || !model.ValidKey(b.Reason) {
		return ErrInvalid
	}
	if b.Resource != nil && b.Resource.Validate() != nil {
		return ErrInvalid
	}
	if b.Snapshot != nil && (b.Resource == nil || b.Snapshot.Resource != *b.Resource || b.Snapshot.Validate() != nil || b.Snapshot.Runtime == nil) {
		return ErrInvalid
	}
	if b.ValidUntil != nil && (b.Snapshot == nil || b.Phase != Ready && b.Phase != CleanupPending) {
		return ErrInvalid
	}
	if b.Phase == Ready && (b.Snapshot == nil || b.ValidUntil == nil || b.ReleaseRequested) {
		return ErrInvalid
	}
	if b.Phase == Released && (b.CleanupReceipt == nil || b.CleanupReceipt.Validate() != nil || !b.ReleaseRequested || b.ValidUntil != nil) {
		return ErrInvalid
	}
	return nil
}
