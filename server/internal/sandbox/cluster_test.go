package sandbox_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/sandbox"
)

// TestClusterRuntime is deliberately unavailable on an existing/local cluster.
// The CI job owns a disposable kind cluster and installs the pinned controller.
// All credentials/data here are synthetic and scoped to generated namespaces.
// This is trusted-Worker lifecycle acceptance, NOT CNI/hostile-code isolation.
func TestClusterRuntime(t *testing.T) {
	if os.Getenv("PERO_SANDBOX_CLUSTER_E2E") != "1" {
		t.Skip("explicit disposable-cluster acceptance only")
	}
	if os.Getenv("GITHUB_ACTIONS") != "true" {
		t.Fatal("cluster acceptance is restricted to the disposable GitHub Actions runner")
	}
	image, apiURL, host, revision := os.Getenv("PERO_SANDBOX_IMAGE"), os.Getenv("PERO_SANDBOX_KUBE_API"), os.Getenv("PERO_SANDBOX_HOST"), os.Getenv("PERO_SANDBOX_WORKSPACE_REVISION")
	directAPI, caFile := os.Getenv("PERO_SANDBOX_DIRECT_API"), os.Getenv("PERO_SANDBOX_CA_FILE")
	parts := strings.Split(image, "@")
	if len(parts) != 2 || !strings.HasPrefix(parts[1], "sha256:") || len(parts[1]) != 71 {
		t.Fatal("PERO_SANDBOX_IMAGE must be a manifest-digest-pinned test image")
	}
	u, err := url.Parse(apiURL)
	if err != nil || u.Scheme != "http" || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() {
		t.Fatal("PERO_SANDBOX_KUBE_API must be an explicit loopback kubectl proxy")
	}
	if net.ParseIP(host) == nil || len(revision) != 40 {
		t.Fatalf("explicit test host IP and full workspace commit are required: host=%q revision_length=%d", host, len(revision))
	}
	direct, err := url.Parse(directAPI)
	if err != nil || direct.Scheme != "https" || net.ParseIP(direct.Hostname()) == nil || !net.ParseIP(direct.Hostname()).IsLoopback() {
		t.Fatal("PERO_SANDBOX_DIRECT_API must be the job-owned kind HTTPS API")
	}
	ca, err := os.ReadFile(caFile)
	if err != nil {
		t.Fatal("job-owned kind CA is required")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(ca) {
		t.Fatal("invalid job-owned kind CA")
	}
	api := clusterAPI{base: strings.TrimSuffix(apiURL, "/"), client: &http.Client{Timeout: 10 * time.Second}}
	for _, scenario := range []string{"success", "cancel"} {
		t.Run(scenario, func(t *testing.T) {
			db := isolatedStore(t)
			config, token := workerConfig(t, db)
			var random [5]byte
			if _, err := rand.Read(random[:]); err != nil {
				t.Fatal(err)
			}
			namespace := "pero-sandbox-e2e-" + hex.EncodeToString(random[:])
			var ns kubernetes.Object
			if err := api.request(t.Context(), http.MethodPost, "/api/v1/namespaces", map[string]any{"apiVersion": "v1", "kind": "Namespace", "metadata": map[string]any{"name": namespace, "labels": map[string]string{"pero.dev/fixture": "agent-sandbox"}}}, &ns); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
				defer cancel()
				if err := api.request(ctx, http.MethodDelete, "/api/v1/namespaces/"+namespace, deleteOptions(ns.Metadata.UID), nil); err != nil {
					t.Errorf("delete fixture namespace: %v", err)
					return
				}
				if err := until(ctx, func() (bool, error) {
					code, err := api.status(ctx, "/api/v1/namespaces/"+namespace)
					return code == 404, err
				}); err != nil {
					t.Errorf("fixture namespace still present: %v", err)
				}
			})
			model := newModel(scenario == "cancel")
			defer func() { t.Logf("provider_trace: calls=%d observations=%+v", model.calls.Load(), model.trace()) }()
			provider := hostServer(t, model)
			cloud := hostServer(t, httpapi.Handler(db, "synthetic-operator"))
			providerTarget := hostTarget(provider.URL, host)
			cloudTarget := hostTarget(cloud.URL, host)
			config.Namespace = namespace
			config.ClusterID = "disposable-kind"
			config.ImageDigest = parts[1]
			config.WorkspaceRevision = revision
			config.TTLSeconds = 300
			objects, template := clusterObjects(namespace, image, revision, token, cloudTarget, providerTarget)
			encoded, _ := json.Marshal(template["spec"])
			digest := sha256.Sum256(encoded)
			config.TemplateDigest = "sha256:" + hex.EncodeToString(digest[:])
			// Warm Pods begin polling immediately. Persist their runtime-only fence
			// before starting the pool; a first 403 would stop a Never-restart Worker.
			if err := db.ConfigureRuntimeWorker(t.Context(), config); err != nil {
				t.Fatal(err)
			}
			for _, object := range objects {
				kind := object["kind"].(string)
				path := "/api/v1/namespaces/" + namespace + "/" + map[string]string{"ConfigMap": "configmaps", "Secret": "secrets"}[kind]
				if kind == "SandboxTemplate" {
					path = "/apis/" + kubernetes.ClaimAPI + "/namespaces/" + namespace + "/sandboxtemplates"
				}
				if kind == "SandboxWarmPool" {
					path = "/apis/" + kubernetes.ClaimAPI + "/namespaces/" + namespace + "/sandboxwarmpools"
				}
				if err := api.request(t.Context(), http.MethodPost, path, object, nil); err != nil {
					t.Fatalf("create fixture %s: %v", kind, err)
				}
			}
			warmCtx, warmCancel := context.WithTimeout(t.Context(), 3*time.Minute)
			defer warmCancel()
			var warmPod kubernetes.Object
			if err := until(warmCtx, func() (bool, error) {
				var list struct {
					Items []kubernetes.Object `json:"items"`
				}
				if err := api.request(warmCtx, http.MethodGet, "/api/v1/namespaces/"+namespace+"/pods", nil, &list); err != nil {
					return false, err
				}
				for _, pod := range list.Items {
					if pod.Status.Phase != "Running" || len(pod.Status.ContainerStatuses) != 2 {
						continue
					}
					ready := true
					for _, c := range pod.Status.ContainerStatuses {
						ready = ready && c.Ready && c.State.Running != nil
					}
					if ready {
						warmPod = pod
						return true, nil
					}
				}
				return false, nil
			}); err != nil {
				t.Fatalf("warm Worker Pod readiness: %v", err)
			}
			t.Cleanup(func() {
				if !t.Failed() {
					return
				}
				// Read only the synthetic gateway's fixed diagnostics, before namespace
				// deletion. No exec, Worker logs, prompts or arbitrary errors are printed.
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				path := "/api/v1/namespaces/" + namespace + "/pods/" + warmPod.Metadata.Name + "/log?container=test-gateway&tailLines=100&limitBytes=16384"
				request, _ := http.NewRequestWithContext(ctx, http.MethodGet, api.base+path, nil)
				response, err := api.client.Do(request)
				if err != nil {
					t.Log("gateway_diagnostic_unavailable=transport")
					return
				}
				defer response.Body.Close()
				if response.StatusCode != http.StatusOK {
					t.Logf("gateway_diagnostic_status=%d", response.StatusCode)
					return
				}
				data, err := io.ReadAll(io.LimitReader(response.Body, 16384))
				if err != nil {
					t.Log("gateway_diagnostic_unavailable=read")
					return
				}
				for _, line := range strings.Split(string(data), "\n") {
					if at := strings.Index(line, "fixture_trace "); at >= 0 && safeFixtureTrace.MatchString(line[at:]) {
						t.Log(line[at:])
					}
					if at := strings.Index(line, "fixture_proxy "); at >= 0 {
						for _, role := range []string{"cloud", "provider"} {
							prefix := "fixture_proxy role=" + role + " event="
							if line[at:] == prefix+"copy_or_upgrade_error" {
								t.Log(line[at:])
							}
							for _, category := range []string{"cancelled", "deadline", "transport"} {
								if line[at:] == prefix+"transport_error category="+category+" status=502" {
									t.Log(line[at:])
								}
							}
						}
					}
				}
			})
			controllerToken := scopedController(t, api, namespace)
			scoped := clusterAPI{base: directAPI, token: controllerToken, client: &http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{MinVersion: tls.VersionTLS12, RootCAs: roots}}}}
			for _, denied := range []struct{ method, path string }{{http.MethodGet, "/api/v1/namespaces/" + namespace + "/secrets"}, {http.MethodPost, "/api/v1/namespaces/" + namespace + "/pods/" + warmPod.Metadata.Name + "/exec"}} {
				if code, err := scoped.statusMethod(t.Context(), denied.method, denied.path); err != nil || code != http.StatusForbidden {
					t.Fatalf("controller RBAC failed closed check %s: HTTP %d %v", denied.path, code, err)
				}
			}
			private := t.TempDir()
			tokenFile := filepath.Join(private, "controller-token")
			if err := os.WriteFile(tokenFile, []byte(controllerToken), 0600); err != nil {
				t.Fatal(err)
			}
			configFile := filepath.Join(private, "runtime.json")
			writeJSON(t, configFile, sandbox.FileConfig{Runtime: config, APIURL: directAPI, TokenFile: tokenFile, CAFile: caFile})
			runtime, err := sandbox.FromFile(t.Context(), db, configFile)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			runtime.Start(ctx)
			run, b, err := runtime.Dispatch(t.Context(), task(t, db, "Respond with a short fixture answer.").ID, "cluster-dispatch")
			if err != nil {
				t.Fatal(err)
			}
			execCtx, execCancel := context.WithTimeout(t.Context(), 90*time.Second)
			defer execCancel()
			if err := until(execCtx, func() (bool, error) {
				var err error
				b, err = runtime.Reconcile(execCtx, run.ID)
				if err != nil {
					return false, err
				}
				if b.Phase == runtimebinding.Reconcile {
					return false, fmt.Errorf("runtime rejected: %s", b.Reason)
				}
				return b.Snapshot != nil, nil
			}); err != nil {
				t.Fatalf("claim admission: %v binding=%+v", err, b)
			}
			if b.Snapshot.Runtime.ID != warmPod.Metadata.UID {
				t.Fatalf("not a hot claim: warm Pod %s != bound %s", warmPod.Metadata.UID, b.Snapshot.Runtime.ID)
			}
			if scenario == "cancel" {
				select {
				case <-model.started:
				case <-execCtx.Done():
					t.Fatal("real model request did not start")
				}
				t.Logf("cancellation_requested_at=%s", time.Now().UTC().Format(time.RFC3339Nano))
				if _, err := runtime.Release(execCtx, run.ID); err != nil {
					t.Fatal(err)
				}
			}
			want := "succeeded"
			if scenario == "cancel" {
				want = "cancelled"
			}
			if err := until(execCtx, func() (bool, error) {
				result, err := db.RuntimeRun(execCtx, run.ID)
				if err != nil {
					return false, err
				}
				if result.Status == "failed" || result.Status == "reconcile" {
					return false, fmt.Errorf("unexpected %s: %s", result.Status, result.Summary)
				}
				return result.Status == want, nil
			}); err != nil {
				t.Fatal(err)
			}
			events, err := db.Events(execCtx, run.ID)
			if err == nil {
				// Fixed event kinds distinguish another execution from provider recovery.
				var sessions, turns, finished int
				for _, event := range events.Events {
					switch event.Kind {
					case "session_ready":
						sessions++
					case "turn_started":
						turns++
					case "turn_finished":
						finished++
					}
				}
				t.Logf("execution_counts: sessions=%d turns=%d finished=%d", sessions, turns, finished)
			}
			if model.calls.Load() != 1 {
				t.Fatalf("expected one actual provider request, got %d", model.calls.Load())
			}
			if err != nil || len(events.Events) == 0 {
				t.Fatalf("no retained events: %+v %v", events, err)
			}
			if scenario == "cancel" {
				select {
				case <-model.cancelled:
				case <-execCtx.Done():
					t.Fatal("provider request not cancelled")
				}
			}
			if _, err := runtime.Release(execCtx, run.ID); err != nil {
				t.Fatal(err)
			}
			if err := until(execCtx, func() (bool, error) {
				var err error
				b, err = runtime.Reconcile(execCtx, run.ID)
				return b.Phase == runtimebinding.Released, err
			}); err != nil {
				t.Fatalf("foreground cleanup: %v binding=%+v", err, b)
			}
			claimPath := "/apis/" + kubernetes.ClaimAPI + "/namespaces/" + namespace + "/sandboxclaims/" + b.Resource.ID
			if code, err := api.status(execCtx, claimPath); err != nil || code != 404 {
				t.Fatalf("released Claim still exists: HTTP %d %v", code, err)
			}
			if code, err := api.status(execCtx, "/api/v1/namespaces/"+namespace+"/pods/"+warmPod.Metadata.Name); err != nil || code != 404 {
				t.Fatalf("original Pod remains after claim settlement: HTTP %d %v", code, err)
			}
			retained, err := db.RuntimeRun(execCtx, run.ID)
			if err != nil || retained.Status != want {
				t.Fatalf("cleanup lost outcome: %+v %v", retained, err)
			}
			t.Logf("cluster_receipt: controller=v1.0.2 controller_commit=9a85153590e54cb980f3241f9e7a9228449412c9 namespace=%s run=%s claim=%s claim_uid=%s pod=%s pod_uid=%s runtime_digest=%s image=%s workspace=%s outcome=%s events=%d cleanup=%s", namespace, run.ID, b.Resource.ID, b.Resource.Incarnation, warmPod.Metadata.Name, b.Snapshot.Runtime.ID, b.Snapshot.Runtime.Digest, image, revision, want, len(events.Events), b.Phase)
		})
	}
}

