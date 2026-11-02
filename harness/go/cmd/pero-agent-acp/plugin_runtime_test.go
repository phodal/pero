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
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestPluginRuntimeAgentProcess(t *testing.T) {
	if os.Getenv("PERO_PLUGIN_RUNTIME_CHILD") != "1" {
		return
	}
	flag.CommandLine = flag.NewFlagSet("plugin-runtime-fixture", flag.ContinueOnError)
	os.Args = []string{"plugin-runtime-fixture", "--endpoint", os.Getenv("PERO_PLUGIN_RUNTIME_ENDPOINT"), "--model", "fixture", "--selectable-model", "fixture-analysis", "--plugin-model", "analysis=fixture-analysis", "--session-dir", os.Getenv("PERO_PLUGIN_RUNTIME_SESSIONS"), "--workspace", os.Getenv("PERO_PLUGIN_RUNTIME_WORKSPACE"), "--plugin-dir", os.Getenv("PERO_PLUGIN_RUNTIME_DIRECTORY"), "--api-key-env", "PERO_PLUGIN_RUNTIME_CREDENTIAL", "--max-requests", "8", "--max-tokens", "2048", "--max-retries", "0"}
	if encoded := os.Getenv("PERO_PLUGIN_RUNTIME_EXTRA_ARGS"); encoded != "" {
		var extra []string
		if err := json.Unmarshal([]byte(encoded), &extra); err != nil {
			t.Fatal(err)
		}
		os.Args = append(os.Args, extra...)
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	os.Exit(0)
}

// Actual CLI composition runs the provider loop, plugin instructions and hook,
// package resource reading, approved file creation, ACP, and JSONL restoration.
func TestPluginRuntimeCLIResourceWriteAndRestore(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("plugin command hooks and descriptor-bound package reads require Unix")
	}
	const bodyMarker = "workflow-body-runtime-fixture"
	const hookMarker = "session-hook-runtime-fixture"
	const hiddenDescription = "user-only-description-runtime-fixture"
	const template = "# Template-source-runtime-fixture\nUse verified acceptance criteria.\n"
	const document = "# Product requirement\n\nTopic: topic with spaces\n\nAcceptance: output has verified criteria.\n"
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	pluginRoot := filepath.Join(base, "Plugin With Spaces")
	workspace, sessions := filepath.Join(base, "workspace"), filepath.Join(base, "sessions")
	for _, path := range []string{pluginRoot, workspace, sessions} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		".claude-plugin/plugin.json": `{"name":"sample","version":"1.0.0"}`,
		"skills/draft/SKILL.md":      "---\nname: draft\ndescription: " + hiddenDescription + "\nmodel: analysis\ndisable-model-invocation: true\n---\n" + bodyMarker + "\narguments=$ARGUMENTS\ntemplate=${CLAUDE_PLUGIN_ROOT}/templates/report.md\nRead the template, then write reports/prd.md.\n",
		"templates/report.md":        template,
		"hooks/hooks.json":           `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"printf '` + hookMarker + `\n'"}]}]}}`,
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
	var calls atomic.Int32
	var warmed atomic.Bool
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			http.Error(w, "invalid fixture request", http.StatusBadRequest)
			return
		}
		var request struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
			Tools []struct {
				Function struct{ Name, Description string } `json:"function"`
			} `json:"tools"`
		}
		if err := json.Unmarshal(raw, &request); err != nil {
			t.Error(err)
			http.Error(w, "invalid fixture JSON", http.StatusBadRequest)
			return
		}
		if warmed.CompareAndSwap(false, true) {
			if request.Model != "fixture" {
				t.Errorf("initial session model = %q", request.Model)
			}
			w.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"workspace ready\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		stage := calls.Add(1)
		wantModel := "fixture-analysis"
		if stage == 4 {
			wantModel = "fixture"
		}
		if request.Model != wantModel {
			t.Errorf("request %d model = %q, want %q", stage, request.Model, wantModel)
		}
		var messages strings.Builder
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
			messages.WriteString(text + "\n")
			if message.Role == "tool" {
				lastTool = text
			}
		}
		text := messages.String()
		if count := strings.Count(text, bodyMarker); count != 1 {
			t.Errorf("request %d contains %d skill loads, want one frozen invocation", stage, count)
		}
		for _, tool := range request.Tools {
			if tool.Function.Name == "Skill" && (strings.Contains(tool.Function.Description, "sample:draft") || strings.Contains(tool.Function.Description, hiddenDescription)) {
				t.Error("user-only skill was advertised for model invocation")
			}
		}
		if stage == 1 {
			for _, expected := range []string{"arguments=topic with spaces", "template=" + filepath.Join(pluginRoot, "templates", "report.md"), hookMarker} {
				if !strings.Contains(text, expected) {
					t.Errorf("first provider request is missing %q", expected)
				}
			}
			if strings.Contains(text, "$ARGUMENTS") || strings.Contains(text, "${CLAUDE_PLUGIN_ROOT}") {
				t.Error("provider received unexpanded plugin arguments or root")
			}
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if stage == 1 || stage == 2 {
			name := "Read"
			arguments := map[string]string{"file_path": filepath.Join(pluginRoot, "templates", "report.md")}
			if stage == 2 {
				if !strings.Contains(lastTool, "Template-source-runtime-fixture") {
					t.Errorf("actual package resource receipt is missing: %s", lastTool)
				}
				name = "Write"
				arguments = map[string]string{"file_path": filepath.Join(workspace, "reports", "prd.md"), "content": document}
			}
			encodedArguments, _ := json.Marshal(arguments)
			chunk := map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": fmt.Sprintf("plugin-runtime-%d", stage), "type": "function", "function": map[string]any{"name": name, "arguments": string(encodedArguments)}}}}, "finish_reason": "tool_calls"}}}
			encoded, _ := json.Marshal(chunk)
			fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", encoded)
			return
		}
		if stage == 3 && !strings.Contains(lastTool, "applied") {
			t.Errorf("actual workspace write receipt is missing: %s", lastTool)
		}
		if stage > 4 {
			t.Errorf("unexpected provider continuation %d", stage)
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"plugin fixture complete\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer provider.Close()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	var child *exec.Cmd
	var input io.WriteCloser
	var encoder *json.Encoder
	var scanner *bufio.Scanner
	var diagnostics bytes.Buffer
	waited := true
	launch := func() {
		t.Helper()
		child = exec.CommandContext(ctx, executable, "-test.run=^TestPluginRuntimeAgentProcess$")
		child.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + base, "TMPDIR=" + base, "LANG=C.UTF-8", "PERO_PLUGIN_RUNTIME_CHILD=1", "PERO_PLUGIN_RUNTIME_ENDPOINT=" + provider.URL + "/v1", "PERO_PLUGIN_RUNTIME_SESSIONS=" + sessions, "PERO_PLUGIN_RUNTIME_WORKSPACE=" + workspace, "PERO_PLUGIN_RUNTIME_DIRECTORY=" + pluginRoot, "PERO_PLUGIN_RUNTIME_CREDENTIAL=local-fixture-placeholder"}
		input, err = child.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		output, err := child.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		diagnostics.Reset()
		child.Stderr = &diagnostics
		if err := child.Start(); err != nil {
			t.Fatal(err)
		}
		waited = false
		encoder, scanner = json.NewEncoder(input), bufio.NewScanner(output)
		scanner.Buffer(make([]byte, 4096), 2<<20)
	}
	launch()
	defer func() {
		_ = input.Close()
		if !waited {
			_ = child.Process.Kill()
			_ = child.Wait()
		}
	}()
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
				if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": reply["id"], "result": map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "allow-once"}}}); err != nil {
					t.Fatal(err)
				}
				continue
			}
			if reply["id"] == float64(sequence) {
				if reply["error"] != nil {
					t.Fatalf("%s failed: %v", method, reply["error"])
				}
				result, ok := reply["result"].(map[string]any)
				if !ok {
					t.Fatalf("%s missing result: %v", method, reply)
				}
				return result
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
	id, ok := created["sessionId"].(string)
	if !ok || id == "" {
		t.Fatalf("missing session id: %v", created)
	}
	rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "permission", "value": "workspace-write"})
	rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "model", "value": "fixture"})
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "Prepare the workspace."}}})
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "/sample:draft topic with spaces"}}})
	if calls.Load() != 3 || approvals != 1 {
		t.Fatalf("workflow requests=%d approvals=%d, want three requests and one approved write", calls.Load(), approvals)
	}
	outputPath := filepath.Join(workspace, "reports", "prd.md")
	if content, err := os.ReadFile(outputPath); err != nil || string(content) != document {
		t.Fatalf("real workspace artifact differs: %v", err)
	}
	rpc("session/close", map[string]any{"sessionId": id})
	_ = input.Close()
	err = child.Wait()
	waited = true
	if err != nil {
		t.Fatalf("initial CLI process failed: %v; %s", err, diagnostics.String())
	}
	launch()
	rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	rpc("session/load", map[string]any{"sessionId": id, "cwd": workspace, "mcpServers": []any{}})
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "Continue without invoking another workflow."}}})
	rpc("session/close", map[string]any{"sessionId": id})
	if calls.Load() != 4 || approvals != 1 {
		t.Fatalf("restored workflow re-executed tools: requests=%d approvals=%d", calls.Load(), approvals)
	}
	if content, err := os.ReadFile(outputPath); err != nil || string(content) != document {
		t.Fatalf("restoration changed the completed artifact: %v", err)
	}
	persistence, err := harness.NewJSONLSessionPersistence(sessions)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := persistence.Load(ctx, harness.SessionID(id))
	if err != nil {
		t.Fatal(err)
	}
	messages, err := restored.DeriveMessages()
	if err != nil {
		t.Fatal(err)
	}
	loaded := 0
	for _, message := range messages {
		var source struct{ Kind, Name, Arguments string }
		if json.Unmarshal(message.Source, &source) == nil && source.Kind == "skill-invocation" {
			loaded++
			if source.Name != "sample:draft" || source.Arguments != "topic with spaces" {
				t.Fatalf("durable invocation attribution differs: %+v", source)
			}
		}
	}
	if loaded != 1 {
		t.Fatalf("restored journal contains %d invocations, want one", loaded)
	}
	transient := false
	for _, event := range restored.Events() {
		if event.Type == "request/header" {
			var header harness.RequestHeaderEvent
			if err := json.Unmarshal(event.Data, &header); err != nil {
				t.Fatal(err)
			}
			if header.Model == "fixture-analysis" {
				if !header.TransientModel {
					t.Fatal("skill model was recorded as the durable session model")
				}
				transient = true
			}
		}
	}
	selection, found, err := harness.RecordedModelSelection(restored)
	if err != nil || !found || selection.Model != "fixture" || !transient {
		t.Fatalf("cold restoration changed the primary model: %+v found=%v error=%v transient=%v", selection, found, err, transient)
	}
	_ = input.Close()
	err = child.Wait()
	waited = true
	if err != nil {
		t.Fatalf("CLI process failed: %v; %s", err, diagnostics.String())
	}
}
