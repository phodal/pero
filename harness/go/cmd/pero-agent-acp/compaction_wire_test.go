package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/providers/openai"
)

func TestCompactionAgentProcess(t *testing.T) {
	if os.Getenv("PERO_COMPACTION_TEST_CHILD") != "1" {
		return
	}
	flag.CommandLine = flag.NewFlagSet("agent-fixture", flag.ContinueOnError)
	os.Args = []string{"agent-fixture", "--endpoint", os.Getenv("PERO_COMPACTION_TEST_ENDPOINT"), "--model", "fixture", "--session-dir", os.Getenv("PERO_COMPACTION_TEST_SESSIONS"), "--context-window", os.Getenv("PERO_COMPACTION_TEST_WINDOW"), "--max-tokens", "128", "--max-retries", "0"}
	if os.Getenv("PERO_COMPACTION_TEST_API") == "responses" {
		os.Args = append(os.Args, "--api-format", "responses", "--disable-streaming")
	}
	if os.Getenv("PERO_RECOVER_TAIL") == "1" {
		os.Args = append(os.Args, "--recover-complete-session-tail")
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	os.Exit(0)
}

func TestCompactionCLIActualLoopAndWire(t *testing.T) {
	for _, scenario := range []string{"pressure", "http-context-overflow", "responses-pressure"} {
		t.Run(scenario, func(t *testing.T) {
			var summaries, mainCalls atomic.Int32
			var overflowRecovered atomic.Bool
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				data, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
				}
				if strings.Contains(string(data), "acting as a compaction engine") {
					summaries.Add(1)
				} else if scenario == "http-context-overflow" {
					call := mainCalls.Add(1)
					if call == 2 {
						if summaries.Load() != 0 {
							t.Error("pressure compaction masked overflow recovery")
						}
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusRequestEntityTooLarge)
						fmt.Fprint(w, `{"error":{"code":"context_length_exceeded","message":"maximum context length exceeded"}}`)
						return
					}
					if call == 3 {
						overflowRecovered.Store(summaries.Load() > 0)
					}
				}
				if scenario == "responses-pressure" {
					w.Header().Set("Content-Type", "application/json")
					fmt.Fprintf(w, `{"status":"completed","output":[{"id":"msg_%d","type":"message","role":"assistant","status":"completed","phase":"final_answer","content":[{"type":"output_text","text":"checkpoint answer","annotations":[]}]}]}`, mainCalls.Add(1))
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"checkpoint answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			}))
			defer server.Close()
			exe, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, exe, "-test.run=^TestCompactionAgentProcess$")
			window := "1024"
			if scenario == "http-context-overflow" {
				window = "32768"
			}
			sessionDir := t.TempDir()
			child.Env = append(os.Environ(), "PERO_COMPACTION_TEST_WINDOW="+window, "PERO_COMPACTION_TEST_CHILD=1", "PERO_COMPACTION_TEST_ENDPOINT="+server.URL+"/v1", "PERO_COMPACTION_TEST_SESSIONS="+sessionDir, "PERO_RECOVER_TAIL=1", "AGENT_PROVIDER_API_KEY=fixture-not-secret")
			if scenario == "responses-pressure" {
				child.Env = append(child.Env, "PERO_COMPACTION_TEST_API=responses")
			}
			input, err := child.StdinPipe()
			if err != nil {
				t.Fatal(err)
			}
			output, err := child.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			var diagnostics bytes.Buffer
			child.Stderr = &diagnostics
			if err = child.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = input.Close(); _ = child.Process.Kill(); _ = child.Wait() })
			encoder := json.NewEncoder(input)
			scanner := bufio.NewScanner(output)
			scanner.Buffer(make([]byte, 4096), 1<<20)
			next := 0
			rpc := func(method string, params any) map[string]any {
				t.Helper()
				next++
				id := next
				if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
					t.Fatal(err)
				}
				for scanner.Scan() {
					var message map[string]any
					if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
						t.Fatal(err)
					}
					if message["id"] == float64(id) {
						return message
					}
				}
				t.Fatalf("RPC %s EOF: %v %s", method, scanner.Err(), diagnostics.String())
				return nil
			}
			rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
			cwd := t.TempDir()
			created := rpc("session/new", map[string]any{"cwd": cwd, "mcpServers": []any{}})
			result, ok := created["result"].(map[string]any)
			if !ok {
				t.Fatalf("session/new: %v", created)
			}
			session := result["sessionId"]
			prompt := func() {
				reply := rpc("session/prompt", map[string]any{"sessionId": session, "prompt": []map[string]any{{"type": "text", "text": strings.Repeat("long context detail ", 100)}}})
				if reply["error"] != nil {
					t.Fatalf("prompt: %v", reply)
				}
			}
			for i := 0; i < 6; i++ {
				prompt()
			}
			if summaries.Load() == 0 {
				t.Fatal("CLI did not activate compaction")
			}
			rpc("session/close", map[string]any{"sessionId": session})
			// A stopped writer leaves a complete final JSON record without its
			// delimiter. The explicit CLI policy must preserve it before resume.
			logPath := filepath.Join(sessionDir, session.(string)+".jsonl")
			raw, err := os.ReadFile(logPath)
			if err != nil {
				t.Fatal(err)
			}
			torn := raw[:len(raw)-1]
			if err = os.WriteFile(logPath, torn, 0600); err != nil {
				t.Fatal(err)
			}
			reply := rpc("session/resume", map[string]any{"sessionId": session, "cwd": cwd, "mcpServers": []any{}})
			if reply["error"] != nil {
				t.Fatal(reply)
			}
			backup, err := os.ReadFile(logPath + ".tail-backup")
			if err != nil || !bytes.Equal(backup, torn) {
				t.Fatalf("recovery backup: %v", err)
			}
			before := summaries.Load()
			for i := 0; i < 4; i++ {
				prompt()
			}
			if scenario == "pressure" && summaries.Load() <= before {
				t.Fatal("resumed CLI lost compaction")
			}
			if scenario == "http-context-overflow" && !overflowRecovered.Load() {
				t.Fatal("HTTP 413 did not summarize and retry the main request")
			}
			_ = input.Close()
			if err = child.Wait(); err != nil {
				t.Fatalf("child: %v %s", err, diagnostics.String())
			}
		})
	}
}