type clusterAPI struct {
	base   string
	client *http.Client
	token  string
}

func (a clusterAPI) request(ctx context.Context, method, path string, input, output any) error {
	var body []byte
	var err error
	if input != nil {
		body, err = json.Marshal(input)
		if err != nil {
			return err
		}
	}
	r, err := http.NewRequestWithContext(ctx, method, a.base+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	r.Header.Set("Content-Type", "application/json")
	if a.token != "" {
		r.Header.Set("Authorization", "Bearer "+a.token)
	}
	response, err := a.client.Do(r)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return fmt.Errorf("%s %s: HTTP %d %s", method, path, response.StatusCode, string(data))
	}
	if output != nil {
		return json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(output)
	}
	return nil
}
func (a clusterAPI) status(ctx context.Context, path string) (int, error) {
	return a.statusMethod(ctx, http.MethodGet, path)
}
func (a clusterAPI) statusMethod(ctx context.Context, method, path string) (int, error) {
	r, err := http.NewRequestWithContext(ctx, method, a.base+path, nil)
	if err != nil {
		return 0, err
	}
	if a.token != "" {
		r.Header.Set("Authorization", "Bearer "+a.token)
	}
	response, err := a.client.Do(r)
	if err != nil {
		return 0, err
	}
	defer response.Body.Close()
	return response.StatusCode, nil
}

