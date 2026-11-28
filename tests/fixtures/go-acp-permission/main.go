// Test-only assembly: production ACP transport/provider/core, one guarded no-op.
// This executable must never be used as the production runtime entrypoint.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"github.com/phodal/pero/harness/go/acp"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/providers/openai"
	"os"
	"path/filepath"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	endpoint := flag.String("endpoint", "", "loopback fixture provider")
	model := flag.String("model", "", "fixture model")
	sessions := flag.String("session-dir", "", "private fixture session directory")
	keyEnv := flag.String("api-key-env", "ACP_FIXTURE_API_KEY", "fake fixture credential")
	_ = flag.String("approval", "ask", "test fixture always requires approval")
	flag.Parse()
	apiKey := os.Getenv(*keyEnv)
	if err := os.Unsetenv(*keyEnv); err != nil {
		return err
	}
	adapter, err := openai.New(openai.Config{Endpoint: *endpoint, APIKey: apiKey, ProviderName: "configured", Models: []openai.ModelConfig{{ID: *model}}})
	if err != nil {
		return err
	}
	ctx := context.Background()
	h, err := harness.Boot(ctx, harness.Options{Adapter: adapter, AdapterProviders: []string{"configured"}, ModelInfo: adapter, ApprovalPolicy: harness.ApprovalPolicy("ask")})
	if err != nil {
		return err
	}
	defer h.Dispose(ctx)
	_, err = h.RegisterTool(ctx, "fixture.guarded-noop", harness.Tool{Schema: harness.ToolSchema{Name: "fixture_guarded_noop", Description: "Test-only no-op requiring approval", InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)}, AlwaysAskApproval: true, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		// Observation only: any call is a test failure. No shell/network/tool effects.
		if err := os.WriteFile(filepath.Join(*sessions, "tool-executed"), []byte("unexpected fixture execution"), 0600); err != nil {
			return harness.ToolResult{}, err
		}
		return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "NOOP_EXECUTED"}}}, nil
	}})
	if err != nil {
		return err
	}
	persistence, err := harness.NewJSONLSessionPersistence(*sessions)
	if err != nil {
		return err
	}
	server, err := acp.NewServer(acp.Options{Harness: h, Persistence: persistence, Provider: "configured", Model: *model, Name: "pero-test-permission", Version: "1"})
	if err != nil {
		return err
	}
	return server.Serve(ctx, os.Stdin, os.Stdout)
}
