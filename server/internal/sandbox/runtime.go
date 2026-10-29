// Package sandbox wires the environment owner to the existing Run store. The
// reconciler settles resource operations; it never schedules or retries a Run.
package sandbox

import (
	"context"
	"errors"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/environments/ports"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/store"
)

// Owner is the actual resource boundary: Kubernetes in production, an HTTP
// fixture in tests. It has no execution/Use grant or worker credential methods.
type Owner interface {
	Provision(context.Context, string, ports.ProvisionSpec) (model.ResourceRef, error)
	ReconcileProvision(context.Context, string, ports.ProvisionSpec) (model.ResourceRef, error)
	Observe(context.Context, model.ResourceRef) (model.Observation, error)
	ReconcileDispose(context.Context, string, string, model.Binding) (model.Ref, error)
}

type Runtime struct {
	db             *store.Store
	owner          Owner
	cold           *kubernetes.ColdOwner
	artifactPolicy artifacts.Policy
	config         runtimebinding.Config
	now            func() time.Time
}

func New(ctx context.Context, db *store.Store, owner Owner, config runtimebinding.Config) (*Runtime, error) {
	if db == nil || owner == nil || config.Validate() != nil {
		return nil, runtimebinding.ErrInvalid
	}
	if err := db.ConfigureRuntimeWorker(ctx, config); err != nil {
		return nil, err
	}
	return &Runtime{db: db, owner: owner, config: config, now: time.Now}, nil
}

func (r *Runtime) Dispatch(ctx context.Context, taskID, key string) (*store.Run, runtimebinding.Binding, error) {
	run, b, created, err := r.db.DispatchRuntime(ctx, taskID, key, r.config)
	if err != nil {
		return nil, runtimebinding.Binding{}, err
	}
	next, err := r.advance(ctx, *b, created)
	return run, next, err
}
func (r *Runtime) Binding(ctx context.Context, runID string) (runtimebinding.Binding, error) {
	return r.db.RuntimeBinding(ctx, runID)
}
func (r *Runtime) Reconcile(ctx context.Context, runID string) (runtimebinding.Binding, error) {
	b, err := r.db.RuntimeBinding(ctx, runID)
	if err != nil {
		return b, err
	}
	return r.advance(ctx, b, false)
}
func (r *Runtime) Release(ctx context.Context, runID string) (runtimebinding.Binding, error) {
	b, err := r.db.ReleaseRuntime(ctx, runID)
	if err != nil {
		return b, err
	}
	return r.advance(ctx, b, false)
}

func terminal(status string) bool {
	return status == "succeeded" || status == "failed" || status == "cancelled" || status == "reconcile"
}
func (r *Runtime) save(ctx context.Context, b runtimebinding.Binding) (runtimebinding.Binding, error) {
	next, err := r.db.SaveRuntimeBinding(ctx, b.Version, b)
	if errors.Is(err, store.ErrConflict) {
		return r.db.RuntimeBinding(ctx, b.RunID)
	}
	return next, err
}
func (r *Runtime) advance(ctx context.Context, b runtimebinding.Binding, create bool) (runtimebinding.Binding, error) {
	if b.Config != r.config {
		return b, store.ErrConflict
	}
	if b.Phase == runtimebinding.Released {
		return b, nil
	}
	if r.cold != nil {
		return r.advanceIsolated(ctx, b, create)
	}
	if b.Resource == nil {
		var resource model.ResourceRef
		var err error
		if create {
			resource, err = r.owner.Provision(ctx, b.RequestID, b.Spec())
		} else {
			resource, err = r.owner.ReconcileProvision(ctx, b.RequestID, b.Spec())
		}
		if err != nil {
			return r.save(ctx, b.Failed("ClaimUnconfirmed"))
		}
		b, err = b.WithResource(resource)
		if err != nil {
			return r.save(ctx, b.Failed("IdentityMismatch"))
		}
		// Persist the UID before observing or deleting. Concurrent release/observation
		// wins its CAS; a later sweep reconciles the same request, never a fresh create.
		b, err = r.save(ctx, b)
		if err != nil || b.Resource == nil {
			return b, err
		}
	}
	if b.ReleaseRequested {
		run, err := r.db.RuntimeRun(ctx, b.RunID)
		if err != nil {
			return b, err
		}
		if terminal(run.Status) {
			receipt, err := r.owner.ReconcileDispose(ctx, "release."+b.RequestID, "destroy", model.Binding{Observation: model.Observation{Resource: *b.Resource}, ReleaseIntent: "destroy"})
			if err != nil {
				b.Phase = runtimebinding.CleanupPending
				b.Reason = "CleanupUnconfirmed"
				b.ValidUntil = nil
				return r.save(ctx, b)
			}
			return r.save(ctx, b.Cleanup(receipt))
		}
	}
	observation, err := r.owner.Observe(ctx, *b.Resource)
	if err != nil {
		return r.save(ctx, b.Failed("ObservationUnavailable"))
	}
	return r.save(ctx, b.Observe(observation, r.now()))
}

// Start is optional composition-root wiring. No create is performed here: even
// a crash between reservation and POST needs explicit original-ID reconciliation.
func (r *Runtime) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
			op, cancel := context.WithTimeout(ctx, 8*time.Second)
			bindings, err := r.db.RuntimeBindings(op, r.config.WorkerID)
			if err == nil {
				for _, b := range bindings {
					if op.Err() != nil {
						break
					}
					_, _ = r.advance(op, b, false)
				}
			}
			cancel()
		}
	}()
}
