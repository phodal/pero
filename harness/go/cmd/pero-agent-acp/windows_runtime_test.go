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

	"github.com/phodal/pero/harness/go/sandbox"
	"github.com/phodal/pero/harness/go/shell"
)

// The opt-in runs an actual built CLI against synthetic loopback ACP/provider
// traffic. ACL changes and filesystem effects are limited to disposable paths.
func TestWindowsACLCLIProcessApprovalAndWriteBoundary(t *testing.T) {
	if os.Getenv("PERO_REQUIRE_WINDOWS_ACL") != "1" {
		t.Skip("requires explicit disposable Windows ACL test authorization")
	}
	binary := filepath.Join(t.TempDir(), "pero-agent-acp.exe")
	buildCtx, stopBuild := context.WithTimeout(t.Context(), 90*time.Second)
	defer stopBuild()
	build := exec.CommandContext(buildCtx, "go", "build", "-o", binary, ".")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build actual CLI: %v\n%s", err, output)
	}
	pwsh, err := exec.LookPath("pwsh.exe")
	if err != nil {
		t.Fatal(err)
	}
	pwsh, err = filepath.Abs(pwsh)
	if err != nil {
		t.Fatal(err)
	}
	workspace, sessions, outside, privateTempRoot := t.TempDir(), t.TempDir(), t.TempDir(), t.TempDir()
	denied := filepath.Join(workspace, "denied.txt")
	allowed := filepath.Join(workspace, "allowed.txt")
	protected := filepath.Join(outside, "sentinel.txt")
	if err := os.WriteFile(protected, []byte("unchanged-outside-fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	quote := func(value string) string { return "'" + strings.ReplaceAll(value, "'", "''") + "'" }
	commands := []string{
		"[IO.File]::WriteAllText(" + quote(denied) + ", 'must-not-run')",
		"$ErrorActionPreference='Stop'; [IO.File]::WriteAllText(" + quote(allowed) + ", 'approved-workspace-write'); Write-Output 'ALLOWED_WRITE'",
		"$ErrorActionPreference='Stop'; Write-Output 'ATTEMPT_OUTSIDE_WRITE'; [IO.File]::WriteAllText(" + quote(protected) + ", 'must-not-overwrite')",
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
		if len(names) != 6 || names["chart_render"] == "" || names["read_file"] == "" || names["list_directory"] == "" || names["search_files"] == "" || !strings.Contains(names["write_file"], "create-only") || !strings.Contains(names["shell"], "NOT isolated") {
			t.Errorf("CLI must expose only charts, bounded files and the accurately labeled partial shell: %+v", request.Tools)
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
		if stage < len(commands) {
			arguments, _ := json.Marshal(map[string]any{"command": commands[stage], "timeout_ms": 15000})
			chunk := map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": fmt.Sprintf("windows-cli-%d", stage), "type": "function", "function": map[string]any{"name": "shell", "arguments": string(arguments)}}}}, "finish_reason": "tool_calls"}}}
			raw, _ := json.Marshal(chunk)
			fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", raw)
			return
		}
		io.WriteString(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"boundary fixture complete\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer provider.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, binary, "--endpoint", provider.URL+"/v1", "--model", "fixture", "--session-dir", sessions, "--workspace", workspace, "--enable-shell", "--shell", pwsh, "--sandbox", "windows-acl-workspace-write", "--approval", "ask", "--max-requests", "4", "--max-tokens", "512", "--max-retries", "0")
	child.Env = append(os.Environ(), "AGENT_PROVIDER_API_KEY=local-fixture-not-secret", "TMP="+privateTempRoot, "TEMP="+privateTempRoot)
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
			select {
			case <-exited:
			case <-time.After(5 * time.Second):
				_ = child.Process.Kill()
				<-exited
			}
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
				params, _ := message["params"].(map[string]any)
				if params["_meta"] != nil {
					t.Fatalf("partial CLI emitted strict native approval metadata: %v", params)
				}
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
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "Exercise only the three local filesystem fixture commands."}}})
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
	if gotCalls != 4 || approvals != 3 || len(results) != 3 {
		t.Fatalf("calls=%d approvals=%d results=%q", gotCalls, approvals, results)
	}
	if _, err := os.Stat(denied); !os.IsNotExist(err) {
		t.Fatalf("rejected approval wrote workspace sentinel: %v", err)
	}
	if data, err := os.ReadFile(allowed); err != nil || string(data) != "approved-workspace-write" {
		t.Fatalf("approved command failed: data=%q err=%v results=%q", data, err, results)
	}
	if data, err := os.ReadFile(protected); err != nil || string(data) != "unchanged-outside-fixture" {
		t.Fatalf("outside write escaped: data=%q err=%v", data, err)
	}
	var allowedResult shell.RunResult
	if err := json.Unmarshal([]byte(results[1]), &allowedResult); err != nil {
		t.Fatalf("allowed tool result: %v %q", err, results[1])
	}
	if allowedResult.ExitCode == nil || *allowedResult.ExitCode != 0 || allowedResult.Enforcement != sandbox.EnforcementPartial || allowedResult.ReadIsolated || allowedResult.NetworkIsolated || allowedResult.CleanupUncertain || !strings.Contains(allowedResult.Stdout.Text, "ALLOWED_WRITE") {
		t.Fatalf("allowed result: %+v", allowedResult)
	}
	var outsideResult struct {
		Result shell.RunResult `json:"result"`
		Error  string          `json:"error"`
	}
	if err := json.Unmarshal([]byte(results[2]), &outsideResult); err != nil {
		t.Fatalf("outside tool result: %v %q", err, results[2])
	}
	if outsideResult.Error == "" || outsideResult.Result.ExitCode == nil || *outsideResult.Result.ExitCode == 0 || outsideResult.Result.Enforcement != sandbox.EnforcementPartial || outsideResult.Result.ReadIsolated || outsideResult.Result.NetworkIsolated || outsideResult.Result.CleanupUncertain || !strings.Contains(outsideResult.Result.Stdout.Text, "ATTEMPT_OUTSIDE_WRITE") {
		t.Fatalf("outside command did not reach and fail write boundary: %+v", outsideResult)
	}
}
