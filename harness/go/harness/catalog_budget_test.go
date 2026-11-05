package harness

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestAdmittedCatalogsShareBudgetAndRecoverMCPInstructions(t *testing.T) {
	adapter := &scriptedAdapter{responses: []Completion{{Message: Message{Role: RoleAssistant}, Finish: FinishStop}}}
	h, err := Boot(t.Context(), Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
	for _, name := range []string{"skill", "Agent"} {
		catalog := &CatalogText{Header: "Available " + name + ":", RecoveryTool: name, Continuation: "Call " + name + " to page the complete catalog."}
		for index := range 250 {
			catalog.Rows = append(catalog.Rows, fmt.Sprintf(`{"name":"item-%03d","description":"%s"}`, index, strings.Repeat("metadata ", 40)))
		}
		_, err := h.RegisterTool(t.Context(), "budget/"+name, Tool{Schema: ToolSchema{Name: name, Catalog: catalog, InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (ToolResult, error) { return ToolResult{}, nil }})
		if err != nil {
			t.Fatal(err)
		}
	}
	var configs []MCPServerConfig
	text := strings.Repeat("Initialize guidance 界.\n", 900)
	for index := range 4 {
		name := fmt.Sprintf("docs-%d", index)
		server := mcp.NewServer(&mcp.Implementation{Name: name, Version: "1"}, &mcp.ServerOptions{Instructions: text})
		clientTransport, serverTransport := mcp.NewInMemoryTransports()
		session, err := server.Connect(t.Context(), serverTransport, nil)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = session.Close() })
		configs = append(configs, MCPServerConfig{Name: name, TestTransport: clientTransport, FailOnStartupError: true})
	}
	agent, err := h.Agents().Create(t.Context(), AgentOptions{ID: "shared-budget", Configure: func(ctx context.Context, run *point.Run, _ *Agent) error {
		return MountMCPServers(ctx, run, h.Tools(), h.Prompts(), configs)
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Prompt(t.Context(), Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "Inspect available workflows."}}}); err != nil {
		t.Fatal(err)
	}
	request := adapter.requests[0]
	presentation, err := h.Prompts().AssemblePresentation(t.Context(), agent)
	if err != nil {
		t.Fatal(err)
	}
	defer presentation.Release(context.Background())
	guidance, err := presentation.Guidance(t.Context(), PromptCapabilities{Tools: request.Tools})
	if err != nil {
		t.Fatal(err)
	}
	total := len(guidance)
	for _, schema := range request.Tools {
		if schema.Catalog != nil {
			total += len(schema.Description)
		}
	}
	if total > DefaultCatalogBytes {
		t.Fatalf("shared catalog bytes=%d, max=%d", total, DefaultCatalogBytes)
	}
	if !strings.Contains(guidance, "omitted") || !strings.Contains(guidance, "read_mcp_instructions") {
		t.Fatal(guidance)
	}
	call := func(input string) string {
		out, err := h.Tools().Execute(t.Context(), ToolRequest{Agent: agent, Name: "read_mcp_instructions", CallID: "instruction-read", Arguments: json.RawMessage(input)})
		if err != nil || out.Result.IsError {
			t.Fatalf("read: %+v %v", out.Result, err)
		}
		return out.Result.Content[0].Text
	}
	var servers struct {
		Items []struct {
			Name string `json:"name"`
		} `json:"items"`
		NextOffset *int `json:"next_offset"`
	}
	if err := json.Unmarshal([]byte(call(`{"limit":1}`)), &servers); err != nil || len(servers.Items) != 1 || servers.Items[0].Name != "docs-0" || servers.NextOffset == nil {
		t.Fatalf("servers=%+v %v", servers, err)
	}
	var recovered strings.Builder
	for offset := 0; ; {
		encoded := call(fmt.Sprintf(`{"server":"docs-3","offset":%d}`, offset))
		if len(encoded) > DefaultCatalogPageBytes {
			t.Fatal("unbounded instruction page")
		}
		var page struct {
			Server     string `json:"server"`
			Text       string `json:"text"`
			NextOffset *int   `json:"next_offset"`
		}
		if err := json.Unmarshal([]byte(encoded), &page); err != nil || page.Server != "docs-3" {
			t.Fatalf("page=%+v %v", page, err)
		}
		recovered.WriteString(page.Text)
		if page.NextOffset == nil {
			break
		}
		offset = *page.NextOffset
	}
	if recovered.String() != text {
		t.Fatal("full MCP instructions were lost")
	}
	filtered := BoundToolCatalogs([]ToolSchema{{Name: "Agent", Catalog: &CatalogText{Header: "Selected agents", Rows: []string{strings.Repeat("x", DefaultCatalogBytes)}, RecoveryTool: "AgentList", Continuation: "Call AgentList."}}})
	if strings.Contains(filtered[0].Description, "AgentList") || !strings.Contains(filtered[0].Description, "omitted") {
		t.Fatal("continuation advertised a filtered tool")
	}
}
