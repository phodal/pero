//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestMCPHeadersHelperConnections(t *testing.T) {
	root := t.TempDir()
	fixture := sdk.NewServer(&sdk.Implementation{Name: "headers-fixture", Version: "1"}, nil)
	handler := sdk.NewStreamableHTTPHandler(func(*http.Request) *sdk.Server { return fixture }, nil)
	var mu sync.Mutex
	received := map[string]bool{}
	endpoint := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := r.Header.Get("Authorization")
		if token != "Bearer one" && token != "Bearer two" {
			t.Errorf("dynamic header missing or static header won")
		}
		if r.Header.Get("X-Server") != "remote" {
			t.Error("helper server binding missing")
		}
		mu.Lock()
		received[token] = true
		mu.Unlock()
		handler.ServeHTTP(w, r)
	}))
	defer endpoint.Close()
	h, err := harness.Boot(t.Context(), harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("must not run model")
		return harness.Completion{}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	declaration := plugins.MCPServerDefinition{Name: "remote", Transport: "http", URL: endpoint.URL, Headers: map[string]string{"Authorization": "static"}, HeadersHelper: `printf 'run\n' >> "$CLAUDE_PLUGIN_ROOT/helper-runs"; printf '{"authorization":"Bearer %s","X-Server":"%s"}' "$(cat "$CLAUDE_PLUGIN_ROOT/token")" "$CLAUDE_CODE_MCP_SERVER_NAME"`}
	pkg := plugins.Package{Root: root, Definition: plugins.Plugin{Name: "header-helper"}, MCP: []plugins.MCPServerDefinition{declaration}}
	if _, err := MountMCP(t.Context(), h, []plugins.Package{pkg}, []string{"PATH=/usr/bin:/bin"}, nil); err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{"one", "two"} {
		if err := os.WriteFile(filepath.Join(root, "token"), []byte(token), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: harness.SessionID(token), CWD: root, Provider: "fixture", Model: "fixture"}); err != nil {
			t.Fatal(err)
		}
	}
	mu.Lock()
	both := received["Bearer one"] && received["Bearer two"]
	mu.Unlock()
	if !both {
		t.Fatal("connection did not refresh helper credentials")
	}
	raw, err := os.ReadFile(filepath.Join(root, "helper-runs"))
	if err != nil || strings.Count(string(raw), "run") != 2 {
		t.Fatalf("helper runs=%s err=%v", raw, err)
	}
	for _, command := range []string{`printf 'private-canary' >&2; exit 1`, `printf 'private-canary'`, `printf '{"Authorization":42}'`} {
		declaration.HeadersHelper = command
		resolve := mcpHeadersProvider(pkg, declaration, harness.MCPServerConfig{CWD: root, URL: endpoint.URL}, nil, root)
		if _, err := resolve(t.Context()); err == nil || strings.Contains(err.Error(), "private-canary") {
			t.Fatalf("invalid helper output=%v", err)
		}
	}
}

func TestMCPHeadersHelperInspectionDoesNotExecute(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".claude-plugin"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".claude-plugin/plugin.json"), []byte(`{"name":"helper"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".mcp.json"), []byte(`{"remote":{"url":"https://example.invalid/mcp","headersHelper":"private-canary"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	packages, err := plugins.LoadPackages(t.Context(), []string{root})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(packages)
	if len(packages[0].MCP) != 1 || packages[0].MCP[0].HeadersHelper != "private-canary" || strings.Contains(string(raw), "private-canary") {
		t.Fatal("helper configuration or redaction lost")
	}
}
