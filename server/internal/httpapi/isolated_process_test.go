//go:build unix

package httpapi_test

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
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

// Separate ACP process, not a simulated Worker/bridge. It accepts the fixed
// container cwd without accessing it on the test host. Real Go ACP is exercised
// separately over TLS in remoteacp/cli_test.go and at /workspace/repo in kind.
func TestIsolatedACPProcess(t *testing.T) {
	args := map[string]string{}
	for i, a := range os.Args {
		if strings.HasPrefix(a, "--") && i+1 < len(os.Args) {
			args[a] = os.Args[i+1]
		}
	}
	marker := args["--fixture-marker"]
	if marker == "" {
		return
	}
	if os.Getenv("PERO_WORKER_TOKEN") != "" || os.Getenv("PERO_REMOTE_CHANNEL_SECRET") != "" || os.Getenv("AGENT_PROVIDER_API_KEY") != "" {
		os.Exit(5)
	}
	send := func(v any) {
		if json.NewEncoder(os.Stdout).Encode(v) != nil {
			os.Exit(6)
		}
	}
	var prompt any
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var message map[string]any
		if json.Unmarshal(scanner.Bytes(), &message) != nil {
			os.Exit(7)
		}
		result := func(id, value any) { send(map[string]any{"jsonrpc": "2.0", "id": id, "result": value}) }
		switch message["method"] {
		case "initialize":
			result(message["id"], map[string]any{"protocolVersion": 1, "agentCapabilities": map[string]any{}})
		case "session/new":
			params := message["params"].(map[string]any)
			if params["cwd"] != "/workspace/repo" || len(params["mcpServers"].([]any)) != 0 {
				os.Exit(8)
			}
			result(message["id"], map[string]any{"sessionId": "fixture"})
		case "session/prompt":
			os.WriteFile(marker, []byte("prompt\n"), 0600)
			prompt = message["id"]
			if args["--fixture-mode"] == "eof" {
				os.Exit(9)
			}
			send(map[string]any{"jsonrpc": "2.0", "id": 900, "method": "session/request_permission", "params": map[string]any{"sessionId": "fixture", "toolCall": map[string]any{"toolCallId": "host-write", "title": "attempt", "status": "pending"}, "options": []any{map[string]any{"optionId": "allow", "name": "Allow", "kind": "allow_once"}}}})
		default:
			if message["id"] == float64(900) {
				denied := message["result"].(map[string]any)["outcome"].(map[string]any)["outcome"] == "cancelled"
				if !denied {
					os.Exit(10)
				}
				deadline := time.Now().Add(5 * time.Second)
				waitFile := func(path string) {
					for {
						if _, err := os.Stat(path); err == nil {
							return
						}
						if time.Now().After(deadline) {
							os.Exit(13)
						}
						time.Sleep(10 * time.Millisecond)
					}
				}
				waitFile(args["--fixture-release"])
				response, err := http.Post(args["--endpoint"]+"/chat/completions", "application/json", strings.NewReader(`{"model":"fixture","stream":true,"messages":[{"role":"user","content":"fixture"}]}`))
				if err != nil {
					os.Exit(11)
				}
				body, _ := io.ReadAll(response.Body)
				response.Body.Close()
				if response.StatusCode != 200 || !strings.Contains(string(body), "isolated answer") {
					os.Exit(12)
				}
				os.WriteFile(args["--fixture-provider-done"], []byte("done"), 0600)
				waitFile(args["--fixture-finish"])
				send(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{"sessionId": "fixture", "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": "isolated answer"}}}})
				result(prompt, map[string]any{"stopReason": "end_turn"})
			}
		}
	}
	os.Exit(0)
}

