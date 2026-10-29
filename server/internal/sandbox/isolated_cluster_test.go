package sandbox_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/artifacts/s3"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/runtimeauth"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"github.com/phodal/pero/server/internal/runtimegateway"
	"github.com/phodal/pero/server/internal/sandbox"
	"github.com/phodal/pero/server/internal/store"
)

type fixtureBearer struct {
	token string
	next  http.RoundTripper
}

func (b fixtureBearer) RoundTrip(r *http.Request) (*http.Response, error) {
	copy := r.Clone(r.Context())
	copy.Header = r.Header.Clone()
	copy.Header.Set("Authorization", "Bearer "+b.token)
	return b.next.RoundTrip(copy)
}
func requiredIsolatedEnv(t *testing.T, name string) string {
	t.Helper()
	value := os.Getenv("PERO_ISOLATED_TEST_" + name)
	if value == "" {
		t.Fatalf("PERO_ISOLATED_TEST_%s is required by the owned fixture", name)
	}
	return value
}
func isolatedPrivateValue(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal("private fixture credential unavailable")
	}
	value := strings.TrimSpace(string(data))
	if value == "" {
		t.Fatal("empty private fixture credential")
	}
	return value
}

// A held real Go ACP provider request leaves the actual product Pod alive while
// host-only instrumentation verifies its exact PodUID/runtime/network boundary.
type heldIsolatedModel struct {
	started, release, cancelled chan struct{}
	calls                       atomic.Int64
}

