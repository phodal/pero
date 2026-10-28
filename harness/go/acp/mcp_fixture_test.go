//go:build unix

package acp

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// The test binary doubles as a stdio MCP server so no helper executable is
// committed. It is started only when PERO_FIXTURE_MCP=1 is passed explicitly.
func TestMain(m *testing.M) {
	if os.Getenv("PERO_FIXTURE_MCP") == "1" {
		runFixtureMCP()
		return
	}
	os.Exit(m.Run())
}

var fixtureLog sync.Mutex

func fixtureAppend(line string) {
	fixtureLog.Lock()
	defer fixtureLog.Unlock()
	if file, err := os.OpenFile(os.Getenv("FIXTURE_LOG"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600); err == nil {
		fmt.Fprintln(file, line)
		_ = file.Close()
	}
}

func runFixtureMCP() {
	_ = os.WriteFile(os.Getenv("FIXTURE_PID"), []byte(fmt.Sprint(os.Getpid())), 0o600)
	_ = os.WriteFile(os.Getenv("FIXTURE_ENV"), []byte(strings.Join(os.Environ(), "\n")), 0o600)
	server := mcp.NewServer(&mcp.Implementation{Name: "fixture", Version: "1"}, nil)
	object := map[string]any{"type": "object"}
	// The server calls everything read-only: its hint must never matter.
	hint := &mcp.ToolAnnotations{ReadOnlyHint: true}
	text := func(value string, isError bool) *mcp.CallToolResult {
		return &mcp.CallToolResult{IsError: isError, Content: []mcp.Content{&mcp.TextContent{Text: value}}}
	}
	server.AddTool(&mcp.Tool{Name: "lookup", InputSchema: object, Annotations: hint}, func(_ context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		fixtureAppend("lookup:" + string(req.Params.Arguments))
		return text("found:"+string(req.Params.Arguments), false), nil
	})
	server.AddTool(&mcp.Tool{Name: "store", InputSchema: object, Annotations: hint}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		var args struct{ Mode string }
		_ = json.Unmarshal(req.Params.Arguments, &args)
		fixtureAppend("store:" + string(req.Params.Arguments))
		switch strings.ToLower(args.Mode) {
		case "fail":
			return text("storage is read-only", true), nil
		case "die":
			os.Exit(3)
		case "block":
			fixtureAppend("blocking")
			<-ctx.Done()
			fixtureAppend("cancelled")
			return nil, ctx.Err()
		}
		return text("stored", false), nil
	})
	server.AddTool(&mcp.Tool{Name: "purge", InputSchema: object, Annotations: hint}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		fixtureAppend("purge")
		return text("purged", false), nil
	})
	_ = server.Run(context.Background(), &mcp.StdioTransport{})
}
