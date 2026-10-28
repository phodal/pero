package subagents

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type fixtureAdapter struct {
	mu            sync.Mutex
	calls         map[*harness.Agent]int
	children      chan *harness.Agent
	blockChild    bool
	childCanceled chan struct{}
	requests      []harness.GenerateRequest
}

func (a *fixtureAdapter) Generate(ctx context.Context, r harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
	a.mu.Lock()
	if a.calls == nil {
		a.calls = map[*harness.Agent]int{}
	}
	a.calls[r.Agent]++
	n := a.calls[r.Agent]
	a.requests = append(a.requests, r)
	a.mu.Unlock()
	if r.Agent.Parent() != nil {
		select {
		case a.children <- r.Agent:
		default:
		}
		if a.blockChild {
			<-ctx.Done()
			close(a.childCanceled)
			return harness.Completion{}, ctx.Err()
		}
		return answer("child-result"), nil
	}
	if n == 1 {
		return harness.Completion{Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "delegate-1", Name: "subagent", Arguments: json.RawMessage(`{"description":"focused task","prompt":"child task"}`)}}}, Finish: harness.FinishToolCalls}, nil
	}
	return answer("parent-result"), nil
}
func answer(text string) harness.Completion {
	return harness.Completion{Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}, Finish: harness.FinishStop}
}
func fixture(t *testing.T, adapter harness.Adapter) (context.Context, *harness.Harness, *harness.Agent) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = h.Dispose(context.Background())
		if err := h.Drain(ctx); err != nil {
			t.Error(err)
		}
	})
	if _, err = MountInProcess(ctx, h, InProcessOptions{}); err != nil {
		t.Fatal(err)
	}
	parent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "parent", CWD: t.TempDir(), MaxSteps: 4, MaxTokens: 40})
	if err != nil {
		t.Fatal(err)
	}
	return ctx, h, parent
}
func TestParentToolChildLoopResult(t *testing.T) {
	adapter := &fixtureAdapter{children: make(chan *harness.Agent, 2)}
	ctx, h, parent := fixture(t, adapter)
	if _, err := MountTool(ctx, h, ToolOptions{Provider: "spawn"}); err != nil {
		t.Fatal(err)
	}
	outcome, err := parent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "delegate"}}})
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Reason != harness.FinishStop {
		t.Fatalf("finish %v", outcome.Reason)
	}
	select {
	case child := <-adapter.children:
		if child.Parent() != parent || !parent.Scope().Contains(child.Scope()) || child.MaxSteps() != 4 || child.MaxTokens() != 40 {
			t.Fatal("child widened owner/budgets")
		}
		if policy, err := h.Approvals().EffectivePolicy(child.Session()); err != nil || policy != harness.ApprovalNever {
			t.Fatalf("approval %s %v", policy, err)
		}
		if _, ok := h.Agents().Get(child.ID()); ok {
			t.Fatal("settled child not retired")
		}
	default:
		t.Fatal("child model loop never ran")
	}
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	found := false
	for _, r := range adapter.requests {
		if r.Agent == parent {
			b, _ := json.Marshal(r.Messages)
			if strings.Contains(string(b), "child-result") {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("parent continuation did not receive child result")
	}
}
func TestParentToolCancellationAndRecovery(t *testing.T) {
	adapter := &fixtureAdapter{children: make(chan *harness.Agent, 1), blockChild: true, childCanceled: make(chan struct{})}
	ctx, h, parent := fixture(t, adapter)
	if _, err := MountTool(ctx, h, ToolOptions{Provider: "spawn"}); err != nil {
		t.Fatal(err)
	}
	turnctx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() {
		_, err := parent.Prompt(turnctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "delegate"}}})
		done <- err
	}()
	var child *harness.Agent
	select {
	case child = <-adapter.children:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancel()
	select {
	case <-adapter.childCanceled:
	case <-ctx.Done():
		t.Fatal("child not canceled")
	}
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("parent not canceled")
	}
	if _, err := h.Subagents().WaitForChildren(ctx, parent); err != nil {
		t.Fatal(err)
	}
	if err := h.Agents().WaitRetired(ctx, child); err != nil {
		t.Fatal(err)
	}
	if _, err := parent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "recover"}}}); err != nil {
		t.Fatal(err)
	}
}
func TestBudgetRouteAndFieldFences(t *testing.T) {
	ctx, h, parent := fixture(t, &fixtureAdapter{children: make(chan *harness.Agent, 2)})
	provider := &inProcessProvider{h: h}
	for _, req := range []harness.SubagentRequest{{Parent: parent, MaxSteps: 5}, {Parent: parent, MaxTokens: 41}, {Parent: parent, MaxTokens: -1}, {Parent: parent, Provider: "other"}, {Parent: parent, Model: "other"}, {Parent: parent, CWD: "/"}} {
		if _, err := provider.childAgentOptions(req, nil); err == nil {
			t.Fatalf("widening accepted %+v", req)
		}
	}
	if _, err := parent.Session().Append("request/header", harness.RequestHeaderEvent{MaxTokens: 12}); err != nil {
		t.Fatal(err)
	}
	options, err := provider.childAgentOptions(harness.SubagentRequest{Parent: parent}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if options.MaxTokens != 12 {
		t.Fatalf("effective cap %d", options.MaxTokens)
	}
	if _, err = provider.childAgentOptions(harness.SubagentRequest{Parent: parent, MaxTokens: 13}, nil); err == nil {
		t.Fatal("committed cap widened")
	}
	tool := delegationTool(h.Subagents(), ToolOptions{Provider: "spawn", MaxDepth: 1})
	for _, args := range []string{`{"description":"x","prompt":"y","model":"other"}`, `{"Description":"x","prompt":"y"}`, `{"description":"x","prompt":"y","cwd":"/"}`, `{"description":"x","prompt":null}`} {
		if _, err := tool.ExecuteRequest(ctx, harness.ToolRequest{Agent: parent, Arguments: json.RawMessage(args)}); err == nil {
			t.Fatalf("unsafe args %s", args)
		}
	}
}
func TestRequiresOptInAndRejectsContinuation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	h, err := harness.Boot(ctx, harness.Options{Adapter: &fixtureAdapter{}})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(ctx)
	if _, err := MountInProcess(ctx, h, InProcessOptions{}); err == nil {
		t.Fatal("implicit enable")
	}
	if _, ok := any(&inProcessProvider{}).(harness.SubagentContinuationProvider); ok {
		t.Fatal("continuation advertised")
	}
}

