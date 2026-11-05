package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

const questionArguments = `{"questions":[{"question":"Which language?","header":"Language","options":[{"label":"Go","description":"Harness"},{"label":"Rust","description":"UI"}],"multiSelect":false},{"question":"Which checks?","header":"Checks","options":[{"label":"Tests","description":"Behavior"},{"label":"Vet","description":"Analysis"}],"multiSelect":true}]}`
const answeredQuestions = `{"outcome":"answered","answers":[{"questionIndex":0,"selectedOptions":[1]},{"questionIndex":1,"selectedOptions":[0,1],"text":"Build"}]}`

func TestUserQuestionsNegotiatedWire(t *testing.T) {
	for _, test := range []struct {
		name      string
		enable    bool
		revision  int
		reply     string
		cancel    bool
		wantError bool
		wantText  string
		wantAsk   bool
	}{
		{name: "real answers and resume", enable: true, revision: 1, reply: answeredQuestions, wantText: `"Which checks?":"Tests, Vet, Build"`, wantAsk: true},
		{name: "client does not advertise", enable: true, revision: 0, wantError: true, wantText: "unknown tool"},
		{name: "unsupported revision", enable: true, revision: 2, wantError: true, wantText: "unknown tool"},
		{name: "server not enabled", revision: 1, wantError: true, wantText: "unknown tool"},
		{name: "user dismisses", enable: true, revision: 1, reply: `{"outcome":"cancelled"}`, wantError: true, wantText: "cancelled", wantAsk: true},
		{name: "missing answer index", enable: true, revision: 1, reply: `{"outcome":"answered","answers":[{"selectedOptions":[0]},{"questionIndex":1,"selectedOptions":[0]}]}`, wantError: true, wantText: "questionIndex", wantAsk: true},
		{name: "bad option", enable: true, revision: 1, reply: `{"outcome":"answered","answers":[{"questionIndex":0,"selectedOptions":[7]},{"questionIndex":1,"selectedOptions":[0]}]}`, wantError: true, wantText: "unknown or duplicate option", wantAsk: true},
		{name: "prompt cancellation", enable: true, revision: 1, cancel: true, wantAsk: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			var modelCalls atomic.Int32
			seen := make(chan harness.ContentBlock, 2)
			h, err := harness.Boot(ctx, harness.Options{ApprovalPolicy: harness.ApprovalNever, AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				if modelCalls.Add(1)%2 == 1 {
					found := false
					for _, tool := range request.Tools {
						found = found || tool.Name == "AskUserQuestion"
					}
					if found != test.wantAsk {
						return harness.Completion{}, fmt.Errorf("question schema visible=%v want=%v", found, test.wantAsk)
					}
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "AskUserQuestion", ToolCallID: "question-call", Arguments: json.RawMessage(questionArguments)}}}}, nil
				}
				for _, message := range request.Messages {
					for _, block := range message.Content {
						if block.Type == harness.BlockToolResult && block.ToolCallID == "question-call" {
							seen <- block
						}
					}
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "answered"}}}}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
			disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture", UserQuestions: test.enable})
			if err != nil {
				t.Fatal(err)
			}
			client, remote := net.Pipe()
			_ = client.SetDeadline(time.Now().Add(12 * time.Second))
			served := make(chan error, 1)
			go func() { served <- server.Serve(ctx, remote, remote); _ = remote.Close() }()
			defer func() {
				_ = client.Close()
				if err := <-served; err != nil {
					t.Error(err)
				}
			}()
			wire := questionWire{t: t, encoder: json.NewEncoder(client), scanner: bufio.NewScanner(client), reply: test.reply, cancel: test.cancel}
			initialized := wire.rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{"_meta": map[string]int{UserQuestionsCapability: test.revision}}})
			var capabilities struct {
				Agent struct {
					Meta map[string]int `json:"_meta"`
				} `json:"agentCapabilities"`
			}
			if err := json.Unmarshal(initialized, &capabilities); err != nil || (capabilities.Agent.Meta[UserQuestionsCapability] == 1) != test.enable {
				t.Fatalf("capabilities=%s error=%v", initialized, err)
			}
			cwd := t.TempDir()
			created := wire.rpc("session/new", map[string]any{"cwd": cwd, "mcpServers": []any{}})
			var session struct {
				SessionID string `json:"sessionId"`
			}
			if err := json.Unmarshal(created, &session); err != nil {
				t.Fatal(err)
			}
			wire.session = session.SessionID
			prompt := func() {
				result := wire.rpc("session/prompt", map[string]any{"sessionId": session.SessionID, "prompt": []any{map[string]any{"type": "text", "text": "Ask me"}}})
				if test.cancel {
					if !strings.Contains(string(result), `"stopReason":"cancelled"`) || wire.cancelNotices != 1 {
						t.Fatalf("cancelled result=%s dismissals=%d", result, wire.cancelNotices)
					}
					return
				}
				select {
				case block := <-seen:
					text := ""
					for _, content := range block.Content {
						text += content.Text
					}
					if block.IsError != test.wantError || !strings.Contains(text, test.wantText) {
						t.Fatalf("answer error=%v text=%s", block.IsError, text)
					}
					if !test.wantError && (!strings.Contains(text, `"questions":[`) || !strings.Contains(text, `"Which language?":"Rust"`)) {
						t.Fatalf("not Claude answer shape: %s", text)
					}
				case <-ctx.Done():
					t.Fatal("tool result was not returned to the model")
				}
			}
			prompt()
			wantAsks := 0
			if test.wantAsk {
				wantAsks = 1
			}
			if wire.asks != wantAsks {
				t.Fatalf("asks=%d want=%d", wire.asks, wantAsks)
			}
			wire.rpc("session/close", map[string]any{"sessionId": session.SessionID})
			if test.name == "real answers and resume" {
				wire.rpc("session/resume", map[string]any{"sessionId": session.SessionID, "cwd": cwd, "mcpServers": []any{}})
				prompt()
				if wire.asks != 2 {
					t.Fatalf("resumed session lost its question transport: %d", wire.asks)
				}
			}
		})
	}
}

