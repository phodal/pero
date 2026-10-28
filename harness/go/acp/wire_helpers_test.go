//go:build unix

package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

// scriptStep is one provider turn: a tool call, or the final answer when Tool is empty.
type scriptStep struct{ Tool, Arguments string }

// scriptedProvider drives the real Agent loop without a model: it replays steps
// and records what the Agent offered and what tools returned.
type scriptedProvider struct {
	mu          sync.Mutex
	steps       []scriptStep
	next        int
	offered     []string
	results     []string
	firstPrompt string
}

func (p *scriptedProvider) reset(steps ...scriptStep) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.steps, p.next, p.offered, p.results, p.firstPrompt = steps, 0, nil, nil, ""
}

func (p *scriptedProvider) snapshot() (offered, results []string, firstPrompt string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]string(nil), p.offered...), append([]string(nil), p.results...), p.firstPrompt
}

func flattenText(blocks []harness.ContentBlock, into *[]string) {
	for _, block := range blocks {
		if block.Text != "" {
			*into = append(*into, block.Text)
		}
		flattenText(block.Content, into)
	}
}

func (p *scriptedProvider) adapter() harness.Adapter {
	return harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		p.mu.Lock()
		defer p.mu.Unlock()
		p.offered = p.offered[:0]
		for _, tool := range request.Tools {
			p.offered = append(p.offered, tool.Name)
		}
		p.results = p.results[:0]
		var prompt []string
		for _, message := range request.Messages {
			if message.Role == harness.RoleTool {
				flattenText(message.Content, &p.results)
			} else if message.Role == harness.RoleUser {
				flattenText(message.Content, &prompt)
			}
		}
		if p.next == 0 {
			p.firstPrompt = strings.Join(prompt, "\n")
		}
		step := scriptStep{}
		if p.next < len(p.steps) {
			step = p.steps[p.next]
		}
		p.next++
		if step.Tool == "" {
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
		}
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: step.Tool, ToolCallID: harness.ToolCallID("call-" + string(rune('a'+p.next))), Arguments: json.RawMessage(step.Arguments)}}}}, nil
	})
}

// wire is a minimal ACP client over an in-process pipe.
type wire struct {
	t       *testing.T
	enc     *json.Encoder
	scanner *bufio.Scanner
	write   sync.Mutex
	next    int
	// permit answers session/request_permission; the default rejects.
	permit func(params map[string]any) map[string]any
	// permissions counts the approval requests seen.
	permissions int
}

var (
	outcomeAllow  = map[string]any{"outcome": "selected", "optionId": "allow-once"}
	outcomeReject = map[string]any{"outcome": "selected", "optionId": "reject-once"}
)

func startWire(t *testing.T, h *harness.Harness) *wire {
	t.Helper()
	persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Options{Harness: h, Persistence: persistence, Provider: "test", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	client, remote := net.Pipe()
	_ = client.SetDeadline(time.Now().Add(60 * time.Second))
	served := make(chan error, 1)
	go func() { served <- server.Serve(context.Background(), remote, remote); _ = remote.Close() }()
	t.Cleanup(func() {
		_ = client.Close()
		if err := <-served; err != nil {
			t.Error(err)
		}
	})
	w := &wire{t: t, enc: json.NewEncoder(client), scanner: bufio.NewScanner(client), permit: func(map[string]any) map[string]any { return outcomeReject }}
	w.scanner.Buffer(make([]byte, 64*1024), 16*1024*1024)
	w.call("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	return w
}

func (w *wire) send(message map[string]any) {
	w.write.Lock()
	defer w.write.Unlock()
	if err := w.enc.Encode(message); err != nil {
		w.t.Error(err)
	}
}

func (w *wire) notify(method string, params any) {
	w.send(map[string]any{"jsonrpc": "2.0", "method": method, "params": params})
}

// call returns the result, or the JSON-RPC error object.
func (w *wire) call(method string, params any) (result, rpcError map[string]any) {
	w.t.Helper()
	w.next++
	id := w.next
	w.send(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	for w.scanner.Scan() {
		var message map[string]any
		if err := json.Unmarshal(w.scanner.Bytes(), &message); err != nil {
			w.t.Fatal(err)
		}
		if message["method"] == "session/request_permission" {
			w.permissions++
			w.send(map[string]any{"jsonrpc": "2.0", "id": message["id"], "result": map[string]any{"outcome": w.permit(message["params"].(map[string]any))}})
			continue
		}
		if message["id"] == float64(id) {
			if e, ok := message["error"].(map[string]any); ok {
				return nil, e
			}
			result, _ = message["result"].(map[string]any)
			return result, nil
		}
	}
	w.t.Fatalf("%s: wire closed: %v", method, w.scanner.Err())
	return nil, nil
}

func (w *wire) newSession(cwd string, servers ...any) (string, map[string]any) {
	w.t.Helper()
	if servers == nil {
		servers = []any{}
	}
	result, rpcError := w.call("session/new", map[string]any{"cwd": cwd, "mcpServers": servers})
	if rpcError != nil {
		return "", rpcError
	}
	return result["sessionId"].(string), nil
}

func (w *wire) prompt(session, text string) map[string]any {
	w.t.Helper()
	result, rpcError := w.call("session/prompt", map[string]any{"sessionId": session, "prompt": []any{map[string]any{"type": "text", "text": text}}})
	if rpcError != nil {
		w.t.Fatalf("prompt: %v", rpcError)
	}
	return result
}

func (w *wire) closeSession(session string) {
	w.t.Helper()
	if _, rpcError := w.call("session/close", map[string]any{"sessionId": session}); rpcError != nil {
		w.t.Fatalf("close: %v", rpcError)
	}
}

func bootScripted(t *testing.T, provider *scriptedProvider) *harness.Harness {
	t.Helper()
	ctx := context.Background()
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"test"}, ApprovalPolicy: harness.ApprovalAsk, Adapter: provider.adapter()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = h.Dispose(ctx)
		if err := h.Drain(ctx); err != nil {
			t.Error(err)
		}
	})
	return h
}

func processAlive(pid int) bool { return syscall.Kill(pid, 0) == nil }

func waitUntil(t *testing.T, what string, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
