package acp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestExtractedACPWireLifecyclePermissionAndResume(t *testing.T) {
	ctx := context.Background()
	providerCalls, toolCalls := 0, 0
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"test"}, ApprovalPolicy: harness.ApprovalAsk, Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		providerCalls++
		if providerCalls == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "guarded", ToolCallID: "call-1", Arguments: json.RawMessage(`{}`)}}}}, nil
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = h.Dispose(ctx)
		if err := h.Drain(ctx); err != nil {
			t.Error(err)
		}
	}()
	_, err = h.RegisterTool(ctx, "test/guarded", harness.Tool{Schema: harness.ToolSchema{Name: "guarded", InputSchema: json.RawMessage(`{"type":"object"}`)}, RequiresApproval: true, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		toolCalls++
		return harness.ToolResult{}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewServer(Options{Harness: h, Persistence: persistence, Provider: "test", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	client, server := net.Pipe()
	defer client.Close()
	_ = client.SetDeadline(time.Now().Add(10 * time.Second))
	served := make(chan error, 1)
	go func() { served <- s.Serve(ctx, server, server); _ = server.Close() }()
	defer func() {
		_ = client.Close()
		if err := <-served; err != nil {
			t.Error(err)
		}
	}()
	encoder := json.NewEncoder(client)
	scanner := bufio.NewScanner(client)
	var next int
	var updates, permissions int
	rpc := func(method string, params any) map[string]any {
		t.Helper()
		next++
		id := next
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
			t.Fatal(err)
		}
		for scanner.Scan() {
			var message map[string]any
			if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
				t.Fatal(err)
			}
			if message["method"] == "session/request_permission" {
				permissions++
				if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": message["id"], "result": map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "reject-once"}}}); err != nil {
					t.Fatal(err)
				}
				continue
			}
			if message["method"] == "session/update" {
				updates++
				continue
			}
			if message["id"] == float64(id) {
				if message["error"] != nil {
					t.Fatalf("%s: %v", method, message["error"])
				}
				return message["result"].(map[string]any)
			}
		}
		t.Fatalf("%s EOF: %v", method, scanner.Err())
		return nil
	}
	initialized := rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	if initialized["protocolVersion"] != float64(1) {
		t.Fatal(initialized)
	}
	cwd := t.TempDir()
	created := rpc("session/new", map[string]any{"cwd": cwd, "mcpServers": []any{}})
	id := created["sessionId"].(string)
	var permission string
	for _, option := range created["configOptions"].([]any) {
		item := option.(map[string]any)
		if item["id"] == "permission" {
			permission = item["currentValue"].(string)
		}
	}
	if permission != "auto-review" {
		t.Fatalf("new session permission=%q config=%v", permission, created["configOptions"])
	}
	// Full access still asks. Auto-review would allow the guarded tool without this prompt.
	rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "permission", "value": "full-access"})
	result := rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "do it"}}})
	if result["stopReason"] != "end_turn" || permissions != 1 || toolCalls != 0 || updates == 0 {
		t.Fatalf("result=%v permissions=%d tools=%d updates=%d", result, permissions, toolCalls, updates)
	}
	rpc("session/close", map[string]any{"sessionId": id})
	listed := rpc("session/list", map[string]any{})
	if len(listed["sessions"].([]any)) != 1 {
		t.Fatal("closed session not recoverable", listed)
	}
	before := updates
	rpc("session/resume", map[string]any{"sessionId": id, "cwd": cwd, "mcpServers": []any{}})
	if updates != before {
		t.Fatal("resume replayed old notifications")
	}
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "continue"}}})
	if providerCalls != 3 || toolCalls != 0 {
		t.Fatal("resume replayed work")
	}
	rpc("session/close", map[string]any{"sessionId": id})
}

