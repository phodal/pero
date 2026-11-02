package pluginruntime

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestMCPServerBindings(t *testing.T) {
	root := t.TempDir()
	executable := filepath.Join(root, "server")
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nexit 0\n"), 0700); err != nil {
		t.Fatal(err)
	}
	pkg := plugins.Package{Root: root, Definition: plugins.Plugin{Name: "sample"}, MCP: []plugins.MCPServerDefinition{{Name: "memory", Transport: "stdio", Command: "server", Args: []string{"${CLAUDE_PLUGIN_ROOT}/server.py", "${CLAUDE_PROJECT_DIR}", "${EMPTY:-fallback}", "${MISSING:-fallback}", "$(literal)"}, Env: map[string]string{"TOKEN": "${TOKEN}", "CLAUDE_PLUGIN_ROOT": "cannot-override"}, TimeoutMilliseconds: 120}}}
	cwd := t.TempDir()
	configs, err := MCPServers([]plugins.Package{pkg}, cwd, []string{"PATH=" + root, "TOKEN=private-canary", "EMPTY="})
	if err != nil {
		t.Fatal(err)
	}
	if len(configs) != 1 {
		t.Fatalf("servers = %d", len(configs))
	}
	config := configs[0]
	if config.Name != "plugin_sample_memory" || config.Command != executable || config.CWD != cwd || config.Transport != harness.MCPStdio || config.ToolCallTimeoutMS != 0 || !config.FailOnStartupError {
		t.Fatal("MCP identity, executable or default timeout differs")
	}
	if !reflect.DeepEqual(config.Args, []string{filepath.Join(root, "server.py"), cwd, "", "fallback", "$(literal)"}) || config.Env["TOKEN"] != "private-canary" || config.Env["CLAUDE_PLUGIN_ROOT"] != root || config.Env["CLAUDE_PROJECT_DIR"] != cwd {
		t.Fatal("MCP values were not expanded with explicit scope and unset semantics")
	}
	for _, tc := range []struct {
		name        string
		declaration plugins.MCPServerDefinition
		environment []string
		cwd         string
	}{
		{"missing binding", plugins.MCPServerDefinition{Name: "memory", Transport: "http", URL: "${MISSING}"}, nil, cwd},
		{"bad URL does not echo secret", plugins.MCPServerDefinition{Name: "memory", Transport: "http", URL: "private-canary://wrong"}, nil, cwd},
		{"missing executable", plugins.MCPServerDefinition{Name: "memory", Command: "private-canary"}, nil, cwd},
		{"ambient PATH is not used", plugins.MCPServerDefinition{Name: "memory", Command: "server"}, nil, cwd},
		{"relative cwd", pkg.MCP[0], nil, "relative"},
		{"malformed binding", plugins.MCPServerDefinition{Name: "memory", Transport: "http", URL: "${UNCLOSED"}, nil, cwd},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad := pkg
			bad.MCP = []plugins.MCPServerDefinition{tc.declaration}
			if _, err := MCPServers([]plugins.Package{bad}, tc.cwd, tc.environment); err == nil || strings.Contains(err.Error(), "private-canary") {
				t.Fatalf("expected a non-secret rejection, got %v", err)
			}
		})
	}
}