type questionWire struct {
	t             *testing.T
	encoder       *json.Encoder
	scanner       *bufio.Scanner
	next          int
	session       string
	reply         string
	cancel        bool
	asks          int
	cancelNotices int
}

func (w *questionWire) rpc(method string, params any) json.RawMessage {
	w.t.Helper()
	w.next++
	id := w.next
	w.send(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
	for w.scanner.Scan() {
		var message request
		if err := json.Unmarshal(w.scanner.Bytes(), &message); err != nil {
			w.t.Fatal(err)
		}
		switch message.Method {
		case "session/request_permission":
			w.t.Fatal("human questions were encoded as permission requests")
		case UserQuestionsCancelMethod:
			var params struct {
				SessionID  string `json:"sessionId"`
				ToolCallID string `json:"toolCallId"`
			}
			if err := json.Unmarshal(message.Params, &params); err != nil || params.SessionID != w.session || params.ToolCallID != "question-call" {
				w.t.Fatalf("wrong cancellation: %s %v", message.Params, err)
			}
			w.cancelNotices++
		case UserQuestionsMethod:
			w.asks++
			var params userQuestionsParams
			if err := json.Unmarshal(message.Params, &params); err != nil || string(params.SessionID) != w.session || params.CallID != "question-call" || len(params.Questions) != 2 {
				w.t.Fatalf("question identity/body: %s %v", message.Params, err)
			}
			if w.cancel {
				w.send(map[string]any{"jsonrpc": "2.0", "method": "session/cancel", "params": map[string]string{"sessionId": w.session}})
			} else {
				w.send(map[string]any{"jsonrpc": "2.0", "id": message.ID, "result": json.RawMessage(w.reply)})
			}
		}
		if string(message.ID) == fmt.Sprint(id) {
			if message.Error != nil {
				w.t.Fatalf("%s: %+v", method, message.Error)
			}
			return message.Result
		}
	}
	w.t.Fatalf("%s EOF: %v", method, w.scanner.Err())
	return nil
}

func (w *questionWire) send(message any) {
	w.t.Helper()
	if err := w.encoder.Encode(message); err != nil {
		w.t.Fatal(err)
	}
}
