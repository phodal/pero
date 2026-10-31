package harness

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync/atomic"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestApprovalIsScopedDurableAndFailClosed(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	var executions atomic.Int32
	toolInstance, err := h.RegisterTool(ctx, "approval/tool", Tool{
		Schema:           ToolSchema{Name: "guarded", InputSchema: json.RawMessage(`{"type":"object"}`)},
		RequiresApproval: true,
		Execute: func(context.Context, json.RawMessage) (ToolResult, error) {
			executions.Add(1)
			return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: "executed"}}}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer toolInstance.Dispose(context.Background())

	unhandled, err := h.Agents().Create(ctx, AgentOptions{ID: "unhandled"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := unhandled.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	denied, err := h.Tools().Execute(ctx, ToolRequest{Agent: unhandled, CallID: "call-1", Name: "guarded", Arguments: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if !denied.Result.IsError || executions.Load() != 0 {
		t.Fatalf("unhandled approval = %+v, executions=%d", denied, executions.Load())
	}

	allowed, err := h.Agents().Create(ctx, AgentOptions{
		ID: "allowed",
		Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
			_, err := h.Approvals().Register(run, func(_ context.Context, request ApprovalRequest) (ApprovalOutcome, error) {
				if request.CallID != "call-2" || request.ToolName != "guarded" {
					t.Fatalf("approval request = %+v", request)
				}
				return ApprovalAllowedOnce, nil
			})
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := allowed.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	granted, err := h.Tools().Execute(ctx, ToolRequest{Agent: allowed, CallID: "call-2", Name: "guarded", Arguments: json.RawMessage(`{}`)})
	if err != nil {
		t.Fatal(err)
	}
	if granted.Result.IsError || executions.Load() != 1 {
		t.Fatalf("granted approval = %+v, executions=%d", granted, executions.Load())
	}
	types := []string{}
	for _, event := range allowed.Session().Events() {
		if event.Type == "approval/asked" || event.Type == "approval/decided" {
			types = append(types, event.Type)
		}
	}
	if len(types) != 2 || types[0] != "approval/asked" || types[1] != "approval/decided" {
		t.Fatalf("approval events = %v", types)
	}
	if err := h.Dispose(ctx); err != nil && !errors.Is(err, ErrHarnessDisposalInProgress) {
		t.Fatal(err)
	}
	if err := h.Drain(ctx); err != nil {
		t.Fatal(err)
	}
}

func TestApprovalPolicyIsDurableUnbypassableAndSessionScoped(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{
		ApprovalPolicy: ApprovalNever,
		Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
			return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
		}),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	var consulted atomic.Int32
	agent, err := h.Agents().Create(ctx, AgentOptions{
		ID: "approval-policy",
		Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
			_, err := h.Approvals().Register(run, func(context.Context, ApprovalRequest) (ApprovalOutcome, error) {
				consulted.Add(1)
				return ApprovalAllowedOnce, nil
			})
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	outcome, err := h.Approvals().Request(ctx, ApprovalRequest{Agent: agent, ToolName: "bash"})
	if err != nil || outcome != ApprovalRejected || consulted.Load() != 0 {
		t.Fatalf("never outcome=%q consulted=%d error=%v", outcome, consulted.Load(), err)
	}
	if _, err := SetApprovalPolicy(agent.Session(), ApprovalAsk); err != nil {
		t.Fatal(err)
	}
	outcome, err = h.Approvals().Request(ctx, ApprovalRequest{Agent: agent, ToolName: "bash"})
	if err != nil || outcome != ApprovalAllowedOnce || consulted.Load() != 1 {
		t.Fatalf("ask override outcome=%q consulted=%d error=%v", outcome, consulted.Load(), err)
	}
	policy, found, err := ApprovalPolicyOverride(agent.Session().Events())
	if err != nil || !found || policy != ApprovalAsk {
		t.Fatalf("override=%q found=%v error=%v", policy, found, err)
	}
	system, err := h.Prompts().Assemble(ctx, agent)
	if err != nil || system != approvalAskPrompt {
		t.Fatalf("policy prompt=%q error=%v", system, err)
	}
	var audit []string
	for _, event := range agent.Session().Events() {
		if strings.HasPrefix(event.Type, "approval/") && event.Type != "approval/policy" {
			audit = append(audit, event.Type)
		}
	}
	if strings.Join(audit, ",") != "approval/asked,approval/decided,approval/asked,approval/decided" {
		t.Fatalf("approval audit=%v", audit)
	}
}

func TestApprovalRequestRequiresOpenTurnAndContainsAnswererFailures(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	agent, err := h.Agents().Create(ctx, AgentOptions{
		ID: "approval-contained",
		Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
			_, err := h.Approvals().Register(run, func(context.Context, ApprovalRequest) (ApprovalOutcome, error) {
				return ApprovalAllowedOnce, errors.New("answerer transport failed")
			})
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.Approvals().Request(ctx, ApprovalRequest{Agent: agent, ToolName: "guarded"}); err == nil {
		t.Fatal("approval outside an open turn succeeded")
	}
	if len(agent.Session().Events()) != 0 {
		t.Fatalf("outside-turn request appended events: %+v", agent.Session().Events())
	}
	if _, err := agent.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	outcome, err := h.Approvals().Request(ctx, ApprovalRequest{Agent: agent, ToolName: "guarded"})
	if err != nil || outcome != ApprovalUnavailable {
		t.Fatalf("contained outcome=%q error=%v", outcome, err)
	}
	if _, err := agent.Session().Append("turn/end", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.Approvals().Request(ctx, ApprovalRequest{Agent: agent, ToolName: "guarded"}); err == nil {
		t.Fatal("approval between turns succeeded")
	}
}

func TestApprovalAuditPairSurvivesPostCommitSubscriberPanics(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	agent, err := h.Agents().Create(ctx, AgentOptions{ID: "approval-subscriber-panic"})
	if err != nil {
		t.Fatal(err)
	}
	unsubscribe := agent.Session().Subscribe(func(Event) { panic("projection failed") })
	defer unsubscribe()
	if _, err := agent.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	outcome, err := h.Approvals().Request(ctx, ApprovalRequest{Agent: agent, ToolName: "guarded"})
	if err != nil || outcome != ApprovalUnavailable {
		t.Fatalf("outcome=%q error=%v", outcome, err)
	}
	var asked, decided int
	for _, event := range agent.Session().Events() {
		switch event.Type {
		case "approval/asked":
			asked++
		case "approval/decided":
			decided++
		}
	}
	if asked != 1 || decided != 1 {
		t.Fatalf("audit pair asked=%d decided=%d", asked, decided)
	}
}

func TestApprovalCancellationWinsAndLateAnswerIsDiscarded(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	answer := make(chan struct{})
	started := make(chan struct{})
	agent, err := h.Agents().Create(ctx, AgentOptions{
		ID: "approval-cancel",
		Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
			_, err := h.Approvals().Register(run, func(context.Context, ApprovalRequest) (ApprovalOutcome, error) {
				close(started)
				<-answer
				return ApprovalAllowedOnce, nil
			})
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	requestCtx, cancel := context.WithCancel(ctx)
	pending := make(chan ApprovalOutcome, 1)
	go func() {
		outcome, _ := h.Approvals().Request(requestCtx, ApprovalRequest{Agent: agent, ToolName: "guarded"})
		pending <- outcome
	}()
	<-started
	cancel()
	if outcome := <-pending; outcome != ApprovalCancelled {
		t.Fatalf("cancelled outcome=%q", outcome)
	}
	close(answer)
	var decided int
	for _, event := range agent.Session().Events() {
		if event.Type == "approval/decided" {
			decided++
		}
	}
	if decided != 1 {
		t.Fatalf("decided events=%d", decided)
	}
}

func TestApprovalPolicySwitchInjectsOneNextStepNotice(t *testing.T) {
	ctx := testContext(t)
	requests := make(chan GenerateRequest, 1)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(_ context.Context, request GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		requests <- request
		return Completion{Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "ok"}}}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	agent, err := h.Agents().Create(ctx, AgentOptions{ID: "approval-policy-notice"})
	if err != nil {
		t.Fatal(err)
	}
	if err := h.Approvals().SetPolicy(agent, ApprovalNever); err != nil {
		t.Fatal(err)
	}
	if err := h.Approvals().SetPolicy(agent, ApprovalNever); err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "continue"}}}); err != nil {
		t.Fatal(err)
	}
	request := <-requests
	if request.System != approvalNeverPrompt || len(request.Messages) != 2 {
		t.Fatalf("request=%+v", request)
	}
	if !strings.Contains(request.Messages[0].Content[0].Text, `changed from "ask" to "never"`) || request.Messages[1].Content[0].Text != "continue" {
		t.Fatalf("policy messages=%+v", request.Messages)
	}
	policyEvents := 0
	for _, event := range agent.Session().Events() {
		if event.Type == "approval/policy" {
			policyEvents++
		}
	}
	if policyEvents != 1 {
		t.Fatalf("policy events=%d", policyEvents)
	}
	if _, err := SetApprovalPolicy(agent.Session(), ApprovalPolicy("always")); err == nil {
		t.Fatal("invalid policy was accepted")
	}
}

func TestApprovalNeverRejectsGatedToolsUnderEverySandbox(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	var consulted, executions atomic.Int32
	toolInstance, err := h.RegisterTool(ctx, "approval/never-tool", Tool{
		Schema:           ToolSchema{Name: "guarded", InputSchema: json.RawMessage(`{"type":"object"}`)},
		RequiresApproval: true,
		Execute: func(context.Context, json.RawMessage) (ToolResult, error) {
			executions.Add(1)
			return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: "executed"}}}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer toolInstance.Dispose(context.Background())
	for _, mode := range []string{"", "read-only", "workspace-write", SandboxFullAccessMode} {
		t.Run("sandbox="+mode, func(t *testing.T) {
			agent, err := h.Agents().Create(ctx, AgentOptions{
				ID: SessionID("never-" + mode),
				Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
					_, err := h.Approvals().Register(run, func(context.Context, ApprovalRequest) (ApprovalOutcome, error) {
						consulted.Add(1)
						return ApprovalAllowedOnce, nil
					})
					return err
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			if mode != "" {
				if _, err := agent.Session().Append(SandboxModeEvent, map[string]string{"mode": mode}); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := SetApprovalPolicy(agent.Session(), ApprovalNever); err != nil {
				t.Fatal(err)
			}
			if _, err := agent.Session().Append("turn/start", map[string]int{"turn": 1}); err != nil {
				t.Fatal(err)
			}
			outcome, err := h.Approvals().Request(ctx, ApprovalRequest{Agent: agent, ToolName: "guarded"})
			if err != nil || outcome != ApprovalRejected {
				t.Fatalf("outcome=%q err=%v", outcome, err)
			}
			delegated, err := h.Approvals().Decide(ctx, ApprovalRequest{ID: "dsh-ask", Agent: agent, ToolName: "guarded"})
			if err != nil || delegated != ApprovalRejected {
				t.Fatalf("delegated=%q err=%v", delegated, err)
			}
			result, err := h.Tools().Execute(ctx, ToolRequest{Agent: agent, CallID: "never-call", Name: "guarded", Arguments: json.RawMessage(`{}`)})
			if err != nil || !result.Result.IsError {
				t.Fatalf("gated tool result=%+v err=%v", result, err)
			}
			cancelled, cancel := context.WithCancel(ctx)
			cancel()
			outcome, err = h.Approvals().Request(cancelled, ApprovalRequest{Agent: agent, ToolName: "guarded"})
			if err != nil || outcome != ApprovalCancelled {
				t.Fatalf("cancelled outcome=%q err=%v", outcome, err)
			}
			if prompt := approvalPolicyPrompt(ApprovalNever, agent.Session()); prompt != approvalNeverPrompt {
				t.Fatalf("prompt=%q", prompt)
			}
			var decisions []ApprovalOutcome
			for _, event := range agent.Session().Events() {
				if event.Type == "approval/decided" {
					var payload struct {
						Outcome ApprovalOutcome `json:"outcome"`
					}
					if err := json.Unmarshal(event.Data, &payload); err != nil {
						t.Fatal(err)
					}
					decisions = append(decisions, payload.Outcome)
				}
			}
			if len(decisions) != 3 || decisions[0] != ApprovalRejected || decisions[1] != ApprovalRejected || decisions[2] != ApprovalCancelled {
				t.Fatalf("durable decisions=%v", decisions)
			}
		})
	}
	if consulted.Load() != 0 || executions.Load() != 0 {
		t.Fatalf("never policy consulted answerers %d times and executed tools %d times", consulted.Load(), executions.Load())
	}
}

func TestApprovalNeverRejectsBrowserToolEvenUnderFullAccess(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(ctx)
	for mode, want := range map[string]ApprovalOutcome{"workspace-write": ApprovalRejected, SandboxFullAccessMode: ApprovalRejected} {
		agent, err := h.Agents().Create(ctx, AgentOptions{ID: SessionID("host-cap-" + mode)})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := agent.Session().Append(SandboxModeEvent, map[string]string{"mode": mode}); err != nil {
			t.Fatal(err)
		}
		if _, err := SetApprovalPolicy(agent.Session(), ApprovalNever); err != nil {
			t.Fatal(err)
		}
		got, err := h.Approvals().Decide(ctx, ApprovalRequest{ID: "ask", Agent: agent, ToolName: "browser_start"})
		if err != nil || got != want {
			t.Fatalf("%s: outcome=%q err=%v want %q", mode, got, err, want)
		}
	}
}

func TestApprovalDecideConsultsAnswerersWithoutAuditEvents(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	agent, err := h.Agents().Create(ctx, AgentOptions{
		ID: "delegated",
		Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
			_, err := h.Approvals().Register(run, func(_ context.Context, request ApprovalRequest) (ApprovalOutcome, error) {
				if request.ID != "dsh-ask-1" || request.CallID != "call-1" || request.Reason != "list apps" {
					t.Errorf("delegated request=%+v", request)
				}
				return ApprovalAllowedOnce, nil
			})
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	before := len(agent.Session().Events())
	outcome, err := h.Approvals().Decide(ctx, ApprovalRequest{
		ID: "dsh-ask-1", Agent: agent, CallID: "call-1", ToolName: "computer_list_apps", Reason: "list apps",
	})
	if err != nil || outcome != ApprovalAllowedOnce {
		t.Fatalf("outcome=%q err=%v", outcome, err)
	}
	if after := len(agent.Session().Events()); after != before {
		t.Fatalf("Decide appended %d events", after-before)
	}
	if _, err := h.Approvals().Decide(ctx, ApprovalRequest{Agent: agent, ToolName: "computer_list_apps"}); err == nil {
		t.Fatal("Decide accepted a request without the caller's audit id")
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	if outcome, _ := h.Approvals().Decide(cancelled, ApprovalRequest{ID: "dsh-ask-2", Agent: agent, ToolName: "x"}); outcome != ApprovalCancelled {
		t.Fatalf("cancelled outcome=%q", outcome)
	}
}

func TestApprovalRequestIDsRemainUniqueAcrossBrokerReplacement(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	agent, err := h.Agents().Create(ctx, AgentOptions{ID: "approval-restart"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().Append("turn/start", map[string]int{"turn": 1}); err != nil {
		t.Fatal(err)
	}
	// Replacing the broker must not reuse the first broker's durable request
	// identity. This is the same lifetime boundary encountered on resume.
	for range 2 {
		broker := NewApprovalBroker()
		if outcome, err := broker.Request(ctx, ApprovalRequest{Agent: agent, ToolName: "guarded"}); err != nil || outcome != ApprovalUnavailable {
			t.Fatalf("outcome=%q err=%v", outcome, err)
		}
	}
	asked := make(map[string]bool)
	decided := make(map[string]bool)
	for _, event := range agent.Session().Events() {
		if event.Type != "approval/asked" && event.Type != "approval/decided" {
			continue
		}
		var payload struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(event.Data, &payload); err != nil {
			t.Fatal(err)
		}
		if event.Type == "approval/asked" {
			if payload.ID == "" || asked[payload.ID] {
				t.Fatalf("reused approval identity %q", payload.ID)
			}
			asked[payload.ID] = true
		} else {
			if !asked[payload.ID] || decided[payload.ID] {
				t.Fatalf("unpaired approval decision %q", payload.ID)
			}
			decided[payload.ID] = true
		}
	}
	if len(asked) != 2 || len(decided) != 2 {
		t.Fatalf("audit identities asked=%v decided=%v", asked, decided)
	}
}

func TestNativeApprovalDescriptorComesFromValidatedRegistration(t *testing.T) {
	for _, tc := range []struct {
		name, args                                 string
		descriptorError                            bool
		wantDescriptors, wantApprovals, wantBodies int
	}{
		{"valid", `{"command":"pwd"}`, false, 1, 1, 1},
		{"invalid_arguments", `{"command":42}`, false, 0, 0, 0},
		{"confinement_unavailable", `{"command":"pwd"}`, true, 1, 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := testContext(t)
			h, err := Boot(ctx, Options{})
			if err != nil {
				t.Fatal(err)
			}
			defer h.Dispose(context.Background())
			descriptors, approvals, bodies := 0, 0, 0
			descriptor := &NativeApprovalDescriptor{Version: 1, Operation: "shell", Workspace: "/fixture", SandboxMode: "workspace-write", Enforcement: "required", Network: "deny"}
			_, err = h.RegisterTool(ctx, "native-fixture", Tool{Schema: ToolSchema{Name: "fixture", InputSchema: json.RawMessage(`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}`)}, RequiresApproval: true,
				ApprovalDescriptor: func(_ context.Context, req ToolRequest) (*NativeApprovalDescriptor, error) {
					descriptors++
					if tc.descriptorError {
						return nil, errors.New("confinement unavailable")
					}
					return descriptor, nil
				},
				Execute: func(context.Context, json.RawMessage) (ToolResult, error) { bodies++; return ToolResult{}, nil }})
			if err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(ctx, AgentOptions{ID: "native-descriptor", Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
				_, e := h.Approvals().Register(run, func(_ context.Context, r ApprovalRequest) (ApprovalOutcome, error) {
					approvals++
					if r.Native == nil || r.Native == descriptor || *r.Native != *descriptor {
						t.Fatalf("descriptor not detached: %+v", r.Native)
					}
					return ApprovalAllowedOnce, nil
				})
				return e
			}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = agent.Session().Append("turn/start", map[string]int{"turn": 1}); err != nil {
				t.Fatal(err)
			}
			_, err = h.Tools().Execute(ctx, ToolRequest{Agent: agent, CallID: "call", Name: "fixture", Arguments: json.RawMessage(tc.args)})
			if err != nil {
				t.Fatal(err)
			}
			if descriptors != tc.wantDescriptors || approvals != tc.wantApprovals || bodies != tc.wantBodies {
				t.Fatalf("counts descriptor=%d approval=%d body=%d", descriptors, approvals, bodies)
			}
		})
	}
}
