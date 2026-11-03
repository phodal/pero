package harness

import (
	"context"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	point "github.com/phodal/pero/harness/go/runtime"
)

// tools/list_changed must replace the registered MCP generation. The server
// fixture speaks the SDK's in-memory transport; no subprocess or network.
func TestMCPToolListChangedUpdatesRegisteredTools(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()

	server := mcp.NewServer(&mcp.Implementation{Name: "list-changed-fixture", Version: "1"}, nil)
	add := func(name, description string) {
		t.Helper()
		server.AddTool(&mcp.Tool{Name: name, Description: description, InputSchema: map[string]any{"type": "object"}}, nil)
	}
	add("alpha", "first")
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	session, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })

	h := retirementHarness(t)
	agent, err := h.Agents().Create(ctx, AgentOptions{ID: "mcp-list-changed", Configure: func(ctx context.Context, run *point.Run, _ *Agent) error {
		return MountMCPServers(ctx, run, h.Tools(), h.Prompts(), []MCPServerConfig{{
			Name: "fixture", TestTransport: clientTransport, FailOnStartupError: true,
		}})
	}})
	if err != nil {
		t.Fatal(err)
	}

	alpha := PublicMCPToolName("fixture", "alpha")
	beta := PublicMCPToolName("fixture", "beta")
	assertFixtureTools(t, h.Tools(), agent.Scope(), map[string]string{alpha: "first"})

	add("beta", "second")
	waitForFixtureTools(t, ctx, h.Tools(), agent.Scope(), map[string]string{alpha: "first", beta: "second"})

	server.RemoveTools("alpha")
	waitForFixtureTools(t, ctx, h.Tools(), agent.Scope(), map[string]string{beta: "second"})

	add("beta", "revised")
	waitForFixtureTools(t, ctx, h.Tools(), agent.Scope(), map[string]string{beta: "revised"})
	if _, ok := h.Tools().Resolve(agent.Scope(), alpha); ok {
		t.Fatal("removed MCP tool stayed registered")
	}
	if _, ok := h.Tools().Resolve(agent.Scope(), beta); !ok {
		t.Fatal("updated MCP tool was not registered")
	}
}

func TestMCPResourceGuidanceMatchesAgentTools(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	const instructions = "Use fixture documentation."
	server := mcp.NewServer(&mcp.Implementation{Name: "guidance-fixture", Version: "1"}, &mcp.ServerOptions{Instructions: instructions})
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	session, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	adapter := &scriptedAdapter{responses: []Completion{
		{Message: Message{Role: RoleAssistant}, Finish: FinishStop},
		{Message: Message{Role: RoleAssistant}, Finish: FinishStop},
		{Message: Message{Role: RoleAssistant}, Finish: FinishStop},
		{Message: Message{Role: RoleAssistant}, Finish: FinishStop},
	}}
	h, err := Boot(ctx, Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()) })
	root, err := h.Agents().Create(ctx, AgentOptions{ID: "mcp-guidance-root", Configure: func(ctx context.Context, run *point.Run, _ *Agent) error {
		return MountMCPServers(ctx, run, h.Tools(), h.Prompts(), []MCPServerConfig{{Name: "fixture", TestTransport: clientTransport, FailOnStartupError: true}})
	}})
	if err != nil {
		t.Fatal(err)
	}
	all := []string{"get_mcp_prompt", "list_mcp_prompts", "list_mcp_resource_templates", "list_mcp_resources", "read_mcp_resource"}
	for _, tc := range []struct {
		name  string
		allow []string
		strip bool
	}{
		{name: "root", allow: all},
		{name: "read-only child", allow: []string{"read_mcp_resource"}},
		{name: "child without MCP tools", allow: []string{}},
		{name: "request middleware strips tools", allow: all, strip: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			agent := root
			if tc.name != "root" {
				agent, err = h.Agents().Create(ctx, AgentOptions{Parent: root, Configure: func(ctx context.Context, run *point.Run, child *Agent) error {
					_, err := h.Tools().Restrict(ctx, run, child, ToolRestriction{Allow: tc.allow})
					if err == nil && tc.strip {
						_, err = h.Hooks().Request.Use(run, func(ctx context.Context, value GenerateRequest, next point.Next[GenerateRequest]) (GenerateRequest, error) {
							value, err := next(value)
							value.Tools = []ToolSchema{}
							return value, err
						})
					}
					return err
				}})
				if err != nil {
					t.Fatal(err)
				}
			}
			if _, err := agent.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "Describe the available documentation."}}}); err != nil {
				t.Fatal(err)
			}
			adapter.mu.Lock()
			request := adapter.requests[len(adapter.requests)-1]
			adapter.mu.Unlock()
			gotNames := make([]string, 0, len(request.Tools))
			for _, tool := range request.Tools {
				gotNames = append(gotNames, tool.Name)
			}
			want := tc.allow
			if tc.strip {
				want = []string{}
			}
			if !reflect.DeepEqual(gotNames, want) {
				t.Fatalf("provider tools = %v, want %v", gotNames, want)
			}
			for _, name := range all {
				visible := false
				for _, allowed := range want {
					visible = visible || allowed == name
				}
				if strings.Contains(request.System, name) != visible {
					t.Fatalf("provider guidance for %q does not match tool visibility: %s", name, request.System)
				}
			}
			for _, text := range []string{"## MCP resource servers", instructions} {
				if strings.Contains(request.System, text) != (len(want) > 0) {
					t.Fatalf("provider guidance %q must follow resource tool visibility: %s", text, request.System)
				}
			}
		})
	}
}

func fixtureMCPTools(registry *ToolRegistry, scope *point.Scope, prefix string) map[string]string {
	got := map[string]string{}
	for _, schema := range registry.Schemas(scope) {
		if strings.HasPrefix(schema.Name, prefix) {
			got[schema.Name] = schema.Description
		}
	}
	return got
}

func assertFixtureTools(t *testing.T, registry *ToolRegistry, scope *point.Scope, want map[string]string) {
	t.Helper()
	if got := fixtureMCPTools(registry, scope, "mcp__fixture__"); !reflect.DeepEqual(got, want) {
		t.Fatalf("registered MCP tools = %#v, want %#v", got, want)
	}
}

func waitForFixtureTools(t *testing.T, ctx context.Context, registry *ToolRegistry, scope *point.Scope, want map[string]string) {
	t.Helper()
	deadline, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		if got := fixtureMCPTools(registry, scope, "mcp__fixture__"); reflect.DeepEqual(got, want) {
			return
		}
		select {
		case <-deadline.Done():
			t.Fatalf("registered MCP tools = %#v, want %#v", fixtureMCPTools(registry, scope, "mcp__fixture__"), want)
		case <-ticker.C:
		}
	}
}
