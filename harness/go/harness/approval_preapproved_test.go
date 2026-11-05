package harness

import (
	"context"
	"encoding/json"
	"sync/atomic"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestExplicitAskOverridesToolPreapproval(t *testing.T) {
	for _, forced := range []bool{false, true} {
		t.Run(map[bool]string{false: "grant", true: "explicit ask"}[forced], func(t *testing.T) {
			h, err := Boot(t.Context(), Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
				return Completion{}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
			var consulted, executed atomic.Int32
			_, err = h.RegisterTool(t.Context(), "preapproval/write", Tool{
				Schema: ToolSchema{Name: "Write", InputSchema: json.RawMessage(`{"type":"object"}`)}, RequiresApproval: true,
				Execute: func(context.Context, json.RawMessage) (ToolResult, error) { executed.Add(1); return ToolResult{}, nil },
			})
			if err != nil {
				t.Fatal(err)
			}
			agent, err := h.Agents().Create(t.Context(), AgentOptions{Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
				_, err := h.Approvals().Register(run, func(context.Context, ApprovalRequest) (ApprovalOutcome, error) {
					consulted.Add(1)
					return ApprovalRejected, nil
				})
				return err
			}})
			if err != nil {
				t.Fatal(err)
			}
			_, err = agent.Session().Append("turn/start", struct {
				Turn int `json:"turn"`
			}{1})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := SetPermissionMode(agent.Session(), PermissionAutoReview); err != nil {
				t.Fatal(err)
			}
			outcome, err := h.Tools().Execute(t.Context(), ToolRequest{Agent: agent, CallID: "write", Name: "Write", Arguments: json.RawMessage(`{}`), Preapproved: true, RequestApproval: forced})
			if err != nil || outcome.Result.IsError != forced || consulted.Load() != map[bool]int32{false: 0, true: 1}[forced] || executed.Load() != map[bool]int32{false: 1, true: 0}[forced] {
				t.Fatalf("error=%v result=%+v answerers=%d executions=%d", err, outcome.Result, consulted.Load(), executed.Load())
			}
		})
	}
}
