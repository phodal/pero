//go:build linux || darwin

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
)

// The shared Python fixture speaks Content-Length stdio; the CLI and registry
// own all actual configuration, source access, initialization and query work.
func TestLSPCLIQueriesOperatorAndBundledServers(t *testing.T) {
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("Python 3 is required for the stdio fixture")
	}
	python, err = filepath.Abs(python)
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := filepath.Abs("../../lsp/testdata/server.py")
	if err != nil {
		t.Fatal(err)
	}
	for _, bundled := range []bool{false, true} {
		t.Run(fmt.Sprintf("bundled=%t", bundled), func(t *testing.T) {
			base, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			workspace, sessions := filepath.Join(base, "workspace"), filepath.Join(base, "sessions")
			for _, path := range []string{workspace, sessions} {
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(workspace, "fixture.go"), []byte("package fixture\nfunc Greet() {}\n"), 0600); err != nil {
				t.Fatal(err)
			}
			extra := []string{}
			serverPath := fixture
			configPath := filepath.Join(base, "operator-lsp.json")
			if bundled {
				plugin := filepath.Join(base, "Selected Plugin")
				if err := os.MkdirAll(filepath.Join(plugin, ".claude-plugin"), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(plugin, ".claude-plugin", "plugin.json"), []byte(`{"name":"code-fixture"}`), 0600); err != nil {
					t.Fatal(err)
				}
				data, err := os.ReadFile(fixture)
				if err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(plugin, "fixture.py"), data, 0600); err != nil {
					t.Fatal(err)
				}
				serverPath = "${CLAUDE_PLUGIN_ROOT}/fixture.py"
				configPath = filepath.Join(plugin, ".lsp.json")
				extra = []string{"--plugin-dir", plugin}
			} else {
				extra = []string{"--lsp-config", configPath}
			}
			protocol := filepath.Join(base, "protocol.jsonl")
			config, _ := json.Marshal(map[string]any{"fixture": map[string]any{"command": python, "args": []string{"-u", serverPath}, "extensionToLanguage": map[string]string{".go": "go"}, "env": map[string]string{"LSP_FIXTURE_LOG": protocol}, "settings": map[string]string{"private": "config-canary"}, "diagnostics": false, "shutdownTimeout": 100}})
			if err := os.WriteFile(configPath, config, 0600); err != nil {
				t.Fatal(err)
			}
			var calls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request pluginExecutionRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					http.Error(w, "invalid fixture request", 400)
					return
				}
				stage := calls.Add(1)
				_, receipt := request.text()
				if stage == 1 {
					mounted := false
					for _, tool := range request.Tools {
						mounted = mounted || tool.Function.Name == "LSP"
					}
					if !mounted {
						t.Error("selected LSP was not mounted by the real CLI")
					}
					executionTool(w, "LSP", map[string]any{"operation": "workspaceSymbol", "filePath": "fixture.go", "line": 2, "character": 6}, stage)
					return
				}
				if stage != 2 || !strings.Contains(receipt, "Greet") || !strings.Contains(receipt, "fixture.go:2:6") {
					t.Errorf("real language-server result did not reach the model: stage=%d %s", stage, receipt)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"verified code location\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			}))
			defer provider.Close()
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, executable, "-test.run=^TestWebCLIProcess$")
			arguments := []string{"lsp-cli-fixture", "--endpoint", provider.URL + "/v1", "--model", "fixture", "--session-dir", sessions, "--workspace", workspace, "--api-key-env", "PERO_LSP_PRIMARY_KEY", "--max-requests", "2", "--max-tokens", "512", "--max-retries", "0"}
			arguments = append(arguments, extra...)
			rawArguments, _ := json.Marshal(arguments)
			child.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + base, "TMPDIR=" + base, "LANG=C.UTF-8", "PERO_WEB_TEST_CHILD=1", "PERO_WEB_TEST_ARGS=" + string(rawArguments), "PERO_LSP_PRIMARY_KEY=model-fixture-placeholder"}
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
			if err := child.Start(); err != nil {
				t.Fatal(err)
			}
			waited := false
			defer func() {
				_ = input.Close()
				if !waited {
					_ = child.Process.Kill()
					_ = child.Wait()
				}
			}()
			encoder, scanner := json.NewEncoder(input), bufio.NewScanner(output)
			scanner.Buffer(make([]byte, 4096), 2<<20)
			sequence := 0
			rpc := func(method string, params any) map[string]any {
				t.Helper()
				sequence++
				if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": sequence, "method": method, "params": params}); err != nil {
					t.Fatal(err)
				}
				for scanner.Scan() {
					var reply map[string]any
					if err := json.Unmarshal(scanner.Bytes(), &reply); err != nil {
						t.Fatal(err)
					}
					if reply["method"] == "session/request_permission" {
						t.Fatal("read-only LSP query requested another process approval despite the selected execution grant")
					}
					if reply["id"] == float64(sequence) {
						if reply["error"] != nil {
							t.Fatalf("%s: %v", method, reply["error"])
						}
						return reply["result"].(map[string]any)
					}
				}
				_ = child.Process.Kill()
				_ = child.Wait()
				waited = true
				t.Fatalf("%s EOF: %v %s", method, scanner.Err(), diagnostics.String())
				return nil
			}
			rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
			id := rpc("session/new", map[string]any{"cwd": workspace, "mcpServers": []any{}})["sessionId"].(string)
			if result := rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "Locate Greet using the selected language server."}}}); result["stopReason"] != "end_turn" {
				t.Fatal(result)
			}
			rpc("session/close", map[string]any{"sessionId": id})
			_ = input.Close()
			err = child.Wait()
			waited = true
			if err != nil {
				t.Fatalf("CLI cleanup: %v %s", err, diagnostics.String())
			}
			if calls.Load() != 2 {
				t.Fatalf("LSP unexpectedly invoked another model: calls=%d", calls.Load())
			}
			data, err := os.ReadFile(protocol)
			if err != nil {
				t.Fatal(err)
			}
			methods := map[string]int{}
			pid := 0
			for _, line := range bytes.Split(bytes.TrimSpace(data), []byte("\n")) {
				var event struct {
					Method string
					PID    int
				}
				if err := json.Unmarshal(line, &event); err != nil {
					t.Fatal(err)
				}
				methods[event.Method]++
				pid = event.PID
			}
			if methods["initialize"] != 1 || methods["workspace/symbol"] != 1 || methods["shutdown"] != 1 || methods["exit"] != 1 {
				t.Fatalf("selected stdio lifecycle was not completed: %+v", methods)
			}
			if err := syscall.Kill(pid, 0); err != syscall.ESRCH {
				t.Fatalf("CLI leaked selected LSP process: %v", err)
			}
			journal, err := os.ReadFile(filepath.Join(sessions, id+".jsonl"))
			if err != nil || bytes.Contains(journal, []byte("config-canary")) || bytes.Contains(journal, []byte("fixture-placeholder")) {
				t.Fatal("language-server configuration or credential entered the root journal")
			}
		})
	}
}

func TestLSPOperatorConfigMustBeBoundedRegularFile(t *testing.T) {
	root := t.TempDir()
	fifo := filepath.Join(root, "config.fifo")
	if err := syscall.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	oversize := filepath.Join(root, "oversize.json")
	file, err := os.Create(oversize)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(1<<20 + 1); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{fifo, root, oversize} {
		if _, err := mountLSP(t.Context(), nil, root, nil, nil, lspOptions{Files: []string{path}}); err == nil || !strings.Contains(err.Error(), "regular file") {
			t.Fatalf("non-regular or unbounded config was not rejected: %v", err)
		}
	}
}
