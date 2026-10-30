//go:build unix

package httpapi_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/runtimeauth"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"github.com/phodal/pero/server/internal/runtimegateway"
	"github.com/phodal/pero/server/internal/store"
)

// This file is a local explicit opt-in. Nothing here changes production cwd,
// token, approval or protocol policy, and no key is read by the ordinary suite.
const liveApproval = "deepseek-flash-2x1024"
const liveEndpoint = "https://api.deepseek.com/chat/completions"

func privateLiveFile(path string, flags int) (*os.File, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("explicit absolute private file required")
	}
	f, err := os.OpenFile(path, flags|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, errors.New("private fixture file unavailable")
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || info.Size() > 4096 {
		f.Close()
		return nil, errors.New("fixture file must be regular, private and bounded")
	}
	return f, nil
}

// Reserve the maximum possible charge before reading a key or opening a live
// provider. flock covers separate go-test processes, fsync precedes all calls,
// and unused reservations are NEVER refunded. A damaged ledger fails closed.
func reserveLiveAllowance(path string) error {
	f, err := privateLiveFile(path, os.O_RDWR)
	if err != nil {
		return err
	}
	defer f.Close()
	if err = syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	var ledger struct {
		Reserved *int `json:"reserved_requests"`
	}
	d := json.NewDecoder(io.LimitReader(f, 4097))
	d.DisallowUnknownFields()
	if d.Decode(&ledger) != nil || d.Decode(new(any)) != io.EOF || ledger.Reserved == nil || *ledger.Reserved < 0 || *ledger.Reserved > 4 || *ledger.Reserved%2 != 0 {
		return errors.New("live allowance exhausted or invalid; no request dispatched")
	}
	*ledger.Reserved += 2
	data, _ := json.Marshal(ledger)
	data = append(data, '\n')
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	if err = f.Truncate(0); err != nil {
		return err
	}
	if _, err = f.Write(data); err != nil {
		return err
	}
	return f.Sync()
}

func TestIsolatedLiveAllowance(t *testing.T) {
	path := filepath.Join(t.TempDir(), "budget.json")
	if err := os.WriteFile(path, []byte("{\"reserved_requests\":0}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	var accepted atomic.Int32
	var group sync.WaitGroup
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			if reserveLiveAllowance(path) == nil {
				accepted.Add(1)
			}
		}()
	}
	group.Wait()
	if accepted.Load() != 3 {
		t.Fatalf("durable global budget accepted %d reservations, wanted3", accepted.Load())
	}
	data, _ := os.ReadFile(path)
	if string(data) != "{\"reserved_requests\":6}\n" {
		t.Fatal("global reservation not retained")
	}
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
	if reserveLiveAllowance(path) == nil {
		t.Fatal("public ledger accepted")
	}
	for _, body := range []string{`{}`, `{"reserved_requests":null}`, `{"reserved_requests":-2}`, `{"reserved_requests":1}`, `{"reserved_requests":6}`, `{"reserved_requests":0,"extra":true}`, `{"reserved_requests":`, `{"reserved_requests":0} {}`} {
		bad := filepath.Join(t.TempDir(), "damaged-budget.json")
		if os.WriteFile(bad, []byte(body), 0600) != nil {
			t.Fatal("private synthetic ledger unavailable")
		}
		if reserveLiveAllowance(bad) == nil {
			t.Fatal("damaged or exhausted ledger accepted")
		}
		retained, err := os.ReadFile(bad)
		if err != nil || string(retained) != body {
			t.Fatal("rejected ledger was changed")
		}
	}
}

