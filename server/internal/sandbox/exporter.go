package sandbox

import (
	"context"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/runtimebinding"
)

// AdvanceExport is a trusted control-library action, deliberately not an HTTP
// endpoint accepting caller-invented digests. q must come from the selected real
// storage fence owner. API Pod deletion alone does not establish q.
func (r *Runtime) AdvanceExport(ctx context.Context, runID string, q artifacts.Quiescence, jobs *kubernetes.CollectorOwner) (artifacts.Export, error) {
	b, e, err := r.exportBinding(ctx, runID)
	if err != nil {
		return e, err
	}
	if jobs == nil || q.ComputeReleaseDigest != b.ComputeReceipt.Digest || q.PVCUID != b.Volume.Resource.Incarnation || q.VolumeName != b.Volume.VolumeName {
		return e, artifacts.ErrConflict
	}
	e, err = r.db.BeginArtifactExport(ctx, e.ID, e.Version, q)
	if err != nil {
		return e, err
	}
	if e.Manifest != nil || e.GC != nil {
		return e, nil
	}
	request, err := r.collectorRequest(b, e)
	if err != nil {
		return e, err
	}
	created := e.CollectorJob == nil
	if created {
		ref, err := jobs.Reservation(request, r.now().Add(artifacts.MaxCollectionDuration))
		if err != nil {
			return e, err
		}
		config := jobs.Configuration()
		reservation := artifacts.CollectorJob{Name: ref.Name, Namespace: e.Source.Namespace, ConfigDigest: ref.ConfigDigest, ExpiresAt: ref.ExpiresAt, ServiceAccount: config.ServiceAccountName, ServiceAccountUID: config.ServiceAccountUID}
		e, err = r.db.SaveArtifactCollectorJob(ctx, e.ID, e.Version, reservation)
		if err != nil {
			return e, err
		}
	}
	ref := collectorRef(*e.CollectorJob)
	if !ref.ExpiresAt.After(r.now()) {
		return e, artifacts.ErrNotReady
	}
	if created {
		ref, err = jobs.Provision(ctx, request, ref)
	} else {
		ref, err = jobs.Reconcile(ctx, request, ref)
	}
	if err != nil {
		return e, err
	}
	if e.CollectorJob.UID == "" {
		observed := *e.CollectorJob
		observed.UID = ref.UID
		e, err = r.db.SaveArtifactCollectorJob(ctx, e.ID, e.Version, observed)
		if err != nil {
			return e, err
		}
	}
	pod, err := jobs.Observe(ctx, request, ref)
	if err != nil {
		return e, err
	}
	authority := artifacts.CollectorAuthority{Namespace: e.Source.Namespace, ServiceAccount: pod.ServiceAccount, ServiceAccountUID: pod.ServiceAccountUID, PodName: pod.Name, PodUID: pod.UID, JobUID: pod.JobUID, Audience: artifacts.CollectorAudience, ExpiresAt: ref.ExpiresAt}
	return r.db.BindArtifactCollector(ctx, e.ID, e.Version, authority)
}

// AuthorizeDataCleanup explicitly revokes collection before any destructive
// effect. A committed manifest already required backend-verified object receipts;
// otherwise the separate discard approval must name its actor and reason. The
// original writer's storage fence remains mandatory in both paths.
func (r *Runtime) AuthorizeDataCleanup(ctx context.Context, runID string, a artifacts.GCApproval, jobs *kubernetes.CollectorOwner) (runtimebinding.Binding, error) {
	b, e, err := r.exportBinding(ctx, runID)
	if err != nil {
		return b, err
	}
	if e.Quiescence == nil || e.Quiescence.ComputeReleaseDigest != b.ComputeReceipt.Digest || e.Quiescence.VolumeName != b.Volume.VolumeName {
		return b, artifacts.ErrNotReady
	}
	e, err = r.db.AuthorizeArtifactDataGC(ctx, e.ID, e.Version, a)
	if err != nil {
		return b, err
	}
	if b.DataCleanupReceipt != nil {
		return b, nil
	}
	if e.CollectorJob != nil {
		if jobs == nil {
			return b, artifacts.ErrNotReady
		}
		request, err := r.collectorRequest(b, e)
		if err != nil {
			return b, err
		}
		ref := collectorRef(*e.CollectorJob)
		if ref.UID == "" {
			// Recover the original UID even after collection was revoked. A missing
			// uncertain create remains pending; it is not proof of safe absence.
			ref, err = jobs.Reconcile(ctx, request, ref)
			if err != nil {
				return b, err
			}
			observed := *e.CollectorJob
			observed.UID = ref.UID
			e, err = r.db.SaveArtifactCollectorJob(ctx, e.ID, e.Version, observed)
			if err != nil {
				return b, err
			}
		}
		var pod *kubernetes.CollectorPod
		if e.Collector != nil {
			c := e.Collector
			pod = &kubernetes.CollectorPod{Name: c.PodName, UID: c.PodUID, JobUID: c.JobUID, ServiceAccount: c.ServiceAccount, ServiceAccountUID: c.ServiceAccountUID}
		}
		if err = jobs.Dispose(ctx, request, ref, pod); err != nil {
			return b, err
		}
	}
	receipt, err := r.cold.DeleteVolume(ctx, a.OperationID, r.pvc(b))
	if err != nil {
		return b, err
	}
	approvalDigest, err := artifacts.Digest(*e.GC)
	if err != nil {
		return b, err
	}
	b, err = b.DataCleanup(receipt, approvalDigest)
	if err != nil {
		return b, err
	}
	return r.save(ctx, b)
}
func (r *Runtime) exportBinding(ctx context.Context, runID string) (runtimebinding.Binding, artifacts.Export, error) {
	b, err := r.db.RuntimeBinding(ctx, runID)
	if err != nil {
		return b, artifacts.Export{}, err
	}
	if r.cold == nil || b.Config != r.config || !b.Config.IsIsolated() || b.Volume == nil || b.Volume.VolumeName == "" || b.ComputeReceipt == nil || b.Resource == nil || b.Snapshot == nil || b.Snapshot.Runtime == nil {
		return b, artifacts.Export{}, artifacts.ErrNotReady
	}
	e, err := r.db.ArtifactExport(ctx, "export."+runID)
	if err != nil {
		return b, e, err
	}
	s := e.Source
	if s.RunID != b.RunID || s.Namespace != b.Config.Namespace || s.ClusterID != b.Config.ClusterID || s.PodUID != b.Snapshot.Runtime.ID || s.SandboxUID != b.Resource.Incarnation || s.PVCUID != b.Volume.Resource.Incarnation || s.PVCName != b.Volume.Resource.ID || s.VolumeName != b.Volume.VolumeName {
		return b, e, artifacts.ErrConflict
	}
	return b, e, nil
}
func (r *Runtime) collectorRequest(b runtimebinding.Binding, e artifacts.Export) (kubernetes.CollectorRequest, error) {
	digest, err := artifacts.Digest(struct {
		Source     artifacts.Source
		Quiescence *artifacts.Quiescence
	}{e.Source, e.Quiescence})
	return kubernetes.CollectorRequest{ExportID: e.ID, SourceDigest: digest, PolicyDigest: e.PolicyDigest, PVC: r.pvc(b)}, err
}
func collectorRef(j artifacts.CollectorJob) kubernetes.CollectorRef {
	return kubernetes.CollectorRef{Name: j.Name, UID: j.UID, ConfigDigest: j.ConfigDigest, ExpiresAt: j.ExpiresAt.UTC()}
}
