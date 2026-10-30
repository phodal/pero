package sandbox_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"github.com/phodal/pero/server/internal/sandbox"
	"github.com/phodal/pero/server/internal/store"
)

func newColdRuntime(t *testing.T, db *store.Store) (*sandbox.Runtime, *kubeFixture, runtimebinding.Config) {
	t.Helper()
	c, _ := workerConfig(t, db)
	c.Profile = "isolated-agent-v1"
	c.WarmPool = ""
	c.RuntimeClass = "gvisor"
	c.ServiceAccount = "agent"
	c.ServiceAccountUID = "sa-uid"
	c.Audience = "pero-runtime"
	c.ControlURL = "https://control.invalid"
	c.ImageRef = "registry.invalid/agent@" + fixtureDigest
	c.Model = "fixture"
	c.StorageClass = "fixture"
	c.StorageAccessMode = "ReadWriteOncePod"
	c.VolumeSize = "1Gi"
	c.TemplateDigest, _ = kubernetes.ColdTemplateDigest(sandbox.IsolatedConfig(c))
	k := &kubeFixture{cold: true, objects: map[string]map[string]any{}}
	k.objects["/api/v1/namespaces/fixture/serviceaccounts/agent"] = map[string]any{"apiVersion": "v1", "kind": "ServiceAccount", "metadata": metadata("agent", "fixture", "sa-uid")}
	api := httptest.NewServer(k)
	k.apiURL = api.URL
	t.Cleanup(api.Close)
	owner, err := kubernetes.NewColdOwner(api.URL, api.Client(), sandbox.IsolatedConfig(c), time.Now)
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := sandbox.NewIsolated(t.Context(), db, owner, c, artifacts.Policy{Paths: []string{"result.txt"}, MaxFiles: 1, MaxFileBytes: 1024, MaxTotalBytes: 1024, AllowMissing: true})
	if err != nil {
		t.Fatal(err)
	}
	return runtime, k, c
}