// The only protocol adaptation allowed for local process proof is this exact
// container cwd alias. Other frames remain byte-for-byte unchanged; a different
// cwd or host MCP binding is rejected rather than expanded into host authority.
func isolatedCWDFrame(line []byte, workspace string) ([]byte, error) {
	var frame map[string]json.RawMessage
	if json.Unmarshal(line, &frame) != nil {
		return nil, errors.New("invalid ACP frame")
	}
	var method string
	if json.Unmarshal(frame["method"], &method) != nil || method != "session/new" {
		return line, nil
	}
	var params map[string]json.RawMessage
	if json.Unmarshal(frame["params"], &params) != nil {
		return nil, errors.New("invalid session params")
	}
	var cwd string
	var servers []json.RawMessage
	if json.Unmarshal(params["cwd"], &cwd) != nil || cwd != "/workspace/repo" || json.Unmarshal(params["mcpServers"], &servers) != nil || len(servers) != 0 {
		return nil, errors.New("local fixture rejects cwd or MCP authority change")
	}
	params["cwd"], _ = json.Marshal(workspace)
	frame["params"], _ = json.Marshal(params)
	out, err := json.Marshal(frame)
	return append(out, '\n'), err
}
func TestIsolatedCWDFrame(t *testing.T) {
	root := t.TempDir()
	for _, input := range []string{`{"jsonrpc":"2.0","method":"session/new","params":{"cwd":"/tmp/other","mcpServers":[]}}`, `{"jsonrpc":"2.0","method":"session/new","params":{"cwd":"/workspace/repo","mcpServers":[{}]}}`} {
		if _, err := isolatedCWDFrame([]byte(input), root); err == nil {
			t.Fatal("adapter broadened authority")
		}
	}
	raw := []byte("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n")
	if got, err := isolatedCWDFrame(raw, root); err != nil || !bytes.Equal(got, raw) {
		t.Fatal("adapter rewrote an unrelated frame")
	}
	mapped, err := isolatedCWDFrame([]byte(`{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/workspace/repo","mcpServers":[]}}`), root)
	if err != nil || !strings.Contains(string(mapped), root) || strings.Contains(string(mapped), "/workspace/repo") {
		t.Fatal("exact fixture cwd mapping failed")
	}
}

// Child entry point selected only by the private wrapper script. The real ACP
// process still performs initialize/session/prompt/tool/provider handling.
func TestIsolatedCWDAdapterProcess(t *testing.T) {
	split := -1
	for i, a := range os.Args {
		if a == "--" {
			split = i
			break
		}
	}
	if split < 0 || len(os.Args) <= split+3 || os.Args[split+1] != "isolated-cwd-adapter" {
		return
	}
	root, agent := os.Args[split+2], os.Args[split+3]
	args := os.Args[split+4:]
	if !filepath.IsAbs(root) || !filepath.IsAbs(agent) {
		os.Exit(31)
	}
	info, err := os.Stat(root)
	if err != nil || !info.IsDir() {
		os.Exit(32)
	}
	validWorkspace := false
	for i, a := range args {
		if a == "--workspace" && i+1 < len(args) {
			validWorkspace = args[i+1] == root
		}
	}
	if !validWorkspace {
		os.Exit(33)
	}
	child := exec.Command(agent, args...)
	child.Dir = root
	child.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=" + root, "LANG=C.UTF-8", "PERO_ISOLATED_PROVIDER_KEY=local-nonsecret"}
	child.Stdout = os.Stdout
	child.Stderr = io.Discard
	input, err := child.StdinPipe()
	if err != nil {
		os.Exit(34)
	}
	if child.Start() != nil {
		os.Exit(35)
	}
	done := make(chan error, 1)
	go func() { done <- child.Wait() }()
	copied := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(os.Stdin)
		scanner.Buffer(make([]byte, 4096), runtimechannel.MaxLineBytes)
		for scanner.Scan() {
			line, e := isolatedCWDFrame(append(append([]byte(nil), scanner.Bytes()...), '\n'), root)
			if e != nil {
				copied <- e
				return
			}
			if _, e = input.Write(line); e != nil {
				copied <- e
				return
			}
		}
		input.Close()
		copied <- scanner.Err()
	}()
	select {
	case err = <-done:
	case err = <-copied:
		if err != nil {
			child.Process.Kill()
		}
		err = <-done
	}
	if err != nil {
		os.Exit(36)
	}
	os.Exit(0)
}