// A signal may close stdin, but must not turn a final durability failure into success.
func TestCancelledInputPreservesFinalCloseError(t *testing.T) {
	h, err := harness.Boot(context.Background(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewServer(Options{Harness: h, Persistence: persistence, Provider: "fixture", Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	failure := errors.New("fixture final durability failure")
	s.retireErr = failure
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err = s.Serve(ctx, closedInput{}, io.Discard)
	if !errors.Is(err, failure) || errors.Is(err, os.ErrClosed) {
		t.Fatalf("shutdown error = %v", err)
	}
}

type closedInput struct{}

func (closedInput) Read([]byte) (int, error) { return 0, os.ErrClosed }

type admissionPersistence struct {
	harness.SessionPersistence
	loads int
}

func (p *admissionPersistence) Load(ctx context.Context, id harness.SessionID) (*harness.Session, error) {
	p.loads++
	return p.SessionPersistence.Load(ctx, id)
}

func TestWorkingDirectoryAdmissionBeforeMCPAndPersistence(t *testing.T) {
	ctx := t.Context()
	root := t.TempDir()
	outside := t.TempDir()
	providerCalls := 0
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		providerCalls++
		return harness.Completion{Finish: harness.FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	p := &admissionPersistence{SessionPersistence: disk}
	checks := 0
	s, err := NewServer(Options{Harness: h, Persistence: p, Provider: "fixture", Model: "fixture", ValidateWorkingDirectory: func(cwd string) error {
		checks++
		if cwd != root {
			return errors.New("native workspace mismatch")
		}
		return nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	s.writer = &wireWriter{encoder: json.NewEncoder(io.Discard)}
	defer s.closeAll(context.Background())
	// Malformed MCP configuration must never be reached for a rejected cwd.
	if _, err = s.newSession(ctx, NewSessionParams{CWD: outside, MCPServers: []json.RawMessage{json.RawMessage(`null`)}}); err == nil || !strings.Contains(err.Error(), "native workspace mismatch") {
		t.Fatalf("new admission: %v", err)
	}
	for _, method := range []string{"session/resume", "session/load"} {
		params, _ := json.Marshal(ResumeSessionParams{SessionID: "not-loaded", CWD: outside})
		_, rpcErr := s.handle(ctx, request{Method: method, Params: params})
		if rpcErr == nil || rpcErr.Code != -32602 || !strings.Contains(rpcErr.Message, "native workspace mismatch") {
			t.Fatalf("%s: %+v", method, rpcErr)
		}
	}
	records, err := p.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if checks != 3 || p.loads != 0 || len(h.Agents().List()) != 0 || len(records) != 0 || providerCalls != 0 {
		t.Fatalf("rejected admission had effects: checks=%d loads=%d agents=%d records=%d provider=%d", checks, p.loads, len(h.Agents().List()), len(records), providerCalls)
	}
	id, err := s.newSession(ctx, NewSessionParams{CWD: root})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.closeSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err = s.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: root}); err != nil {
		t.Fatalf("same-root resume: %v", err)
	}
	if p.loads != 1 || providerCalls != 0 {
		t.Fatalf("accepted resume loads=%d provider=%d", p.loads, providerCalls)
	}
}

func TestWorkingDirectoryValidatorIsOptional(t *testing.T) {
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	p, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewServer(Options{Harness: h, Persistence: p})
	if err != nil {
		t.Fatal(err)
	}
	if err = s.checkWorkingDirectory(t.TempDir()); err != nil {
		t.Fatalf("protocol-only absolute cwd rejected: %v", err)
	}
	if err = s.checkWorkingDirectory("relative"); err == nil {
		t.Fatal("relative cwd admitted")
	}
}

func TestMCPResumeRequirementReceiptContract(t *testing.T) {
	event := func(raw string) harness.Event {
		return harness.Event{Type: "session/acp-controller", Data: json.RawMessage(raw)}
	}
	for _, test := range []struct {
		name                string
		events              []harness.Event
		supplied, wantError bool
	}{
		{"legacy", nil, false, false},
		{"not-required", []harness.Event{event(`{"version":1,"requiresClientMCP":false}`)}, false, false},
		{"required-missing", []harness.Event{event(`{"version":1,"requiresClientMCP":true}`)}, false, true},
		{"required-provided", []harness.Event{event(`{"version":1,"requiresClientMCP":true}`)}, true, false},
		{"latest-receipt", []harness.Event{event(`{"version":1,"requiresClientMCP":true}`), event(`{"version":1,"requiresClientMCP":false}`)}, false, false},
		{"unknown-version", []harness.Event{event(`{"version":2,"requiresClientMCP":false}`)}, true, true},
		{"missing-boolean", []harness.Event{event(`{"version":1}`)}, true, true},
		{"malformed", []harness.Event{event(`not-json`)}, true, true},
		{"unreadable-latest-not-fallback", []harness.Event{event(`{"version":1,"requiresClientMCP":false}`), event(`{"version":2,"requiresClientMCP":false}`)}, true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := checkMCPResumeRequirements(test.events, test.supplied)
			if (err != nil) != test.wantError {
				t.Fatalf("error=%v wantError=%v", err, test.wantError)
			}
		})
	}
}

func TestMissingMCPResumeRejectedBeforeRepairOrControllerWrite(t *testing.T) {
	ctx := t.Context()
	cwd := t.TempDir()
	h, err := harness.Boot(ctx, harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	p, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	original := harness.NewSession("mcp-dependent", cwd)
	if _, err = original.Append("session/acp-controller", map[string]any{"version": 1, "requiresClientMCP": true}); err != nil {
		t.Fatal(err)
	}
	if _, err = original.Append("turn/start", map[string]int{"turn": 1}); err != nil {
		t.Fatal(err)
	}
	detach, err := p.Attach(ctx, original)
	if err != nil {
		t.Fatal(err)
	}
	if err = detach(); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(original.Events())
	s, err := NewServer(Options{Harness: h, Persistence: p})
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"session/resume", "session/load"} {
		raw, _ := json.Marshal(ResumeSessionParams{SessionID: string(original.Header().ID), CWD: cwd})
		_, failure := s.handle(ctx, request{Method: method, Params: raw})
		if failure == nil || failure.Code != -32602 || !strings.Contains(failure.Message, "requires client-provided MCP") {
			t.Fatalf("%s: %+v", method, failure)
		}
	}
	// A nonempty list passes this presence guard, not validation of its contents.
	err = s.resumeSession(ctx, ResumeSessionParams{SessionID: string(original.Header().ID), CWD: cwd, MCPServers: []json.RawMessage{json.RawMessage(`{"type":"unsupported","name":"fixture"}`)}})
	if err == nil || !strings.Contains(err.Error(), "mcpServers") {
		t.Fatalf("provided configuration was not validated: %v", err)
	}
	after, err := p.Load(ctx, original.Header().ID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(after.Events())
	if !bytes.Equal(before, encoded) || len(h.Agents().List()) != 0 || len(s.sessions) != 0 || len(s.activating) != 0 {
		t.Fatal("rejected resume mutated persisted events, repaired turn, or activated an agent")
	}
}
