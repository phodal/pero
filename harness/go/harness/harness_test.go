package harness

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	point "github.com/phodal/pero/harness/go/runtime"
)

func testContext(t *testing.T) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestAppendSurfacePreservesExplicitProvenance(t *testing.T) {
	session := NewSession("surface-provenance", "")
	source, err := session.Append("fixture/source", map[string]bool{"ready": true})
	if err != nil {
		t.Fatal(err)
	}
	event, err := session.AppendSurface("user/message", Message{
		Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "derived"}},
	}, []uint64{source.Seq})
	if err != nil {
		t.Fatal(err)
	}
	if string(event.SurfaceOp) != `"append"` || !reflect.DeepEqual(event.SourceEventSeqs, []uint64{source.Seq}) {
		t.Fatalf("surface event = %+v", event)
	}
	before := len(session.Events())
	if _, err := session.AppendSurface("user/message", Message{Role: RoleUser}, []uint64{event.Seq, event.Seq}); err == nil {
		t.Fatal("duplicate surface provenance was accepted")
	}
	if _, err := session.AppendSurface("fixture/log", map[string]bool{"bad": true}, nil); err == nil {
		t.Fatal("log-only event accepted a surface operation")
	}
	if len(session.Events()) != before {
		t.Fatal("rejected surface append mutated the session")
	}
}

func TestBootRejectsInvalidApprovalPolicy(t *testing.T) {
	ctx := testContext(t)
	if _, err := Boot(ctx, Options{ApprovalPolicy: ApprovalPolicy("always")}); err == nil || !strings.Contains(err.Error(), `must be "ask" or "never"`) {
		t.Fatalf("invalid approval policy error = %v", err)
	}
}

type scriptedAdapter struct {
	mu        sync.Mutex
	responses []Completion
	requests  []GenerateRequest
}

func (a *scriptedAdapter) Generate(_ context.Context, request GenerateRequest, emit func(StreamChunk) error) (Completion, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	request.Messages = append([]Message(nil), request.Messages...)
	request.Tools = append([]ToolSchema(nil), request.Tools...)
	a.requests = append(a.requests, request)
	if len(a.responses) == 0 {
		return Completion{}, errors.New("script exhausted")
	}
	response := a.responses[0]
	a.responses = a.responses[1:]
	if emit != nil {
		for _, block := range response.Message.Content {
			if block.Type == BlockText || block.Type == BlockReasoning {
				if err := emit(StreamChunk{Content: []ContentBlock{block}}); err != nil {
					return Completion{}, err
				}
			}
		}
	}
	return response, nil
}