func TestMountedMCPToolsInheritanceCancellationAndDisposal(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	var connections atomic.Int32
	entered, canceled := make(chan struct{}), make(chan struct{})
	fixture := sdk.NewServer(&sdk.Implementation{Name: "fixture", Version: "1"}, &sdk.ServerOptions{InitializedHandler: func(context.Context, *sdk.InitializedRequest) { connections.Add(1) }})
	fixture.AddTool(&sdk.Tool{Name: "echo", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: "fixture result"}}}, nil
	})
	fixture.AddTool(&sdk.Tool{Name: "wait", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(ctx context.Context, _ *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		close(entered)
		<-ctx.Done()
		close(canceled)
		return nil, ctx.Err()
	})
	deleted := make(chan struct{}, 4)
	handler := sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return fixture }, nil)
	cwd := t.TempDir()
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer private-canary" || r.Header.Get("X-Project") != cwd {
			t.Error("HTTP bindings did not match the explicit session environment")
		}
		if r.Method == http.MethodDelete {
			deleted <- struct{}{}
		}
		handler.ServeHTTP(w, r)
	}))
	defer endpoint.Close()
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("MCP fixture must not call a model")
		return harness.Completion{}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	pkg := plugins.Package{Root: t.TempDir(), Definition: plugins.Plugin{Name: "sample"}, MCP: []plugins.MCPServerDefinition{{Name: "memory", Transport: "http", URL: "${ENDPOINT}", Headers: map[string]string{"Authorization": "Bearer ${TOKEN}", "X-Project": "${CLAUDE_PROJECT_DIR}"}}}}
	_, err = MountMCP(ctx, h, []plugins.Package{pkg}, []string{"ENDPOINT=" + endpoint.URL, "TOKEN=private-canary"})
	if err != nil {
		t.Fatal(err)
	}
	parent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "parent", CWD: cwd, Provider: "fixture", Model: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	child, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "child", CWD: cwd, Provider: "fixture", Model: "fixture", Parent: parent, Delegated: true, DelegationDepth: 1})
	if err != nil {
		t.Fatal(err)
	}
	for _, agent := range []*harness.Agent{parent, child} {
		result, err := h.Tools().Execute(ctx, harness.ToolRequest{Agent: agent, Name: "mcp__plugin_sample_memory__echo", Arguments: json.RawMessage(`{}`)})
		if err != nil || result.Result.IsError || !strings.Contains(string(result.Result.Value), "fixture result") {
			t.Fatalf("actual MCP tool call failed: %+v, %v", result.Result, err)
		}
	}
	if connections.Load() != 1 {
		t.Fatalf("delegated agent opened a second connection: %d", connections.Load())
	}
	prompt, err := h.Prompts().Assemble(ctx, parent)
	if err != nil || !strings.Contains(prompt, "plugin:sample:memory") || !strings.Contains(prompt, "mcp__plugin_sample_memory__echo") || strings.Contains(prompt, "private-canary") {
		t.Fatalf("logical MCP identity was lost or exposed a secret: %v", err)
	}
	callCtx, cancelCall := context.WithCancel(ctx)
	finished := make(chan error, 1)
	go func() {
		outcome, err := h.Tools().Execute(callCtx, harness.ToolRequest{Agent: parent, Name: "mcp__plugin_sample_memory__wait", Arguments: json.RawMessage(`{}`)})
		if err == nil && outcome.Result.IsError {
			err = errors.New("tool call canceled")
		}
		finished <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancelCall()
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("canceled MCP call succeeded")
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	select {
	case <-canceled:
	case <-ctx.Done():
		t.Fatal("MCP cancellation did not reach the server")
	}
	if err := h.Agents().Remove(ctx, parent.ID()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-deleted:
	case <-ctx.Done():
		t.Fatal("Agent removal did not close the HTTP MCP session")
	}
	for _, schema := range h.Tools().Schemas(parent.Scope()) {
		if strings.HasPrefix(schema.Name, "mcp__plugin_sample_memory__") {
			t.Fatal("Agent removal left plugin MCP tools mounted")
		}
	}
}

