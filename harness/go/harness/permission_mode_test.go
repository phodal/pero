package harness

import (
	"context"
	"sync/atomic"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestPermissionModeDecidesApproval(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	for _, row := range []struct {
		name, mode, tool, operation string
		never                       bool
		want                        ApprovalOutcome
		consulted                   int32
	}{
		{name: "unset-asks", tool: "write_file", want: ApprovalAllowedOnce, consulted: 1},
		{name: "auto-review-allows-shell", mode: "auto-review", tool: "shell", operation: "shell", want: ApprovalAllowedOnce},
		{name: "read-only-rejects-writes", mode: "read-only", tool: "write_file", want: ApprovalRejected},
		{name: "workspace-asks-for-files", mode: "workspace-write", tool: "write_file", want: ApprovalAllowedOnce, consulted: 1},
		{name: "workspace-rejects-shell", mode: "workspace-write", tool: "shell", want: ApprovalRejected},
		{name: "workspace-rejects-native-shell", mode: "workspace-write", tool: "run", operation: "shell", want: ApprovalRejected},
		{name: "full-access-asks", mode: "full-access", tool: "shell", want: ApprovalAllowedOnce, consulted: 1},
		{name: "never-rejects-auto-review", mode: "auto-review", tool: "shell", never: true, want: ApprovalRejected},
		{name: "invalid-mode-rejects", mode: "nope", tool: "write_file", want: ApprovalRejected},
	} {
		t.Run(row.name, func(t *testing.T) {
			var consulted atomic.Int32
			agent, err := h.Agents().Create(ctx, AgentOptions{
				ID: SessionID("permission-" + row.name),
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
			switch row.mode {
			case "":
			case "nope":
				if _, err := agent.Session().Append("permission/preset", map[string]string{"mode": "nope"}); err != nil {
					t.Fatal(err)
				}
			default:
				if _, err := SetPermissionMode(agent.Session(), PermissionMode(row.mode)); err != nil {
					t.Fatal(err)
				}
			}
			if row.never {
				if err := h.Approvals().SetPolicy(agent, ApprovalNever); err != nil {
					t.Fatal(err)
				}
			}
			request := ApprovalRequest{Agent: agent, ToolName: row.tool}
			if row.operation != "" {
				request.Native = &NativeApprovalDescriptor{Operation: row.operation}
			}
			outcome, err := h.Approvals().Request(ctx, request)
			if err != nil || outcome != row.want || consulted.Load() != row.consulted {
				t.Fatalf("outcome=%q consulted=%d error=%v", outcome, consulted.Load(), err)
			}
		})
	}
}

func TestPermissionModePromptFollowsTheRecordedMode(t *testing.T) {
	session := NewSession("permission-prompt", "")
	if approvalPolicyPrompt(ApprovalAsk, session) != approvalAskPrompt {
		t.Fatal(approvalPolicyPrompt(ApprovalAsk, session))
	}
	if _, err := SetPermissionMode(session, PermissionAutoReview); err != nil {
		t.Fatal(err)
	}
	if approvalPolicyPrompt(ApprovalAsk, session) != permissionModePrompt(PermissionAutoReview) {
		t.Fatal(approvalPolicyPrompt(ApprovalAsk, session))
	}
	if approvalPolicyPrompt(ApprovalNever, session) != approvalNeverPrompt {
		t.Fatal("never policy must stay fail-closed in the prompt")
	}
	if _, err := SetPermissionMode(session, PermissionMode("auto")); err == nil {
		t.Fatal("accepted an unadvertised mode")
	}
}