func scopedController(t *testing.T, api clusterAPI, namespace string) string {
	t.Helper()
	name := "fixture-controller"
	meta := map[string]string{"name": name, "namespace": namespace}
	objects := []struct {
		path string
		body any
	}{
		{"/api/v1/namespaces/" + namespace + "/serviceaccounts", map[string]any{"apiVersion": "v1", "kind": "ServiceAccount", "metadata": meta, "automountServiceAccountToken": false}},
		{"/apis/rbac.authorization.k8s.io/v1/namespaces/" + namespace + "/roles", map[string]any{"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "Role", "metadata": meta, "rules": []any{map[string]any{"apiGroups": []string{""}, "resources": []string{"pods"}, "verbs": []string{"get"}}, map[string]any{"apiGroups": []string{"agents.x-k8s.io"}, "resources": []string{"sandboxes"}, "verbs": []string{"get"}}, map[string]any{"apiGroups": []string{"extensions.agents.x-k8s.io"}, "resources": []string{"sandboxclaims"}, "verbs": []string{"create", "get", "delete"}}}}},
		{"/apis/rbac.authorization.k8s.io/v1/namespaces/" + namespace + "/rolebindings", map[string]any{"apiVersion": "rbac.authorization.k8s.io/v1", "kind": "RoleBinding", "metadata": meta, "roleRef": map[string]string{"apiGroup": "rbac.authorization.k8s.io", "kind": "Role", "name": name}, "subjects": []any{map[string]string{"kind": "ServiceAccount", "name": name, "namespace": namespace}}}},
	}
	for _, object := range objects {
		if err := api.request(t.Context(), http.MethodPost, object.path, object.body, nil); err != nil {
			t.Fatal(err)
		}
	}
	var response struct {
		Status struct {
			Token string `json:"token"`
		} `json:"status"`
	}
	if err := api.request(t.Context(), http.MethodPost, "/api/v1/namespaces/"+namespace+"/serviceaccounts/"+name+"/token", map[string]any{"apiVersion": "authentication.k8s.io/v1", "kind": "TokenRequest", "spec": map[string]any{"expirationSeconds": 600}}, &response); err != nil {
		t.Fatal(err)
	}
	if response.Status.Token == "" {
		t.Fatal("test controller TokenRequest returned no token")
	}
	return response.Status.Token
}
func deleteOptions(uid string) map[string]any {
	return map[string]any{"apiVersion": "v1", "kind": "DeleteOptions", "propagationPolicy": "Foreground", "preconditions": map[string]string{"uid": uid}}
}
func until(ctx context.Context, check func() (bool, error)) error {
	timer := time.NewTicker(200 * time.Millisecond)
	defer timer.Stop()
	for {
		done, err := check()
		if err != nil {
			return err
		}
		if done {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
		}
	}
}
func hostServer(t *testing.T, handler http.Handler) *httptest.Server {
	t.Helper()
	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(handler)
	server.Listener = listener
	server.Start()
	t.Cleanup(func() { server.CloseClientConnections(); server.Close() })
	return server
}
func hostTarget(origin, host string) string {
	u, _ := url.Parse(origin)
	return "http://" + net.JoinHostPort(host, u.Port())
}

func clusterObjects(namespace, image, revision, token, cloud, provider string) ([]map[string]any, map[string]any) {
	meta := func(name string) map[string]any { return map[string]any{"name": name, "namespace": namespace} }
	workerConfig, _ := json.Marshal(map[string]any{"workspaces": map[string]string{"fixture": "/workspace/repo"}, "agents_file": "/etc/pero/agents.json"})
	agents, _ := json.Marshal([]any{map[string]any{"id": "fixture", "name": "Real cluster Go ACP", "command": "/usr/local/bin/pero-agent-acp", "args": []string{"--endpoint", "http://127.0.0.1:8788/v1", "--model", "fixture", "--session-dir", "/state/sessions", "--api-key-env", "ACP_FIXTURE_API_KEY", "--approval", "ask"}, "env": map[string]string{"ACP_FIXTURE_API_KEY": "synthetic-provider"}}})
	config := map[string]any{"apiVersion": "v1", "kind": "ConfigMap", "metadata": meta("fixture-config"), "immutable": true, "data": map[string]string{"worker.json": string(workerConfig), "agents.json": string(agents)}}
	secret := map[string]any{"apiVersion": "v1", "kind": "Secret", "metadata": meta("fixture-worker"), "stringData": map[string]string{"token": token}}
	security := map[string]any{"allowPrivilegeEscalation": false, "readOnlyRootFilesystem": true, "capabilities": map[string]any{"drop": []string{"ALL"}}}
	worker := map[string]any{"name": "worker", "image": image, "imagePullPolicy": "IfNotPresent", "securityContext": security, "env": []any{
		map[string]any{"name": "PERO_RUNTIME_POD_UID", "valueFrom": map[string]any{"fieldRef": map[string]string{"fieldPath": "metadata.uid"}}}, map[string]any{"name": "PERO_WORKSPACE_REVISION", "value": revision}, map[string]any{"name": "PERO_CLOUD_URL", "value": "http://127.0.0.1:8787"}, map[string]any{"name": "PERO_WORKER_CONFIG", "value": "/etc/pero/worker.json"}, map[string]any{"name": "PERO_WORKER_STATE", "value": "/state/worker.json"}, map[string]any{"name": "PERO_WORKER_TOKEN", "valueFrom": map[string]any{"secretKeyRef": map[string]string{"name": "fixture-worker", "key": "token"}}}},
		"resources": map[string]any{"requests": map[string]string{"cpu": "100m", "memory": "128Mi"}, "limits": map[string]string{"cpu": "2", "memory": "1Gi"}}, "volumeMounts": []any{map[string]any{"name": "config", "mountPath": "/etc/pero", "readOnly": true}, map[string]string{"name": "workspace", "mountPath": "/workspace"}, map[string]string{"name": "state", "mountPath": "/state"}, map[string]string{"name": "tmp", "mountPath": "/tmp"}, map[string]string{"name": "home", "mountPath": "/home/pero"}}}
	gateway := map[string]any{"name": "test-gateway", "image": image, "imagePullPolicy": "IfNotPresent", "command": []string{"/usr/local/bin/pero-sandbox-test-gateway"}, "args": []string{"--cloud-target", cloud, "--provider-target", provider}, "securityContext": security, "resources": map[string]any{"requests": map[string]string{"cpu": "25m", "memory": "32Mi"}, "limits": map[string]string{"cpu": "250m", "memory": "128Mi"}}}
	template := map[string]any{"apiVersion": kubernetes.ClaimAPI, "kind": "SandboxTemplate", "metadata": meta("fixture-template"), "spec": map[string]any{"service": false, "networkPolicyManagement": "Unmanaged", "envVarsInjectionPolicy": "Disallowed", "volumeClaimTemplatesPolicy": "Disallowed", "podTemplate": map[string]any{"metadata": map[string]any{"labels": map[string]string{"pero.dev/fixture": "agent-sandbox"}}, "spec": map[string]any{"automountServiceAccountToken": false, "enableServiceLinks": false, "restartPolicy": "Never", "terminationGracePeriodSeconds": 10, "securityContext": map[string]any{"runAsNonRoot": true, "runAsUser": 10001, "runAsGroup": 10001, "fsGroup": 10001, "seccompProfile": map[string]string{"type": "RuntimeDefault"}}, "containers": []any{worker, gateway}, "volumes": []any{map[string]any{"name": "config", "configMap": map[string]any{"name": "fixture-config", "defaultMode": 292}}, map[string]any{"name": "workspace", "emptyDir": map[string]string{"sizeLimit": "4Gi"}}, map[string]any{"name": "state", "emptyDir": map[string]string{"sizeLimit": "1Gi"}}, map[string]any{"name": "tmp", "emptyDir": map[string]string{"sizeLimit": "256Mi"}}, map[string]any{"name": "home", "emptyDir": map[string]string{"sizeLimit": "32Mi"}}}}}}}
	pool := map[string]any{"apiVersion": kubernetes.ClaimAPI, "kind": "SandboxWarmPool", "metadata": meta("fixture-pool"), "spec": map[string]any{"replicas": 1, "updateStrategy": map[string]string{"type": "OnReplenish"}, "sandboxTemplateRef": map[string]string{"name": "fixture-template"}}}
	return []map[string]any{config, secret, template, pool}, template
}

// Only the fixed transport metadata grammar may cross into CI artifacts.
var safeFixtureTrace = regexp.MustCompile(`^fixture_trace role=provider ordinal=[0-9]{1,20} at=[0-9]{1,20} event=(started|upstream_headers|upstream_read_end|upstream_close|transport_error|downstream_context_done|handler_exit) category=(ok|eof|cancelled|deadline|transport|panic|abort) status=[0-9]{1,3} sse=(true|false) bytes=[0-9]{1,20}$`)

func TestFixtureTraceArtifactGrammar(t *testing.T) {
	valid := "fixture_trace role=provider ordinal=1 at=123 event=upstream_headers category=ok status=200 sse=true bytes=0"
	for _, tc := range []struct {
		line  string
		valid bool
	}{
		{valid, true},
		{valid + " secret=synthetic-secret", false},
		{strings.ReplaceAll(valid, "category=ok", "category=http://synthetic-secret"), false},
		{strings.ReplaceAll(valid, "role=provider", "role=synthetic-secret"), false},
		{strings.ReplaceAll(valid, "bytes=0", "bytes=-1"), false},
		{strings.ReplaceAll(valid, "event=upstream_headers", "event=raw_error"), false},
	} {
		if got := safeFixtureTrace.MatchString(tc.line); got != tc.valid {
			t.Fatalf("trace grammar matched=%t expected=%t", got, tc.valid)
		}
	}
}
