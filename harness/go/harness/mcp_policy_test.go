package harness

import (
	"context"
	"encoding/json"
	"net"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestMCPToolPolicyExecution(t *testing.T) {
	for _, row := range []struct {
		name                     string
		decision                 harnessmcp.ToolDecision
		readOnly                 bool
		approval                 ApprovalOutcome
		wantCalls, wantApprovals int32
	}{
		{"allow obeys auto review", harnessmcp.ToolAllow, false, ApprovalAllowedOnce, 1, 0},
		{"deny ignores read hint", harnessmcp.ToolDeny, true, ApprovalAllowedOnce, 0, 0},
		{"ask allows", harnessmcp.ToolAsk, true, ApprovalAllowedOnce, 1, 1},
		{"ask rejects", harnessmcp.ToolAsk, true, ApprovalRejected, 0, 1},
		{"ask cancels", harnessmcp.ToolAsk, true, ApprovalCancelled, 0, 1},
		{"ask unavailable", harnessmcp.ToolAsk, true, ApprovalUnavailable, 0, 1},
	} {
		t.Run(row.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			var calls, approvals atomic.Int32
			server := mcp.NewServer(&mcp.Implementation{Name: "policy-fixture", Version: "1"}, nil)
			server.AddTool(&mcp.Tool{Name: "action", InputSchema: map[string]any{"type": "object"}, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: row.readOnly}}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				calls.Add(1)
				return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "executed"}}}, nil
			})
			clientTransport, serverTransport := mcp.NewInMemoryTransports()
			connected, err := server.Connect(ctx, serverTransport, nil)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = connected.Close() })
			h := retirementHarness(t)
			policy := &harnessmcp.ToolPolicy{Default: harnessmcp.ToolDeny, Tools: map[string]harnessmcp.ToolDecision{"action": row.decision}}
			agent, err := h.Agents().Create(ctx, AgentOptions{ID: "mcp-policy", Configure: func(ctx context.Context, run *point.Run, _ *Agent) error {
				if _, err := h.Approvals().Register(run, func(_ context.Context, request ApprovalRequest) (ApprovalOutcome, error) {
					approvals.Add(1)
					if row.decision == harnessmcp.ToolAsk && !request.AlwaysAsk {
						t.Error("explicit ask did not reach mandatory approval")
					}
					return row.approval, nil
				}); err != nil {
					return err
				}
				return MountMCPServers(ctx, run, h.Tools(), h.Prompts(), []MCPServerConfig{{Name: "fixture", TestTransport: clientTransport, FailOnStartupError: true, ToolPolicy: policy}})
			}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := agent.Session().Append("turn/start", struct {
				Turn int `json:"turn"`
			}{Turn: 1}); err != nil {
				t.Fatal(err)
			}
			if _, err := SetPermissionMode(agent.Session(), PermissionAutoReview); err != nil {
				t.Fatal(err)
			}
			// Saved configuration edits must not alter an admitted session policy.
			policy.Tools["action"] = harnessmcp.ToolAllow
			policy.Default = harnessmcp.ToolAllow
			out, err := h.Tools().Execute(ctx, ToolRequest{Agent: agent, CallID: "call", Preapproved: true, RequestApproval: row.decision == harnessmcp.ToolDeny, Name: PublicMCPToolName("fixture", "action"), Arguments: json.RawMessage(`{}`)})
			if err != nil {
				t.Fatal(err)
			}
			if got := calls.Load(); got != row.wantCalls {
				t.Fatalf("server calls=%d, want %d", got, row.wantCalls)
			}
			if got := approvals.Load(); got != row.wantApprovals {
				t.Fatalf("approvals=%d, want %d", got, row.wantApprovals)
			}
			if out.Result.IsError != (row.wantCalls == 0) {
				t.Fatalf("result=%+v", out.Result)
			}
			server.AddTool(&mcp.Tool{Name: "new_action", InputSchema: map[string]any{"type": "object"}, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				calls.Add(1)
				return &mcp.CallToolResult{}, nil
			})
			waitForFixtureTools(t, ctx, h.Tools(), agent.Scope(), map[string]string{PublicMCPToolName("fixture", "action"): "", PublicMCPToolName("fixture", "new_action"): ""})
			out, err = h.Tools().Execute(ctx, ToolRequest{Agent: agent, CallID: "new-call", Name: PublicMCPToolName("fixture", "new_action"), Arguments: json.RawMessage(`{}`)})
			if err != nil || !out.Result.IsError || calls.Load() != row.wantCalls {
				t.Fatalf("new-generation default denial: %+v %v calls=%d", out, err, calls.Load())
			}
			if err := h.Approvals().SetPolicy(agent, ApprovalNever); err != nil {
				t.Fatal(err)
			}
			out, err = h.Tools().Execute(ctx, ToolRequest{Agent: agent, CallID: "never-call", Name: PublicMCPToolName("fixture", "action"), Arguments: json.RawMessage(`{}`)})
			if err != nil || !out.Result.IsError || calls.Load() != row.wantCalls {
				t.Fatalf("never policy: %+v %v calls=%d", out, err, calls.Load())
			}

		})
	}
}

