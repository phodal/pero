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
	"sync"
	"testing"
	"time"
)

func TestPluginCLIModelSwitchHookRefusesThenGuides(t *testing.T) {
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
	for _, path := range []string{filepath.Join(pluginRoot, ".claude-plugin"), filepath.Join(pluginRoot, "hooks"), workspace, sessions} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]string{
		".claude-plugin/plugin.json": `{"name":"sample"}`,
		"hooks/hooks.json": `{
			"hooks": {
				"PreModelSwitch": [{"matcher": "fixture-analysis", "hooks": [{"type": "command", "command": "sh \"$CLAUDE_PLUGIN_ROOT/hooks/pre.sh\""}]}],
				"PostModelSwitch": [{"matcher": "fixture-analysis", "hooks": [{"type": "command", "command": "printf '%s' 'model guidance'"}]}]
			}
		}`,
		"hooks/pre.sh": "body=$(cat)\n" +
			"printf '%s' \"$body\" > \"$CLAUDE_PLUGIN_ROOT/pre.json\"\n" +
			"if [ ! -f \"$CLAUDE_PLUGIN_ROOT/allow\" ]; then printf '%s' '{\"decision\":\"block\",\"reason\":\"model gate\"}'; fi\n",
	}
	for path, content := range files {
		if err := os.WriteFile(filepath.Join(pluginRoot, filepath.FromSlash(path)), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	var mu sync.Mutex
	var models, bodies []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := readAll(r)
		var request struct {
			Model string `json:"model"`
		}
		_ = json.Unmarshal(raw, &request)
		mu.Lock()
		models = append(models, request.Model)
		bodies = append(bodies, string(raw))
		mu.Unlock()
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
	if _, failure = rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "model", "value": "fixture-analysis"}); failure == nil || !strings.Contains(fmtError(failure), "model gate") {
		t.Fatalf("blocked switch: %v\n%s", failure, diagnostics.String())
	}
	if _, failure = rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "stay"}}}); failure != nil {
		t.Fatalf("prompt after block: %v\n%s", failure, diagnostics.String())
	}
	mu.Lock()
	first := append([]string(nil), models...)
	mu.Unlock()
	if len(first) != 1 || first[0] != "fixture" {
		t.Fatalf("blocked switch changed the model: %v", first)
	}
	if err := os.WriteFile(filepath.Join(pluginRoot, "allow"), []byte("1"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, failure = rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "model", "value": "fixture-analysis"}); failure != nil {
		t.Fatalf("allowed switch: %v\n%s", failure, diagnostics.String())
	}
	if _, failure = rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "next"}}}); failure != nil {
		t.Fatalf("guided prompt: %v\n%s", failure, diagnostics.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if len(models) != 2 || models[1] != "fixture-analysis" || !strings.Contains(bodies[1], "model guidance") {
		t.Fatalf("models=%v body=%s", models, bodies[1])
	}
}
