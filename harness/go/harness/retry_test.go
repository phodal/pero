package harness

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"
	"testing"
	"time"
)

type policyAdapter struct {
	mu       sync.Mutex
	policy   ResolvedRetryPolicy
	failures []ProviderFailure
	calls    int
}

func (a *policyAdapter) RetryPolicyForProvider(string) (ResolvedRetryPolicy, bool) {
	policy := a.policy
	policy.RetryableCodes = append([]string(nil), policy.RetryableCodes...)
	return policy, true
}

func (a *policyAdapter) Generate(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls++
	if len(a.failures) != 0 {
		failure := a.failures[0]
		a.failures = a.failures[1:]
		return Completion{}, NewProviderErrorWithFailure(failure, errors.New("fixture provider failure"))
	}
	return Completion{
		Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "done"}}},
		Finish:  FinishStop,
	}, nil
}

func resolvedTestPolicy(t *testing.T, mode RetryMode, maxRetries int) ResolvedRetryPolicy {
	t.Helper()
	delay := int64(1)
	maximum := int64(10)
	jitter := 0.0
	config := &RetryPolicyConfig{
		Mode: mode,
		Backoff: &RetryBackoffConfig{
			InitialDelayMS: &delay, MaxDelayMS: &maximum, JitterRatio: &jitter,
		},
	}
	if mode == RetryNormal {
		config.MaxRetries = &maxRetries
	}
	policy, err := ResolveRetryPolicy(config)
	if err != nil {
		t.Fatal(err)
	}
	return policy
}

func TestHarnessRetriesProviderFailuresWithDurableStepLocalEvents(t *testing.T) {
	adapter := &policyAdapter{
		policy: resolvedTestPolicy(t, RetryNormal, 3),
		failures: []ProviderFailure{
			{Message: "limited", Code: "RATE_LIMIT", Status: 429, ProviderRetryAfterMS: 2, RequestID: "request-1"},
			{Message: "temporary", Code: "SERVER", Status: 503},
		},
	}
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()) }()
	agent, err := h.Agents().Create(ctx, AgentOptions{ID: "retry-events", Provider: "deepseek", Model: "deepseek-chat"})
	if err != nil {
		t.Fatal(err)
	}
	const promptID = "host-turn-1234"
	result, err := agent.Prompt(WithPromptReceiptID(ctx, promptID), Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "hello"}}})
	if err != nil || result.Reason != FinishStop || adapter.calls != 3 {
		t.Fatalf("result=%+v error=%v calls=%d", result, err, adapter.calls)
	}

	var retries []LLMRetryEvent
	var started []LLMRetryStartedEvent
	var headers []RequestHeaderEvent
	var receipts []promptRequestReceipt
	var eventTypes []string
	for _, event := range agent.Session().Events() {
		eventTypes = append(eventTypes, event.Type)
		switch event.Type {
		case "request/header":
			var value RequestHeaderEvent
			if err := json.Unmarshal(event.Data, &value); err != nil {
				t.Fatal(err)
			}
			headers = append(headers, value)
		case "request/prompt-receipt":
			var value promptRequestReceipt
			if err := json.Unmarshal(event.Data, &value); err != nil {
				t.Fatal(err)
			}
			if value.AfterSeq == 0 || value.AfterSeq >= event.Seq {
				t.Fatalf("receipt anchor = %d, receipt event = %d", value.AfterSeq, event.Seq)
			}
			receipts = append(receipts, value)
		case "llm/retry":
			var value LLMRetryEvent
			if err := json.Unmarshal(event.Data, &value); err != nil {
				t.Fatal(err)
			}
			retries = append(retries, value)
		case "llm/retry-started":
			var value LLMRetryStartedEvent
			if err := json.Unmarshal(event.Data, &value); err != nil {
				t.Fatal(err)
			}
			started = append(started, value)
		}
	}
	wantTypes := []string{
		"agent/inbox/spliced", "turn/start", "agent/inbox/spliced", "step/start", "system/message", "user/message", "request/header", "request/context",
		"request/prompt-receipt", "assistant/attempt", "llm/retry", "llm/retry-started", "request/prompt-receipt", "assistant/attempt", "llm/retry", "llm/retry-started",
		"request/prompt-receipt", "assistant/message", "step/end", "turn/end",
	}
	if !reflect.DeepEqual(eventTypes, wantTypes) {
		t.Fatalf("event types = %v", eventTypes)
	}
	if len(retries) != 2 || len(started) != 2 || retries[0].RetryID == "" || retries[0].RetryID != retries[1].RetryID ||
		retries[0].DelayMS != 2 || retries[1].DelayMS != 2 || retries[0].Failure.RequestID != "request-1" ||
		started[0].Retry != 1 || started[1].Retry != 2 {
		t.Fatalf("retry events = %+v / %+v", retries, started)
	}
	if len(headers) != 1 || headers[0].Reason != "initial" || headers[0].StartsSeries {
		t.Fatalf("retry request headers = %+v", headers)
	}
	if len(receipts) != 3 {
		t.Fatalf("received %d prompt receipts, want 3", len(receipts))
	}
	for index, receipt := range receipts {
		if receipt.PromptID != promptID || receipt.Attempt != index+1 || receipt.Turn != 1 || receipt.Step != 1 || receipt.Stage != "logical" {
			t.Fatalf("invalid attempt receipt: %+v", receipt)
		}
		if !reflect.DeepEqual(receipt.Messages, receipts[0].Messages) || len(receipt.Messages) != 1 || receipt.Messages[0].Role != RoleUser {
			t.Fatalf("retry input fingerprint changed: %+v", receipt.Messages)
		}
	}
}

