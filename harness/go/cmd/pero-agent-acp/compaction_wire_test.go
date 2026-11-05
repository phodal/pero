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
