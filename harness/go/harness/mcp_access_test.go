package harness

import (
	"context"
	"encoding/json"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	harnessmcp "github.com/phodal/pero/harness/go/mcp"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestMCPSessionAppPolicyAndBinding(t *testing.T) {
	for _, row := range []struct {
		name             string
		decision         harnessmcp.ToolDecision
		approval         ApprovalOutcome
		calls, approvals int32
	}{
		{"allow", harnessmcp.ToolAllow, ApprovalAllowedOnce, 1, 0},
		{"deny", harnessmcp.ToolDeny, ApprovalAllowedOnce, 0, 0},
		{"ask approved", harnessmcp.ToolAsk, ApprovalAllowedOnce, 1, 1},
		{"ask rejected", harnessmcp.ToolAsk, ApprovalRejected, 0, 1},
		{"ask cancelled", harnessmcp.ToolAsk, ApprovalCancelled, 0, 1},
	} {
		t.Run(row.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			var calls, approvals atomic.Int32
			var access *MCPAccess
			var closeWhileApproving string
			waitApprovals := false
			entered := make(chan string, 2)
			release := make(chan struct{})
			server := sdk.NewServer(&sdk.Implementation{Name: "app-fixture", Version: "1"}, nil)
			for _, name := range []string{"open", "action", "model_only", "other"} {
				visibility := []string{"app"}
				uri := ""
				if name == "open" {
					visibility = append(visibility, "model")
					uri = "ui://fixture/app"
				}
				if name == "model_only" {
					visibility = []string{"model"}
				}
				if name == "other" {
					uri = "ui://other/app"
				}
				server.AddTool(&sdk.Tool{Name: name, InputSchema: map[string]any{"type": "object"}, Annotations: &sdk.ToolAnnotations{ReadOnlyHint: true}, Meta: sdk.Meta{"ui": map[string]any{"visibility": visibility, "resourceUri": uri}}}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
					calls.Add(1)
					return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "ok"}}, Meta: sdk.Meta{"view_only": "private app result"}}, nil
				})
			}
			server.AddResource(&sdk.Resource{URI: "ui://fixture/app", Name: "app", MIMEType: "text/html;profile=mcp-app"}, func(context.Context, *sdk.ReadResourceRequest) (*sdk.ReadResourceResult, error) {
				return &sdk.ReadResourceResult{Contents: []*sdk.ResourceContents{{URI: "ui://fixture/app", MIMEType: "text/html;profile=mcp-app", Text: "<p>Fixture</p>"}}}, nil
			})
			ct, st := sdk.NewInMemoryTransports()
			ss, err := server.Connect(ctx, st, nil)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = ss.Close() })
			h := retirementHarness(t)
			agent, err := h.Agents().Create(ctx, AgentOptions{ID: "app", Configure: func(ctx context.Context, run *point.Run, owner *Agent) error {
				if _, err := h.Approvals().Register(run, func(approvalCtx context.Context, approval ApprovalRequest) (ApprovalOutcome, error) {
					approvals.Add(1)
					binding := MCPApprovalBinding(approvalCtx, approval)
					if binding == "" {
						t.Error("App approval has no exact binding")
					}
					wrong := approval
					wrong.CallID = "unrelated"
					if MCPApprovalBinding(approvalCtx, wrong) != "" {
						t.Error("binding receipt escaped its exact call")
					}
					if waitApprovals {
						entered <- binding
						select {
						case <-approvalCtx.Done():
						case <-release:
						}
						return ApprovalAllowedOnce, nil
					}
					if closeWhileApproving != "" {
						_, err := access.Request(ctx, MCPSessionRequest{Action: "close", Binding: closeWhileApproving})
						if err != nil {
							return ApprovalUnavailable, err
						}
					}
					return row.approval, nil
				}); err != nil {
					return err
				}
				return MountAgentMCPServers(ctx, run, h.Tools(), h.Prompts(), owner, []MCPServerConfig{{Name: "Fixture original", TestTransport: ct, FailOnStartupError: true, ToolPolicy: &harnessmcp.ToolPolicy{Default: row.decision}}})
			}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err = SetPermissionMode(agent.Session(), PermissionAutoReview); err != nil {
				t.Fatal(err)
			}
			access = agent.MCPAccess()
			list, err := access.Request(ctx, MCPSessionRequest{Action: "list"})
			if err != nil || !strings.Contains(string(list), `"name":"Fixture original"`) {
				t.Fatalf("list %s %v", list, err)
			}
			schemas, err := h.Tools().SchemasForAgent(ctx, agent)
			if err != nil {
				t.Fatal(err)
			}
			for _, schema := range schemas {
				if schema.Name == PublicMCPToolName(normalizeMCPServerName("Fixture original"), "action") {
					t.Fatal("app-only tool entered model catalog")
				}
			}
			for _, action := range []string{"resources", "read"} {
				if _, err = access.Request(ctx, MCPSessionRequest{Action: action, Server: "Fixture original", Generation: 1, URI: "ui://fixture/app"}); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = access.Request(ctx, MCPSessionRequest{Action: "read", Server: "Fixture original", Generation: 2, URI: "ui://fixture/app"}); err == nil {
				t.Fatal("stale generation accepted")
			}
			if _, err := access.Request(ctx, MCPSessionRequest{Action: "open", Server: "Fixture original", Generation: 1, Name: "open"}); err == nil {
				t.Fatal("legacy open admitted")
			}
			if _, err := access.Request(ctx, MCPSessionRequest{Action: "prepare", Server: "Fixture original", Generation: 1, Name: "open", Arguments: json.RawMessage(`{}`)}); err == nil {
				t.Fatal("prepare accepted business arguments")
			}
			prepared, err := access.Request(ctx, MCPSessionRequest{Action: "prepare", Server: "Fixture original", Generation: 1, Name: "open"})
			if err != nil {
				t.Fatal(err)
			}
			var opened struct {
				Binding string `json:"binding"`
			}
			if json.Unmarshal(prepared, &opened) != nil || opened.Binding == "" {
				t.Fatal(string(prepared))
			}
			if calls.Load() != 0 || approvals.Load() != 0 {
				t.Fatal("prepare executed or requested approval")
			}
			result, err := access.Request(ctx, MCPSessionRequest{Action: "tool", Binding: opened.Binding, Name: "open", Arguments: json.RawMessage(`{}`)})
			if calls.Load() != row.calls || approvals.Load() != row.approvals {
				t.Fatalf("calls=%d approvals=%d err=%v", calls.Load(), approvals.Load(), err)
			}
			if row.calls == 0 {
				if err == nil {
					t.Fatal("denial succeeded")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(result), "private app result") {
				t.Fatalf("App-only result metadata missing: %s", result)
			}
			for _, name := range []string{"model_only", "other"} {
				if _, err = access.Request(ctx, MCPSessionRequest{Action: "tool", Binding: opened.Binding, Name: name}); err == nil {
					t.Fatalf("%s was admitted", name)
				}
			}
			if _, err = access.Request(ctx, MCPSessionRequest{Action: "resource", Binding: opened.Binding, URI: "ui://other/app"}); err == nil {
				t.Fatal("cross-resource accepted")
			}
			if _, err = access.Request(ctx, MCPSessionRequest{Action: "tool", Binding: opened.Binding, Name: "action"}); err != nil {
				t.Fatal(err)
			}
			if calls.Load() != 2*row.calls || approvals.Load() != 2*row.approvals {
				t.Fatalf("interactive calls=%d approvals=%d", calls.Load(), approvals.Load())
			}
			if row.decision == harnessmcp.ToolAsk {
				closeWhileApproving = opened.Binding
				if _, err = access.Request(ctx, MCPSessionRequest{Action: "tool", Binding: opened.Binding, Name: "action"}); err == nil {
					t.Fatal("closed during approval dispatched")
				}
				if calls.Load() != 2 {
					t.Fatal("closed binding reached server")
				}
			}
			if row.decision == harnessmcp.ToolAsk {
				closeWhileApproving = ""
				prepare := func() string {
					t.Helper()
					raw, err := access.Request(ctx, MCPSessionRequest{Action: "prepare", Server: "Fixture original", Generation: 1, Name: "open"})
					if err != nil {
						t.Fatal(err)
					}
					var value struct {
						Binding string `json:"binding"`
					}
					if err = json.Unmarshal(raw, &value); err != nil {
						t.Fatal(err)
					}
					return value.Binding
				}
				first, second := prepare(), prepare()
				waitApprovals = true
				invoke := func(binding string) <-chan error {
					done := make(chan error, 1)
					go func() {
						_, err := access.Request(ctx, MCPSessionRequest{Action: "tool", Binding: binding, Name: "action"})
						done <- err
					}()
					return done
				}
				firstDone, secondDone := invoke(first), invoke(second)
				seen := map[string]bool{}
				for range 2 {
					select {
					case binding := <-entered:
						seen[binding] = true
					case <-ctx.Done():
						t.Fatal(ctx.Err())
					}
				}
				if !seen[first] || !seen[second] {
					t.Fatalf("wrong approval bindings: %v", seen)
				}
				if _, err := access.Request(ctx, MCPSessionRequest{Action: "close", Binding: first}); err != nil {
					t.Fatal(err)
				}
				select {
				case err := <-firstDone:
					if err == nil {
						t.Fatal("late allow executed closed binding")
					}
				case <-ctx.Done():
					t.Fatal("close did not promptly cancel bound approval")
				}
				select {
				case err := <-secondDone:
					t.Fatalf("other binding cancelled: %v", err)
				default:
				}
				if calls.Load() != 2 {
					t.Fatal("cancelled approval reached server")
				}
				close(release)
				select {
				case err := <-secondDone:
					if err != nil {
						t.Fatal(err)
					}
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				}
				if calls.Load() != 3 {
					t.Fatal("unrelated binding did not execute exactly once")
				}
			}
			if _, err = access.Request(ctx, MCPSessionRequest{Action: "close", Binding: opened.Binding}); err != nil {
				t.Fatal(err)
			}
			if _, err = access.Request(ctx, MCPSessionRequest{Action: "tool", Binding: opened.Binding, Name: "action"}); err == nil {
				t.Fatal("closed binding accepted")
			}
		})
	}
}
