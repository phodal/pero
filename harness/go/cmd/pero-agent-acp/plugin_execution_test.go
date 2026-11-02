//go:build linux || darwin

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

type pluginExecutionRequest struct {
	Model    string `json:"model"`
	Messages []struct {
		Role    string          `json:"role"`
		Content json.RawMessage `json:"content"`
	} `json:"messages"`
	Tools []struct {
		Function struct{ Name string } `json:"function"`
	} `json:"tools"`
}

func (request pluginExecutionRequest) text() (string, string) {
	var all strings.Builder
	lastTool := ""
	for _, message := range request.Messages {
		var text string
		if json.Unmarshal(message.Content, &text) != nil {
			var blocks []struct{ Text string }
			_ = json.Unmarshal(message.Content, &blocks)
			for _, block := range blocks {
				text += block.Text
			}
		}
		all.WriteString(text + "\n")
		if message.Role == "tool" {
			lastTool = text
		}
	}
	return all.String(), lastTool
}

func executionTool(w http.ResponseWriter, name string, arguments any, stage int32) {
	raw, _ := json.Marshal(arguments)
	chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": fmt.Sprintf("execution-%d", stage), "type": "function", "function": map[string]any{"name": name, "arguments": string(raw)}}}}, "finish_reason": "tool_calls"}}})
	w.Header().Set("Content-Type", "text/event-stream")
	fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", chunk)
}

