package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
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

func TestPluginCLISlashExpansionHookBlocksBeforeTheModel(t *testing.T) {
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
	for _, path := range []string{filepath.Join(pluginRoot, ".claude-plugin"), filepath.Join(pluginRoot, "hooks"), filepath.Join(pluginRoot, "skills", "check"), workspace, sessions} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		".claude-plugin/plugin.json": `{"name":"sample"}`,
		"skills/check/SKILL.md":      "---\nname: check\ndescription: Check a command.\n---\nSECRET_SKILL_BODY\n",
		"hooks/hooks.json": `{
			"hooks": {
				"UserPromptExpansion": [{"matcher": "sample:check", "hooks": [{"type": "command", "command": "python3 \"$CLAUDE_PLUGIN_ROOT/hooks/gate.py\""}]}]
			}
		}`,
		"hooks/gate.py": "import json, os, sys\n" +
			"data = json.load(sys.stdin)\n" +
			"root = os.environ['CLAUDE_PLUGIN_ROOT']\n" +
			"open(os.path.join(root, 'expansion.json'), 'w').write(json.dumps(data))\n" +
			"if data.get('command_args') == 'allow':\n" +
			"    print(json.dumps({'hookSpecificOutput': {'hookEventName': 'UserPromptExpansion', 'additionalContext': 'expansion checklist'}}))\n" +
			"    raise SystemExit(0)\n" +
			"print(json.dumps({'decision': 'block', 'reason': 'command gate'}))\n",
	}
	for path, content := range files {
		if err := os.WriteFile(filepath.Join(pluginRoot, filepath.FromSlash(path)), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	var calls atomic.Int32
	var sawSkill, sawContext atomic.Bool
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := readAll(r)
		calls.Add(1)
		if strings.Contains(string(raw), "SECRET_SKILL_BODY") {
			sawSkill.Store(true)
		}
		if strings.Contains(string(raw), "expansion checklist") {
			sawContext.Store(true)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"))
	}))
	defer provider.Close()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
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
		"PERO_PLUGIN_DATA_HOME=" + filepath.Join(base, "plugin-data"),
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
	scanner.Buffer(make([]byte, 4096), 2<<20)
	sequence := 0
	rpc := func(method string, params any) (map[string]any, map[string]any) {
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
			if reply["id"] == float64(sequence) {
				result, _ := reply["result"].(map[string]any)
				failure, _ := reply["error"].(map[string]any)
				return result, failure
			}
		}
		t.Fatalf("%s EOF: %v; %s", method, scanner.Err(), diagnostics.String())
		return nil, nil
	}
	if _, failure := rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}}); failure != nil {
		t.Fatalf("initialize: %v\n%s", failure, diagnostics.String())
	}
	created, failure := rpc("session/new", map[string]any{"cwd": workspace, "mcpServers": []any{}})
	if failure != nil {
		t.Fatalf("session/new: %v\n%s", failure, diagnostics.String())
	}
	id, _ := created["sessionId"].(string)
	_, failure = rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "/sample:check block"}}})
	if failure == nil || !strings.Contains(fmtError(failure), "command gate") || calls.Load() != 0 {
		t.Fatalf("blocked prompt failure=%v calls=%d\n%s", failure, calls.Load(), diagnostics.String())
	}
	recorded, err := os.ReadFile(filepath.Join(pluginRoot, "expansion.json"))
	if err != nil || !strings.Contains(string(recorded), `"command_name": "sample:check"`) || !strings.Contains(string(recorded), `"command_args": "block"`) || !strings.Contains(string(recorded), `"expansion_type": "slash_command"`) || !strings.Contains(string(recorded), `"/sample:check block"`) {
		t.Fatalf("expansion input=%s error=%v", recorded, err)
	}
	if _, failure = rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "/sample:check allow"}}}); failure != nil || calls.Load() != 1 || !sawSkill.Load() || !sawContext.Load() {
		t.Fatalf("allowed prompt failure=%v calls=%d skill=%v context=%v\n%s", failure, calls.Load(), sawSkill.Load(), sawContext.Load(), diagnostics.String())
	}
}

func readAll(r *http.Request) ([]byte, error) {
	buffer := bytes.NewBuffer(nil)
	_, err := buffer.ReadFrom(r.Body)
	return buffer.Bytes(), err
}

func fmtError(failure map[string]any) string {
	encoded, _ := json.Marshal(failure)
	return string(encoded)
}