func TestHarnessRunsToolContinuationAndLogsModelVisibleState(t *testing.T) {
	adapter := &scriptedAdapter{responses: []Completion{
		{
			Message: Message{Role: RoleAssistant, Content: []ContentBlock{{
				Type: BlockToolCall, ToolCallID: "call-1", Name: "add", Arguments: json.RawMessage(`{"a":2,"b":3}`),
			}}},
			Finish: FinishToolCalls,
		},
		{
			Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "The answer is 5."}}},
			Finish:  FinishStop,
			Usage:   &TokenUsage{InputTokens: 10, OutputTokens: 5, TotalTokens: 15},
		},
	}}
	ctx := testContext(t)
	harness, err := Boot(ctx, Options{Adapter: adapter})
	if err != nil {
		t.Fatalf("boot: %v", err)
	}
	promptInstance, err := harness.RegisterPrompt(ctx, "prompt/base", PromptSection{
		ID: "base", Order: 10,
		Content: func(context.Context, *Agent) (string, error) { return "You are a precise assistant.", nil },
	})
	if err != nil {
		t.Fatalf("register prompt: %v", err)
	}
	toolInstance, err := harness.RegisterTool(ctx, "tool/add", Tool{
		Schema: ToolSchema{Name: "add", Description: "add two integers", InputSchema: json.RawMessage(`{"type":"object"}`)},
		Execute: func(_ context.Context, raw json.RawMessage) (ToolResult, error) {
			var input struct{ A, B int }
			if err := json.Unmarshal(raw, &input); err != nil {
				return ToolResult{}, err
			}
			return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: "5"}}}, nil
		},
	})
	if err != nil {
		t.Fatalf("register tool: %v", err)
	}
	agent, err := harness.Agents().Create(ctx, AgentOptions{ID: "session-1", CWD: t.TempDir(), Provider: "test", Model: "scripted"})
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}
	result, err := agent.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "What is 2+3?"}}})
	if err != nil {
		t.Fatalf("prompt: %v", err)
	}
	if result.Turn != 1 || result.Reason != FinishStop || result.Usage == nil || result.Usage.TotalTokens != 15 {
		t.Fatalf("turn result = %+v", result)
	}

	adapter.mu.Lock()
	requests := append([]GenerateRequest(nil), adapter.requests...)
	adapter.mu.Unlock()
	if len(requests) != 2 {
		t.Fatalf("model requests = %d, want 2", len(requests))
	}
	if requests[0].System != "You are a precise assistant.\n\n"+approvalAskPrompt || len(requests[0].Tools) != 1 || requests[0].Tools[0].Name != "add" {
		t.Fatalf("first request = %+v", requests[0])
	}
	roles := make([]Role, 0, len(requests[1].Messages))
	for _, message := range requests[1].Messages {
		roles = append(roles, message.Role)
	}
	if want := []Role{RoleUser, RoleAssistant, RoleTool}; !reflect.DeepEqual(roles, want) {
		t.Fatalf("second request roles = %v, want %v", roles, want)
	}

	types := make([]string, 0)
	for _, event := range agent.Session().Events() {
		types = append(types, event.Type)
	}
	wantTypes := []string{
		"agent/inbox/spliced", "turn/start", "agent/inbox/spliced", "step/start", "system/message", "user/message", "request/header", "request/context", "assistant/message", "tool/call", "tool/batch-budget", "tool/result", "step/end",
		"step/start", "assistant/chunk", "assistant/message", "step/end", "turn/end",
	}
	if !reflect.DeepEqual(types, wantTypes) {
		t.Fatalf("event types = %v, want %v", types, wantTypes)
	}
	for index, event := range agent.Session().Events() {
		if event.Seq != uint64(index+1) {
			t.Fatalf("event %d seq = %d", index, event.Seq)
		}
	}
	if err := toolInstance.Dispose(ctx); err != nil {
		t.Fatalf("dispose tool contribution: %v", err)
	}
	if schemas := harness.Tools().Schemas(agent.Scope()); len(schemas) != 0 {
		t.Fatalf("tool registration leaked: %+v", schemas)
	}
	if err := promptInstance.Dispose(ctx); err != nil {
		t.Fatalf("dispose prompt contribution: %v", err)
	}
	if err := harness.Dispose(ctx); err != nil {
		t.Fatalf("dispose harness: %v", err)
	}
	if snapshot := harness.Runtime().Snapshot(); snapshot.Instances != 0 || snapshot.Services != 0 {
		t.Fatalf("runtime residue = %+v", snapshot)
	}
}

func TestPreStepStartsDistinctRequestSeries(t *testing.T) {
	adapter := &scriptedAdapter{responses: []Completion{
		{
			Message: Message{Role: RoleAssistant, Content: []ContentBlock{{
				Type: BlockToolCall, ToolCallID: "series-call", Name: "series_tool", Arguments: json.RawMessage(`{}`),
			}}},
			Finish: FinishToolCalls,
		},
		{Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "done"}}}, Finish: FinishStop},
	}}
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	tool, err := h.RegisterTool(ctx, "tool/request-series", Tool{
		Schema: ToolSchema{Name: "series_tool", InputSchema: json.RawMessage(`{"type":"object"}`)},
		Execute: func(context.Context, json.RawMessage) (ToolResult, error) {
			return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: "ok"}}}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer tool.Dispose(context.Background())
	agent, err := h.Agents().Create(ctx, AgentOptions{
		ID: "request-series", Provider: "test", Model: "scripted",
		Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
			_, hookErr := h.Hooks().PreStep.Use(run, func(_ context.Context, input StepInput, next point.Next[StepInput]) (StepInput, error) {
				decision, nextErr := next(input)
				decision.StartsRequestSeries = true
				return decision, nextErr
			})
			return hookErr
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "start"}}}); err != nil {
		t.Fatal(err)
	}
	var headers []RequestHeaderEvent
	for _, event := range agent.Session().Events() {
		if event.Type != "request/header" {
			continue
		}
		var header RequestHeaderEvent
		if err := json.Unmarshal(event.Data, &header); err != nil {
			t.Fatal(err)
		}
		headers = append(headers, header)
	}
	if len(headers) != 2 || headers[0].Reason != "initial" || !headers[0].StartsSeries ||
		headers[1].Reason != "series" || headers[1].StartsSeries {
		t.Fatalf("request series headers = %+v", headers)
	}
}