func (m *heldIsolatedModel) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer synthetic-provider" {
		http.Error(w, "fixture mismatch", 400)
		return
	}
	var body struct {
		Model string `json:"model"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || body.Model != "fixture" {
		http.Error(w, "fixture model mismatch", 400)
		return
	}
	m.calls.Add(1)
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(200)
	w.(http.Flusher).Flush()
	select {
	case m.started <- struct{}{}:
	default:
	}
	select {
	case <-m.release:
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"isolated fixture answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	case <-r.Context().Done():
		select {
		case m.cancelled <- struct{}{}:
		default:
		}
	}
}

// TestIsolatedClusterRuntime only consumes the separately authorized disposable
// CI fixture. It neither reads an ambient kubeconfig nor installs infrastructure.
// A dedicated fixture wrapper writes a Run-specific output before unchanged Go
// ACP; this proves runtime durability, not ACP tool-write approval.
func TestIsolatedClusterRuntime(t *testing.T) {
	if os.Getenv("PERO_ISOLATED_ACCEPTANCE") != "1" {
		t.Skip("explicit isolated disposable-cluster acceptance only")
	}
	if os.Getenv("GITHUB_ACTIONS") != "true" {
		t.Fatal("isolated cluster acceptance requires its owned disposable CI runner")
	}
	apiURL := requiredIsolatedEnv(t, "API_URL")
	host := requiredIsolatedEnv(t, "HOST_GATEWAY")
	namespace := requiredIsolatedEnv(t, "NAMESPACE")
	image := requiredIsolatedEnv(t, "IMAGE")
	revision := requiredIsolatedEnv(t, "WORKSPACE_REVISION")
	parsed, err := url.Parse(apiURL)
	if err != nil || parsed.Scheme != "https" || net.ParseIP(parsed.Hostname()) == nil || !net.ParseIP(parsed.Hostname()).IsLoopback() || net.ParseIP(host) == nil || namespace != "pero-isolated-runtime" {
		t.Fatal("owned loopback API, fixed namespace and host gateway required")
	}
	imageParts := strings.Split(image, "@")
	if len(imageParts) != 2 || !strings.HasPrefix(imageParts[1], "sha256:") || len(imageParts[1]) != 71 || len(revision) != 40 {
		t.Fatal("exact image digest and workspace commit required")
	}
	ca, err := os.ReadFile(requiredIsolatedEnv(t, "CA_FILE"))
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		t.Fatal("invalid fixture Kubernetes CA")
	}
	kubeClient := &http.Client{Timeout: 10 * time.Second, Transport: fixtureBearer{isolatedPrivateValue(t, requiredIsolatedEnv(t, "TOKEN_FILE")), &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}}}}
	api := clusterAPI{base: apiURL, client: kubeClient}
	var sa kubernetes.Object
	if err = api.request(t.Context(), http.MethodGet, "/api/v1/namespaces/"+namespace+"/serviceaccounts/pero-agent", nil, &sa); err != nil {
		t.Fatal(err)
	}
	for _, denied := range []struct{ method, path string }{{http.MethodGet, "/api/v1/namespaces/" + namespace + "/secrets"}, {http.MethodPost, "/api/v1/namespaces/" + namespace + "/pods/probe/exec"}, {http.MethodPost, "/api/v1/namespaces/" + namespace + "/serviceaccounts/pero-agent/token"}} {
		if code, err := api.statusMethod(t.Context(), denied.method, denied.path); err != nil || code != http.StatusForbidden {
			t.Fatalf("provider RBAC %s: status=%d err=%v", denied.path, code, err)
		}
	}
	objects, err := s3.New(s3.Config{Endpoint: requiredIsolatedEnv(t, "MINIO_ENDPOINT"), Bucket: os.Getenv("PERO_TEST_S3_BUCKET"), Region: "us-east-1", AccessKey: isolatedPrivateValue(t, requiredIsolatedEnv(t, "MINIO_ACCESS_KEY_FILE")), SecretKey: isolatedPrivateValue(t, requiredIsolatedEnv(t, "MINIO_SECRET_KEY_FILE")), LoopbackHTTP: true})
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := tls.LoadX509KeyPair(requiredIsolatedEnv(t, "CONTROL_TLS_CERT_FILE"), requiredIsolatedEnv(t, "CONTROL_TLS_KEY_FILE"))
	if err != nil {
		t.Fatal("fixture TLS keypair unavailable")
	}
	reviewer, err := runtimeauth.New(apiURL, kubeClient)
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"success", "cancel"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 8*time.Minute)
			defer cancel()
			db := isolatedStore(t)
			config, workerToken := workerConfig(t, db)
			model := &heldIsolatedModel{started: make(chan struct{}, 1), release: make(chan struct{}), cancelled: make(chan struct{}, 1)}
			provider := httptest.NewServer(model)
			defer provider.Close()
			gateway, err := runtimegateway.New(db, reviewer, runtimegateway.ProviderConfig{Endpoint: provider.URL + "/v1/chat/completions", Model: "fixture", APIKey: "synthetic-provider", Budget: runtimechannel.ProviderBudget{MaxRequests: 4, MaxConcurrent: 1, MaxOutputTokens: 256, MaxRequestBytes: 1 << 20, MaxResponseBytes: 1 << 20, TimeoutSeconds: 120}})
			if err != nil {
				t.Fatal(err)
			}
			listener, err := net.Listen("tcp", net.JoinHostPort(host, "0"))
			if err != nil {
				t.Fatal(err)
			}
			defer listener.Close()
			port := fmt.Sprint(listener.Addr().(*net.TCPAddr).Port)
			controlURL := "https://" + net.JoinHostPort(host, port)
			config.Profile = "isolated-agent-v1"
			config.Namespace = namespace
			config.ClusterID = "disposable-isolated-kind"
			config.WarmPool = ""
			config.RuntimeClass = requiredIsolatedEnv(t, "RUNTIME_CLASS")
			config.ServiceAccount = "pero-agent"
			config.ServiceAccountUID = sa.Metadata.UID
			config.Audience = runtimechannel.Audience
			config.ControlURL = controlURL
			config.ControlCAFile = "/etc/pero/control-ca.pem"
			config.ImageRef = image
			config.ImageDigest = imageParts[1]
			config.Model = "fixture"
			config.StorageClass = requiredIsolatedEnv(t, "STORAGE_CLASS")
			config.StorageAccessMode = "ReadWriteOnce"
			config.VolumeSize = "1Gi"
			config.WorkspaceRevision = revision
			config.TTLSeconds = 600
			config.TemplateDigest, err = kubernetes.ColdTemplateDigest(sandbox.IsolatedConfig(config))
			if err != nil {
				t.Fatal(err)
			}
			owner, err := kubernetes.NewColdOwner(apiURL, kubeClient, sandbox.IsolatedConfig(config), time.Now)
			if err != nil {
				t.Fatal(err)
			}
			runtime, err := sandbox.NewIsolated(ctx, db, owner, config, artifacts.Policy{Paths: []string{"repo/artifacts/generated.txt"}, MaxFiles: 1, MaxFileBytes: 1024, MaxTotalBytes: 1024})
			if err != nil {
				t.Fatal(err)
			}
			handler := httpapi.HandlerWithIsolatedRuntime(db, "synthetic-operator", runtime, gateway, reviewer, objects)
			tlsServer := httptest.NewUnstartedServer(handler)
			tlsServer.Listener = listener
			tlsServer.TLS = &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}}
			tlsServer.StartTLS()
			defer tlsServer.Close()
			// External Worker and its bridge are host-local clients. The hostile Pod
			// still uses the independently authenticated HTTPS listener and baked CA.
			workerServer := httptest.NewServer(handler)
			defer workerServer.Close()
			if out, err := exec.CommandContext(ctx, requiredIsolatedEnv(t, "APPLY_POLICY_HELPER"), port).CombinedOutput(); err != nil {
				t.Fatalf("install exact fixture policy: %v %s", err, out)
			}
			runtime.Start(ctx)
			run, b, err := runtime.Dispatch(ctx, task(t, db, "Reply with a short fixture answer; do not run tools or modify files.").ID, "isolated-cluster")
			if err != nil {
				t.Fatal(err)
			}
			if err = until(ctx, func() (bool, error) {
				var e error
				b, e = runtime.Reconcile(ctx, run.ID)
				if e != nil {
					return false, e
				}
				if b.Phase == runtimebinding.Reconcile {
					return false, fmt.Errorf("runtime identity rejected: %s", b.Reason)
				}
				return b.Phase == runtimebinding.Ready, nil
			}); err != nil {
				t.Fatalf("isolated admission: %v reason=%s", err, b.Reason)
			}
			if b.Snapshot == nil || b.Volume == nil || b.Volume.VolumeName == "" || b.Snapshot.Artifacts[0].Digest != imageParts[1] {
				t.Fatalf("missing exact runtime/storage tuple: %+v", b)
			}
			private := t.TempDir()
			workerConfigFile := filepath.Join(private, "worker.json")
			writeJSON(t, workerConfigFile, map[string]any{"remote_bridge": requiredIsolatedEnv(t, "BRIDGE_BINARY")})
			worker := os.Getenv("PERO_TEST_WORKER_BIN")
			if !filepath.IsAbs(worker) {
				t.Fatal("PERO_TEST_WORKER_BIN must name reviewed external Worker binary")
			}
			command := exec.CommandContext(ctx, worker, "--once")
			command.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=" + private, "TMPDIR=" + private, "LANG=C.UTF-8", "PERO_CLOUD_URL=" + workerServer.URL, "PERO_WORKER_TOKEN=" + workerToken, "PERO_WORKER_CONFIG=" + workerConfigFile, "PERO_WORKER_STATE=" + filepath.Join(private, "journal.json")}
			var output bytes.Buffer
			command.Stdout = &output
			command.Stderr = &output
			if err = command.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- command.Wait() }()
			settled := false
			defer func() {
				if !settled {
					cancel()
					<-done
				}
			}()
			select {
			case <-model.started:
			case e := <-done:
				settled = true
				t.Fatalf("Worker ended before provider: %v %s", e, output.String())
			case <-ctx.Done():
				t.Fatal("real Go ACP provider request not observed")
			}
			proof, err := exec.CommandContext(ctx, requiredIsolatedEnv(t, "PROBE_POD_HELPER"), b.Resource.ID, b.Snapshot.Runtime.ID, port).CombinedOutput()
			if err != nil {
				t.Fatalf("exact product Pod runtime/network proof: %v %s", err, proof)
			}
			var evidence struct {
				Kind     string `json:"kind"`
				PodUID   string `json:"pod_uid"`
				Runtime  string `json:"runtime"`
				Stable   bool   `json:"identity_stable"`
				Artifact struct {
					RunID  string `json:"run_id"`
					Nonce  string `json:"nonce"`
					SHA256 string `json:"sha256"`
					Bytes  int64  `json:"bytes"`
				} `json:"generated_artifact"`
			}
			if json.Unmarshal(bytes.TrimSpace(proof), &evidence) != nil || evidence.Kind != "product-controlled-probe" || evidence.PodUID != b.Snapshot.Runtime.ID || evidence.Runtime != "io.containerd.runsc.v1" || !evidence.Stable {
				t.Fatal("missing exact runsc/product PodUID evidence")
			}
			nonce, nonceErr := hex.DecodeString(evidence.Artifact.Nonce)
			expectedArtifact, _ := json.Marshal(struct {
				RunID string `json:"run_id"`
				Nonce string `json:"nonce"`
			}{run.ID, evidence.Artifact.Nonce})
			expectedArtifact = append(expectedArtifact, '\n')
			expectedHash := sha256.Sum256(expectedArtifact)
			if nonceErr != nil || len(nonce) != 32 || hex.EncodeToString(nonce) != evidence.Artifact.Nonce || evidence.Artifact.RunID != run.ID || evidence.Artifact.Bytes != int64(len(expectedArtifact)) || evidence.Artifact.SHA256 != "sha256:"+hex.EncodeToString(expectedHash[:]) {
				t.Fatal("runtime-generated fixture output identity/digest mismatch")
			}
			if scenario == "cancel" {
				if _, err = runtime.Release(ctx, run.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				close(model.release)
			}
			select {
			case e := <-done:
				settled = true
				if e != nil {
					t.Fatalf("real Worker failed: %v %s", e, output.String())
				}
			case <-ctx.Done():
				t.Fatal("external Worker did not settle")
			}
			want := "succeeded"
			if scenario == "cancel" {
				want = "cancelled"
				select {
				case <-model.cancelled:
				case <-ctx.Done():
					t.Fatal("provider request was not cancelled")
				}
			}
			result, err := db.RuntimeRun(ctx, run.ID)
			if err != nil || result.Status != want || model.calls.Load() != 1 {
				t.Fatalf("execution result: status=%v calls=%d err=%v output=%s", result, model.calls.Load(), err, output.String())
			}
			events, err := db.Events(ctx, run.ID)
			if err != nil || len(events.Events) == 0 {
				t.Fatal("durable real process events missing")
			}
			encoded, _ := json.Marshal(events)
			if strings.Contains(string(encoded), workerToken) || strings.Contains(string(encoded), "synthetic-provider") {
				t.Fatal("trusted credential leaked into events")
			}
			b, err = runtime.Release(ctx, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if err = until(ctx, func() (bool, error) {
				var e error
				b, e = runtime.Reconcile(ctx, run.ID)
				return e == nil && b.ComputeReceipt != nil, e
			}); err != nil {
				t.Fatalf("compute cleanup: %v", err)
			}
			if b.Phase != runtimebinding.CleanupPending || b.Reason != "DataExportPending" || b.CleanupReceipt != nil {
				t.Fatal("compute cleanup released retained workspace")
			}
			for _, path := range []string{"/apis/" + kubernetes.SandboxAPI + "/namespaces/" + namespace + "/sandboxes/" + b.Resource.ID, "/api/v1/namespaces/" + namespace + "/pods/" + b.Resource.ID} {
				if code, err := api.status(ctx, path); err != nil || code != 404 {
					t.Fatalf("original compute still present: %s status=%d err=%v", path, code, err)
				}
			}
			pvc, err := owner.ObserveVolume(ctx, kubernetes.PVCRef{Name: b.Volume.Resource.ID, Namespace: namespace, UID: b.Volume.Resource.Incarnation, VolumeName: b.Volume.VolumeName, StorageClass: config.StorageClass, AccessMode: config.StorageAccessMode, VolumeSize: config.VolumeSize, RequestID: b.RequestID, ConfigDigest: b.Volume.ProviderDigest})
			if err != nil || pvc.UID != b.Volume.Resource.Incarnation || pvc.VolumeName != b.Volume.VolumeName {
				t.Fatal("retained independent workspace identity changed")
			}
			export, err := db.ArtifactExport(ctx, "export."+run.ID)
			if err != nil || export.Source.VolumeName != pvc.VolumeName || export.Source.PodUID != b.Snapshot.Runtime.ID || export.Source.PVCUID != pvc.UID || export.Source.ImageDigest != config.ImageDigest {
				t.Fatalf("frozen artifact tuple unavailable: %+v %v", export, err)
			}
			writeJSON(t, filepath.Join(requiredIsolatedEnv(t, "EVIDENCE"), "execution-before-export-"+scenario+".json"), map[string]any{"scenario": scenario, "run_id": run.ID, "status": result.Status, "provider_calls": model.calls.Load(), "events": len(events.Events), "compute_receipt": b.ComputeReceipt, "source": export.Source, "phase": b.Phase, "artifact_export_committed": false})
			b, export = verifyIsolatedClusterArtifacts(t, ctx, runtime, db, owner, api, objects, b, export, controlURL, expectedArtifact)
			evidencePath := filepath.Join(requiredIsolatedEnv(t, "EVIDENCE"), "execution-"+scenario+".json")
			writeJSON(t, evidencePath, map[string]any{"scenario": scenario, "run_id": run.ID, "generation": run.Generation, "status": result.Status, "source": export.Source, "compute_receipt": b.ComputeReceipt, "data_cleanup_receipt": b.DataCleanupReceipt, "manifest_digest": export.Manifest.Digest, "artifact_entry": export.Manifest.Entries[0], "storage_fence_digest": export.Quiescence.StorageFenceDigest, "phase": b.Phase, "provider_calls": model.calls.Load(), "events": len(events.Events), "artifact_fixture": "Run-specific file written by dedicated test wrapper before unchanged Go ACP; not ACP tool approval", "generated_artifact": evidence.Artifact, "storage_scope": "single owned node; RWO is not a CSI/node-failover fencing proof"})
			t.Logf("isolated actual Worker+bridge+Agent: scenario=%s run=%s sandbox_uid=%s pod_uid=%s pvc_uid=%s pv=%s image=%s", scenario, run.ID, b.Resource.Incarnation, b.Snapshot.Runtime.ID, pvc.UID, pvc.VolumeName, config.ImageDigest)
		})
	}
}

// The runtime-generated fixture file is collected only after a real owned-node
// writer-quiescence proof. This is deliberately not general CSI fencing support.
func verifyIsolatedClusterArtifacts(t *testing.T, ctx context.Context, runtime *sandbox.Runtime, db *store.Store, owner *kubernetes.ColdOwner, api clusterAPI, objects *s3.Store, b runtimebinding.Binding, export artifacts.Export, controlURL string, expectedArtifact []byte) (runtimebinding.Binding, artifacts.Export) {
	t.Helper()
	proof, err := exec.CommandContext(ctx, requiredIsolatedEnv(t, "STORAGE_FENCE_HELPER"), b.Resource.ID, b.Snapshot.Runtime.ID, b.Resource.ID, b.Resource.Incarnation, b.Volume.Resource.ID, b.Volume.Resource.Incarnation, b.Volume.VolumeName).CombinedOutput()
	if err != nil {
		t.Fatalf("owned-node storage quiescence: %v %s", err, proof)
	}
	var fence struct {
		Kind       string `json:"kind"`
		PodUID     string `json:"pod_uid"`
		SandboxUID string `json:"sandbox_uid"`
		PVCUID     string `json:"pvc_uid"`
		VolumeName string `json:"volume_name"`
		Scope      string `json:"scope"`
		Node       string `json:"node"`
		Quiescent  bool   `json:"quiescent"`
	}
	if json.Unmarshal(bytes.TrimSpace(proof), &fence) != nil || fence.Kind != "single-node-storage-quiescence" || fence.PodUID != b.Snapshot.Runtime.ID || fence.SandboxUID != b.Resource.Incarnation || fence.PVCUID != b.Volume.Resource.Incarnation || fence.VolumeName != b.Volume.VolumeName || fence.Scope != "single-owned-node-no-partition-failover" || fence.Node == "" || !fence.Quiescent {
		t.Fatal("missing exact owned-node storage-fence evidence")
	}
	hash := sha256.Sum256(proof)
	q := artifacts.Quiescence{PodUID: b.Snapshot.Runtime.ID, PVCUID: b.Volume.Resource.Incarnation, VolumeName: b.Volume.VolumeName, ComputeReleaseDigest: b.ComputeReceipt.Digest, StorageFenceDigest: "sha256:" + hex.EncodeToString(hash[:]), ObservedAt: time.Now().UTC()}
	collectorImage := requiredIsolatedEnv(t, "COLLECTOR_IMAGE")
	parts := strings.Split(collectorImage, "@")
	if len(parts) != 2 {
		t.Fatal("collector image digest required")
	}
	var sa kubernetes.Object
	if err = api.request(ctx, http.MethodGet, "/api/v1/namespaces/"+b.Config.Namespace+"/serviceaccounts/pero-artifact-collector", nil, &sa); err != nil {
		t.Fatal(err)
	}
	jobs, err := kubernetes.NewCollectorOwner(owner, kubernetes.CollectorConfig{ImageRef: collectorImage, ImageDigest: parts[1], RuntimeClass: b.Config.RuntimeClass, ServiceAccountName: "pero-artifact-collector", ServiceAccountUID: sa.Metadata.UID, ControlURL: controlURL, ControlCAFile: "/etc/pero/control-ca.pem"})
	if err != nil {
		t.Fatal(err)
	}
	var latest error
	if err = until(ctx, func() (bool, error) {
		var e error
		export, e = runtime.AdvanceExport(ctx, b.RunID, q, jobs)
		latest = e
		if e != nil {
			if errors.Is(e, kubernetes.ErrNotFound) || errors.Is(e, artifacts.ErrNotReady) || errors.Is(e, store.ErrConflict) {
				return false, nil
			}
			return false, e
		}
		return export.Manifest != nil, nil
	}); err != nil {
		recordCollectorFailure(t, ctx, api, db, b.RunID, b.Config.Namespace)
		t.Fatalf("trusted collector did not commit: %v last=%v", err, latest)
	}
	if export.Phase != artifacts.Committed || export.Manifest == nil || len(export.Manifest.Entries) != 1 || export.Collector == nil || export.CollectorJob == nil || export.Manifest.Source != export.Source || export.Source.VolumeName != b.Volume.VolumeName {
		t.Fatalf("durable artifact receipt incomplete: %+v", export)
	}
	entry := export.Manifest.Entries[0]
	content, err := objects.Read(ctx, entry)
	if err != nil || !bytes.Equal(content, expectedArtifact) || entry.Path != "repo/artifacts/generated.txt" {
		t.Fatalf("private S3 round-trip failed: entry=%+v err=%v", entry, err)
	}
	// The fixture bucket is private: possessing a manifest object key is not a
	// public download grant and reveals no storage credential or signed URL.
	anonymous, err := http.NewRequestWithContext(ctx, http.MethodGet, requiredIsolatedEnv(t, "MINIO_ENDPOINT")+"/"+os.Getenv("PERO_TEST_S3_BUCKET")+"/"+entry.ObjectKey, nil)
	if err != nil {
		t.Fatal(err)
	}
	anonymousClient := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{}}
	response, err := anonymousClient.Do(anonymous)
	if err != nil {
		t.Fatal("anonymous private-object check unavailable")
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("private object anonymous HTTP status %d", response.StatusCode)
	}
	// The collector can finish without a data-deletion grant. Prove that ordinary
	// release still retains the PVC even after a durable manifest exists.
	retained, err := runtime.Release(ctx, b.RunID)
	if err != nil || retained.Phase != runtimebinding.CleanupPending || retained.DataCleanupReceipt != nil {
		t.Fatal("manifest silently authorized PVC destruction")
	}
	if code, err := api.status(ctx, "/api/v1/namespaces/"+b.Config.Namespace+"/persistentvolumeclaims/"+b.Volume.Resource.ID); err != nil || code != 200 {
		t.Fatal("PVC disappeared before explicit GC approval")
	}
	approval := artifacts.GCApproval{OperationID: "gc." + b.RunID, ActorID: "isolated-ci-operator", ManifestDigest: export.Manifest.Digest, ApprovedAt: time.Now().UTC()}
	if err = until(ctx, func() (bool, error) {
		var e error
		b, e = runtime.AuthorizeDataCleanup(ctx, b.RunID, approval, jobs)
		latest = e
		if e != nil {
			return false, nil
		}
		return b.Phase == runtimebinding.Released, nil
	}); err != nil {
		t.Fatalf("explicit data cleanup did not settle: %v last=%v", err, latest)
	}
	if b.ComputeReceipt == nil || b.DataCleanupReceipt == nil || b.CleanupReceipt == nil || b.Volume == nil {
		t.Fatal("cleanup lost immutable data/compute receipts")
	}
	if code, err := api.status(ctx, "/api/v1/namespaces/"+b.Config.Namespace+"/persistentvolumeclaims/"+b.Volume.Resource.ID); err != nil || code != 404 {
		t.Fatal("original PVC still exists after settled GC receipt")
	}
	if again, err := runtime.AuthorizeDataCleanup(ctx, b.RunID, approval, jobs); err != nil || again.DataCleanupReceipt == nil || *again.DataCleanupReceipt != *b.DataCleanupReceipt {
		t.Fatal("explicit GC replay changed settled receipt")
	}
	after, err := db.ArtifactExport(ctx, export.ID)
	if err != nil || after.Manifest == nil || after.Manifest.Digest != export.Manifest.Digest || after.GC == nil {
		t.Fatal("data cleanup erased artifact manifest")
	}
	if data, err := objects.Read(ctx, entry); err != nil || !bytes.Equal(data, content) {
		t.Fatal("artifact did not survive source-volume deletion")
	}
	return b, after
}