func TestIsolatedRuntimeWorkerProcesses(t *testing.T) {
	if os.Getenv("PERO_ISOLATED_PROCESS_E2E") != "1" {
		t.Skip("set PERO_ISOLATED_PROCESS_E2E=1 with explicit built binaries and PostgreSQL")
	}
	binaries := map[string]string{}
	for _, name := range []string{"PERO_SANDBOX_WORKER_BINARY", "PERO_REMOTE_BRIDGE_BINARY", "PERO_REMOTE_CONNECT_BINARY"} {
		binaries[name] = os.Getenv(name)
		if !filepath.IsAbs(binaries[name]) {
			t.Fatalf("%s must name a built absolute fixture binary", name)
		}
	}
	for _, mode := range []string{"success", "eof", "cancel", "release"} {
		t.Run(mode, func(t *testing.T) {
			var providers atomic.Int32
			providerStarted := make(chan struct{}, 1)
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempt := providers.Add(1)
				if r.Header.Get("Authorization") != "Bearer server-provider-secret" {
					t.Error("server provider credential missing")
				}
				if mode == "cancel" || mode == "release" {
					io.Copy(io.Discard, r.Body)
					providerStarted <- struct{}{}
					<-r.Context().Done()
					return
				}
				if attempt == 1 {
					connection, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					connection.Close()
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"isolated answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			}))
			defer upstream.Close()
			reviews := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var in struct {
					Spec struct {
						Token     string   `json:"token"`
						Audiences []string `json:"audiences"`
					} `json:"spec"`
				}
				if json.NewDecoder(r.Body).Decode(&in) != nil || len(in.Spec.Audiences) != 1 || in.Spec.Audiences[0] != runtimechannel.Audience {
					t.Error("invalid online TokenReview")
					http.Error(w, "bad", 400)
					return
				}
				pod := "pod1"
				audience := runtimechannel.Audience
				if in.Spec.Token == "wrong-pod-token" {
					pod = "pod2"
				} else if in.Spec.Token == "wrong-audience-token" {
					audience = "another-audience"
				} else if in.Spec.Token != "synthetic-pod-token" {
					http.Error(w, "bad", 403)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"status": map[string]any{"authenticated": true, "audiences": []string{audience}, "user": map[string]any{"username": "system:serviceaccount:pero-test:agent", "uid": "sa1", "extra": map[string]any{"authentication.kubernetes.io/pod-uid": []string{pod}}}}})
			}))
			defer reviews.Close()
			reviewer, err := runtimeauth.New(reviews.URL, reviews.Client())
			if err != nil {
				t.Fatal(err)
			}
			var db *store.Store
			server := testAPI(t, func(s *store.Store) http.Handler {
				db = s
				gateway, err := runtimegateway.New(s, reviewer, runtimegateway.ProviderConfig{Endpoint: upstream.URL + "/v1/chat/completions", Model: "fixture", APIKey: "server-provider-secret", Budget: runtimechannel.ProviderBudget{MaxRequests: 2, MaxConcurrent: 1, MaxOutputTokens: 64, MaxRequestBytes: 1 << 20, MaxResponseBytes: 1 << 20, TimeoutSeconds: 5}})
				if err != nil {
					t.Fatal(err)
				}
				return httpapi.HandlerWithIsolatedRuntime(s, "test-operator", nil, gateway, reviewer, nil)
			})
			var serverErrors strings.Builder
			server.Config.ErrorLog = log.New(&serverErrors, "", 0)
			t.Cleanup(func() {
				server.Close()
				if serverErrors.Len() != 0 {
					t.Errorf("HTTP transport logged an internal failure: %s", serverErrors.String())
				}
			})
			ctx, cancel := context.WithTimeout(t.Context(), 12*time.Second)
			defer cancel()
			worker, workerToken, err := db.CreateWorker(ctx, "external", []string{"p"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			config := runtimebinding.Config{Profile: runtimechannel.Profile, ClusterID: "test", Namespace: "pero-test", WorkerID: worker.ID, ProjectID: "p", WorkspaceKey: "repo", AgentID: "fixture", ImageDigest: "sha256:" + strings.Repeat("a", 64), TemplateDigest: "sha256:" + strings.Repeat("b", 64), WorkspaceRevision: strings.Repeat("c", 40), TTLSeconds: 3600, RuntimeClass: "runsc", ServiceAccount: "agent", ServiceAccountUID: "sa1", Audience: runtimechannel.Audience, ControlURL: "https://fixture.invalid", ImageRef: "fixture@sha256:" + strings.Repeat("a", 64), Model: "fixture", StorageClass: "retained", StorageAccessMode: "ReadWriteOnce", VolumeSize: "1Gi"}
			if err = db.ConfigureRuntimeWorker(ctx, config); err != nil {
				t.Fatal(err)
			}
			task, err := db.CreateTask(ctx, store.Spec{Title: "Fixture", Prompt: "Use isolated Agent", Acceptance: "Retain candidate evidence", ProjectID: "p", WorkspaceKey: "repo", AgentID: "fixture"}, "create")
			if err != nil {
				t.Fatal(err)
			}
			run, binding, _, err := db.DispatchRuntime(ctx, task.ID, "dispatch", config)
			if err != nil {
				t.Fatal(err)
			}
			resource := model.ResourceRef{Owner: model.Owner{Kind: "kubernetes", ID: "test"}, Kind: "kubernetes.sandbox", Scope: "pero-test", ID: "sandbox", Incarnation: "sandbox-uid"}
			bound, err := binding.WithResource(resource)
			if err != nil {
				t.Fatal(err)
			}
			pvc := resource
			pvc.Kind = "kubernetes.pvc"
			pvc.ID = "workspace"
			pvc.Incarnation = "pvc-uid"
			bound, err = bound.WithVolume(runtimebinding.VolumeBinding{Resource: pvc, VolumeName: "pv1", ProviderDigest: "sha256:" + strings.Repeat("d", 64)})
			if err != nil {
				t.Fatal(err)
			}
			now := time.Now()
			expiry := now.Add(time.Hour)
			bound = bound.Observe(model.Observation{Resource: resource, Runtime: &model.Ref{Kind: "kubernetes-runtime", ID: "pod1", Digest: "sha256:" + strings.Repeat("d", 64)}, Receipt: model.Ref{Kind: "kubernetes-observation", ID: resource.Incarnation, Revision: "1"}, ObservedAt: now, Ready: model.Condition{Status: "True", Reason: "FixtureReady"}, Artifacts: []model.Ref{{Kind: "container-image", ID: config.ImageRef, Revision: "agent", Digest: config.ImageDigest}}, LeaseExpiresAt: &expiry}, now)
			if _, err = db.SaveRuntimeBinding(ctx, bound.Version, bound); err != nil || bound.Phase != runtimebinding.Ready {
				t.Fatal("binding not ready", err)
			}
			dir := t.TempDir()
			tokenPath := filepath.Join(dir, "pod-token")
			os.WriteFile(tokenPath, []byte("synthetic-pod-token"), 0600)
			configPath := filepath.Join(dir, "worker.json")
			data, _ := json.Marshal(map[string]string{"remote_bridge": binaries["PERO_REMOTE_BRIDGE_BINARY"]})
			os.WriteFile(configPath, data, 0600)
			workerCmd := exec.CommandContext(ctx, binaries["PERO_SANDBOX_WORKER_BINARY"], "--once")
			workerCmd.Env = []string{"PERO_CLOUD_URL=" + server.URL, "PERO_WORKER_TOKEN=" + workerToken, "PERO_WORKER_CONFIG=" + configPath, "PERO_WORKER_STATE=" + filepath.Join(dir, "state.json"), "AGENT_PROVIDER_API_KEY=must-not-cross"}
			workerOutput := &strings.Builder{}
			workerCmd.Stdout = workerOutput
			workerCmd.Stderr = workerOutput
			if err = workerCmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { workerCmd.Process.Kill(); workerCmd.Wait() }()
			// Observe the durable grant before testing a cross-Pod attach and starting the
			// legitimate Agent. No timing sleeps are used to order internal goroutines.
			for {
				if _, err = db.RuntimeChannel(ctx, run.ID); err == nil {
					break
				}
				select {
				case <-ctx.Done():
					t.Fatal("grant not issued", workerOutput.String())
				case <-time.After(10 * time.Millisecond):
				}
			}
			request(t, server, "POST", "/api/worker/v1/claims", "synthetic-pod-token", map[string]string{"request_id": "forged", "instance_id": "forged"}, "", 401)
			rejected, _ := http.NewRequestWithContext(ctx, "POST", server.URL+"/api/runtime/v1/runs/"+run.ID+"/channel/agent?session_id="+run.ID, strings.NewReader("{}\n"))
			rejected.Header.Set("Content-Type", "application/x-ndjson")
			rejected.Header.Set("Authorization", "Bearer wrong-pod-token")
			response, err := server.Client().Do(rejected)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode != 403 {
				t.Fatalf("wrong Pod attach=%d", response.StatusCode)
			}
			executable, _ := os.Executable()
			fixture := filepath.Join(dir, "fixture.sh")
			os.WriteFile(fixture, []byte("#!/bin/sh\nexec '"+strings.ReplaceAll(executable, "'", "'\\''")+"' -test.run=TestIsolatedACPProcess -- \"$@\"\n"), 0700)
			agentCmd := exec.CommandContext(ctx, binaries["PERO_REMOTE_CONNECT_BINARY"], "--control-url", server.URL, "--run-id", run.ID, "--session-id", run.ID, "--token-file", tokenPath, "--workspace", dir, "--agent", fixture, "--model", "fixture", "--session-dir", filepath.Join(dir, "sessions"), "--", "--fixture-marker", filepath.Join(dir, "prompt-marker"), "--fixture-mode", mode, "--fixture-release", filepath.Join(dir, "release"), "--fixture-provider-done", filepath.Join(dir, "provider-done"), "--fixture-finish", filepath.Join(dir, "finish"))
			agentCmd.Cancel = func() error { return agentCmd.Process.Signal(syscall.SIGTERM) }
			agentCmd.WaitDelay = 2 * time.Second
			agentOutput := &strings.Builder{}
			agentCmd.Stdout = agentOutput
			agentCmd.Stderr = agentOutput
			if err = agentCmd.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() { agentCmd.Process.Signal(syscall.SIGTERM); agentCmd.Wait() }()
			if mode == "success" {
				waitFile := func(path string) {
					t.Helper()
					for {
						if _, err := os.Stat(path); err == nil {
							return
						}
						select {
						case <-ctx.Done():
							t.Fatal("fixture signal missing", path)
						case <-time.After(10 * time.Millisecond):
						}
					}
				}
				waitFile(filepath.Join(dir, "prompt-marker"))
				path := "/api/runtime/v1/runs/" + run.ID + "/provider/v1/chat/completions?session_id=" + run.ID
				valid := map[string]any{"model": "fixture", "stream": true, "messages": []any{map[string]any{"role": "user", "content": "test"}}}
				request(t, server, "POST", path, "wrong-pod-token", valid, "", 403)
				request(t, server, "POST", path, "wrong-audience-token", valid, "", 403)
				request(t, server, "POST", path, "synthetic-pod-token", map[string]any{"model": "another", "messages": valid["messages"]}, "", 400)
				duplicate, _ := http.NewRequestWithContext(ctx, "POST", server.URL+"/api/runtime/v1/runs/"+run.ID+"/channel/agent?session_id="+run.ID, strings.NewReader("{}\n"))
				duplicate.Header.Set("Content-Type", "application/x-ndjson")
				duplicate.Header.Set("Authorization", "Bearer synthetic-pod-token")
				duplicateResponse, e := server.Client().Do(duplicate)
				if e != nil {
					t.Fatal(e)
				}
				duplicateResponse.Body.Close()
				if duplicateResponse.StatusCode != 409 {
					t.Fatal("accepted Agent channel reopened", duplicateResponse.StatusCode)
				}
				// Upstream accepts this request and loses its reply. The attempt is
				// still charged; the Agent's successful call spends the second.
				lost := request(t, server, "POST", path, "synthetic-pod-token", valid, "", 502)
				if string(lost) != "{\"error\":{\"message\":\"PERO_PROVIDER_TRANSPORT\",\"code\":\"PERO_PROVIDER_TRANSPORT\"}}\n" {
					t.Fatal("lost upstream response did not retain only the static transport diagnostic")
				}
				os.WriteFile(filepath.Join(dir, "release"), []byte("go"), 0600)
				waitFile(filepath.Join(dir, "provider-done"))
				request(t, server, "POST", path, "synthetic-pod-token", valid, "", 403)
				channel, e := db.RuntimeChannel(ctx, run.ID)
				if e != nil || channel.Requests != 2 {
					t.Fatalf("provider attempts not retained: %#v %v", channel, e)
				}
				os.WriteFile(filepath.Join(dir, "finish"), []byte("go"), 0600)
			}
			if mode == "cancel" || mode == "release" {
				os.WriteFile(filepath.Join(dir, "release"), []byte("go"), 0600)
				select {
				case <-providerStarted:
				case <-ctx.Done():
					t.Fatal("provider never entered held request")
				}
				if mode == "release" {
					if _, e := db.ReleaseRuntime(ctx, run.ID); e != nil {
						t.Fatal(e)
					}
				} else {
					request(t, server, "POST", "/api/v1/tasks/"+task.ID+"/cancel", "test-operator", nil, "", 200)
				}
			}
			workerErr := workerCmd.Wait()
			agentErr := agentCmd.Wait()
			if ctx.Err() != nil {
				t.Fatalf("process deadline: worker=%s agent=%s", workerOutput.String(), agentOutput.String())
			}
			if (mode == "success" || mode == "cancel" || mode == "release") && workerErr != nil || mode == "eof" && workerErr == nil || agentErr == nil {
				t.Fatalf("process outcome: worker=%v agent=%v workerlog=%s agentlog=%s", workerErr, agentErr, workerOutput.String(), agentOutput.String())
			}
			current, err := db.RuntimeRun(ctx, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			wanted := "succeeded"
			if mode == "eof" {
				wanted = "reconcile"
			}
			if mode == "cancel" || mode == "release" {
				wanted = "cancelled"
			}
			if current.Status != wanted {
				t.Fatalf("Run=%s wanted=%s", current.Status, wanted)
			}
			evidence, err := db.Events(ctx, run.ID)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(evidence)
			if strings.Contains(string(raw), workerToken) || strings.Contains(string(raw), "server-provider-secret") {
				t.Fatal("credential in retained evidence")
			}
			if mode == "success" && (!strings.Contains(string(raw), "permission_denied") || !strings.Contains(string(raw), "isolated answer") || providers.Load() != 2) {
				t.Fatalf("candidate evidence missing: %s providers=%d", raw, providers.Load())
			}
			if mode == "cancel" || mode == "release" {
				// Either the trusted renewal or post-EOF inspection may observe
				// cancellation first. Neither is a remote compute/data receipt.
				retained, e := db.RuntimeBinding(ctx, run.ID)
				if e != nil || retained.ComputeReceipt != nil || retained.DataCleanupReceipt != nil {
					t.Fatal("Worker cancellation fabricated cleanup", e)
				}
				if providers.Load() != 1 {
					t.Fatal("held provider request replayed")
				}
			}
			marker, _ := os.ReadFile(filepath.Join(dir, "prompt-marker"))
			if string(marker) != "prompt\n" {
				t.Fatal("prompt did not execute exactly once")
			}
			request(t, server, "POST", "/api/runtime/v1/runs/"+run.ID+"/provider/v1/chat/completions?session_id="+run.ID, "synthetic-pod-token", map[string]any{"model": "fixture", "messages": []any{}}, "", 403)
		})
	}
}