func TestForkKeepsCompletedPrefixAndInheritedToolMask(t *testing.T) {
	childRequests := make(chan harness.GenerateRequest, 1)
	adapter := harness.AdapterFunc(func(_ context.Context, r harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if r.Agent.Parent() != nil {
			childRequests <- r
		}
		return answer("historical-answer"), nil
	})
	ctx, h, parent := fixture(t, adapter)
	if _, err := h.RegisterTool(ctx, "forbidden", harness.Tool{Schema: harness.ToolSchema{Name: "forbidden", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		t.Error("forbidden tool executed")
		return harness.ToolResult{}, nil
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.RegisterToolRestrictionAt(ctx, parent, "parent-mask", harness.ToolRestriction{Deny: []string{"forbidden"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := parent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "historical-question"}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := MountForkInProcess(ctx, h, InProcessOptions{}); err != nil {
		t.Fatal(err)
	}
	run, err := h.Subagents().StartActivation(ctx, "fork", harness.SubagentRequest{Parent: parent, Prompt: "fork-task", MaxDepth: 1}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	result := <-run.Result
	if result.Status != harness.SubagentCompleted {
		t.Fatalf("result %+v", result)
	}
	childReq := <-childRequests
	encoded, _ := json.Marshal(childReq.Messages)
	if !strings.Contains(string(encoded), "historical-question") || !strings.Contains(string(encoded), "historical-answer") {
		t.Fatalf("fork lost completed prefix: %s", encoded)
	}
	if childReq.Agent.Session().Header().SeedLength == 0 {
		t.Fatal("fork lacks seed")
	}
	for _, schema := range childReq.Tools {
		if schema.Name == "forbidden" {
			t.Fatal("parent tool restriction lost")
		}
	}
	if err := run.Dispose(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestToolActivationCapacityAndDepth(t *testing.T) {
	started := make(chan *harness.Agent, 2)
	adapter := harness.AdapterFunc(func(ctx context.Context, r harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if r.Agent.Parent() != nil {
			started <- r.Agent
			<-ctx.Done()
			return harness.Completion{}, ctx.Err()
		}
		return answer("root"), nil
	})
	ctx, h, parent := fixture(t, adapter)
	if err := h.Subagents().ReplaceConfig(harness.SubagentRuntimeConfig{MaxDepth: 1, MaxActiveSubagents: 1}); err != nil {
		t.Fatal(err)
	}
	tool := delegationTool(h.Subagents(), ToolOptions{Provider: "spawn", MaxDepth: 1})
	req := harness.ToolRequest{Agent: parent, Arguments: json.RawMessage(`{"description":"bounded","prompt":"wait"}`)}
	childCtx, cancel := context.WithCancel(ctx)
	done := make(chan error, 1)
	go func() { _, err := tool.ExecuteRequest(childCtx, req); done <- err }()
	var child *harness.Agent
	select {
	case child = <-started:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if _, err := tool.ExecuteRequest(ctx, req); err == nil {
		t.Fatal("capacity N+1 accepted")
	}
	req.Agent = child
	if _, err := tool.ExecuteRequest(ctx, req); err == nil {
		t.Fatal("depth 2 accepted")
	}
	cancel()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if _, err := h.Subagents().WaitForChildren(ctx, parent); err != nil {
		t.Fatal(err)
	}
	if err := h.Agents().WaitRetired(ctx, child); err != nil {
		t.Fatal(err)
	}
}

func TestRootHookEffectiveCapFlowsToChild(t *testing.T) {
	adapter := &fixtureAdapter{children: make(chan *harness.Agent, 1)}
	ctx, h, parent := fixture(t, adapter)
	def := point.Define(point.Descriptor{ID: "test/root-cap"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		return h.Hooks().Request.Use(run, func(ctx context.Context, r harness.GenerateRequest, next point.Next[harness.GenerateRequest]) (harness.GenerateRequest, error) {
			if r.Agent.Parent() == nil {
				r.MaxTokens = 9
			}
			return next(r)
		})
	})
	instance, err := h.Runtime().Mount(nil, "root-cap", def, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = instance.WaitStable(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err = MountTool(ctx, h, ToolOptions{Provider: "spawn"}); err != nil {
		t.Fatal(err)
	}
	if _, err = parent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "delegate"}}}); err != nil {
		t.Fatal(err)
	}
	child := <-adapter.children
	if child.MaxTokens() != 9 {
		t.Fatalf("child failed effective request cap: %d", child.MaxTokens())
	}
}
func TestCompactionOptionIsDetached(t *testing.T) {
	ctx, h, parent := fixture(t, &fixtureAdapter{children: make(chan *harness.Agent, 1)})
	tokens := 100
	auto := false
	config := harness.BasicCompactionConfig{MaxTokens: 100, RetainTokens: &tokens, Auto: &auto, ModelPolicies: []harness.ModelCompactionPolicy{{Provider: "fixture", Model: "fixture", MaxTokens: &tokens}}}
	if _, err := MountInProcess(ctx, h, InProcessOptions{EntryID: "copy-policy", Name: "copy-policy", Compaction: &config}); err != nil {
		t.Fatal(err)
	}
	mounted, err := h.Subagents().Provider(h.Runtime().Root(), "copy-policy")
	if err != nil {
		t.Fatal(err)
	}
	provider := mounted.(*inProcessProvider)
	tokens = 999
	config.ModelPolicies[0].Model = "changed"
	first, err := provider.childAgentOptions(harness.SubagentRequest{Parent: parent}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if first.Compaction == nil || *first.Compaction.RetainTokens != 100 || first.Compaction.ModelPolicies[0].Model != "fixture" {
		t.Fatal("mount retained caller-owned mutable policy")
	}
	*first.Compaction.RetainTokens = 7
	first.Compaction.ModelPolicies[0].Model = "mutated-child"
	second, err := provider.childAgentOptions(harness.SubagentRequest{Parent: parent}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if *second.Compaction.RetainTokens != 100 || second.Compaction.ModelPolicies[0].Model != "fixture" {
		t.Fatal("children share mutable policy")
	}
}
