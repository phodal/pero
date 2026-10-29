package sandbox

import (
	"context"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/store"
)

// IsolatedConfig maps the fixed composition-root recipe once. It contains no
// task-controlled values, provider key, Worker token or Kubernetes credential.
func IsolatedConfig(c runtimebinding.Config) kubernetes.ColdConfig {
	return kubernetes.ColdConfig{Namespace: c.Namespace, ClusterID: c.ClusterID, ImageRef: c.ImageRef, ImageDigest: c.ImageDigest, RuntimeClass: c.RuntimeClass, ServiceAccountName: c.ServiceAccount, ServiceAccountUID: c.ServiceAccountUID, Audience: c.Audience, ControlURL: c.ControlURL, ControlCAFile: c.ControlCAFile, StorageClass: c.StorageClass, StorageAccessMode: c.StorageAccessMode, VolumeSize: c.VolumeSize, WorkspaceRevision: c.WorkspaceRevision, TemplateDigest: c.TemplateDigest, Model: c.Model, TTLSeconds: c.TTLSeconds}
}
func NewIsolated(ctx context.Context, db *store.Store, owner *kubernetes.ColdOwner, config runtimebinding.Config, policy artifacts.Policy) (*Runtime, error) {
	p, err := policy.Canonical()
	if err != nil || db == nil || owner == nil || !config.IsIsolated() || config.Validate() != nil || IsolatedConfig(config) != owner.Configuration() {
		return nil, runtimebinding.ErrInvalid
	}
	if err = db.ConfigureRuntimeWorker(ctx, config); err != nil {
		return nil, err
	}
	if err = db.FenceRuntimeChannels(ctx, config.WorkerID); err != nil {
		return nil, err
	}
	return &Runtime{db: db, cold: owner, config: config, artifactPolicy: p, now: time.Now}, nil
}
func (r *Runtime) pvc(b runtimebinding.Binding) kubernetes.PVCRef {
	v := b.Volume
	return kubernetes.PVCRef{Name: v.Resource.ID, Namespace: v.Resource.Scope, UID: v.Resource.Incarnation, VolumeName: v.VolumeName, StorageClass: b.Config.StorageClass, AccessMode: b.Config.StorageAccessMode, VolumeSize: b.Config.VolumeSize, RequestID: b.RequestID, ConfigDigest: v.ProviderDigest}
}

// Only the original Dispatch may create both resources. If the PVC reply is
// lost before Sandbox POST, reconciliation retains that PVC and reports missing
// compute; it never guesses that an unobserved operation is safe to replay.
func (r *Runtime) advanceIsolated(ctx context.Context, b runtimebinding.Binding, create bool) (runtimebinding.Binding, error) {
	if b.ComputeReceipt != nil {
		return b, nil
	}
	if b.Volume == nil {
		var pvc kubernetes.PVCRef
		var err error
		if create && !b.ReleaseRequested {
			pvc, err = r.cold.ProvisionVolume(ctx, b.RequestID)
		} else {
			pvc, err = r.cold.ReconcileVolume(ctx, b.RequestID)
		}
		if err != nil {
			return r.save(ctx, b.Failed("VolumeUnconfirmed"))
		}
		b, err = b.WithVolume(runtimebinding.VolumeBinding{Resource: model.ResourceRef{Owner: r.cold.Owner(), Kind: "kubernetes.pvc", Scope: pvc.Namespace, ID: pvc.Name, Incarnation: pvc.UID}, VolumeName: pvc.VolumeName, ProviderDigest: pvc.ConfigDigest})
		if err != nil {
			return r.save(ctx, b.Failed("IdentityMismatch"))
		}
		b, err = r.save(ctx, b)
		if err != nil || b.Volume == nil {
			return b, err
		}
	}
	if b.Resource == nil {
		var resource model.ResourceRef
		var err error
		if create && !b.ReleaseRequested {
			resource, err = r.cold.ProvisionSandbox(ctx, b.RequestID, r.pvc(b))
		} else {
			resource, err = r.cold.ReconcileSandbox(ctx, b.RequestID, r.pvc(b))
		}
		if err != nil {
			return r.save(ctx, b.Failed("SandboxUnconfirmed"))
		}
		b, err = b.WithResource(resource)
		if err != nil {
			return r.save(ctx, b.Failed("IdentityMismatch"))
		}
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
			if err = r.db.StopRuntimeChannel(ctx, b.RunID, false); err != nil {
				return b, err
			}
			podUID := ""
			if b.Snapshot != nil && b.Snapshot.Runtime != nil {
				podUID = b.Snapshot.Runtime.ID
			}
			receipt, err := r.cold.ReconcileDispose(ctx, b.RequestID, *b.Resource, podUID)
			if err != nil {
				b.Phase = runtimebinding.CleanupPending
				b.Reason = "CleanupUnconfirmed"
				b.ValidUntil = nil
				return r.save(ctx, b)
			}
			b, err = b.ComputeCleanup(receipt)
			if err != nil {
				return b, err
			}
			return r.save(ctx, b)
		}
	}
	current, err := r.cold.ObserveVolume(ctx, r.pvc(b))
	if err != nil {
		return r.save(ctx, b.Failed("VolumeIdentityUnavailable"))
	}
	if current.Phase == "Bound" && current.VolumeName != "" && b.Volume.VolumeName == "" {
		volume := *b.Volume
		volume.VolumeName = current.VolumeName
		b, err = b.WithVolume(volume)
		if err != nil {
			return r.save(ctx, b.Failed("IdentityMismatch"))
		}
		b, err = r.save(ctx, b)
		if err != nil {
			return b, err
		}
	}
	observation, err := r.cold.Observe(ctx, *b.Resource, r.pvc(b))
	if err != nil {
		return r.save(ctx, b.Failed("ObservationUnavailable"))
	}
	next := b.Observe(observation, r.now())
	if next.Snapshot != nil && next.Phase != runtimebinding.Reconcile && next.ComputeReceipt == nil {
		run, err := r.db.RuntimeRun(ctx, b.RunID)
		if err != nil {
			return b, err
		}
		source := artifacts.Source{ProjectID: run.Spec.ProjectID, TaskID: run.TaskID, RunID: run.ID, Generation: run.Generation, ClusterID: b.Config.ClusterID, Namespace: b.Config.Namespace, SandboxUID: b.Resource.Incarnation, PodUID: next.Snapshot.Runtime.ID, PVCName: b.Volume.Resource.ID, PVCUID: b.Volume.Resource.Incarnation, VolumeName: b.Volume.VolumeName, ImageDigest: b.Config.ImageDigest, TemplateDigest: b.Config.TemplateDigest, WorkspaceRevision: b.Config.WorkspaceRevision}
		if _, err = r.db.ReserveArtifactExport(ctx, source, r.artifactPolicy, "export."+b.RunID); err != nil {
			return r.save(ctx, b.Failed("ArtifactReservationUnconfirmed"))
		}
	}
	return r.save(ctx, next)
}