func isolatedLiveBinaries(t *testing.T) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, name := range []string{"PERO_SANDBOX_WORKER_BINARY", "PERO_REMOTE_BRIDGE_BINARY", "PERO_REMOTE_CONNECT_BINARY", "PERO_REMOTE_AGENT_BINARY"} {
		value := os.Getenv(name)
		info, err := os.Stat(value)
		if !filepath.IsAbs(value) || err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0111 == 0 {
			t.Fatalf("%s must name the explicit reviewed executable", name)
		}
		out[name] = value
	}
	return out
}
func liveBudget() runtimechannel.ProviderBudget {
	return runtimechannel.ProviderBudget{MaxRequests: 2, MaxConcurrent: 1, MaxOutputTokens: 1024, MaxRequestBytes: 1 << 20, MaxResponseBytes: 1 << 20, TimeoutSeconds: 60}
}

// TestIsolatedLiveDeepSeek is executed only by the parent after the user's
// specific paid-call approval. The same ledger MUST be shared by all rounds.
func TestIsolatedLiveDeepSeek(t *testing.T) {
	if os.Getenv("PERO_ISOLATED_LIVE_E2E") != "1" {
		t.Skip("explicit approved local live-provider proof only")
	}
	if os.Getenv("PERO_ISOLATED_LIVE_APPROVED") != liveApproval || os.Getenv("GITHUB_ACTIONS") != "" || os.Getenv("CI") == "true" {
		t.Fatal("live proof requires exact local approval; CI is forbidden")
	}
	mode := os.Getenv("PERO_ISOLATED_LIVE_MODE")
	if mode == "" {
		mode = "completion"
	}
	if mode != "completion" && mode != "cancel" {
		t.Fatal("live mode must be completion or cancel")
	}
	binaries := isolatedLiveBinaries(t)
	if os.Getenv("PERO_TEST_DATABASE_URL") == "" {
		t.Fatal("dedicated synthetic PostgreSQL required")
	}
	if err := reserveLiveAllowance(os.Getenv("PERO_ISOLATED_LIVE_BUDGET_FILE")); err != nil {
		t.Fatal(err)
	}
	f, err := privateLiveFile(os.Getenv("PERO_DEEPSEEK_API_KEY_FILE"), os.O_RDONLY)
	if err != nil {
		t.Fatal(err)
	}
	data, err := io.ReadAll(io.LimitReader(f, 4097))
	f.Close()
	if err != nil || len(data) > 4096 {
		t.Fatal("private provider credential unavailable")
	}
	key := strings.TrimSpace(string(data))
	if key == "" || strings.ContainsAny(key, "\r\n") {
		t.Fatal("invalid private provider credential")
	}
	runIsolatedRealACP(t, binaries, runtimegateway.ProviderConfig{Endpoint: liveEndpoint, Model: "deepseek-flash", APIKey: key, Budget: liveBudget()}, true, mode)
}