// malformedThenValidArgumentsAdapter fails the first completed attempt with the
// adapter's own MALFORMED_RESPONSE failure and succeeds on the second attempt.
// Its short bounded policy keeps the regression fast while still exercising the
// shipped default code list, which resolvedTestPolicy derives from
// ResolveRetryPolicy.
type malformedThenValidArgumentsAdapter struct {
	mu     sync.Mutex
	calls  int
	policy ResolvedRetryPolicy
}

func (a *malformedThenValidArgumentsAdapter) RetryPolicyForProvider(string) (ResolvedRetryPolicy, bool) {
	policy := a.policy
	policy.RetryableCodes = append([]string(nil), policy.RetryableCodes...)
	return policy, true
}

func (a *malformedThenValidArgumentsAdapter) Generate(_ context.Context, _ GenerateRequest, emit func(StreamChunk) error) (Completion, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls++
	if a.calls == 1 {
		return Completion{}, NewProviderError(
			`openai adapter: tool "write" returned malformed arguments`, MalformedResponseCode, nil,
		)
	}
	if emit != nil {
		if err := emit(StreamChunk{Content: []ContentBlock{{Type: BlockToolCall, ToolCallID: "call-2", Name: "write", ArgumentsDelta: `{"path":"note.txt"}`}}}); err != nil {
			return Completion{}, err
		}
	}
	return Completion{
		Message: Message{Role: RoleAssistant, Content: []ContentBlock{{
			Type: BlockToolCall, ToolCallID: "call-2", Name: "write",
			Arguments: json.RawMessage(`{"path":"note.txt"}`),
		}}},
		Finish: FinishToolCalls,
	}, nil
}

func TestHarnessRetriesMalformedCompletedToolArgumentsWithinOneStep(t *testing.T) {
	delay := int64(1)
	maximum := int64(10)
	jitter := 0.0
	maxRetries := 2
	policy, err := ResolveRetryPolicy(&RetryPolicyConfig{
		Mode: RetryNormal, MaxRetries: &maxRetries,
		Backoff: &RetryBackoffConfig{InitialDelayMS: &delay, MaxDelayMS: &maximum, JitterRatio: &jitter},
	})
	if err != nil {
		t.Fatal(err)
	}
	adapter := &malformedThenValidArgumentsAdapter{policy: policy}
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()) }()
	executions := 0
	tool, err := h.RegisterTool(ctx, "write", Tool{
		Schema: ToolSchema{Name: "write", InputSchema: json.RawMessage(`{"type":"object","required":["path"],"additionalProperties":false,"properties":{"path":{"type":"string"}}}`)},
		Execute: func(context.Context, json.RawMessage) (ToolResult, error) {
			executions++
			return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: "written"}}, ConcludesTurn: true}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tool.Dispose(context.Background()) }()
	agent, err := h.Agents().Create(ctx, AgentOptions{ID: "retry-malformed-arguments", Provider: "deepseek"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := agent.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "write a note"}}})
	if err != nil {
		t.Fatalf("prompt error = %v", err)
	}
	if adapter.calls != 2 || executions != 1 {
		t.Fatalf("calls=%d executions=%d", adapter.calls, executions)
	}
	var retries []LLMRetryEvent
	var started []LLMRetryStartedEvent
	var steps, ends int
	var assistantEvents, toolCalls int
	for _, event := range agent.Session().Events() {
		switch event.Type {
		case "llm/retry":
			var value LLMRetryEvent
			if err := json.Unmarshal(event.Data, &value); err != nil {
				t.Fatal(err)
			}
			retries = append(retries, value)
		case "llm/retry-started":
			var value LLMRetryStartedEvent
			if err := json.Unmarshal(event.Data, &value); err != nil {
				t.Fatal(err)
			}
			started = append(started, value)
		case "step/start":
			steps++
		case "step/end":
			ends++
		case "assistant/message":
			assistantEvents++
		case "tool/call":
			toolCalls++
		}
	}
	if len(retries) != 1 || len(started) != 1 || retries[0].Failure.Code != MalformedResponseCode ||
		retries[0].Failure.Message != `openai adapter: tool "write" returned malformed arguments` ||
		retries[0].Turn != started[0].Turn || retries[0].Step != started[0].Step ||
		retries[0].Retry != 1 || retries[0].MaxRetries == nil || *retries[0].MaxRetries != 2 ||
		retries[0].RetryID == "" || retries[0].RetryID != started[0].RetryID {
		t.Fatalf("retry events = %+v / %+v", retries, started)
	}
	if steps != 1 || ends != 1 || assistantEvents != 1 || toolCalls != 1 {
		t.Fatalf("steps=%d ends=%d assistant=%d toolCalls=%d", steps, ends, assistantEvents, toolCalls)
	}
	// Exactly one durable tool call exists, and it is the valid retried call:
	// the malformed attempt never produced a call or a result.
	calls := 0
	for _, event := range agent.Session().Events() {
		if event.Type != "tool/call" {
			continue
		}
		calls++
		var value struct {
			CallID    ToolCallID      `json:"callId"`
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}
		if err := json.Unmarshal(event.Data, &value); err != nil {
			t.Fatal(err)
		}
		if value.CallID != ToolCallID("call-2") || value.Name != "write" ||
			!json.Valid(value.Arguments) || string(value.Arguments) != `{"path":"note.txt"}` {
			t.Fatalf("durable tool call = %+v", value)
		}
	}
	if calls != 1 {
		t.Fatalf("durable tool calls = %d", calls)
	}
	if result.Reason != FinishStop {
		t.Fatalf("result = %+v", result)
	}
}