func TestSessionConcurrentAppendKeepsContiguousSequence(t *testing.T) {
	session := NewSession("concurrent", "")
	var observedMu sync.Mutex
	var observed []uint64
	session.Subscribe(func(event Event) {
		observedMu.Lock()
		observed = append(observed, event.Seq)
		observedMu.Unlock()
	})
	const writers = 16
	const perWriter = 50
	var wait sync.WaitGroup
	wait.Add(writers)
	for writer := range writers {
		writer := writer
		go func() {
			defer wait.Done()
			for index := range perWriter {
				if _, err := session.Append("test/event", map[string]int{"writer": writer, "index": index}); err != nil {
					t.Errorf("append: %v", err)
					return
				}
			}
		}()
	}
	wait.Wait()
	events := session.Events()
	if len(events) != writers*perWriter {
		t.Fatalf("events = %d", len(events))
	}
	for index, event := range events {
		if event.Seq != uint64(index+1) {
			t.Fatalf("event %d seq = %d", index, event.Seq)
		}
	}
	observedMu.Lock()
	defer observedMu.Unlock()
	for index, seq := range observed {
		if seq != uint64(index+1) {
			t.Fatalf("notification %d seq = %d", index, seq)
		}
	}
}

func TestSessionAppendIfLastSeqIsAtomic(t *testing.T) {
	session := NewSession("append-cas", t.TempDir())
	first, err := session.AppendIfLastSeq(0, "fact", map[string]int{"value": 1})
	if err != nil || first.Seq != 1 {
		t.Fatalf("first=%+v err=%v", first, err)
	}
	if _, err = session.AppendIfLastSeq(0, "fact", map[string]int{"value": 2}); !errors.Is(err, ErrSessionChanged) {
		t.Fatalf("stale append error=%v", err)
	}
	second, err := session.AppendIfLastSeq(first.Seq, "fact", map[string]int{"value": 2})
	if err != nil || second.Seq != 2 || len(session.Events()) != 2 {
		t.Fatalf("second=%+v events=%+v err=%v", second, session.Events(), err)
	}
}

