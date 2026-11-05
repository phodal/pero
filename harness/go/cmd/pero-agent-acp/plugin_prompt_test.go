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
	"sync"
	"testing"
	"time"
)

func TestPluginCLIPromptStopHookContinuesUntilTheModelAgrees(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("plugin hooks require Unix")
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
	if err := os.WriteFile(filepath.Join(pluginRoot, ".claude-plugin", "plugin.json"), []byte(`{"name":"sample"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginRoot, "hooks", "hooks.json"), []byte(`{"hooks":{"Stop":[{"hooks":[{"type":"prompt","prompt":"PROMPT-HOOK $ARGUMENTS"}]}]}}`), 0600); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var bodies []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(raw))
		mu.Unlock()
		content := "done"
		if strings.Contains(string(raw), "PROMPT-HOOK") {
			content = `{"ok":false,"reason":"finish the work"}`
			if strings.Contains(string(raw), `stop_hook_active\":true`) {
				content = `{"ok":true}`
			}
		}
		chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": content}, "finish_reason": "stop"}}})
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", chunk)
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
	rpc := func(method string, params any) {
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
				if reply["error"] != nil {
					t.Fatalf("%s failed: %v\n%s", method, reply["error"], diagnostics.String())
				}
				return
			}
		}
		t.Fatalf("%s EOF: %v; %s", method, scanner.Err(), diagnostics.String())
	}
	rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	var created map[string]any
	sequence++
	if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": sequence, "method": "session/new", "params": map[string]any{"cwd": workspace, "mcpServers": []any{}}}); err != nil {
		t.Fatal(err)
	}
	for scanner.Scan() {
		var reply map[string]any
		if json.Unmarshal(scanner.Bytes(), &reply) != nil {
			t.Fatal(scanner.Text())
		}
		if reply["id"] == float64(sequence) {
			created, _ = reply["result"].(map[string]any)
			break
		}
	}
	id, _ := created["sessionId"].(string)
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "finish"}}})
	mu.Lock()
	defer mu.Unlock()
	hookCalls, continued := 0, false
	for _, body := range bodies {
		if strings.Contains(body, "PROMPT-HOOK") {
			hookCalls++
		}
		if strings.Contains(body, "finish the work") && !strings.Contains(body, "PROMPT-HOOK") {
			continued = true
		}
	}
	if hookCalls < 2 || !continued {
		t.Fatalf("hookCalls=%d continued=%v bodies=%d\n%s", hookCalls, continued, len(bodies), diagnostics.String())
	}
}
