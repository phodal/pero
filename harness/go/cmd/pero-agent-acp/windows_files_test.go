//go:build windows

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
	"sync"
	"testing"
	"time"
)

// Run the real CLI, not the test executable, with only a local scripted model.
// All effects are ordinary files in test-owned directories; no ACL changes or
// shell capability are needed. Every native contract must pass without skips.
func TestWindowsFileCLIReadCreateApprovalBoundary(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "pero-agent-acp.exe")
	buildCtx, stopBuild := context.WithTimeout(t.Context(), 90*time.Second)
	defer stopBuild()
	build := exec.CommandContext(buildCtx, "go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build actual CLI: %v\n%s", err, output)
	}
	workspace, sessions := t.TempDir(), t.TempDir()
	const original = "first\nneedle workspace fixture\n"
	const createdText = "approved create-only fixture\n"
	originalPath := filepath.Join(workspace, "original.txt")
	if err := os.WriteFile(originalPath, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	outsideAlias := filepath.Join(t.TempDir(), "outside-alias.txt")
	if err := os.Link(originalPath, outsideAlias); err != nil {
		t.Fatal(err)
	}
	operations := []struct {
		name string
		args map[string]any
	}{
		{"read_file", map[string]any{"path": "original.txt"}},
		{"list_directory", map[string]any{"path": "."}},
		{"search_files", map[string]any{"path": ".", "query": "needle"}},
		{"write_file", map[string]any{"path": "denied.txt", "content": "must not create"}},
		{"write_file", map[string]any{"path": "created.txt", "content": createdText}},
		{"write_file", map[string]any{"path": "original.txt", "content": "must not overwrite"}},
		{"read_file", map[string]any{"path": "created.txt"}},
	}
	var mu sync.Mutex
	calls := 0
	var toolResults []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request struct {
			Messages []struct {
				Role    string `json:"role"`
				Content any    `json:"content"`
			} `json:"messages"`
			Tools []struct {
				Function struct {
					Name        string `json:"name"`
					Description string `json:"description"`
				} `json:"function"`
			} `json:"tools"`
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Errorf("provider request: %v", err)
			http.Error(w, "bad fixture request", 400)
			return
		}
		names := map[string]string{}
		for _, tool := range request.Tools {
			names[tool.Function.Name] = tool.Function.Description
		}
		if len(names) != 5 || names["chart_render"] == "" || names["read_file"] == "" || names["list_directory"] == "" || names["search_files"] == "" || names["write_file"] == "" || names["edit_file"] != "" || names["shell"] != "" {
			t.Errorf("CLI must expose only charts, bounded reads and create-only writes: %+v", names)
		}
		description := strings.ToLower(names["write_file"])
		if !strings.Contains(description, "new") || !strings.Contains(description, "existing") {
			t.Errorf("write schema conceals create-only boundary: %q", names["write_file"])
		}
		mu.Lock()
		stage := calls
		calls++
		if stage > 0 {
			last := ""
			for _, message := range request.Messages {
				if message.Role == "tool" {
					last, _ = message.Content.(string)
				}
			}
			toolResults = append(toolResults, last)
		}
		mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		if stage < len(operations) {
			op := operations[stage]
			arguments, _ := json.Marshal(op.args)
			chunk := map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": fmt.Sprintf("windows-files-%d", stage), "type": "function", "function": map[string]any{"name": op.name, "arguments": string(arguments)}}}}, "finish_reason": "tool_calls"}}}
			raw, _ := json.Marshal(chunk)
			fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", raw)
			return
		}
		io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"file fixture complete\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer provider.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, binary, "--endpoint", provider.URL+"/v1", "--model", "fixture", "--session-dir", sessions, "--workspace", workspace, "--approval", "ask", "--max-requests", "8", "--max-tokens", "512", "--max-retries", "0")
	child.Env = append(os.Environ(), "AGENT_PROVIDER_API_KEY=local-fixture-not-secret")
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
	exited := make(chan error, 1)
	go func() { exited <- child.Wait() }()
	waited := false
	defer func() {
		_ = input.Close()
		if !waited {
			_ = child.Process.Kill()
			<-exited
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
			var message map[string]any
			if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
				t.Fatal(err)
			}
			if message["method"] == "session/request_permission" {
				option := "allow-once"
				if approvals == 0 {
					option = "reject-once"
				}
				approvals++
				if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": message["id"], "result": map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": option}}}); err != nil {
					t.Fatal(err)
				}
				continue
			}
			if message["id"] == float64(sequence) {
				if message["error"] != nil {
					t.Fatalf("%s: %v", method, message)
				}
				result, ok := message["result"].(map[string]any)
				if !ok {
					t.Fatalf("%s missing result: %v", method, message)
				}
				return result
			}
		}
		_ = input.Close()
		waitErr := <-exited
		waited = true
		t.Fatalf("%s EOF: scan=%v process=%v diagnostics=%s", method, scanner.Err(), waitErr, diagnostics.String())
		return nil
	}
	rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	created := rpc("session/new", map[string]any{"cwd": workspace, "mcpServers": []any{}})
	id, ok := created["sessionId"].(string)
	if !ok || id == "" {
		t.Fatalf("missing session: %v", created)
	}
	rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "permission", "value": "full-access"})
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "Exercise only the local read, create and rejection fixtures."}}})
	rpc("session/close", map[string]any{"sessionId": id})
	_ = input.Close()
	err = <-exited
	waited = true
	if err != nil {
		t.Fatalf("CLI exit: %v %s", err, diagnostics.String())
	}
	mu.Lock()
	gotCalls, results := calls, append([]string(nil), toolResults...)
	mu.Unlock()
	if gotCalls != len(operations)+1 || approvals != 3 || len(results) != len(operations) {
		t.Fatalf("calls=%d approvals=%d results=%q", gotCalls, approvals, results)
	}
	if _, err := os.Stat(filepath.Join(workspace, "denied.txt")); !os.IsNotExist(err) {
		t.Fatalf("rejected create had an effect: %v", err)
	}
	for _, path := range []string{originalPath, outsideAlias} {
		if data, err := os.ReadFile(path); err != nil || string(data) != original {
			t.Fatalf("existing file or outside hard-link alias changed: %q %v", data, err)
		}
	}
	if data, err := os.ReadFile(filepath.Join(workspace, "created.txt")); err != nil || string(data) != createdText {
		t.Fatalf("approved create failed: %q %v results=%q", data, err, results)
	}
	var read struct {
		Content    string `json:"content"`
		TotalLines int    `json:"total_lines"`
	}
	if err := json.Unmarshal([]byte(results[0]), &read); err != nil || read.Content != strings.TrimSuffix(original, "\n") || read.TotalLines != 2 {
		t.Fatalf("read result: %+v %v %q", read, err, results[0])
	}
	var listed struct {
		Entries []struct {
			Name string `json:"name"`
		} `json:"entries"`
	}
	if err := json.Unmarshal([]byte(results[1]), &listed); err != nil || len(listed.Entries) != 1 || listed.Entries[0].Name != "original.txt" {
		t.Fatalf("list result: %+v %v %q", listed, err, results[1])
	}
	var searched struct {
		Matches []struct {
			Path string `json:"path"`
			Line int    `json:"line"`
		} `json:"matches"`
	}
	if err := json.Unmarshal([]byte(results[2]), &searched); err != nil || len(searched.Matches) != 1 || searched.Matches[0].Path != "original.txt" || searched.Matches[0].Line != 2 {
		t.Fatalf("search result: %+v %v %q", searched, err, results[2])
	}
	var receipt struct {
		Path  string `json:"path"`
		State string `json:"state"`
	}
	if err := json.Unmarshal([]byte(results[4]), &receipt); err != nil || receipt.Path != "created.txt" || receipt.State != "applied" {
		t.Fatalf("create receipt: %+v %v %q", receipt, err, results[4])
	}
	var refused struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal([]byte(results[5]), &refused); err != nil || refused.Error == "" {
		t.Fatalf("overwrite must return explicit refusal: %+v %v %q", refused, err, results[5])
	}
	if err := json.Unmarshal([]byte(results[6]), &read); err != nil || read.Content != strings.TrimSuffix(createdText, "\n") || read.TotalLines != 1 {
		t.Fatalf("created readback result: %+v %v %q", read, err, results[6])
	}
	entries, err := os.ReadDir(workspace)
	if err != nil || len(entries) != 2 {
		t.Fatalf("native create left staging debris: entries=%v err=%v", entries, err)
	}
}