// Exercises the actual CLI composition and provider/ACP wires. Package-level
// runtimes alone cannot prove automatic Workflow registration or the shell
// provider's participation in the CLI's shared TaskOutput dispatch.
func TestPluginCLIWorkflowAndBackgroundTaskExecution(t *testing.T) {
	for _, mode := range []string{"workflow", "background shell"} {
		t.Run(mode, func(t *testing.T) {
			base, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			plugin, workspace, sessions := filepath.Join(base, "Selected Plugin"), filepath.Join(base, "workspace"), filepath.Join(base, "sessions")
			for _, path := range []string{filepath.Join(plugin, ".claude-plugin"), workspace, sessions} {
				if err := os.MkdirAll(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if err := os.WriteFile(filepath.Join(plugin, ".claude-plugin", "plugin.json"), []byte(`{"name":"execution-fixture"}`), 0600); err != nil {
				t.Fatal(err)
			}
			artifact := filepath.Join(workspace, "report.txt")
			nodeMarker := filepath.Join(base, "selected-node-ran")
			extra := []string{"--enable-shell", "--workflow-node", filepath.Join(base, "absent-node")}
			var gate *os.File
			if mode == "workflow" {
				node, err := exec.LookPath("node")
				if err != nil {
					t.Skip("Node is required for the real selected-workflow CLI path")
				}
				node, err = filepath.Abs(node)
				if err != nil {
					t.Fatal(err)
				}
				selectedNode := filepath.Join(base, "Node With Spaces")
				wrapper := "#!/bin/sh\nprintf selected > '" + nodeMarker + "'\nexec '" + node + "' \"$@\"\n"
				if err := os.WriteFile(selectedNode, []byte(wrapper), 0700); err != nil {
					t.Fatal(err)
				}
				extra = []string{"--workflow-node", selectedNode}
				if err := os.Mkdir(filepath.Join(plugin, "workflows"), 0700); err != nil {
					t.Fatal(err)
				}
				source := `export const meta={name:'cli-execution',description:'Delegate through the real CLI'}; return await agent('CLI_WORKFLOW_CHILD',{model:'analysis',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false}});`
				if err := os.WriteFile(filepath.Join(plugin, "workflows", "main.js"), []byte(source), 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				path := filepath.Join(workspace, "gate")
				if err := syscall.Mkfifo(path, 0600); err != nil {
					t.Fatal(err)
				}
				gate, err = os.OpenFile(path, os.O_RDWR, 0600)
				if err != nil {
					t.Fatal(err)
				}
				defer gate.Close()
			}
			var calls atomic.Int32
			var taskID atomic.Value
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request pluginExecutionRequest
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					http.Error(w, "invalid fixture request", 400)
					return
				}
				stage := calls.Add(1)
				text, receipt := request.text()
				names := map[string]bool{}
				for _, tool := range request.Tools {
					names[tool.Function.Name] = true
				}
				if stage == 1 && (!names["TaskOutput"] || names["Workflow"] != (mode == "workflow")) {
					t.Errorf("CLI mounted the wrong execution catalog: %+v", names)
				}
				if mode == "workflow" {
					wantModel := "fixture"
					if stage == 2 || stage == 3 {
						wantModel = "fixture-analysis"
						if !names["structured_output"] || names["Workflow"] || !strings.Contains(text, "CLI_WORKFLOW_CHILD") || strings.Contains(text, "CLI_PARENT_INPUT") {
							t.Errorf("CLI child did not receive isolated structured execution: %s", text)
						}
					}
					if request.Model != wantModel {
						t.Errorf("model=%s want=%s", request.Model, wantModel)
					}
					switch stage {
					case 1:
						executionTool(w, "Workflow", map[string]any{"scriptPath": filepath.Join(plugin, "workflows", "main.js"), "args": map[string]any{}}, stage)
						return
					case 2:
						executionTool(w, "Write", map[string]string{"file_path": artifact, "content": "workflow-child-artifact"}, stage)
						return
					case 3:
						if !strings.Contains(receipt, "applied") {
							t.Errorf("child Write did not actually succeed: %s", receipt)
						}
						executionTool(w, "structured_output", map[string]string{"answer": "structured-child-result"}, stage)
						return
					case 4:
						if !strings.Contains(receipt, `"answer":"structured-child-result"`) || !strings.Contains(receipt, `"stopReason":"completed"`) {
							t.Errorf("real Workflow structured result did not reach the parent: %s", receipt)
						}
					}
				} else {
					if request.Model != "fixture" {
						t.Errorf("background shell changed the parent model: %s", request.Model)
					}
					switch stage {
					case 1:
						executionTool(w, "Bash", map[string]any{"command": "read -r _ < gate; printf background-artifact > report.txt; printf background-result", "run_in_background": true}, stage)
						return
					case 2:
						var task struct {
							ID string `json:"task_id"`
						}
						if err := json.Unmarshal([]byte(receipt), &task); err != nil || !strings.HasPrefix(task.ID, "bash-") {
							t.Errorf("CLI Bash did not return a real task: %s error=%v", receipt, err)
						}
						taskID.Store(task.ID)
						executionTool(w, "TaskOutput", map[string]any{"task_id": task.ID, "block": false}, stage)
						return
					case 3:
						if !strings.Contains(receipt, `"status":"running"`) || !strings.Contains(receipt, `"retrieval_status":"not_ready"`) {
							t.Errorf("CLI TaskLookup did not find the running shell task: %s", receipt)
						}
						if _, err := io.WriteString(gate, "continue\n"); err != nil {
							t.Error(err)
						}
						executionTool(w, "TaskOutput", map[string]any{"task_id": taskID.Load().(string), "block": true, "timeout": 2000}, stage)
						return
					case 4:
						if !strings.Contains(receipt, `"status":"completed"`) || !strings.Contains(receipt, "background-result") {
							t.Errorf("CLI TaskOutput lost the actual terminal shell result: %s", receipt)
						}
					}
				}
				if stage > 4 {
					t.Errorf("unexpected execution continuation %d", stage)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"CLI execution complete\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			}))
			defer provider.Close()
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, executable, "-test.run=^TestPluginRuntimeAgentProcess$")
			extraJSON, _ := json.Marshal(extra)
			child.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + base, "TMPDIR=" + base, "LANG=C.UTF-8", "PERO_PLUGIN_RUNTIME_CHILD=1", "PERO_PLUGIN_RUNTIME_ENDPOINT=" + provider.URL + "/v1", "PERO_PLUGIN_RUNTIME_SESSIONS=" + sessions, "PERO_PLUGIN_RUNTIME_WORKSPACE=" + workspace, "PERO_PLUGIN_RUNTIME_DIRECTORY=" + plugin, "PERO_PLUGIN_RUNTIME_CREDENTIAL=local-fixture-placeholder", "PERO_PLUGIN_RUNTIME_EXTRA_ARGS=" + string(extraJSON)}
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
			sequence, approvals := 0, 0
			sessionID := ""
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
						approvals++
						if reply["params"].(map[string]any)["sessionId"] != sessionID {
							t.Error("execution approval was not routed to the controlling ACP session")
						}
						if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": reply["id"], "result": map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "allow-once"}}}); err != nil {
							t.Fatal(err)
						}
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
				t.Fatalf("%s EOF: %v; %s", method, scanner.Err(), diagnostics.String())
				return nil
			}
			rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
			id := rpc("session/new", map[string]any{"cwd": workspace, "mcpServers": []any{}})["sessionId"].(string)
			sessionID = id
			permission := "workspace-write"
			if mode == "background shell" {
				permission = "full-access"
			}
			rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "permission", "value": permission})
			if result := rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "CLI_PARENT_INPUT"}}}); result["stopReason"] != "end_turn" {
				t.Fatal(result)
			}
			if calls.Load() != 4 || approvals != 1 {
				t.Fatalf("calls=%d approvals=%d", calls.Load(), approvals)
			}
			want := "workflow-child-artifact"
			if mode == "background shell" {
				want = "background-artifact"
			} else if _, err := os.Stat(nodeMarker); err != nil {
				t.Fatalf("--workflow-node was not used: %v", err)
			}
			if got, err := os.ReadFile(artifact); err != nil || string(got) != want {
				t.Fatalf("artifact=%s error=%v", got, err)
			}
			rpc("session/close", map[string]any{"sessionId": id})
			_ = input.Close()
			err = child.Wait()
			waited = true
			if err != nil {
				t.Fatalf("CLI cleanup: %v %s", err, diagnostics.String())
			}
			journal, err := os.ReadFile(filepath.Join(sessions, id+".jsonl"))
			fact := "workflow/end"
			if mode == "background shell" {
				fact = "shell-task/ended"
			}
			if err != nil || !bytes.Contains(journal, []byte(fact)) {
				t.Fatalf("execution receipt was not durable: %v", err)
			}
		})
	}
}
