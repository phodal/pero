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
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The real CLI process is the composition root for skill frontmatter hooks,
// CLAUDE_PLUGIN_DATA, if, onFailure, and async delivery.
func TestClaudePluginCLIHookSemantics(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("command hooks require Unix")
	}
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	pluginRoot := filepath.Join(base, "plugin")
	workspace := filepath.Join(base, "workspace")
	sessions := filepath.Join(base, "sessions")
	dataHome := filepath.Join(base, "plugin-data")
	for _, path := range []string{
		filepath.Join(pluginRoot, ".claude-plugin"),
		filepath.Join(pluginRoot, "hooks"),
		filepath.Join(pluginRoot, "skills", "check"),
		workspace, sessions, dataHome,
	} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		".claude-plugin/plugin.json": `{"name":"sample"}`,
		"skills/check/SKILL.md":      "---\nname: check\ndescription: Check plugin data.\nhooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: printf once >> \"$CLAUDE_PLUGIN_ROOT/once.txt\"\n          once: true\n---\ndata=${CLAUDE_PLUGIN_DATA}\n",
		"hooks/hooks.json": `{
			"hooks": {
				"SessionStart": [{"hooks": [{"type": "command", "command": "sh \"$CLAUDE_PLUGIN_ROOT/hooks/wait.sh\"", "async": true}]}],
				"PreToolUse": [
					{"matcher": "Bash", "hooks": [{"type": "command", "command": "python3 \"$CLAUDE_PLUGIN_ROOT/hooks/select.py\"", "if": "Bash(printf marker *)", "timeout": 5}]},
					{"matcher": "Write", "hooks": [{"type": "command", "command": "/no/such/pero-hook", "args": ["check"], "onFailure": "block", "timeout": 5}]}
				]
			}
		}`,
		"hooks/wait.sh": "while [ ! -f \"$CLAUDE_PLUGIN_ROOT/release-async\" ]; do sleep 0.05; done\nprintf '%s' '{\"additionalContext\":\"async result\"}'\nprintf done > \"$CLAUDE_PLUGIN_ROOT/async-finished\"\n",
		"hooks/select.py": "import json, os\n" +
			"data = json.load(open(0))\n" +
			"root = os.environ['CLAUDE_PLUGIN_ROOT']\n" +
			"command = (data.get('tool_input') or {}).get('command') or ''\n" +
			"open(os.path.join(root, 'selected.txt'), 'a').write(command + '\\n')\n" +
			"open(os.path.join(root, 'data-path'), 'w').write(os.environ.get('CLAUDE_PLUGIN_DATA', ''))\n",
	}
	for path, content := range files {
		if err := os.WriteFile(filepath.Join(pluginRoot, filepath.FromSlash(path)), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	dataDir := filepath.Join(dataHome, "sample")
	blocked := filepath.Join(workspace, "blocked.txt")
	var calls atomic.Int32
	var sawBlock atomic.Bool
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var request struct {
			Messages []struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"messages"`
		}
		_ = json.Unmarshal(raw, &request)
		var text, lastTool strings.Builder
		for _, message := range request.Messages {
			var body string
			if json.Unmarshal(message.Content, &body) != nil {
				var blocks []struct{ Text string }
				_ = json.Unmarshal(message.Content, &blocks)
				for _, block := range blocks {
					body += block.Text
				}
			}
			text.WriteString(body + "\n")
			if message.Role == "tool" {
				lastTool.Reset()
				lastTool.WriteString(body)
			}
		}
		stage := calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		tool := func(id, name string, arguments any) {
			encodedArguments, _ := json.Marshal(arguments)
			chunk := map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": id, "type": "function", "function": map[string]any{"name": name, "arguments": string(encodedArguments)}}}}, "finish_reason": "tool_calls"}}}
			encoded, _ := json.Marshal(chunk)
			fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", encoded)
		}
		stop := func() {
			fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
		}
		switch stage {
		case 1:
			body := text.String()
			if strings.Contains(body, "${CLAUDE_PLUGIN_DATA}") || !strings.Contains(body, "data="+dataDir) {
				t.Errorf("skill body did not receive the plugin data directory: %s", body)
			}
			if strings.Contains(body, "async result") {
				t.Error("async hook context arrived before the hook finished")
			}
			tool("bash-match", "Bash", map[string]string{"command": "printf marker hello"})
		case 2:
			tool("bash-skip", "Bash", map[string]string{"command": "printf other"})
		case 3:
			tool("write-block", "Write", map[string]string{"file_path": blocked, "content": "no\n"})
		case 4:
			if strings.Contains(lastTool.String(), "blocking because onFailure is") {
				sawBlock.Store(true)
			}
			stop()
		default:
			if !strings.Contains(text.String(), "async result") {
				t.Errorf("next prompt missed async hook context: %s", text.String())
			}
			stop()
		}
	}))
	defer provider.Close()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	extra, _ := json.Marshal([]string{"--enable-shell"})
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, executable, "-test.run=^TestPluginRuntimeAgentProcess$")
	child.Env = []string{
		"PATH=" + os.Getenv("PATH"), "HOME=" + base, "TMPDIR=" + base, "LANG=C.UTF-8",
		"PERO_PLUGIN_RUNTIME_CHILD=1",
		"PERO_PLUGIN_RUNTIME_ENDPOINT=" + provider.URL + "/v1",
		"PERO_PLUGIN_RUNTIME_SESSIONS=" + sessions,
		"PERO_PLUGIN_RUNTIME_WORKSPACE=" + workspace,
		"PERO_PLUGIN_RUNTIME_DIRECTORY=" + pluginRoot,
		"PERO_PLUGIN_RUNTIME_CREDENTIAL=local-fixture-placeholder",
		"PERO_PLUGIN_RUNTIME_EXTRA_ARGS=" + string(extra),
		"PERO_PLUGIN_DATA_HOME=" + dataHome,
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
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { _ = input.Close(); _ = child.Process.Kill() }()
	encoder, scanner := json.NewEncoder(input), bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	sequence := 0
	rpc := func(method string, params any) map[string]any {
		t.Helper()
		sequence++
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": sequence, "method": method, "params": params}); err != nil {
			t.Fatal(err)
		}
		for scanner.Scan() {
			var reply map[string]any
			if json.Unmarshal(scanner.Bytes(), &reply) != nil {
				t.Fatal(scanner.Text())
			}
			if reply["method"] == "session/request_permission" {
				if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": reply["id"], "result": map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "allow-once"}}}); err != nil {
					t.Fatal(err)
				}
				continue
			}
			if reply["id"] == float64(sequence) {
				if reply["error"] != nil {
					t.Fatalf("%s failed: %v\n%s", method, reply["error"], diagnostics.String())
				}
				result, _ := reply["result"].(map[string]any)
				return result
			}
		}
		t.Fatalf("%s EOF: %v; %s", method, scanner.Err(), diagnostics.String())
		return nil
	}
	rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	created := rpc("session/new", map[string]any{"cwd": workspace, "mcpServers": []any{}})
	id, _ := created["sessionId"].(string)
	rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "permission", "value": "workspace-write"})
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "/sample:check"}}})
	once, err := os.ReadFile(filepath.Join(pluginRoot, "once.txt"))
	selected, selectedErr := os.ReadFile(filepath.Join(pluginRoot, "selected.txt"))
	recorded, dataErr := os.ReadFile(filepath.Join(pluginRoot, "data-path"))
	if err != nil || string(once) != "once" || selectedErr != nil || string(selected) != "printf marker hello\n" || dataErr != nil || string(recorded) != dataDir || !sawBlock.Load() {
		t.Fatalf("hook effects once=%q selected=%q data=%q block=%v errors=%v %v %v\n%s", once, selected, recorded, sawBlock.Load(), err, selectedErr, dataErr, diagnostics.String())
	}
	if _, err := os.Stat(blocked); !os.IsNotExist(err) {
		t.Fatalf("onFailure block still wrote the file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(pluginRoot, "release-async"), []byte("go"), 0600); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(pluginRoot, "async-finished")); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("async hook did not finish\n%s", diagnostics.String())
		}
		time.Sleep(20 * time.Millisecond)
	}
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "continue after the hook"}}})
	if calls.Load() != 5 {
		t.Fatalf("CLI hook session made %d model calls, want 5\n%s", calls.Load(), diagnostics.String())
	}
}