// Synthetic transport proof runs only when the explicit existing binaries and
// test database are available. It never reads a key or leaves loopback.
func TestIsolatedRealACPPathAdapter(t *testing.T) {
	if os.Getenv("PERO_REMOTE_AGENT_BINARY") == "" || os.Getenv("PERO_ISOLATED_PROCESS_E2E") != "1" {
		t.Skip("explicit local actual-process fixture only")
	}
	binaries := isolatedLiveBinaries(t)
	for _, mode := range []string{"completion", "completion-split", "cancel", "rejected-provider-401", "rejected-provider-503", "rejected-provider-303"} {
		t.Run(mode, func(t *testing.T) {
			var calls atomic.Int32
			cancelled := make(chan struct{}, 1)
			fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.Path != "/chat/completions" || r.Header.Get("Authorization") != "Bearer synthetic-live-provider" {
					http.Error(w, "fixture mismatch", 400)
					return
				}
				io.Copy(io.Discard, r.Body)
				if status := isolatedRejectionStatus(mode); status != 0 {
					if status == http.StatusSeeOther {
						w.Header().Set("Location", "/synthetic-private-redirect-location")
					}
					http.Error(w, `{"error":{"message":"synthetic-private-provider-body"}}`, status)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				if mode == "cancel" {
					fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"1\\n\"}}]}\n\n")
					w.(http.Flusher).Flush()
					<-r.Context().Done()
					cancelled <- struct{}{}
					return
				}
				if mode == "completion-split" {
					fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"PERO_\"}}]}\n\n")
					w.(http.Flusher).Flush()
					fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"LIVE_OK\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
					return
				}
				fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"PERO_LIVE_OK\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			}))
			defer fixture.Close()
			runIsolatedRealACP(t, binaries, runtimegateway.ProviderConfig{Endpoint: fixture.URL + "/chat/completions", Model: "fixture", APIKey: "synthetic-live-provider", Budget: liveBudget()}, false, mode)
			if calls.Load() != 1 {
				t.Fatalf("synthetic provider calls=%d, wanted1", calls.Load())
			}
			if mode == "cancel" {
				select {
				case <-cancelled:
				case <-time.After(3 * time.Second):
					t.Fatal("synthetic provider stream was not cancelled")
				}
			}
		})
	}
}

func retainedAssistantDelta(events *store.EventTail) bool {
	turn := isolatedTurnEvidence(events)
	return turn.Metrics.Scope == "bound" && turn.Metrics.TextDeltas > 0
}