func TestHarnessStopsAtRetryLimitAndDeclinesExcessProviderDelay(t *testing.T) {
	for _, test := range []struct {
		name       string
		failure    ProviderFailure
		maxRetries int
		wantCalls  int
		wantEvents int
	}{
		{name: "limit", failure: ProviderFailure{Message: "temporary", Code: "SERVER"}, maxRetries: 1, wantCalls: 2, wantEvents: 1},
		{name: "provider delay over bound", failure: ProviderFailure{Message: "limited", Code: "RATE_LIMIT", ProviderRetryAfterMS: 11}, maxRetries: 2, wantCalls: 1, wantEvents: 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			adapter := &policyAdapter{policy: resolvedTestPolicy(t, RetryNormal, test.maxRetries)}
			for range test.wantCalls + 1 {
				adapter.failures = append(adapter.failures, test.failure)
			}
			ctx := testContext(t)
			h, err := Boot(ctx, Options{Adapter: adapter})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = h.Dispose(context.Background()) }()
			agent, err := h.Agents().Create(ctx, AgentOptions{ID: SessionID("retry-" + test.name), Provider: "deepseek"})
			if err != nil {
				t.Fatal(err)
			}
			_, err = agent.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "hello"}}})
			if err == nil || adapter.calls != test.wantCalls {
				t.Fatalf("error=%v calls=%d", err, adapter.calls)
			}
			retries := 0
			for _, event := range agent.Session().Events() {
				if event.Type == "llm/retry" {
					retries++
				}
			}
			if retries != test.wantEvents {
				t.Fatalf("retry events = %d", retries)
			}
		})
	}
}

func TestRetryWaitIsCancellableBeforeAttemptStarts(t *testing.T) {
	delay := int64(5_000)
	maximum := delay
	jitter := 0.0
	maxRetries := 1
	policy, err := ResolveRetryPolicy(&RetryPolicyConfig{
		Mode: RetryNormal, MaxRetries: &maxRetries,
		Backoff: &RetryBackoffConfig{InitialDelayMS: &delay, MaxDelayMS: &maximum, JitterRatio: &jitter},
	})
	if err != nil {
		t.Fatal(err)
	}
	adapter := &policyAdapter{policy: policy, failures: []ProviderFailure{{Message: "temporary", Code: "SERVER"}}}
	h, err := Boot(context.Background(), Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()) }()
	agent, err := h.Agents().Create(context.Background(), AgentOptions{ID: "retry-cancel", Provider: "deepseek"})
	if err != nil {
		t.Fatal(err)
	}
	scheduled := make(chan struct{}, 1)
	agent.Session().Subscribe(func(event Event) {
		if event.Type == "llm/retry" {
			select {
			case scheduled <- struct{}{}:
			default:
			}
		}
	})
	promptContext, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() {
		_, err := agent.Prompt(promptContext, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "hello"}}})
		result <- err
	}()
	select {
	case <-scheduled:
	case <-time.After(time.Second):
		t.Fatal("retry was not scheduled")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("prompt error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("retry wait did not cancel")
	}
	for _, event := range agent.Session().Events() {
		if event.Type == "llm/retry-started" {
			t.Fatal("cancelled retry was recorded as started")
		}
	}
}

