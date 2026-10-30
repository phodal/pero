// Adapted from phodal/point@edff76d7dd39b2900cff707af1896fe8ff9fd2dc; see ../SOURCE_REFERENCES.md.
// Package ports separates resource lifecycle authority from execution authority.
// A Kubernetes ResourceOwner/Provisioner/Disposer never grants Agent operations.
package ports

import (
	"context"
	"github.com/phodal/pero/server/internal/environments/model"
)

// ResourceOwner reports its own actual identity. Detach only completes this
// binding's non-destructive disposition; it does not imply physical deletion.
// Provisioning/destruction must be added with durable Owner-side operation and
// cross-environment retention contracts, not inferred from an attachment.
type ResourceOwner interface {
	Owner() model.Owner
	Observe(context.Context, model.ResourceRef) (model.Observation, error)
	Detach(context.Context, string, model.Binding) (model.Ref, error)
	ReconcileDetach(context.Context, string, model.Binding) (model.Ref, error)
}

// Provisioner is implemented by Owners that can create or claim a resource.
// The embedding coordinator persists the request ID before its first dispatch.
// A duplicate create can identify the same live named object, but after an
// unknown result only ReconcileProvision is allowed: a disappeared resource
// may have expired after a successful create and must never be recreated.
type Provisioner interface {
	Provision(ctx context.Context, requestID string, spec ProvisionSpec) (model.ResourceRef, error)
	ReconcileProvision(ctx context.Context, requestID string, spec ProvisionSpec) (model.ResourceRef, error)
}

type ProvisionSpec struct {
	EnvironmentID string
	SlotID        string
	ResourceKind  string
	Acquisition   string     // provision / pool
	Recipe        *model.Ref // immutable reference from the pinned template
}

// Disposer is implemented by Owners that can return or destroy what they own.
// SupportedDispositions lists the intents it honors; the module rejects others
// at attach time instead of degrading them. Destroy is allowed only for the
// resource's single Owner and retention checks across environments are its own.
type Disposer interface {
	SupportedDispositions() []string
	Dispose(ctx context.Context, requestID, intent string, binding model.Binding) (model.Ref, error)
	ReconcileDispose(ctx context.Context, requestID, intent string, binding model.Binding) (model.Ref, error)
}