func TestSessionEnforcesDurableCodeDispatchEnclosureAndRootTopology(t *testing.T) {
	session := NewSession("dispatch-invariant", "")
	start := map[string]any{
		"rootCallId": "run", "parentCallId": "run", "subCallId": "run:code:1", "name": "read",
		"arguments": map[string]any{"path": "large.txt"},
	}
	if _, err := session.Append("tool/code-dispatch-start", start); err == nil {
		t.Fatal("dispatch start outside a turn was accepted")
	}
	if _, err := session.Append("turn/start", map[string]int{"turn": 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Append("tool/code-dispatch-start", start); err != nil {
		t.Fatal(err)
	}
	settle := map[string]any{
		"rootCallId": "other", "parentCallId": "run", "subCallId": "run:code:1", "name": "read",
		"arguments": map[string]any{"path": "large.txt"}, "isError": false,
		"content": []ContentBlock{{Type: BlockText, Text: "ok"}},
	}
	if _, err := session.Append("tool/code-dispatch", settle); err == nil {
		t.Fatal("dispatch root identity change was accepted")
	}
	settle["rootCallId"] = "run"
	if _, err := session.Append("tool/code-dispatch", settle); err != nil {
		t.Fatal(err)
	}
}

func TestAgentCancellationClosesStepAndTurn(t *testing.T) {
	started := make(chan struct{})
	adapter := AdapterFunc(func(ctx context.Context, _ GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		close(started)
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})
	ctx := testContext(t)
	harness, err := Boot(ctx, Options{Adapter: adapter})
	if err != nil {
		t.Fatalf("boot: %v", err)
	}
	agent, err := harness.Agents().Create(ctx, AgentOptions{ID: "cancel"})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	result := make(chan error, 1)
	go func() {
		_, err := agent.Prompt(context.Background(), Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "wait"}}})
		result <- err
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("adapter did not start")
	}
	agent.Cancel(errors.New("user canceled"))
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("prompt error = %v", err)
	}
	types := make([]string, 0)
	for _, event := range agent.Session().Events() {
		types = append(types, event.Type)
	}
	if want := []string{"agent/inbox/spliced", "turn/start", "agent/inbox/spliced", "step/start", "system/message", "user/message", "request/header", "assistant/attempt", "step/end", "turn/end"}; !reflect.DeepEqual(types, want) {
		t.Fatalf("event types = %v, want %v", types, want)
	}
	if err := harness.Dispose(ctx); err != nil {
		t.Fatalf("dispose: %v", err)
	}
}

func TestAgentCancellationFinalizesSafeStreamPrefix(t *testing.T) {
	started := make(chan struct{})
	var calls int
	adapter := AdapterFunc(func(ctx context.Context, request GenerateRequest, emit func(StreamChunk) error) (Completion, error) {
		calls++
		if calls == 2 {
			var replayed bool
			for _, message := range request.Messages {
				if message.Role != RoleAssistant {
					continue
				}
				for _, block := range message.Content {
					replayed = replayed || block.Type == BlockText && block.Text == "partial answer"
				}
			}
			if !replayed {
				return Completion{}, errors.New("interrupted assistant prefix was not replayed")
			}
			return Completion{
				Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "continued"}}},
				Finish:  FinishStop,
			}, nil
		}
		usage := &TokenUsage{InputTokens: 7, OutputTokens: 4, TotalTokens: 11}
		for _, chunk := range []StreamChunk{
			{Content: []ContentBlock{{Type: BlockReasoning, Text: "thinking about it"}}},
			{Content: []ContentBlock{{Type: BlockText, Text: "partial "}}},
			{Content: []ContentBlock{
				{Type: BlockText, Text: "answer"},
				{Type: BlockToolCall, ToolCallID: "unfinished", Name: "read", ArgumentsDelta: `{"pa`},
			}, Usage: usage},
		} {
			if err := emit(chunk); err != nil {
				return Completion{}, err
			}
		}
		close(started)
		<-ctx.Done()
		return Completion{}, ctx.Err()
	})
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	agent, err := h.Agents().Create(ctx, AgentOptions{ID: "cancel-prefix", Provider: "fixture", Model: "stream"})
	if err != nil {
		t.Fatal(err)
	}
	settled := make(chan error, 1)
	go func() {
		_, promptErr := agent.Prompt(context.Background(), Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "start"}}})
		settled <- promptErr
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("streaming adapter did not start")
	}
	agent.Cancel(errors.New("user canceled"))
	if err := <-settled; !errors.Is(err, context.Canceled) {
		t.Fatalf("prompt error = %v", err)
	}

	events := agent.Session().Events()
	var interrupted struct {
		Message     Message     `json:"message"`
		Interrupted bool        `json:"interrupted"`
		Usage       *TokenUsage `json:"usage"`
	}
	messageIndex, stepEndIndex, turnEndIndex := -1, -1, -1
	for index, event := range events {
		switch event.Type {
		case "assistant/message":
			messageIndex = index
			if err := json.Unmarshal(event.Data, &interrupted); err != nil {
				t.Fatal(err)
			}
		case "tool/call":
			t.Fatal("partial tool call was dispatched")
		case "step/end":
			stepEndIndex = index
		case "turn/end":
			turnEndIndex = index
			var end struct {
				Reason FinishKind `json:"reason"`
			}
			if err := json.Unmarshal(event.Data, &end); err != nil || end.Reason != FinishAborted {
				t.Fatalf("turn end=%s error=%v", event.Data, err)
			}
		}
	}
	wantContent := []ContentBlock{
		{Type: BlockReasoning, Text: "thinking about it"},
		{Type: BlockText, Text: "partial answer"},
	}
	if !interrupted.Interrupted || !reflect.DeepEqual(interrupted.Message.Content, wantContent) ||
		interrupted.Usage == nil || interrupted.Usage.TotalTokens != 11 ||
		messageIndex < 0 || messageIndex >= stepEndIndex || stepEndIndex >= turnEndIndex ||
		!strings.Contains(string(interrupted.Message.Source), `"provider":"fixture"`) {
		t.Fatalf("interrupted=%+v indexes message=%d step=%d turn=%d", interrupted, messageIndex, stepEndIndex, turnEndIndex)
	}

	continued, err := agent.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "continue"}}})
	if err != nil || continued.Reason != FinishStop || calls != 2 {
		t.Fatalf("continued=%+v calls=%d error=%v", continued, calls, err)
	}
}

