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

func TestPluginCLIHTTPHookDeniesWrite(t *testing.T) {
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
	var sawAuth, sawTool atomic.Bool
	hooks := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer secret" && r.Header.Get("X-Other") == "" {
			sawAuth.Store(true)
		}
		raw, _ := io.ReadAll(r.Body)
		if strings.Contains(string(raw), `"tool_name":"Write"`) {
			sawTool.Store(true)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"http gate"}}`))
	}))
	defer hooks.Close()
	files := map[string]string{
		".claude-plugin/plugin.json": `{"name":"sample"}`,
		"hooks/hooks.json": `{
			"hooks": {"PreToolUse": [{"matcher": "Write", "hooks": [{"type": "http", "url": "` + hooks.URL + `", "headers": {"Authorization": "Bearer $TOKEN", "X-Other": "$OTHER"}, "allowedEnvVars": ["TOKEN"]}]}]}
		}`,
	}
	for path, content := range files {
		if err := os.WriteFile(filepath.Join(pluginRoot, filepath.FromSlash(path)), []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	target := filepath.Join(workspace, "original.md")
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		if calls.Add(1) == 1 {
			encoded, _ := json.Marshal(map[string]string{"file_path": target, "content": "original"})
			fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"write-1\",\"type\":\"function\",\"function\":{\"name\":\"Write\",\"arguments\":%s}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n", jsonString(string(encoded)))
			return
		}
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
		"TOKEN=secret", "OTHER=hidden",
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
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "write the note"}}})
	if _, err := os.Stat(target); !os.IsNotExist(err) || !sawAuth.Load() || !sawTool.Load() {
		t.Fatalf("file err=%v auth=%v tool=%v\n%s", err, sawAuth.Load(), sawTool.Load(), diagnostics.String())
	}
}

func jsonString(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}
