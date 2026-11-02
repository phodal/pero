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
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestPluginForkCLIIsolationAndChildGrants(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("descriptor-bound plugin resources require Unix")
	}
	for _, test := range []struct {
		name, agent, invocation string
		childWrite              bool
	}{
		{name: "builtin slash", agent: "Explore", invocation: "slash"},
		{name: "plugin agent through Skill", agent: "reviewer", invocation: "model", childWrite: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			const body = "private-fork-instructions-fixture"
			const history = "parent-history-must-stay-isolated"
			const answer = "verified-isolated-child-result"
			const agentInstructions = "custom-agent-private-instructions-fixture"
			base, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			pluginRoot := filepath.Join(base, "Selected Plugin")
			workspace, sessions := filepath.Join(base, "workspace"), filepath.Join(base, "sessions")
			for _, path := range []string{pluginRoot, workspace, sessions} {
				if err := os.MkdirAll(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			files := map[string]string{
				".claude-plugin/plugin.json": `{"name":"sample","version":"1.0.0"}`,
				"skills/research/SKILL.md":   "---\nname: research\ndescription: Run an isolated research task\ncontext: fork\nagent: " + test.agent + "\nmodel: analysis\nbackground: true\nallowed-tools: Write\n---\n" + body + "\narguments=$ARGUMENTS\ntemplate=${CLAUDE_PLUGIN_ROOT}/templates/report.md\n",
				"agents/reviewer.md":         "---\nname: reviewer\ndescription: Isolated reviewer\ntools: [Read, Write]\n---\n" + agentInstructions,
				"templates/report.md":        "verified-plugin-template-content",
			}
			for path, content := range files {
				absolute := filepath.Join(pluginRoot, filepath.FromSlash(path))
				if err := os.MkdirAll(filepath.Dir(absolute), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(absolute, []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			childStart := int32(2)
			if test.invocation == "model" {
				childStart++
			}
			var calls, childCalls atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Model    string `json:"model"`
					Messages []struct {
						Role    string          `json:"role"`
						Content json.RawMessage `json:"content"`
					} `json:"messages"`
					Tools []struct {
						Function struct{ Name string } `json:"function"`
					} `json:"tools"`
				}
				if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
					t.Error(err)
					http.Error(w, "invalid fixture request", http.StatusBadRequest)
					return
				}
				var text strings.Builder
				for _, message := range request.Messages {
					var content string
					if json.Unmarshal(message.Content, &content) != nil {
						var blocks []struct{ Text string }
						_ = json.Unmarshal(message.Content, &blocks)
						for _, block := range blocks {
							content += block.Text
						}
					}
					text.WriteString(content + "\n")
				}
				stage := calls.Add(1)
				child := stage == childStart || stage == childStart+1
				wantModel := "fixture"
				if child {
					wantModel = "fixture-analysis"
					childCalls.Add(1)
				}
				if request.Model != wantModel {
					t.Errorf("request %d model=%s want=%s", stage, request.Model, wantModel)
				}
				if child && strings.Contains(text.String(), history) {
					t.Error("forked child received parent conversation history")
				}
				if !child && (strings.Contains(text.String(), body) || strings.Contains(text.String(), agentInstructions)) {
					t.Error("parent model received fork instructions")
				}
				w.Header().Set("Content-Type", "text/event-stream")
				tool := func(name string, arguments any) {
					raw, _ := json.Marshal(arguments)
					chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": fmt.Sprintf("fork-fixture-%d", stage), "type": "function", "function": map[string]any{"name": name, "arguments": string(raw)}}}}, "finish_reason": "tool_calls"}}})
					fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", chunk)
				}
				stop := func(content string) {
					raw, _ := json.Marshal(content)
					fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":%s},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n", raw)
				}
				switch {
				case stage == 1:
					stop("parent workspace ready")
				case test.invocation == "model" && stage == 2:
					tool("Skill", map[string]string{"skill": "sample:research", "args": "topic with spaces"})
				case stage == childStart:
					for _, expected := range []string{body, "arguments=topic with spaces", filepath.Join(pluginRoot, "templates", "report.md"), "Base directory for this skill: " + filepath.Join(pluginRoot, "skills", "research"), "Plugin root: " + pluginRoot} {
						if !strings.Contains(text.String(), expected) {
							t.Errorf("child instructions missing %q", expected)
						}
					}
					if test.childWrite {
						if !strings.Contains(text.String(), agentInstructions) {
							t.Error("plugin-local custom agent was not selected")
						}
						tool("Write", map[string]string{"file_path": filepath.Join(workspace, "reports", "child.md"), "content": "child grant was scoped"})
					} else {
						for _, tool := range request.Tools {
							if tool.Function.Name == "Write" {
								t.Error("read-only builtin received Write")
							}
						}
						tool("Read", map[string]string{"file_path": filepath.Join(pluginRoot, "templates", "report.md")})
					}
				case stage == childStart+1:
					want := "verified-plugin-template-content"
					if test.childWrite {
						want = "applied"
					}
					if !strings.Contains(text.String(), want) {
						t.Errorf("child did not receive real tool result %q", want)
					}
					stop(answer)
				case stage == childStart+2:
					for _, expected := range []string{answer, `"childId"`, `"status":"completed"`} {
						if !strings.Contains(text.String(), expected) {
							t.Errorf("parent result missing %s", expected)
						}
					}
					tool("Write", map[string]string{"file_path": filepath.Join(workspace, "reports", "parent.md"), "content": "parent write required approval"})
				case stage == childStart+3 || stage == childStart+4:
					stop("parent completed")
				default:
					t.Errorf("unexpected request %d", stage)
					stop("unexpected continuation")
				}
			}))
			defer provider.Close()
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 25*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, executable, "-test.run=^TestPluginRuntimeAgentProcess$")
			child.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + base, "TMPDIR=" + base, "LANG=C.UTF-8", "PERO_PLUGIN_RUNTIME_CHILD=1", "PERO_PLUGIN_RUNTIME_ENDPOINT=" + provider.URL + "/v1", "PERO_PLUGIN_RUNTIME_SESSIONS=" + sessions, "PERO_PLUGIN_RUNTIME_WORKSPACE=" + workspace, "PERO_PLUGIN_RUNTIME_DIRECTORY=" + pluginRoot, "PERO_PLUGIN_RUNTIME_CREDENTIAL=local-fixture-placeholder"}
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
						if strings.Contains(string(scanner.Bytes()), "child.md") {
							t.Error("child did not receive its isolated skill grant")
						}
						_ = encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": reply["id"], "result": map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "allow-once"}}})
						continue
					}
					if reply["id"] == float64(sequence) {
						if reply["error"] != nil {
							t.Fatalf("%s failed: %v", method, reply["error"])
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
			created := rpc("session/new", map[string]any{"cwd": workspace, "mcpServers": []any{}})
			id := created["sessionId"].(string)
			rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "permission", "value": "workspace-write"})
			prompt := func(text string) {
				rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": text}}})
			}
			prompt(history)
			text := "Use the isolated research workflow."
			if test.invocation == "slash" {
				text = "/sample:research topic with spaces"
			}
			prompt(text)
			if calls.Load() != childStart+3 || childCalls.Load() != 2 || approvals != 1 {
				t.Fatalf("requests=%d child=%d approvals=%d", calls.Load(), childCalls.Load(), approvals)
			}
			rpc("session/close", map[string]any{"sessionId": id})
			rpc("session/load", map[string]any{"sessionId": id, "cwd": workspace, "mcpServers": []any{}})
			prompt("Continue without invoking another skill.")
			rpc("session/close", map[string]any{"sessionId": id})
			if calls.Load() != childStart+4 || childCalls.Load() != 2 || approvals != 1 {
				t.Fatal("restoration reran the fork or retained its permissions")
			}
			persistence, err := harness.NewJSONLSessionPersistence(sessions)
			if err != nil {
				t.Fatal(err)
			}
			loaded, err := persistence.Load(ctx, harness.SessionID(id))
			if err != nil {
				t.Fatal(err)
			}
			messages, err := loaded.DeriveMessages()
			if err != nil {
				t.Fatal(err)
			}
			results := 0
			for _, message := range messages {
				raw, _ := json.Marshal(message.Content)
				if strings.Contains(string(raw), body) {
					t.Error("parent durable messages contain fork instructions")
				}
				var source struct{ Form, ChildID, Status string }
				if json.Unmarshal(message.Source, &source) == nil && source.Form == "fork-result" {
					results++
					if source.ChildID == "" || source.Status != "completed" {
						t.Fatalf("fork result lost child identity/status: %+v", source)
					}
				}
			}
			if results != 1 {
				t.Fatalf("parent durable fork results=%d", results)
			}
			if contents, err := os.ReadFile(filepath.Join(workspace, "reports", "parent.md")); err != nil || string(contents) != "parent write required approval" {
				t.Fatalf("parent actual artifact: %q %v", contents, err)
			}
			if test.childWrite {
				if contents, err := os.ReadFile(filepath.Join(workspace, "reports", "child.md")); err != nil || string(contents) != "child grant was scoped" {
					t.Fatalf("child actual artifact: %q %v", contents, err)
				}
			}
			_ = input.Close()
			err = child.Wait()
			waited = true
			if err != nil {
				t.Fatalf("CLI fixture failed: %v; %s", err, diagnostics.String())
			}
		})
	}
}
