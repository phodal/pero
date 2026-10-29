package sandbox_test

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/sandbox"
	"github.com/phodal/pero/server/internal/store"
)

const fixtureDigest = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func isolatedStore(t *testing.T) *store.Store {
	t.Helper()
	dsn := os.Getenv("PERO_TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("PERO_REQUIRE_TEST_DATABASE") == "1" {
			t.Fatal("PERO_TEST_DATABASE_URL is required")
		}
		t.Skip("set PERO_TEST_DATABASE_URL for real PostgreSQL runtime acceptance")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	var random [8]byte
	if _, err = rand.Read(random[:]); err != nil {
		t.Fatal(err)
	}
	schema := "runtime_test_" + hex.EncodeToString(random[:])
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	db, err := store.Open(ctx, u.String(), 10*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		_, err := admin.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
		admin.Close()
		if err != nil {
			t.Error(err)
		}
	})
	return db
}

func workerConfig(t *testing.T, db *store.Store) (runtimebinding.Config, string) {
	t.Helper()
	w, token, err := db.CreateWorker(t.Context(), "sandbox fixture", []string{"fixture"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return runtimebinding.Config{ClusterID: "fixture-cluster", Namespace: "fixture", WarmPool: "fixture-pool", WorkerID: w.ID, ProjectID: "fixture", WorkspaceKey: "fixture", AgentID: "fixture", ImageDigest: fixtureDigest, TemplateDigest: fixtureDigest, WorkspaceRevision: strings.Repeat("a", 40), TTLSeconds: 120}, token
}

func task(t *testing.T, db *store.Store, prompt string) *store.Task {
	t.Helper()
	value, err := db.CreateTask(t.Context(), store.Spec{Title: "Sandbox acceptance", Prompt: prompt, Acceptance: "Fixture result is retained", ProjectID: "fixture", WorkspaceKey: "fixture", AgentID: "fixture"}, "")
	if err != nil {
		t.Fatal(err)
	}
	return value
}

// kubeFixture is the single fake external API seam. Actual ClaimOwner HTTP
// adapters read this server; the driver/store and its PostgreSQL transactions
// are real. The fixture's controller effects are not real Kubernetes evidence.
type kubeFixture struct {
	cold                                       bool
	loseColdSandbox                            bool
	volumePath                                 string
	mu                                         sync.Mutex
	objects                                    map[string]map[string]any
	posts, deletes                             int
	loseCreate, loseDelete, linger, omitCreate bool
	claimPath, podPath                         string
	deletedUIDs                                []string
	apiURL, requiredToken                      string
}

func newKube(t *testing.T, config runtimebinding.Config) (*kubeFixture, *kubernetes.ClaimOwner) {
	t.Helper()
	k := &kubeFixture{objects: map[string]map[string]any{}}
	server := httptest.NewServer(k)
	k.apiURL = server.URL
	t.Cleanup(server.Close)
	reader, err := kubernetes.NewHTTPReader(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	writer, err := kubernetes.NewHTTPWriter(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	base, err := kubernetes.NewOwner(config.ClusterID, []string{config.Namespace}, reader, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := kubernetes.NewClaimOwner(base, writer, kubernetes.ClaimConfig{Namespace: config.Namespace, WarmPool: config.WarmPool, TTL: time.Duration(config.TTLSeconds) * time.Second, ShutdownPolicy: "DeleteForeground", Recipe: config.Recipe()})
	if err != nil {
		t.Fatal(err)
	}
	return k, owner
}

func ready(generation int) []any {
	return []any{map[string]any{"type": "Ready", "status": "True", "observedGeneration": generation}}
}
func metadata(name, namespace, uid string) map[string]any {
	return map[string]any{"name": name, "namespace": namespace, "uid": uid, "resourceVersion": "1", "generation": 1}
}
func ownerRef(api, kind, name, uid string) []any {
	return []any{map[string]any{"apiVersion": api, "kind": kind, "name": name, "uid": uid, "controller": true, "blockOwnerDeletion": true}}
}
func (k *kubeFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.requiredToken != "" && r.Header.Get("Authorization") != "Bearer "+k.requiredToken {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	if k.cold && (r.Method == http.MethodPost || r.Method == http.MethodDelete || r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/pods")) {
		k.serveCold(w, r)
		return
	}
	switch r.Method {
	case http.MethodPost:
		k.posts++
		var claim map[string]any
		if json.NewDecoder(r.Body).Decode(&claim) != nil {
			w.WriteHeader(400)
			return
		}
		m := claim["metadata"].(map[string]any)
		name := m["name"].(string)
		namespace := m["namespace"].(string)
		k.claimPath = r.URL.Path + "/" + name
		if _, ok := k.objects[k.claimPath]; ok {
			w.WriteHeader(409)
			return
		}
		if !k.omitCreate {
			m["uid"], m["resourceVersion"], m["generation"] = "claim-uid", "1", 1
			claim["status"] = map[string]any{"sandbox": map[string]any{"name": "warm"}, "conditions": ready(1)}
			k.objects[k.claimPath] = claim
			sm := metadata("warm", namespace, "sandbox-uid")
			sm["ownerReferences"] = ownerRef(kubernetes.ClaimAPI, "SandboxClaim", name, "claim-uid")
			k.objects["/apis/"+kubernetes.SandboxAPI+"/namespaces/"+namespace+"/sandboxes/warm"] = map[string]any{"apiVersion": kubernetes.SandboxAPI, "kind": "Sandbox", "metadata": sm, "spec": map[string]any{"operatingMode": "Running"}, "status": map[string]any{"conditions": ready(1)}}
			pm := metadata("warm", namespace, "pod-uid")
			pm["ownerReferences"] = ownerRef(kubernetes.SandboxAPI, "Sandbox", "warm", "sandbox-uid")
			k.podPath = "/api/v1/namespaces/" + namespace + "/pods/warm"
			k.objects[k.podPath] = map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": pm, "status": map[string]any{"phase": "Running", "conditions": ready(0), "containerStatuses": []any{map[string]any{"name": "worker", "containerID": "containerd://fixture", "imageID": "registry.invalid/pero@" + fixtureDigest, "restartCount": 0, "ready": true, "state": map[string]any{"running": map[string]any{}}}}}}
		}
		if k.loseCreate {
			k.loseCreate = false
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(claim)
	case http.MethodDelete:
		k.deletes++
		var input struct {
			PropagationPolicy string `json:"propagationPolicy"`
			Preconditions     struct {
				UID string `json:"uid"`
			} `json:"preconditions"`
		}
		if json.NewDecoder(r.Body).Decode(&input) != nil || input.PropagationPolicy != "Foreground" || input.Preconditions.UID == "" {
			w.WriteHeader(400)
			return
		}
		current, ok := k.objects[r.URL.Path]
		if !ok {
			w.WriteHeader(404)
			return
		}
		if current["metadata"].(map[string]any)["uid"] != input.Preconditions.UID {
			w.WriteHeader(409)
			return
		}
		k.deletedUIDs = append(k.deletedUIDs, input.Preconditions.UID)
		if k.linger {
			current["metadata"].(map[string]any)["deletionTimestamp"] = time.Now().UTC().Format(time.RFC3339)
		} else {
			k.objects = map[string]map[string]any{}
		}
		if k.loseDelete {
			k.loseDelete = false
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		w.WriteHeader(200)
	default:
		value, ok := k.objects[r.URL.Path]
		if !ok {
			w.WriteHeader(404)
			return
		}
		json.NewEncoder(w).Encode(value)
	}
}
func (k *kubeFixture) change(fn func(*kubeFixture)) { k.mu.Lock(); defer k.mu.Unlock(); fn(k) }

func TestRuntimeLostResponsesAndRetainedReceipts(t *testing.T) {
	db := isolatedStore(t)
	config, _ := workerConfig(t, db)
	k, owner := newKube(t, config)
	k.loseCreate = true
	runtime, err := sandbox.New(t.Context(), db, owner, config)
	if err != nil {
		t.Fatal(err)
	}
	task := task(t, db, "Return a fixture answer")
	run, b, err := runtime.Dispatch(t.Context(), task.ID, "dispatch-original")
	if err != nil || b.Phase != runtimebinding.Pending || b.Resource != nil {
		t.Fatalf("lost create: %+v %v", b, err)
	}
	again, b, err := runtime.Dispatch(t.Context(), task.ID, "dispatch-original")
	if err != nil || again.ID != run.ID || b.Phase != runtimebinding.Ready || b.Snapshot.Runtime.ID != "pod-uid" {
		t.Fatalf("original dispatch: %+v %v", b, err)
	}
	k.change(func(k *kubeFixture) {
		if k.posts != 1 {
			t.Errorf("unknown create replayed: %d", k.posts)
		}
	})
	if got, err := db.Claim(t.Context(), config.WorkerID, "wrong", "wrong-pod", "other-pod"); err != nil || got != nil {
		t.Fatalf("wrong Pod admitted: %+v %v", got, err)
	}
	claimed, err := db.Claim(t.Context(), config.WorkerID, "instance", "original-worker-claim", "pod-uid")
	if err != nil || claimed == nil || claimed.ID != run.ID {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	if _, err := db.AppendEvents(t.Context(), run.ID, config.WorkerID, "instance", run.Generation, []store.Event{{Seq: 1, Kind: "agent_message", Text: "retained fixture event"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Complete(t.Context(), run.ID, config.WorkerID, "instance", run.Generation, store.Completion{Outcome: "succeeded", Summary: "retained result"}); err != nil {
		t.Fatal(err)
	}
	k.change(func(k *kubeFixture) { k.loseDelete = true; k.linger = true })
	b, err = runtime.Release(t.Context(), run.ID)
	if err != nil || b.Phase != runtimebinding.CleanupPending || b.CleanupReceipt != nil {
		t.Fatalf("unknown delete: %+v %v", b, err)
	}
	b, err = runtime.Reconcile(t.Context(), run.ID)
	if err != nil || b.Phase != runtimebinding.CleanupPending {
		t.Fatalf("terminating: %+v %v", b, err)
	}
	k.change(func(k *kubeFixture) {
		if k.deletes != 1 || len(k.deletedUIDs) != 1 || k.deletedUIDs[0] != "claim-uid" {
			t.Errorf("UID cleanup: %+v", k.deletedUIDs)
		}
		k.objects = map[string]map[string]any{}
	})
	b, err = runtime.Reconcile(t.Context(), run.ID)
	if err != nil || b.Phase != runtimebinding.Released || b.CleanupReceipt == nil || b.Snapshot.Runtime.ID != "pod-uid" {
		t.Fatalf("cleanup: %+v %v", b, err)
	}
	retained, err := db.RuntimeRun(t.Context(), run.ID)
	if err != nil || retained.Status != "succeeded" || retained.Summary != "retained result" {
		t.Fatalf("result lost: %+v %v", retained, err)
	}
	events, err := db.Events(t.Context(), run.ID)
	if err != nil || len(events.Events) != 1 || events.Events[0].Text != "retained fixture event" {
		t.Fatalf("events lost: %+v %v", events, err)
	}
	if _, err = runtime.Release(t.Context(), run.ID); err != nil {
		t.Fatal(err)
	}
	k.change(func(k *kubeFixture) {
		if k.posts != 1 || k.deletes != 1 {
			t.Errorf("repeat lifecycle mutated cluster: posts=%d deletes=%d", k.posts, k.deletes)
		}
	})
}

func TestRuntimeUnknownCreateAbsenceAndReplacementNeverReplay(t *testing.T) {
	for _, scenario := range []string{"absent-create", "pod-replaced", "container-restarted"} {
		t.Run(scenario, func(t *testing.T) {
			db := isolatedStore(t)
			config, _ := workerConfig(t, db)
			k, owner := newKube(t, config)
			if scenario == "absent-create" {
				k.loseCreate = true
				k.omitCreate = true
			}
			runtime, err := sandbox.New(t.Context(), db, owner, config)
			if err != nil {
				t.Fatal(err)
			}
			run, b, err := runtime.Dispatch(t.Context(), task(t, db, "Never replay").ID, "dispatch")
			if err != nil {
				t.Fatal(err)
			}
			if scenario != "absent-create" {
				if _, err := db.Claim(t.Context(), config.WorkerID, "original", "claim", "pod-uid"); err != nil {
					t.Fatal(err)
				}
				k.change(func(k *kubeFixture) {
					p := k.objects[k.podPath]
					if scenario == "pod-replaced" {
						p["metadata"].(map[string]any)["uid"] = "replacement"
					} else {
						p["status"].(map[string]any)["containerStatuses"].([]any)[0].(map[string]any)["restartCount"] = 1
					}
				})
			}
			b, err = runtime.Reconcile(t.Context(), run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "absent-create" {
				if b.Phase != runtimebinding.Pending || b.Resource != nil {
					t.Fatalf("absence adopted: %+v", b)
				}
			} else {
				if b.Phase != runtimebinding.Reconcile {
					t.Fatalf("replacement not fenced: %+v", b)
				}
				if _, _, err := db.Renew(t.Context(), run.ID, config.WorkerID, "original", run.Generation); !errors.Is(err, store.ErrLease) {
					t.Fatalf("lease retained: %v", err)
				}
				if got, err := db.Claim(t.Context(), config.WorkerID, "new", "new-claim", "replacement"); err != nil || got != nil {
					t.Fatalf("replacement replayed: %+v %v", got, err)
				}
				// Restoring the old UID cannot silently reopen the interrupted Run.
				k.change(func(k *kubeFixture) { k.objects[k.podPath]["metadata"].(map[string]any)["uid"] = "pod-uid" })
				if later, err := runtime.Reconcile(t.Context(), run.ID); err != nil || later.Phase != runtimebinding.Reconcile {
					t.Fatalf("reopened: %+v %v", later, err)
				}
			}
			k.change(func(k *kubeFixture) {
				if k.posts != 1 {
					t.Errorf("create replayed: %d", k.posts)
				}
			})
		})
	}
}

// Only fixed categories and timing are retained; never prompts, headers or keys.
type modelObservation struct {
	Call    int64
	Event   string
	At      time.Time
	Context string
}

type modelFixture struct {
	mu           sync.Mutex
	observations []modelObservation
	calls        atomic.Int64
	started      chan struct{}
	cancelled    chan struct{}
	wait         bool
}

func (m *modelFixture) observe(call int64, event string, ctx context.Context) {
	category := "active"
	if errors.Is(ctx.Err(), context.Canceled) {
		category = "cancelled"
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		category = "deadline"
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.observations) < 16 {
		m.observations = append(m.observations, modelObservation{call, event, time.Now().UTC(), category})
	}
}
func (m *modelFixture) trace() []modelObservation {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]modelObservation(nil), m.observations...)
}

func (m *modelFixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer synthetic-provider" {
		http.Error(w, "fixture request mismatch", 400)
		return
	}
	var body struct {
		Model string `json:"model"`
	}
	if json.NewDecoder(r.Body).Decode(&body) != nil || body.Model != "fixture" {
		http.Error(w, "fixture model mismatch", 400)
		return
	}
	call := m.calls.Add(1)
	m.observe(call, "started", r.Context())
	defer m.observe(call, "returned", r.Context())
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(200)
	if m.wait {
		w.(http.Flusher).Flush()
		select {
		case m.started <- struct{}{}:
		default:
		}
		<-r.Context().Done()
		m.observe(call, "context_done", r.Context())
		select {
		case m.cancelled <- struct{}{}:
		default:
		}
		return
	}
	fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"sandbox fixture answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
}
func newModel(wait bool) *modelFixture {
	return &modelFixture{started: make(chan struct{}, 1), cancelled: make(chan struct{}, 1), wait: wait}
}

func TestModelFixtureCancellationTrace(t *testing.T) {
	model := newModel(true)
	server := httptest.NewServer(model)
	defer server.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader(`{"model":"fixture"}`))
	request.Header.Set("Authorization", "Bearer synthetic-provider")
	response, err := server.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	select {
	case <-model.started:
	case <-time.After(3 * time.Second):
		t.Fatal("fixture did not start")
	}
	cancel()
	select {
	case <-model.cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("fixture did not observe cancellation")
	}
	trace := model.trace()
	if model.calls.Load() != 1 || len(trace) < 2 || trace[0].Call != 1 || trace[0].Event != "started" || trace[0].Context != "active" || trace[1].Call != 1 || trace[1].Event != "context_done" || trace[1].Context != "cancelled" || trace[1].At.Before(trace[0].At) {
		t.Fatalf("invalid synthetic request trace: %+v", trace)
	}
}

func TestRuntimeWorkerProcess(t *testing.T) {
	worker, agent := os.Getenv("PERO_SANDBOX_WORKER_BINARY"), os.Getenv("PERO_SANDBOX_AGENT_BINARY")
	if worker == "" || agent == "" {
		t.Skip("set PERO_SANDBOX_WORKER_BINARY and PERO_SANDBOX_AGENT_BINARY for actual CLI acceptance")
	}
	for _, name := range []string{"success", "cancel"} {
		t.Run(name, func(t *testing.T) {
			db := isolatedStore(t)
			config, token := workerConfig(t, db)
			_, owner := newKube(t, config)
			runtime, err := sandbox.New(t.Context(), db, owner, config)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			runtime.Start(ctx)
			cloud := httptest.NewServer(httpapi.HandlerWithSandbox(db, "synthetic-operator", runtime))
			defer cloud.Close()
			model := newModel(name == "cancel")
			provider := httptest.NewServer(model)
			defer provider.Close()
			run, b, err := runtime.Dispatch(t.Context(), task(t, db, "Return the fixture answer").ID, "dispatch")
			if err != nil || b.Phase != runtimebinding.Ready {
				t.Fatalf("dispatch: %+v %v", b, err)
			}
			root := t.TempDir()
			workspace := filepath.Join(root, "workspace")
			if err := os.Mkdir(workspace, 0700); err != nil {
				t.Fatal(err)
			}
			writeJSON(t, filepath.Join(root, "agents.json"), []any{map[string]any{"id": "fixture", "name": "Actual Go ACP", "command": agent, "args": []string{"--endpoint", provider.URL + "/v1", "--model", "fixture", "--session-dir", filepath.Join(root, "sessions"), "--api-key-env", "ACP_FIXTURE_API_KEY", "--approval", "ask"}, "env": map[string]string{"ACP_FIXTURE_API_KEY": "synthetic-provider"}}})
			writeJSON(t, filepath.Join(root, "worker.json"), map[string]any{"workspaces": map[string]string{"fixture": workspace}, "agents_file": filepath.Join(root, "agents.json")})
			processCtx, stop := context.WithTimeout(t.Context(), 30*time.Second)
			defer stop()
			cmd := exec.CommandContext(processCtx, worker, "--once")
			cmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=" + root, "TMPDIR=" + root, "LANG=C.UTF-8", "PERO_CLOUD_URL=" + cloud.URL, "PERO_WORKER_TOKEN=" + token, "PERO_WORKER_CONFIG=" + filepath.Join(root, "worker.json"), "PERO_WORKER_STATE=" + filepath.Join(root, "journal.json"), "PERO_RUNTIME_POD_UID=pod-uid"}
			var output bytes.Buffer
			cmd.Stdout = &output
			cmd.Stderr = &output
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			if name == "cancel" {
				select {
				case <-model.started:
				case err := <-done:
					t.Fatalf("Worker exited before model request: %v %s", err, output.String())
				case <-processCtx.Done():
					t.Fatal("model request not observed")
				}
				if _, err := runtime.Release(t.Context(), run.ID); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case err := <-done:
				if err != nil {
					t.Fatalf("Worker: %v %s", err, output.String())
				}
			case <-processCtx.Done():
				t.Fatal("Worker did not settle")
			}
			want := "succeeded"
			if name == "cancel" {
				want = "cancelled"
				select {
				case <-model.cancelled:
				case <-time.After(3 * time.Second):
					t.Fatal("provider request not cancelled")
				}
			}
			retained, err := db.RuntimeRun(t.Context(), run.ID)
			if err != nil || retained.Status != want || model.calls.Load() != 1 {
				t.Fatalf("execution: %+v calls=%d %v output=%s", retained, model.calls.Load(), err, output.String())
			}
			events, err := db.Events(t.Context(), run.ID)
			if err != nil || len(events.Events) == 0 {
				t.Fatalf("no durable process events: %+v %v", events, err)
			}
			encoded, _ := json.Marshal(events)
			if strings.Contains(string(encoded), token) || strings.Contains(string(encoded), "synthetic-provider") {
				t.Fatal("credentials leaked to events")
			}
			b, err = runtime.Release(t.Context(), run.ID)
			if err != nil || b.Phase != runtimebinding.Released {
				t.Fatalf("cleanup: %+v %v", b, err)
			}
			t.Logf("actual Rust Worker + Go ACP: outcome=%s provider_calls=%d events=%d run=%s claim_uid=%s pod_uid=%s image=%s workspace=%s", want, model.calls.Load(), len(events.Events), run.ID, b.Resource.Incarnation, b.Snapshot.Runtime.ID, b.Config.ImageDigest, b.Config.WorkspaceRevision)
		})
	}
}

func writeJSON(t *testing.T, path string, value any) {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}