func runIsolatedRealACP(t *testing.T, binaries map[string]string, provider runtimegateway.ProviderConfig, live bool, mode string) {
	t.Helper()
	reviews := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			Spec struct {
				Token     string   `json:"token"`
				Audiences []string `json:"audiences"`
			} `json:"spec"`
		}
		if json.NewDecoder(r.Body).Decode(&in) != nil || in.Spec.Token != "synthetic-pod-token" || len(in.Spec.Audiences) != 1 || in.Spec.Audiences[0] != runtimechannel.Audience {
			http.Error(w, "fixture identity rejected", 403)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": map[string]any{"authenticated": true, "audiences": []string{runtimechannel.Audience}, "user": map[string]any{"username": "system:serviceaccount:pero-test:agent", "uid": "sa1", "extra": map[string]any{"authentication.kubernetes.io/pod-uid": []string{"pod1"}}}}})
	}))
	defer reviews.Close()
	reviewer, err := runtimeauth.New(reviews.URL, reviews.Client())
	if err != nil {
		t.Fatal("fixture reviewer unavailable")
	}
	var db *store.Store
	providerEvidence := &isolatedCPObserver{}
	server := testAPI(t, func(s *store.Store) http.Handler {
		db = s
		gateway, e := runtimegateway.New(s, reviewer, provider)
		if e != nil {
			t.Fatal("fixed provider configuration rejected")
		}
		return providerEvidence.handler(httpapi.HandlerWithIsolatedRuntime(s, "synthetic-operator", nil, gateway, reviewer, nil))
	})
	ctx, cancel := context.WithTimeout(t.Context(), 100*time.Second)
	defer cancel()
	worker, workerToken, err := db.CreateWorker(ctx, "local live proof", []string{"synthetic-live"}, nil)
	if err != nil {
		t.Fatal("fixture Worker reservation failed")
	}
	config := runtimebinding.Config{Profile: runtimechannel.Profile, ClusterID: "synthetic-no-kubernetes", Namespace: "pero-test", WorkerID: worker.ID, ProjectID: "synthetic-live", WorkspaceKey: "repo", AgentID: "actual-acp", ImageDigest: "sha256:" + strings.Repeat("a", 64), TemplateDigest: "sha256:" + strings.Repeat("b", 64), WorkspaceRevision: strings.Repeat("c", 40), TTLSeconds: 600, RuntimeClass: "fixture-not-attested", ServiceAccount: "agent", ServiceAccountUID: "sa1", Audience: runtimechannel.Audience, ControlURL: "https://fixture.invalid", ImageRef: "fixture@sha256:" + strings.Repeat("a", 64), Model: provider.Model, StorageClass: "fixture", StorageAccessMode: "ReadWriteOnce", VolumeSize: "1Gi"}
	if db.ConfigureRuntimeWorker(ctx, config) != nil {
		t.Fatal("fixture Worker fence failed")
	}
	prompt := "Reply exactly PERO_LIVE_OK. Do not use tools, browse, inspect the host, or read or write any files."
	if mode == "cancel" {
		prompt = "Output the integers from 1 through 10000 in order, one integer per line, with no explanation. Do not use tools, browse, inspect the host, or read or write any files. This is synthetic cancellation testing."
	}
	task, err := db.CreateTask(ctx, store.Spec{Title: "Synthetic local transport proof", Prompt: prompt, Acceptance: "Retain the short model answer", ProjectID: config.ProjectID, WorkspaceKey: config.WorkspaceKey, AgentID: config.AgentID}, "live-task")
	if err != nil {
		t.Fatal("synthetic task reservation failed")
	}
	run, b, _, err := db.DispatchRuntime(ctx, task.ID, "live-dispatch", config)
	if err != nil {
		t.Fatal("synthetic Run reservation failed")
	}
	diagnose := func() isolatedDiagnostic {
		diagnostic := isolatedFailureDiagnostic(db, run.ID)
		diagnostic.ControlPlane = providerEvidence.snapshot()
		safe, _ := json.Marshal(diagnostic)
		t.Logf("redacted chain diagnostic: %s", safe)
		return diagnostic
	}
	resource := model.ResourceRef{Owner: model.Owner{Kind: "kubernetes", ID: config.ClusterID}, Kind: "kubernetes.sandbox", Scope: config.Namespace, ID: "synthetic-sandbox", Incarnation: "sandbox-uid"}
	bound, err := b.WithResource(resource)
	if err != nil {
		t.Fatal(err)
	}
	pvc := resource
	pvc.Kind = "kubernetes.pvc"
	pvc.ID = "synthetic-pvc"
	pvc.Incarnation = "pvc-uid"
	bound, err = bound.WithVolume(runtimebinding.VolumeBinding{Resource: pvc, VolumeName: "synthetic-pv", ProviderDigest: "sha256:" + strings.Repeat("d", 64)})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	expiry := now.Add(5 * time.Minute)
	observation := model.Observation{Resource: resource, Runtime: &model.Ref{Kind: "kubernetes-runtime", ID: "pod1", Digest: "sha256:" + strings.Repeat("d", 64)}, Receipt: model.Ref{Kind: "kubernetes-observation", ID: resource.Incarnation, Revision: "synthetic"}, ObservedAt: now, Ready: model.Condition{Status: "True", Reason: "SyntheticLocalFixture"}, Artifacts: []model.Ref{{Kind: "container-image", ID: config.ImageRef, Revision: "agent", Digest: config.ImageDigest}}, LeaseExpiresAt: &expiry}
	bound = bound.Observe(observation, now)
	if _, err = db.SaveRuntimeBinding(ctx, bound.Version, bound); err != nil {
		t.Fatal("synthetic binding admission failed")
	}
	// Readiness is explicitly simulated locally; this is not cluster/isolation
	// evidence. Refresh through normal CAS, never widen the 15-second authority.
	refreshed := make(chan struct{})
	go func() {
		defer close(refreshed)
		ticker := time.NewTicker(3 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				current, e := db.RuntimeBinding(ctx, run.ID)
				if e != nil {
					return
				}
				_, _ = db.SaveRuntimeBinding(ctx, current.Version, current.Observe(observation, time.Now()))
			}
		}
	}()
	defer func() { cancel(); <-refreshed }()
	dir := t.TempDir()
	workspace := filepath.Join(dir, "workspace")
	if os.Mkdir(workspace, 0700) != nil {
		t.Fatal("private workspace unavailable")
	}
	tokenPath := filepath.Join(dir, "pod-token")
	if os.WriteFile(tokenPath, []byte("synthetic-pod-token"), 0600) != nil {
		t.Fatal("synthetic token file unavailable")
	}
	configPath := filepath.Join(dir, "worker.json")
	configData, _ := json.Marshal(map[string]string{"remote_bridge": binaries["PERO_REMOTE_BRIDGE_BINARY"]})
	if os.WriteFile(configPath, configData, 0600) != nil {
		t.Fatal("private Worker configuration unavailable")
	}
	executable, _ := os.Executable()
	quote := func(v string) string { return "'" + strings.ReplaceAll(v, "'", "'\\''") + "'" }
	adapter := filepath.Join(dir, "cwd-adapter.sh")
	script := "#!/bin/sh\nexec " + quote(executable) + " -test.run='^TestIsolatedCWDAdapterProcess$' -- isolated-cwd-adapter " + quote(workspace) + " " + quote(binaries["PERO_REMOTE_AGENT_BINARY"]) + " \"$@\"\n"
	if os.WriteFile(adapter, []byte(script), 0700) != nil {
		t.Fatal("private test adapter unavailable")
	}
	workerCmd := exec.CommandContext(ctx, binaries["PERO_SANDBOX_WORKER_BINARY"], "--once")
	workerCmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=" + dir, "TMPDIR=" + dir, "LANG=C.UTF-8", "PERO_CLOUD_URL=" + server.URL, "PERO_WORKER_TOKEN=" + workerToken, "PERO_WORKER_CONFIG=" + configPath, "PERO_WORKER_STATE=" + filepath.Join(dir, "worker-state.json")}
	workerCmd.Stdout = io.Discard
	workerCmd.Stderr = io.Discard
	if workerCmd.Start() != nil {
		t.Fatal("external Worker process unavailable")
	}
	workerDone := make(chan error, 1)
	go func() { workerDone <- workerCmd.Wait() }()
	workerFinished := false
	var agentDone chan error
	agentFinished := false
	defer func() {
		cancel()
		if !workerFinished {
			<-workerDone
		}
		if agentDone != nil && !agentFinished {
			<-agentDone
		}
	}()
	ticker := time.NewTicker(25 * time.Millisecond)
	defer ticker.Stop()
	for {
		if _, err = db.RuntimeChannel(ctx, run.ID); err == nil {
			break
		}
		select {
		case <-ctx.Done():
			diagnose()
			t.Fatal("durable channel grant unavailable")
		case <-workerDone:
			workerFinished = true
			diagnose()
			t.Fatal("Worker exited before channel grant")
		case <-ticker.C:
		}
	}
	agentCmd := exec.CommandContext(ctx, binaries["PERO_REMOTE_CONNECT_BINARY"], "--control-url", server.URL, "--run-id", run.ID, "--session-id", run.ID, "--token-file", tokenPath, "--workspace", workspace, "--agent", adapter, "--model", provider.Model, "--session-dir", filepath.Join(dir, "sessions"), "--", "--max-requests", "2", "--max-tokens", "1024", "--max-retries", "0", "--disable-thinking")
	agentCmd.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=" + dir, "TMPDIR=" + dir, "LANG=C.UTF-8"}
	agentCmd.Stdout = io.Discard
	agentCmd.Stderr = io.Discard
	agentCmd.Cancel = func() error { return agentCmd.Process.Signal(syscall.SIGTERM) }
	agentCmd.WaitDelay = 2 * time.Second
	if agentCmd.Start() != nil {
		t.Fatal("outbound Agent wrapper unavailable")
	}
	agentDone = make(chan error, 1)
	go func() { agentDone <- agentCmd.Wait() }()
	if mode == "cancel" {
		for {
			tail, e := db.Events(ctx, run.ID)
			if e != nil {
				t.Fatal("retained assistant stream observation unavailable")
			}
			if retainedAssistantDelta(tail) {
				cancelled, e := db.Cancel(ctx, task.ID)
				if e != nil {
					t.Fatal("cancellation request unavailable; allowance consumed")
				}
				if cancelled.Status != "cancel_requested" {
					t.Fatal("live cancellation inconclusive: model completed before cancellation could be observed; allowance consumed, no retry or refund")
				}
				break
			}
			select {
			case <-workerDone:
				workerFinished = true
				diagnose()
				t.Fatal("live cancellation inconclusive: Worker settled before a retained assistant text delta; allowance consumed, no retry or refund")
			case <-ctx.Done():
				diagnose()
				t.Fatal("no retained real-model text delta before deadline; cancellation unobserved, allowance consumed")
			case <-ticker.C:
			}
		}
	}
	select {
	case err = <-workerDone:
		workerFinished = true
		if err != nil {
			diagnostic := diagnose()
			assertIsolatedEvidenceRedacted(t, db, run.ID, provider.APIKey, workerToken)
			if status := isolatedRejectionStatus(mode); status != 0 {
				if diagnostic.ChargedRequests != 1 || diagnostic.EventKinds["session_error"] == 0 || diagnostic.ControlPlane.ProviderCodes["PERO_PROVIDER_UPSTREAM_HTTP"] != 1 || diagnostic.ControlPlane.UpstreamStatuses[status] != 1 || diagnostic.ControlPlane.Unknown != 0 {
					t.Fatal("synthetic provider failure did not retain exactly one safe upstream code/status")
				}
				return
			}
			t.Fatal("actual Worker/ACP chain did not complete successfully; no automatic replay")
		}
	case <-ctx.Done():
		diagnose()
		t.Fatal("actual Worker/ACP deadline exceeded; no automatic replay")
	}
	select {
	case <-agentDone:
		agentFinished = true
	case <-ctx.Done():
		t.Fatal("outbound Agent wrapper did not settle")
	}
	diagnose() // Record bounded completion evidence before any semantic assertion.
	wanted := "succeeded"
	if mode == "cancel" {
		wanted = "cancelled"
	}
	result, err := db.RuntimeRun(ctx, run.ID)
	if err != nil || result.Status != wanted {
		if mode == "cancel" {
			t.Fatal("live cancellation inconclusive: no cancelled durable receipt; allowance consumed, no retry or refund")
		}
		t.Fatal("model-backed Run did not retain the expected completion receipt; no replay")
	}
	events, err := db.Events(ctx, run.ID)
	if err != nil {
		t.Fatal("durable candidate events unavailable")
	}
	assertIsolatedEvidenceRedacted(t, db, run.ID, provider.APIKey, workerToken)
	if strings.HasPrefix(mode, "completion") && !isolatedAnswerMatches(events) {
		t.Fatal("synthetic answer marker missing; provider text is intentionally not logged")
	}
	if mode == "cancel" && !retainedAssistantDelta(events) {
		t.Fatal("cancelled receipt lost real assistant stream evidence")
	}
	channel, err := db.RuntimeChannel(ctx, run.ID)
	if err != nil || channel.Requests < 1 || channel.Requests > 2 {
		t.Fatal("provider attempts outside approved per-round allowance")
	}
	t.Logf("actual Worker→bridge→control-plane→outbound wrapper→Go ACP passed; live=%t mode=%s model=%s charged_attempts=%d max_requests=2 max_output_tokens=1024; cwd mapping and Pod identity are test-only, no cluster isolation claim", live, mode, provider.Model, channel.Requests)
}
