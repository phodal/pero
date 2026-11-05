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
	"testing"
	"time"
)

func TestPluginCLIMessageDisplayReplacesTheLiveTextOnly(t *testing.T) {
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
	files := map[string]string{
		".claude-plugin/plugin.json": `{"name":"sample"}`,
		"hooks/hooks.json":           `{"hooks":{"MessageDisplay":[{"hooks":[{"type":"command","command":"cat > \"$CLAUDE_PLUGIN_ROOT/display.json\"; printf '%s' '{\"displayContent\":\"shown\"}'"}]}]}}`,
	}
	for path, content := range files {
		if err := os.WriteFile(filepath.Join(pluginRoot, filepath.FromSlash(path)), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "SECRET_MODEL_TEXT"}, "finish_reason": "stop"}}})
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
	var updates []string
	rpc := func(method string, params any) {
		t.Helper()
		sequence++
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": sequence, "method": method, "params": params}); err != nil {
			t.Fatal(err)
		}
		for scanner.Scan() {
			line := scanner.Text()
			if strings.Contains(line, "agent_message_chunk") {
				updates = append(updates, line)
			}
			var reply map[string]any
			if json.Unmarshal(scanner.Bytes(), &reply) != nil {
				t.Fatal(line)
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
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "say it"}}})
	shown := strings.Join(updates, "\n")
	if !strings.Contains(shown, "shown") || strings.Contains(shown, "SECRET_MODEL_TEXT") {
		t.Fatalf("live text = %s\n%s", shown, diagnostics.String())
	}
	recorded, err := os.ReadFile(filepath.Join(pluginRoot, "display.json"))
	if err != nil || !strings.Contains(string(recorded), "SECRET_MODEL_TEXT") {
		t.Fatalf("hook input = %s %v", recorded, err)
	}
	var stored string
	entries, _ := os.ReadDir(sessions)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		body, err := os.ReadFile(filepath.Join(sessions, entry.Name()))
		if err == nil {
			stored += string(body)
		}
	}
	if !strings.Contains(stored, "SECRET_MODEL_TEXT") {
		t.Fatalf("transcript lost the original model text")
	}
}