func TestMCPActivationCancellationCleansOwnedConnections(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var message struct{ Method string }
		_ = json.Unmarshal(raw, &message)
		if strings.HasPrefix(message.Method, "notifications/") || r.Method == http.MethodDelete {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		select {
		case entered <- struct{}{}:
		default:
		}
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer func() { close(release); endpoint.Close() }()
	h, err := harness.Boot(ctx, harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	pkg := plugins.Package{Root: t.TempDir(), Definition: plugins.Plugin{Name: "sample"}, MCP: []plugins.MCPServerDefinition{{Name: "memory", Transport: "http", URL: endpoint.URL}}}
	if _, err := MountMCP(ctx, h, []plugins.Package{pkg}, nil); err != nil {
		t.Fatal(err)
	}
	activationCtx, cancelActivation := context.WithCancel(ctx)
	defer cancelActivation()
	finished := make(chan error, 1)
	go func() {
		_, err := h.Agents().Create(activationCtx, harness.AgentOptions{ID: "canceled", CWD: pkg.Root})
		finished <- err
	}()
	select {
	case <-entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancelActivation()
	select {
	case err := <-finished:
		if err == nil {
			t.Fatal("canceled activation succeeded")
		}
	case <-ctx.Done():
		t.Fatal("canceled activation did not settle")
	}
	if len(h.Agents().List()) != 0 {
		t.Fatal("failed activation left an Agent published")
	}
	for _, instance := range h.Runtime().Snapshot().InstanceDetails {
		if strings.HasPrefix(instance.EntryID, "plugin-mcp:") {
			t.Fatal("failed activation leaked its scoped MCP owner")
		}
	}
}

// The test binary is its own stdio server; no installed command or credential
// participates in this integration fixture.
func TestPluginMCPStdioFixture(t *testing.T) {
	if os.Getenv("PLUGIN_MCP_FIXTURE") != "1" {
		return
	}
	server := sdk.NewServer(&sdk.Implementation{Name: "stdio-fixture", Version: "1"}, nil)
	server.AddTool(&sdk.Tool{Name: "environment", InputSchema: json.RawMessage(`{"type":"object"}`)}, func(context.Context, *sdk.CallToolRequest) (*sdk.CallToolResult, error) {
		text := "root=" + os.Getenv("CLAUDE_PLUGIN_ROOT") + "\nproject=" + os.Getenv("CLAUDE_PROJECT_DIR") + "\nargument=" + os.Args[len(os.Args)-1]
		if os.Getenv("TOKEN") == "private-canary" {
			text += "\ncredential bound"
		}
		return &sdk.CallToolResult{Content: []sdk.Content{&sdk.TextContent{Text: text}}}, nil
	})
	_ = server.Run(context.Background(), &sdk.StdioTransport{})
	if err := os.WriteFile(os.Getenv("PLUGIN_MCP_CLOSED"), []byte("closed"), 0600); err != nil {
		os.Exit(2)
	}
	os.Exit(0)
}

func TestMountedMCPStdioExecutesExpandedArgumentsAndClosesProcess(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	root, cwd := t.TempDir(), t.TempDir()
	receipt := filepath.Join(root, "closed")
	h, err := harness.Boot(ctx, harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	pkg := plugins.Package{Root: root, Definition: plugins.Plugin{Name: "sample"}, MCP: []plugins.MCPServerDefinition{{Name: "memory", Transport: "stdio", Command: executable, Args: []string{"-test.run=^TestPluginMCPStdioFixture$", "${CLAUDE_PLUGIN_ROOT}/server.py", "$(literal)"}, Env: map[string]string{"PLUGIN_MCP_FIXTURE": "1", "PLUGIN_MCP_CLOSED": receipt, "TOKEN": "${TOKEN}"}}}}
	if _, err := MountMCP(ctx, h, []plugins.Package{pkg}, []string{"TOKEN=private-canary"}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "stdio", CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := h.Tools().Execute(ctx, harness.ToolRequest{Agent: agent, Name: "mcp__plugin_sample_memory__environment", Arguments: json.RawMessage(`{}`)})
	if err != nil || outcome.Result.IsError {
		t.Fatalf("stdio call failed: %v", err)
	}
	var text string
	for _, block := range outcome.Result.Content {
		text += block.Text
	}
	for _, expected := range []string{"root=" + root, "project=" + cwd, "argument=$(literal)", "credential bound"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("stdio environment/argv was not preserved: missing %q", expected)
		}
	}
	if err := h.Agents().Remove(ctx, agent.ID()); err != nil {
		t.Fatal(err)
	}
	if content, err := os.ReadFile(receipt); err != nil || string(content) != "closed" {
		t.Fatalf("stdio process did not settle before Agent removal: %v", err)
	}
}