func TestRetryExecutionPolicyLayersAndAbortsDisabledGeneration(t *testing.T) {
	delay := int64(5_000)
	maximum := delay
	jitter := 0.0
	maxRetries := 1
	providerPolicy, err := ResolveRetryPolicy(&RetryPolicyConfig{
		Mode: RetryNormal, MaxRetries: &maxRetries,
		Backoff: &RetryBackoffConfig{InitialDelayMS: &delay, MaxDelayMS: &maximum, JitterRatio: &jitter},
	})
	if err != nil {
		t.Fatal(err)
	}
	adapter := &policyAdapter{policy: providerPolicy, failures: []ProviderFailure{{Message: "temporary", Code: "SERVER"}}}
	h, err := Boot(context.Background(), Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()) }()
	policy := h.RetryExecutionPolicy()
	if snapshot := policy.Snapshot(); snapshot != (RetryExecutionPolicySnapshot{Enabled: true}) {
		t.Fatalf("default snapshot = %+v", snapshot)
	}
	agent, err := h.Agents().Create(context.Background(), AgentOptions{ID: "retry-policy-hmr", Provider: "deepseek"})
	if err != nil {
		t.Fatal(err)
	}
	scheduled := make(chan struct{}, 1)
	agent.Session().Subscribe(func(event Event) {
		if event.Type == "llm/retry" {
			select {
			case scheduled <- struct{}{}:
			default:
			}
		}
	})
	result := make(chan error, 1)
	go func() {
		_, promptErr := agent.Prompt(context.Background(), Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "hello"}}})
		result <- promptErr
	}()
	select {
	case <-scheduled:
	case <-time.After(time.Second):
		t.Fatal("retry was not scheduled")
	}
	disable, err := policy.Override(false)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case promptErr := <-result:
		if promptErr == nil {
			t.Fatal("disabled in-flight retry hid the original provider failure")
		}
	case <-time.After(time.Second):
		t.Fatal("disabled retry generation did not abort its active wait")
	}
	if snapshot := policy.Snapshot(); snapshot != (RetryExecutionPolicySnapshot{Overridden: true, Enabled: false}) {
		t.Fatalf("disabled snapshot = %+v", snapshot)
	}
	enable, err := policy.Override(true)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot := policy.Snapshot(); snapshot != (RetryExecutionPolicySnapshot{Overridden: true, Enabled: true}) {
		t.Fatalf("enabled snapshot = %+v", snapshot)
	}
	if err := enable(context.Background()); err != nil {
		t.Fatal(err)
	}
	if snapshot := policy.Snapshot(); snapshot != (RetryExecutionPolicySnapshot{Overridden: true, Enabled: false}) {
		t.Fatalf("restored lower layer = %+v", snapshot)
	}
	if err := disable(context.Background()); err != nil {
		t.Fatal(err)
	}
	if snapshot := policy.Snapshot(); snapshot != (RetryExecutionPolicySnapshot{Enabled: true}) {
		t.Fatalf("restored default = %+v", snapshot)
	}
	for _, event := range agent.Session().Events() {
		if event.Type == "llm/retry-started" {
			t.Fatal("disabled retry generation was recorded as started")
		}
	}
}

func TestAlwaysRetryIgnoresDownstreamFailure(t *testing.T) {
	policy := resolvedTestPolicy(t, RetryAlways, 0)
	adapter := &policyAdapter{policy: policy}
	executor := newRetryExecutor(adapter, func() float64 { return 0.5 }, nil)
	defer func() { _ = executor.dispose(context.Background()) }()
	session := NewSession("always-retry", "")
	_, _ = session.Append("turn/start", struct{ Turn int }{1})
	_, _ = session.Append("step/start", struct{ Turn, Step int }{1, 1})
	agent := &Agent{session: session}
	decision, err := executor.recover(context.Background(), RequestErrorInput{
		Agent: agent, Turn: 1, Step: 1, Provider: "deepseek", Failure: ProviderFailure{Message: "bad", Code: "AUTH"},
	}, func(input RequestErrorInput) (RequestErrorInput, error) {
		return input, errors.New("downstream recovery failed")
	})
	if err != nil || !decision.Retry {
		t.Fatalf("decision=%+v error=%v", decision, err)
	}
}

var _ Adapter = (*policyAdapter)(nil)
var _ RetryPolicyProvider = (*policyAdapter)(nil)
