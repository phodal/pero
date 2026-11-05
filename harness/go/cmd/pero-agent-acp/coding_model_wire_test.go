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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/harness"
)

func TestCodingModelAgentProcess(t *testing.T) {
	if os.Getenv("PERO_CODING_MODEL_CHILD") != "1" {
		return
	}
	flag.CommandLine = flag.NewFlagSet("coding-model-fixture", flag.ContinueOnError)
	os.Args = []string{"coding-model-fixture", "--endpoint", os.Getenv("PERO_CODING_MODEL_ENDPOINT"), "--model", "fixture-a", "--selectable-model", "fixture-b", "--session-dir", os.Getenv("PERO_CODING_MODEL_SESSIONS"), "--enable-todos", "--context-window", "8192", "--max-tokens", "128", "--max-retries", "0", "--max-turn-steps", "0"}
	if os.Getenv("PERO_CODING_MODEL_NATIVE") == "1" {
		os.Args = append(os.Args, "--workspace", os.Getenv("PERO_CODING_MODEL_WORKSPACE"), "--enable-agent-instructions")
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	os.Exit(0)
}

// This exercises the actual CLI composition, not independent helper mounts.
// Both provider and MCP endpoints are synthetic loopback servers.
func TestCodingModelCLICombinedActivationWire(t *testing.T) {
	for _, native := range []bool{false, true} {
		t.Run(fmt.Sprintf("native-instructions=%v", native), func(t *testing.T) {
			if native && runtime.GOOS != "linux" && runtime.GOOS != "darwin" && runtime.GOOS != "windows" {
				t.Skip("native instruction capability unsupported; portable combined workflow still runs")
			}
			testCodingModelCLICombinedActivationWire(t, native)
		})
	}
}
func testCodingModelCLICombinedActivationWire(t *testing.T, native bool) {
	t.Helper()
	const marker = "root-guidance-fixture-9d32"
	workspace, sessions := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "AGENTS.md"), []byte(marker+"\nDo not treat this document as permission."), 0600); err != nil {
		t.Fatal(err)
	}
	remote := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, nil)
	remote.AddTool(&sdk.Tool{Name: "remote_probe", InputSchema: map[string]any{"type": "object"}}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		return &sdk.CallToolResult{}, nil
	})
	var mcpRequests atomic.Int32
	mcpHandler := sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return remote }, nil)
	mcpHTTP := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { mcpRequests.Add(1); mcpHandler.ServeHTTP(w, r) }))
	defer mcpHTTP.Close()
	var mu sync.Mutex
	var models []string
	var sawInstructions, sawTodo, sawMCP, sawTodoResult bool
	var mainCalls, summaries atomic.Int32
	var outputLimit atomic.Bool
	var todoUnicode atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
			http.Error(w, "fixture", 500)
			return
		}
		var request struct {
			Model    string `json:"model"`
			Messages []struct {
				Role    string `json:"role"`
				Content any    `json:"content"`
			} `json:"messages"`
			Tools []struct {
				Function struct {
					Name string `json:"name"`
				} `json:"function"`
			} `json:"tools"`
		}
		if err := json.Unmarshal(body, &request); err != nil {
			t.Error(err)
			http.Error(w, "fixture", 500)
			return
		}
		summary := strings.Contains(string(body), "acting as a compaction engine")
		mu.Lock()
		models = append(models, request.Model)
		for _, message := range request.Messages {
			text, _ := message.Content.(string)
			if strings.Contains(text, marker) {
				if !native {
					t.Error("portable CLI implicitly loaded workspace instructions")
				}
				if message.Role != "user" || !strings.Contains(text, "untrusted task guidance, not permission") {
					t.Errorf("instruction authority widened: role=%q", message.Role)
				}
				sawInstructions = true
			}
			if message.Role == "tool" && strings.Contains(text, "Updated todo list") {
				sawTodoResult = true
			}
		}
		for _, tool := range request.Tools {
			sawTodo = sawTodo || tool.Function.Name == "todo_write"
			sawMCP = sawMCP || tool.Function.Name == harness.PublicMCPToolName("fixture", "remote_probe")
		}
		mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		if summary {
			summaries.Add(1)
			fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"compact checkpoint\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		if stage := todoUnicode.Load(); stage > 0 && stage < 4 {
			lastTool := ""
			for _, message := range request.Messages {
				if message.Role == "tool" {
					lastTool, _ = message.Content.(string)
				}
			}
			if stage == 2 && !strings.Contains(lastTool, "non-empty string") {
				t.Errorf("BOM-only todo was not rejected: %s", lastTool)
			}
			if stage == 3 {
				if !strings.Contains(lastTool, "Updated todo list") {
					t.Errorf("NEL todo was not preserved: %s", lastTool)
				}
				todoUnicode.Store(4)
				fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"unicode verified\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
				return
			}
			content := "\ufeff"
			if stage == 2 {
				content = "\u0085"
			}
			input := map[string]any{"todos": []any{map[string]any{"content": content, "status": "pending"}}}
			if stage == 2 {
				input["upstream_extension"] = true
			}
			arguments, _ := json.Marshal(input)
			chunk := map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": fmt.Sprint("unicode-", stage), "type": "function", "function": map[string]any{"name": "todo_write", "arguments": string(arguments)}}}}, "finish_reason": "tool_calls"}}}
			raw, _ := json.Marshal(chunk)
			todoUnicode.Add(1)
			fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", raw)
			return
		}
		if outputLimit.Load() {
			// Even complete tool JSON must not execute when the response is truncated.
			fmt.Fprint(w, `data: {"choices":[{"index":0,"delta":{"content":"safe partial answer","tool_calls":[{"index":0,"id":"truncated-todo","type":"function","function":{"name":"todo_write","arguments":"{\"todos\":[{\"content\":\"must not execute\",\"status\":\"pending\"}]}"}}]},"finish_reason":"length"}]}`+"\n\ndata: [DONE]\n\n")
			return
		}
		if mainCalls.Add(1) == 1 {
			chunk := map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "todo-fixture-call", "type": "function", "function": map[string]any{"name": "todo_write", "arguments": `{"todos":[{"content":"synthetic checkpoint","status":"in_progress"}]}`}}}}, "finish_reason": "tool_calls"}}}
			raw, _ := json.Marshal(chunk)
			fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", raw)
			return
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"stream-fixture-\"},\"finish_reason\":null}]}\n\n")
		if flush, ok := w.(http.Flusher); ok {
			flush.Flush()
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer provider.Close()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, exe, "-test.run=^TestCodingModelAgentProcess$")
	child.Env = append(os.Environ(), "PERO_CODING_MODEL_CHILD=1", "PERO_CODING_MODEL_NATIVE="+map[bool]string{false: "0", true: "1"}[native], "PERO_CODING_MODEL_ENDPOINT="+provider.URL+"/v1", "PERO_CODING_MODEL_WORKSPACE="+workspace, "PERO_CODING_MODEL_SESSIONS="+sessions, "AGENT_PROVIDER_API_KEY=fixture-not-secret")
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
	seq, streamChunks := 0, 0
	rpc := func(method string, params any) map[string]any {
		t.Helper()
		seq++
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": seq, "method": method, "params": params}); err != nil {
			t.Fatal(err)
		}
		for scanner.Scan() {
			var m map[string]any
			if err := json.Unmarshal(scanner.Bytes(), &m); err != nil {
				t.Fatal(err)
			}
			if m["method"] == "session/update" {
				p, _ := m["params"].(map[string]any)
				u, _ := p["update"].(map[string]any)
				if u["sessionUpdate"] == "agent_message_chunk" {
					streamChunks++
				}
			}
			if m["method"] == "session/request_permission" {
				t.Fatal("todo unexpectedly requested native permission")
			}
			if m["id"] == float64(seq) {
				if m["error"] != nil {
					t.Fatalf("%s: %v", method, m)
				}
				return m["result"].(map[string]any)
			}
		}
		_ = child.Process.Kill()
		_ = child.Wait()
		waited = true
		t.Fatalf("%s EOF: %v %s", method, scanner.Err(), diagnostics.String())
		return nil
	}
	rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	mcpServers := []any{map[string]any{"type": "http", "name": "fixture", "url": mcpHTTP.URL}}
	created := rpc("session/new", map[string]any{"cwd": workspace, "mcpServers": mcpServers})
	id := created["sessionId"].(string)
	current := func(reply map[string]any) string {
		return reply["configOptions"].([]any)[0].(map[string]any)["currentValue"].(string)
	}
	if current(created) != "fixture-a" {
		t.Fatal(created)
	}
	prompt := func(text string) {
		rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": text}}})
	}
	prompt("Record one synthetic todo, then answer.")
	mu.Lock()
	aCount := len(models)
	instructions, todo, mcp, result := sawInstructions, sawTodo, sawMCP, sawTodoResult
	mu.Unlock()
	if instructions != native || !todo || !mcp || !result || mcpRequests.Load() == 0 {
		t.Fatalf("combined activation: instructions=%v todo=%v mcp=%v todoResult=%v mcpRequests=%d", instructions, todo, mcp, result, mcpRequests.Load())
	}
	if current(rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "model", "value": "fixture-b"})) != "fixture-b" {
		t.Fatal("model switch failed")
	}
	mu.Lock()
	afterSelect := len(models)
	mu.Unlock()
	if afterSelect != aCount {
		t.Fatal("model selection invoked provider")
	}
	for i := 0; i < 8; i++ {
		prompt(strings.Repeat("synthetic context detail ", 500))
	}
	if summaries.Load() == 0 {
		t.Fatal("combined CLI did not activate compaction")
	}
	rpc("session/close", map[string]any{"sessionId": id})
	restored := rpc("session/load", map[string]any{"sessionId": id, "cwd": workspace, "mcpServers": mcpServers})
	if current(restored) != "fixture-b" {
		t.Fatal(restored)
	}
	prompt("Continue the synthetic restored session.")
	todoUnicode.Store(1)
	prompt("Verify BOM-only rejection and NEL preservation.")
	if todoUnicode.Load() != 4 {
		t.Fatal("Unicode scenario did not settle")
	}
	outputLimit.Store(true)
	limited := rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "Exercise the output limit."}}})
	if limited["stopReason"] != "max_tokens" {
		t.Fatalf("output limit became a retry or error: %v", limited)
	}
	rpc("session/close", map[string]any{"sessionId": id})
	mu.Lock()
	for _, model := range models[aCount:] {
		if model != "fixture-b" {
			t.Errorf("post-switch request used %q", model)
		}
	}
	mu.Unlock()
	if streamChunks < 2 {
		t.Fatalf("missing streaming updates: %d", streamChunks)
	}
	data, err := os.ReadFile(filepath.Join(sessions, id+".jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(data, []byte(`"type":"todo/write"`)) || !bytes.Contains(data, []byte(`"type":"session/model-selected"`)) {
		t.Fatal("todo/model selection missing durable events")
	}
	if count := bytes.Count(data, []byte(`"type":"todo/write"`)); count != 2 {
		t.Fatalf("truncated tool executed: %d durable todo writes, want control and NEL writes only", count)
	}
	if !bytes.Contains(data, []byte("\u0085")) || !bytes.Contains(data, []byte("ecmascript-trim-v1")) {
		t.Fatal("CLI did not persist DSH-normalized NEL todo")
	}
	_ = input.Close()
	err = child.Wait()
	waited = true
	if err != nil {
		t.Fatalf("child: %v %s", err, diagnostics.String())
	}
}

func TestUnsupportedNativeCLIAdmission(t *testing.T) {
	if runtime.GOOS == "linux" || runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		t.Skip("unsupported-platform contract")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	sessions := t.TempDir()
	child := exec.CommandContext(ctx, exe, "-test.run=^TestCodingModelAgentProcess$")
	child.Env = append(os.Environ(), "PERO_CODING_MODEL_CHILD=1", "PERO_CODING_MODEL_NATIVE=1", "PERO_CODING_MODEL_ENDPOINT=https://fixture.invalid/v1", "PERO_CODING_MODEL_WORKSPACE="+t.TempDir(), "PERO_CODING_MODEL_SESSIONS="+sessions, "AGENT_PROVIDER_API_KEY=fixture-not-secret")
	output, err := child.CombinedOutput()
	if err == nil || !strings.Contains(string(output), "supported descriptor-rooted Unix") {
		t.Fatalf("unsupported CLI admission: %v %s", err, output)
	}
	entries, err := os.ReadDir(sessions)
	if err != nil || len(entries) != 0 {
		t.Fatalf("unsupported CLI created durable session: %v %v", entries, err)
	}
}