// Same configured name is scoped to its Agent, including after a real transport
// disconnection. Reconnection replaces tools but never replays business calls.
func TestMCPPolicyReconnectIsolation(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	h := retirementHarness(t)
	type mounted struct {
		agent        *Agent
		calls        *atomic.Int32
		sessions     chan net.Conn
		observations chan MCPConnectionObservation
	}
	var mounts []mounted
	for _, decision := range []harnessmcp.ToolDecision{harnessmcp.ToolAllow, harnessmcp.ToolDeny} {
		calls := &atomic.Int32{}
		sessions := make(chan net.Conn, 4)
		observations := make(chan MCPConnectionObservation, 16)
		policy := &harnessmcp.ToolPolicy{Default: decision}
		agent, err := h.Agents().Create(ctx, AgentOptions{ID: SessionID("policy-" + string(decision)), Configure: func(ctx context.Context, run *point.Run, _ *Agent) error {
			return MountMCPServers(ctx, run, h.Tools(), h.Prompts(), []MCPServerConfig{{Name: "same-server", ToolPolicy: policy, FailOnStartupError: true,
				Reconnect: &MCPReconnectConfig{InitialDelayMS: 1, MaxDelayMS: 1, MaxAttempts: 2},
				Observe:   func(value MCPConnectionObservation) { observations <- value },
				testTransportFactory: func() (mcp.Transport, error) {
					server := mcp.NewServer(&mcp.Implementation{Name: "same-server", Version: "1"}, nil)
					server.AddTool(&mcp.Tool{Name: "action", InputSchema: map[string]any{"type": "object"}, Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true}}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
						calls.Add(1)
						return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: "done"}}}, nil
					})
					clientPipe, serverPipe := net.Pipe()
					clientTransport := &mcp.IOTransport{Reader: clientPipe, Writer: clientPipe}
					serverTransport := &mcp.IOTransport{Reader: serverPipe, Writer: serverPipe}
					connected, err := server.Connect(run.Context, serverTransport, nil)
					if err != nil {
						return nil, err
					}
					t.Cleanup(func() { _ = serverPipe.Close(); _ = clientPipe.Close(); _ = connected.Close() })
					sessions <- serverPipe
					return clientTransport, nil
				},
			}})
		}})
		if err != nil {
			t.Fatal(err)
		}
		// Mutate caller data; a reconnect must retain the admitted decision.
		if decision == harnessmcp.ToolAllow {
			policy.Default = harnessmcp.ToolDeny
		} else {
			policy.Default = harnessmcp.ToolAllow
		}
		mounts = append(mounts, mounted{agent, calls, sessions, observations})
	}
	call := func(index int, phase string) {
		t.Helper()
		m := mounts[index]
		out, err := h.Tools().Execute(ctx, ToolRequest{Agent: m.agent, CallID: ToolCallID(phase), Name: PublicMCPToolName("same-server", "action"), Arguments: json.RawMessage(`{}`)})
		if err != nil || out.Result.IsError != (index == 1) {
			t.Fatalf("%s agent %d: %+v %v", phase, index, out, err)
		}
	}
	for index, m := range mounts {
		call(index, "initial")
		first := <-m.sessions
		if err := first.Close(); err != nil {
			t.Fatal(err)
		}
		for {
			select {
			case observed := <-m.observations:
				if observed.Generation == 2 && observed.Status == harnessmcp.ConnectionConnected {
					goto reconnected
				}
			case <-ctx.Done():
				t.Fatal("reconnect did not settle", ctx.Err())
			}
		}
	reconnected:
		want := int32(0)
		if index == 0 {
			want = 1
		}
		if m.calls.Load() != want {
			t.Fatalf("reconnect replayed a call: %d", m.calls.Load())
		}
	}
	// Both second generations coexist under the same public name.
	call(0, "after-reconnect")
	call(1, "after-reconnect")
	if mounts[0].calls.Load() != 2 || mounts[1].calls.Load() != 0 {
		t.Fatalf("cross-session policy/call leakage: allow=%d deny=%d", mounts[0].calls.Load(), mounts[1].calls.Load())
	}
}
