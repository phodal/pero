package sandbox_test

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/sandbox"
	"github.com/phodal/pero/server/internal/store"
)

func TestIsolatedExportAndExplicitDataCleanupReceipts(t *testing.T) {
	db := isolatedStore(t)
	runtime, k, c := newColdRuntime(t, db)
	cold, err := kubernetes.NewColdOwner(k.apiURL, http.DefaultClient, sandbox.IsolatedConfig(c), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	jobs, err := kubernetes.NewCollectorOwner(cold, kubernetes.CollectorConfig{ImageRef: "registry.invalid/collector@" + fixtureDigest, ImageDigest: fixtureDigest, RuntimeClass: c.RuntimeClass, ServiceAccountName: "collector", ServiceAccountUID: "collector-sa", ControlURL: c.ControlURL})
	if err != nil {
		t.Fatal(err)
	}
	k.change(func(k *kubeFixture) {
		k.objects["/api/v1/namespaces/fixture/serviceaccounts/collector"] = map[string]any{"apiVersion": "v1", "kind": "ServiceAccount", "metadata": metadata("collector", "fixture", "collector-sa")}
	})
	run, _, err := runtime.Dispatch(t.Context(), task(t, db, "retained artifact").ID, "dispatch")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Claim(t.Context(), c.WorkerID, "trusted-worker", "claim"); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Complete(t.Context(), run.ID, c.WorkerID, "trusted-worker", run.Generation, store.Completion{Outcome: "cancelled", Summary: "cancelled with retained data"}); err != nil {
		t.Fatal(err)
	}
	b, err := runtime.Release(t.Context(), run.ID)
	if err != nil || b.ComputeReceipt == nil {
		t.Fatal(b, err)
	}
	q := artifacts.Quiescence{PodUID: b.Snapshot.Runtime.ID, PVCUID: b.Volume.Resource.Incarnation, VolumeName: b.Volume.VolumeName, ComputeReleaseDigest: b.ComputeReceipt.Digest, StorageFenceDigest: "sha256:" + strings.Repeat("f", 64), ObservedAt: time.Now().UTC()}
	wrong := q
	wrong.VolumeName = "different-pv"
	if _, err = runtime.AdvanceExport(t.Context(), run.ID, wrong, jobs); err == nil {
		t.Fatal("wrong volume fence accepted")
	}
	k.change(func(k *kubeFixture) { k.loseCreate = true })
	if _, err = runtime.AdvanceExport(t.Context(), run.ID, q, jobs); err == nil {
		t.Fatal("lost Job create reply reported confirmed")
	}
	e, err := db.ArtifactExport(t.Context(), "export."+run.ID)
	if err != nil || e.CollectorJob == nil || e.CollectorJob.UID != "" {
		t.Fatal("durable unconfirmed reservation missing", e, err)
	}
	e, err = runtime.AdvanceExport(t.Context(), run.ID, q, jobs)
	if err != nil || e.Collector == nil || e.Collector.PodUID != "collector-pod-uid" {
		t.Fatal(e, err)
	}
	k.change(func(k *kubeFixture) {
		if k.posts != 3 {
			t.Fatal("Job creation repeated", k.posts)
		}
	})
	// A terminal failed collector is not an export receipt and must not create
	// another Job or release the retained workspace without a manifest.
	k.change(func(k *kubeFixture) {
		for path, object := range k.objects {
			if strings.Contains(path, "/jobs/") {
				object["status"] = map[string]any{"failed": 1, "conditions": []any{map[string]any{"type": "Failed", "status": "True"}}}
			}
			if object["kind"] == "Pod" && object["metadata"].(map[string]any)["uid"] == e.Collector.PodUID {
				object["status"] = map[string]any{"phase": "Failed", "containerStatuses": []any{map[string]any{"name": "collector", "imageID": "registry.invalid/collector@" + fixtureDigest, "state": map[string]any{"terminated": map[string]any{"exitCode": 1}}}}}
			}
		}
	})
	failed, err := runtime.AdvanceExport(t.Context(), run.ID, q, jobs)
	if err != nil || failed.CollectorJob.UID != e.CollectorJob.UID || failed.Manifest != nil {
		t.Fatal("failed collector replaced or treated as committed", failed, err)
	}
	approval := artifacts.GCApproval{OperationID: "gc.original", ActorID: "operator", ManifestDigest: fixtureDigest, ApprovedAt: time.Now().UTC()}
	if _, err = runtime.AuthorizeDataCleanup(t.Context(), run.ID, approval, jobs); err == nil {
		t.Fatal("data cleanup before manifest")
	}
	k.change(func(k *kubeFixture) {
		if k.posts != 3 || k.objects[k.volumePath] == nil {
			t.Fatal("failed collector created fresh resources or deleted retained PVC", k.posts)
		}
	})
	// This cancellation selected an explicitly optional file which was never
	// created. The committed partial manifest is exhaustive, not an output claim.
	manifest, err := artifacts.NewManifest(e.Source, e.Policy, e.ID, nil, []string{"result.txt"}, q.ObservedAt)
	if err != nil {
		t.Fatal(err)
	}
	e, err = db.CommitArtifactManifest(t.Context(), e.ID, e.Version, manifest)
	if err != nil {
		t.Fatal(err)
	}
	approval.ManifestDigest = manifest.Digest
	approval.ApprovedAt = time.Now().UTC()
	k.change(func(k *kubeFixture) { k.linger = true })
	if _, err = runtime.AuthorizeDataCleanup(t.Context(), run.ID, approval, jobs); err == nil {
		t.Fatal("lingering collector permitted PVC cleanup")
	}
	k.change(func(k *kubeFixture) {
		if k.objects[k.volumePath] == nil {
			t.Fatal("retained PVC deleted before collector gone")
		}
		k.linger = false
		k.loseDelete = true
	})
	if _, err = runtime.AuthorizeDataCleanup(t.Context(), run.ID, approval, jobs); err == nil {
		t.Fatal("lost Job delete reply reported confirmed")
	}
	k.change(func(k *kubeFixture) { k.loseDelete = true })
	if _, err = runtime.AuthorizeDataCleanup(t.Context(), run.ID, approval, jobs); err == nil {
		t.Fatal("lost PVC delete reply reported confirmed")
	}
	b, err = runtime.AuthorizeDataCleanup(t.Context(), run.ID, approval, jobs)
	if err != nil || b.Phase != runtimebinding.Released || b.DataCleanupReceipt == nil {
		t.Fatal(b, err)
	}
	again, err := runtime.AuthorizeDataCleanup(t.Context(), run.ID, approval, jobs)
	if err != nil || again.Version != b.Version {
		t.Fatal("data cleanup receipt not idempotent", again, err)
	}
	final, err := db.ArtifactExport(t.Context(), e.ID)
	if err != nil || final.Manifest == nil || final.Manifest.Digest != manifest.Digest || final.GC == nil {
		t.Fatal("immutable manifest/approval lost", final, err)
	}
	retained, err := db.RuntimeRun(t.Context(), run.ID)
	if err != nil || retained.Status != "cancelled" {
		t.Fatal("data lifetime rewrote Run", retained, err)
	}
}