func TestSummaryRouteAfterProviderSwitch(t *testing.T) {
	for _, tc := range []struct{ name, override, recipient string }{
		{"default uses the newly selected provider", "", "provider-b"},
		{"explicit summarizer chooses the earlier provider", "provider-a", "provider-a"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
			defer cancel()
			const excerpt = "synthetic-excerpt-frozen-page-004"
			type receipt struct{ provider, model, body string }
			received := make(chan receipt, 4)
			providers := make(map[string]*openai.Adapter)
			for _, provider := range []string{"provider-a", "provider-b"} {
				model := "model-" + strings.TrimPrefix(provider, "provider-")
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					raw, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
					var body struct{ Model string }
					if err != nil || json.Unmarshal(raw, &body) != nil || r.URL.Path != "/v1/chat/completions" {
						t.Errorf("invalid local fixture request: %s %v", r.URL.Path, err)
						http.Error(w, "invalid fixture request", http.StatusBadRequest)
						return
					}
					received <- receipt{provider, body.Model, string(raw)}
					w.Header().Set("Content-Type", "text/event-stream")
					fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"short checkpoint\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
				}))
				t.Cleanup(server.Close)
				adapter, err := openai.New(openai.Config{
					Endpoint: server.URL + "/v1", AllowHTTP: true, APIKey: "synthetic-not-a-credential", MaxRequests: 1,
					ProviderName: provider, Models: []openai.ModelConfig{{ID: model, ContextWindow: 32768}},
				})
				if err != nil {
					t.Fatal(err)
				}
				providers[provider] = adapter
			}
			h, err := harness.Boot(ctx, harness.Options{
				AdapterProviders: []string{"provider-a", "provider-b"},
				Adapter: harness.AdapterFunc(func(ctx context.Context, req harness.GenerateRequest, emit func(harness.StreamChunk) error) (harness.Completion, error) {
					adapter := providers[req.Provider]
					if adapter == nil {
						return harness.Completion{}, fmt.Errorf("unknown fixture provider %q", req.Provider)
					}
					return adapter.Generate(ctx, req, emit)
				}),
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				_ = h.Dispose(context.Background())
				_ = h.Drain(context.Background())
			})
			auto := false
			config := harness.BasicCompactionConfig{Auto: &auto}
			if tc.override != "" {
				config.SummarizationProvider, config.SummarizationModel = tc.override, "model-a"
			}
			agent, err := h.Agents().Create(ctx, harness.AgentOptions{
				Provider: "provider-b", Model: "model-b", Compaction: &config,
			})
			if err != nil {
				t.Fatal(err)
			}
			session := agent.Session()
			appendEvent := func(kind string, value any) {
				t.Helper()
				if _, err := session.Append(kind, value); err != nil {
					t.Fatal(err)
				}
			}
			appendEvent("turn/start", struct{ Turn int }{1})
			appendEvent("step/start", struct{ Turn, Step int }{1, 1})
			appendEvent("user/message", harness.Message{
				Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "read the frozen fixture"}},
			})
			appendEvent("request/header", harness.RequestHeaderEvent{Turn: 1, Step: 1, Provider: "provider-a", Model: "model-a"})
			appendEvent("assistant/message", struct {
				Message harness.Message `json:"message"`
			}{harness.Message{
				Role: harness.RoleAssistant, Source: json.RawMessage(`{"kind":"model","provider":"provider-a","model":"model-a"}`),
				Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "call_read", Name: "read_file", Arguments: json.RawMessage(`{"path":"fixture.txt"}`)}},
			}})
			appendEvent("tool/result", harness.ContentBlock{
				Type: harness.BlockToolResult, ToolCallID: "call_read",
				Content: []harness.ContentBlock{{Type: harness.BlockText, Text: strings.Repeat(excerpt+" ", 600)}},
			})
			appendEvent("step/end", struct{ Turn, Step int }{1, 1})
			appendEvent("turn/end", struct{ Turn int }{1})
			appendEvent("turn/start", struct{ Turn int }{2})
			appendEvent("step/start", struct{ Turn, Step int }{2, 1})
			appendEvent("user/message", harness.Message{
				Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "keep this latest message"}},
			})
			appendEvent("request/header", harness.RequestHeaderEvent{Turn: 2, Step: 1, Provider: "provider-b", Model: "model-b"})
			appendEvent("step/end", struct{ Turn, Step int }{2, 1})
			appendEvent("turn/end", struct{ Turn int }{2})

			result, err := agent.CompactNow(ctx)
			if err != nil || result == nil {
				t.Fatalf("compaction result=%+v err=%v", result, err)
			}
			if len(received) != 1 {
				t.Fatalf("expected one request total to both endpoints, got %d", len(received))
			}
			got := <-received
			if got.provider != tc.recipient || got.model != "model-"+strings.TrimPrefix(tc.recipient, "provider-") ||
				!strings.Contains(got.body, excerpt) {
				t.Fatalf("wrong summary recipient or missing excerpt: provider=%q model=%q excerpt=%t", got.provider, got.model, strings.Contains(got.body, excerpt))
			}
			event, ok := session.EventAt(result.SummarySeq)
			var recorded struct{ Provider, Model string }
			if !ok || json.Unmarshal(event.Data, &recorded) != nil || recorded.Provider != got.provider || recorded.Model != got.model {
				t.Fatalf("summary receipt=%+v, wire=%s/%s", recorded, got.provider, got.model)
			}
		})
	}
}
