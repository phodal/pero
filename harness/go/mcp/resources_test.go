package mcp

import (
	"context"
	"errors"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestPromptDirectoryListsAndReadsAPrompt(t *testing.T) {
	s := sdk.NewServer(&sdk.Implementation{Name: "prompts", Version: "1"}, &sdk.ServerOptions{Capabilities: &sdk.ServerCapabilities{Prompts: &sdk.PromptCapabilities{}}})
	s.AddPrompt(&sdk.Prompt{Name: "review", Description: "Review a change"}, func(_ context.Context, req *sdk.GetPromptRequest) (*sdk.GetPromptResult, error) {
		topic := ""
		if req != nil && req.Params != nil {
			topic = req.Params.Arguments["topic"]
		}
		return &sdk.GetPromptResult{Description: "Review a change", Messages: []*sdk.PromptMessage{{Role: "user", Content: &sdk.TextContent{Text: "review " + topic}}}}, nil
	})
	ct, st := sdk.NewInMemoryTransports()
	ss, err := s.Connect(t.Context(), st, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	c := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "1"}, nil)
	cs, err := c.Connect(t.Context(), ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	directory := NewResourceDirectory(map[string]time.Duration{"docs": time.Second})
	directory.SetSession("docs", cs)
	listed, err := directory.Request(t.Context(), "docs", "prompts/list", nil, "")
	if err != nil || !strings.Contains(string(listed), `"name":"review"`) {
		t.Fatalf("list prompts: %s %v", listed, err)
	}
	got, err := directory.GetPrompt(t.Context(), "docs", "review", map[string]string{"topic": "auth"})
	if err != nil || !strings.Contains(string(got), "review auth") {
		t.Fatalf("get prompt: %s %v", got, err)
	}
}

func TestServerInstructionsStayAttributedAndBounded(t *testing.T) {
	section, err := ServerInstructions("docs", "Use the review prompt.\n")
	if err != nil || section != "### MCP server: docs\n\nUse the review prompt." {
		t.Fatalf("section = %q %v", section, err)
	}
	if section, err := ServerInstructions("docs", " \n\t"); err != nil || section != "" {
		t.Fatalf("blank = %q %v", section, err)
	}
	if _, err := ServerInstructions("docs", strings.Repeat("x", maxServerInstructionBytes)); err == nil || !strings.Contains(err.Error(), "exceed") {
		t.Fatal(err)
	}
}

func TestConnectedServerInstructionsAreListed(t *testing.T) {
	server := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, &sdk.ServerOptions{Instructions: "Use the review prompt."})
	clientTransport, serverTransport := sdk.NewInMemoryTransports()
	session, err := server.Connect(t.Context(), serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	client := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "1"}, nil)
	connected, err := client.Connect(t.Context(), clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connected.Close()
	directory := NewResourceDirectory(map[string]time.Duration{"docs": time.Second, "other": time.Second})
	directory.SetSession("docs", connected)
	if got := directory.Instructions(); got != "### MCP server: docs\n\nUse the review prompt." {
		t.Fatalf("instructions = %q", got)
	}
}

func TestRenderResourceResultRedactsBlobAndKeepsOrder(t *testing.T) {
	raw := []byte(`{"contents":[{"uri":"docs://text","mimeType":"text/plain","text":"Read this guide."},{"uri":"docs://binary","mimeType":"application/octet-stream","blob":"AQIDBA=="}]}`)
	text, err := RenderResourceResult("docs", raw)
	if err != nil {
		t.Fatal(err)
	}
	want := "MCP server: docs\n" +
		`{"contents":[{"uri":"docs://text","mimeType":"text/plain","text":"Read this guide."},` +
		`{"uri":"docs://binary","mimeType":"application/octet-stream","blob":` +
		`"[binary resource: 8 base64 characters; available to programmatic callers]"}]}`
	if text != want {
		t.Fatalf("rendered = %q", text)
	}
	if strings.Contains(text, "AQIDBA==") {
		t.Fatal("binary payload leaked into model text")
	}
}

func TestResourceOnlyDiscovery(t *testing.T) {
	var calls atomic.Int32
	s := sdk.NewServer(&sdk.Implementation{Name: "resources-only", Version: "1"}, &sdk.ServerOptions{Capabilities: &sdk.ServerCapabilities{Resources: &sdk.ResourceCapabilities{}}})
	s.AddReceivingMiddleware(func(next sdk.MethodHandler) sdk.MethodHandler {
		return func(ctx context.Context, method string, req sdk.Request) (sdk.Result, error) {
			if method == "tools/list" {
				calls.Add(1)
				return nil, errors.New("method not found: tools/list")
			}
			return next(ctx, method, req)
		}
	})
	s.AddResource(&sdk.Resource{URI: "docs://guide", Name: "guide"}, func(context.Context, *sdk.ReadResourceRequest) (*sdk.ReadResourceResult, error) {
		return &sdk.ReadResourceResult{Contents: []*sdk.ResourceContents{{URI: "docs://guide", Text: "resource-only guide"}}}, nil
	})
	ct, st := sdk.NewInMemoryTransports()
	ss, err := s.Connect(t.Context(), st, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	c := sdk.NewClient(&sdk.Implementation{Name: "test", Version: "1"}, nil)
	cs, err := c.Connect(t.Context(), ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	if cs.InitializeResult().Capabilities.Tools != nil {
		t.Fatal("fixture unexpectedly advertises tools")
	}
	rows, err := ListTools(t.Context(), cs)
	if err != nil || calls.Load() != 0 || len(rows) != 0 {
		t.Fatalf("resource-only server rejected: calls=%d, tools=%d, err=%v", calls.Load(), len(rows), err)
	}
	directory := NewResourceDirectory(map[string]time.Duration{"docs": time.Second})
	directory.SetSession("docs", cs)
	raw, err := directory.Request(t.Context(), "docs", "resources/read", nil, "docs://guide")
	if err != nil || !strings.Contains(string(raw), "resource-only guide") {
		t.Fatalf("read resource: %s %v", raw, err)
	}
}