func TestMaxTokenStopContracts(t *testing.T) {
	for _, mode := range []string{"tool", "sticky"} {
		t.Run(mode, func(t *testing.T) {
			responses := []Completion{{Finish: FinishMaxTokens, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "limited"}}}}, {Finish: FinishStop, Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "complete"}}}}}
			if mode == "tool" {
				responses[0].Message.Content = append(responses[0].Message.Content, ContentBlock{Type: BlockToolCall, ToolCallID: "limited-call", Name: "probe", Arguments: json.RawMessage(`{}`)})
			}
			adapter := &scriptedAdapter{responses: responses}
			ctx := testContext(t)
			h, err := Boot(ctx, Options{Adapter: adapter})
			if err != nil {
				t.Fatal(err)
			}
			defer h.Dispose(context.Background())
			var effects int
			tool, err := h.RegisterTool(ctx, "tool/probe", Tool{Schema: ToolSchema{Name: "probe", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (ToolResult, error) {
				effects++
				return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: "side effect"}}}, nil
			}})
			if err != nil {
				t.Fatal(err)
			}
			defer tool.Dispose(context.Background())
			injected := false
			agent, err := h.Agents().Create(ctx, AgentOptions{ID: SessionID("max-token-" + mode), Provider: "test", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
				if mode != "sticky" {
					return nil
				}
				_, e := h.Hooks().TurnStopping.On(run, func(_ context.Context, in TurnStoppingInput) error {
					if !injected {
						injected = true
						return in.Agent.Inject(Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "follow up"}}})
					}
					return nil
				})
				return e
			}})
			if err != nil {
				t.Fatal(err)
			}
			got, err := agent.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "start"}}})
			if err != nil {
				t.Fatal(err)
			}
			if effects != 0 || got.Reason != FinishMaxTokens {
				t.Fatalf("mode=%s effects=%d reason=%s; want no effects and max_tokens", mode, effects, got.Reason)
			}
			for _, event := range agent.Session().Events() {
				if event.Type == "assistant/message" {
					var payload struct{ Message Message }
					if err := json.Unmarshal(event.Data, &payload); err != nil {
						t.Fatal(err)
					}
					if len(toolCalls(payload.Message)) != 0 {
						t.Fatal("output-limited call persisted into committed history")
					}
					if len(payload.Message.Content) == 0 {
						t.Fatal("safe text disappeared")
					}
				}
				if event.Type == "turn/end" {
					var payload struct{ Reason FinishKind }
					json.Unmarshal(event.Data, &payload)
					if payload.Reason != FinishMaxTokens {
						t.Fatal("durable turn reason downgraded")
					}
				}
			}
			wantRequests := 1
			if mode == "sticky" {
				wantRequests = 2
			}
			if len(adapter.requests) != wantRequests {
				t.Fatalf("requests=%d want=%d", len(adapter.requests), wantRequests)
			}
		})
	}
}