// Extend the existing single HTTP Kubernetes seam with the core Sandbox/PVC
// controller projection. This is not a claim that a real CSI or runtime exists.
func (k *kubeFixture) serveCold(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		_, uid, _ := strings.Cut(r.URL.Query().Get("labelSelector"), "=")
		items := []any{}
		for path, object := range k.objects {
			if strings.Contains(path, "/pods/") {
				meta := object["metadata"].(map[string]any)
				labels, _ := meta["labels"].(map[string]any)
				if labels["batch.kubernetes.io/controller-uid"] == uid {
					items = append(items, object)
				}
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"apiVersion": "v1", "kind": "PodList", "items": items})
		return
	}

	if r.Method == http.MethodPost {
		k.posts++
		var object map[string]any
		if json.NewDecoder(r.Body).Decode(&object) != nil {
			w.WriteHeader(400)
			return
		}
		meta := object["metadata"].(map[string]any)
		name := meta["name"].(string)
		path := r.URL.Path + "/" + name
		if k.objects[path] != nil {
			w.WriteHeader(409)
			return
		}
		meta["resourceVersion"], meta["generation"] = "1", 1
		if object["kind"] == "PersistentVolumeClaim" {
			meta["uid"] = "pvc-uid"
			object["status"] = map[string]any{"phase": "Pending"}
			k.volumePath = path
		} else if object["kind"] == "Sandbox" {
			meta["uid"] = "sandbox-uid"
			object["status"] = map[string]any{"conditions": ready(1)}
			k.claimPath = path
			spec := object["spec"].(map[string]any)["podTemplate"].(map[string]any)["spec"]
			podmeta := metadata(name, "fixture", "pod-uid")
			podmeta["ownerReferences"] = ownerRef(kubernetes.SandboxAPI, "Sandbox", name, "sandbox-uid")
			k.podPath = "/api/v1/namespaces/fixture/pods/" + name
			k.objects[k.podPath] = map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": podmeta, "spec": spec, "status": map[string]any{"phase": "Running", "conditions": ready(0), "containerStatuses": []any{map[string]any{"name": "agent", "containerID": "containerd://cold", "imageID": "registry.invalid/agent@" + fixtureDigest, "restartCount": 0, "ready": true, "state": map[string]any{"running": map[string]any{}}}}}}
			k.objects[k.volumePath]["spec"].(map[string]any)["volumeName"] = "pv-frozen"
			k.objects[k.volumePath]["status"] = map[string]any{"phase": "Bound"}
		} else if object["kind"] == "Job" {
			meta["uid"] = "job-uid"
			template := object["spec"].(map[string]any)["template"].(map[string]any)
			spec := template["spec"]
			labels := template["metadata"].(map[string]any)["labels"].(map[string]any)
			podmeta := metadata(name+"-pod", "fixture", "collector-pod-uid")
			podmeta["labels"] = map[string]any{"environments.sandbox.users.io/spec": labels["environments.sandbox.users.io/spec"], "batch.kubernetes.io/controller-uid": "job-uid"}
			podmeta["ownerReferences"] = ownerRef("batch/v1", "Job", name, "job-uid")
			k.objects["/api/v1/namespaces/fixture/pods/"+name+"-pod"] = map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": podmeta, "spec": spec, "status": map[string]any{"containerStatuses": []any{map[string]any{"name": "collector", "imageID": "registry.invalid/collector@" + fixtureDigest}}}}
		} else {
			w.WriteHeader(400)
			return
		}
		k.objects[path] = object
		if k.loseCreate || k.loseColdSandbox && object["kind"] == "Sandbox" {
			k.loseCreate = false
			k.loseColdSandbox = false
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(object)
		return
	}
	k.deletes++
	var options struct {
		PropagationPolicy string `json:"propagationPolicy"`
		Preconditions     struct {
			UID string `json:"uid"`
		} `json:"preconditions"`
	}
	if json.NewDecoder(r.Body).Decode(&options) != nil || options.PropagationPolicy != "Foreground" || options.Preconditions.UID == "" {
		w.WriteHeader(400)
		return
	}
	object := k.objects[r.URL.Path]
	if object == nil {
		w.WriteHeader(404)
		return
	}
	if object["metadata"].(map[string]any)["uid"] != options.Preconditions.UID {
		w.WriteHeader(409)
		return
	}
	k.deletedUIDs = append(k.deletedUIDs, options.Preconditions.UID)
	if k.linger {
		object["metadata"].(map[string]any)["deletionTimestamp"] = time.Now().UTC().Format(time.RFC3339)
	} else {
		delete(k.objects, r.URL.Path)
		if object["kind"] == "Sandbox" {
			delete(k.objects, k.podPath)
		}
		if object["kind"] == "Job" {
			delete(k.objects, "/api/v1/namespaces/fixture/pods/"+object["metadata"].(map[string]any)["name"].(string)+"-pod")
		}
	}
	if k.loseDelete {
		k.loseDelete = false
		conn, _, _ := w.(http.Hijacker).Hijack()
		conn.Close()
		return
	}
	w.WriteHeader(200)
}
func TestIsolatedRuntimeRetainsWorkspaceAfterComputeCleanup(t *testing.T) {
	db := isolatedStore(t)
	runtime, k, c := newColdRuntime(t, db)
	run, b, err := runtime.Dispatch(t.Context(), task(t, db, "isolated result").ID, "cold-dispatch")
	if err != nil || b.Phase != runtimebinding.Ready || b.Volume == nil || b.Volume.VolumeName != "pv-frozen" || b.Snapshot.Runtime.ID != "pod-uid" {
		t.Fatalf("ready: %+v %v", b, err)
	}
	export, err := db.ArtifactExport(t.Context(), "export."+run.ID)
	if err != nil || export.Source.PVCUID != "pvc-uid" || export.Source.VolumeName != "pv-frozen" || export.Source.SandboxUID != "sandbox-uid" || export.Source.PodUID != "pod-uid" || export.Source.ProjectID != c.ProjectID || export.Source.Generation != run.Generation || export.Phase != artifacts.Reserved {
		t.Fatalf("source reserve: %+v %v", export, err)
	}
	duplicate, _, err := runtime.Dispatch(t.Context(), run.TaskID, "cold-dispatch")
	if err != nil || duplicate.ID != run.ID {
		t.Fatal("dispatch replayed Run")
	}
	claimed, err := db.Claim(t.Context(), c.WorkerID, "trusted-worker", "claim")
	if err != nil || claimed == nil || claimed.ID != run.ID || claimed.RemoteExecution == nil || claimed.RemoteExecution.SessionID != run.ID {
		t.Fatalf("outside Worker: %+v %v", claimed, err)
	}
	if _, err = db.ReserveRuntimeChannel(t.Context(), run.ID, c.WorkerID, "trusted-worker", run.Generation, run.ID, strings.Repeat("a", 64), runtimechannel.ProviderBudget{MaxRequests: 1, MaxConcurrent: 1, MaxOutputTokens: 32, MaxRequestBytes: 1024, MaxResponseBytes: 1024, TimeoutSeconds: 5}); err != nil {
		t.Fatal(err)
	}
	if _, err = db.AppendEvents(t.Context(), run.ID, c.WorkerID, "trusted-worker", run.Generation, []store.Event{{Seq: 1, Kind: "message", Text: "isolated event", Data: json.RawMessage(`{}`)}}); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Complete(t.Context(), run.ID, c.WorkerID, "trusted-worker", run.Generation, store.Completion{Outcome: "succeeded", Summary: "retained isolated result"}); err != nil {
		t.Fatal(err)
	}
	k.change(func(k *kubeFixture) { k.loseDelete = true })
	b, err = runtime.Release(t.Context(), run.ID)
	if err != nil || b.Phase != runtimebinding.CleanupPending || b.ComputeReceipt != nil {
		t.Fatalf("lost cleanup: %+v %v", b, err)
	}
	b, err = runtime.Reconcile(t.Context(), run.ID)
	if err != nil || b.Phase != runtimebinding.CleanupPending || b.Reason != "DataExportPending" || b.ComputeReceipt == nil || b.CleanupReceipt != nil {
		t.Fatalf("retention: %+v %v", b, err)
	}
	if channel, err := db.RuntimeChannel(t.Context(), run.ID); err != nil || channel.State != runtimechannel.Closed {
		t.Fatalf("channel survived terminal release: %+v %v", channel, err)
	}
	if _, err = runtime.Release(t.Context(), run.ID); err != nil {
		t.Fatal(err)
	}
	k.change(func(k *kubeFixture) {
		if k.posts != 2 || k.deletes != 1 || k.objects[k.volumePath] == nil || strings.Join(k.deletedUIDs, ",") != "sandbox-uid" {
			t.Fatalf("unsafe resource effects posts=%d deletes=%d UIDs=%v", k.posts, k.deletes, k.deletedUIDs)
		}
	})
	retained, err := db.RuntimeRun(t.Context(), run.ID)
	if err != nil || retained.Status != "succeeded" || retained.Summary != "retained isolated result" {
		t.Fatalf("result lost: %+v %v", retained, err)
	}
	events, err := db.Events(t.Context(), run.ID)
	if err != nil || len(events.Events) != 1 || events.Events[0].Text != "isolated event" {
		t.Fatalf("events lost: %+v %v", events, err)
	}
	if _, _, err = runtime.Dispatch(t.Context(), task(t, db, "second run").ID, "second"); err == nil {
		t.Fatal("retained-data slot silently released")
	}
}
func TestIsolatedUnknownCreatesNeverMakeFreshResources(t *testing.T) {
	for _, stage := range []string{"volume", "sandbox"} {
		t.Run(stage, func(t *testing.T) {
			db := isolatedStore(t)
			runtime, k, _ := newColdRuntime(t, db)
			k.loseCreate = stage == "volume"
			k.loseColdSandbox = stage == "sandbox"
			run, b, err := runtime.Dispatch(t.Context(), task(t, db, "no replay").ID, "dispatch")
			if err != nil || b.Phase != runtimebinding.Pending {
				t.Fatalf("unknown effect: %+v %v", b, err)
			}
			b, err = runtime.Reconcile(t.Context(), run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stage == "volume" {
				if b.Volume == nil || b.Resource != nil || b.Reason != "SandboxUnconfirmed" || b.ValidUntil != nil {
					t.Fatalf("unattempted Sandbox created: %+v", b)
				}
			} else if b.Phase != runtimebinding.Ready || b.Resource.Incarnation != "sandbox-uid" {
				t.Fatalf("original Sandbox not reconciled: %+v", b)
			}
			k.change(func(k *kubeFixture) {
				expected := 2
				if stage == "volume" {
					expected = 1
				}
				if k.posts != expected {
					t.Fatalf("POST replay %d", k.posts)
				}
			})
		})
	}
}

func TestIsolatedCancellationRetainsBoundWorkspace(t *testing.T) {
	db := isolatedStore(t)
	runtime, k, c := newColdRuntime(t, db)
	run, _, err := runtime.Dispatch(t.Context(), task(t, db, "cancel isolated").ID, "cancel-dispatch")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Claim(t.Context(), c.WorkerID, "trusted-worker", "claim"); err != nil {
		t.Fatal(err)
	}
	b, err := runtime.Release(t.Context(), run.ID)
	if err != nil || b.ComputeReceipt != nil || b.ValidUntil == nil {
		t.Fatalf("cleanup before Worker settlement: %+v %v", b, err)
	}
	if _, err = db.Complete(t.Context(), run.ID, c.WorkerID, "trusted-worker", run.Generation, store.Completion{Outcome: "cancelled", Summary: "cancelled safely"}); err != nil {
		t.Fatal(err)
	}
	b, err = runtime.Reconcile(t.Context(), run.ID)
	if err != nil || b.ComputeReceipt == nil || b.Phase != runtimebinding.CleanupPending || b.Reason != "DataExportPending" {
		t.Fatalf("cancellation retention: %+v %v", b, err)
	}
	k.change(func(k *kubeFixture) {
		if k.deletes != 1 || k.objects[k.volumePath] == nil {
			t.Fatal("cancellation destroyed workspace")
		}
	})
	retained, err := db.RuntimeRun(t.Context(), run.ID)
	if err != nil || retained.Status != "cancelled" {
		t.Fatalf("cancellation receipt changed: %+v %v", retained, err)
	}
}
