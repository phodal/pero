package mcp

import (
	"context"
	"encoding/json"
	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestSessionAccessGenerationAndBounds(t *testing.T) {
	server := sdk.NewServer(&sdk.Implementation{Name: "access", Version: "1"}, nil)
	server.AddResource(&sdk.Resource{URI: "docs://one", Name: "one"}, func(context.Context, *sdk.ReadResourceRequest) (*sdk.ReadResourceResult, error) {
		return &sdk.ReadResourceResult{Contents: []*sdk.ResourceContents{{URI: "docs://one", Text: "document"}}}, nil
	})
	ct, st := sdk.NewInMemoryTransports()
	ss, err := server.Connect(t.Context(), st, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	client := sdk.NewClient(&sdk.Implementation{Name: "client", Version: "1"}, nil)
	cs, err := client.Connect(t.Context(), ct, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	access := NewSessionAccess()
	access.Publish("docs", 1, cs, nil, nil, time.Second)
	raw, err := access.Request(t.Context(), "docs", 1, "read", "", "docs://one")
	if err != nil || !strings.Contains(string(raw), "document") {
		t.Fatalf("%s %v", raw, err)
	}
	for _, row := range []struct {
		name       string
		generation uint64
	}{{"other", 1}, {"docs", 0}, {"docs", 2}} {
		if _, err := access.Request(t.Context(), row.name, row.generation, "read", "", "docs://one"); err == nil {
			t.Fatal("unbound request admitted")
		}
	}
	access.Disconnect("docs")
	if err := access.Check("docs", 1); err == nil {
		t.Fatal("disconnected generation accepted")
	}
	access.Publish("docs", 2, cs, nil, nil, time.Second)
	if err := access.Check("docs", 1); err == nil {
		t.Fatal("replaced generation accepted")
	}
	if _, err := BoundedAccessResult(json.RawMessage(`"` + strings.Repeat("x", 1<<20) + `"`)); err == nil {
		t.Fatal("oversize result accepted")
	}
}

// Absent metadata must stay absent: the official Apps bridge rejects a null
// legacy resource URI even when a valid current ui.resourceUri exists.
func TestSessionAccessCatalogUIMetadata(t *testing.T) {
	for _, row := range []struct {
		name string
		meta sdk.Meta
		want string
	}{
		{"plain", nil, `{"name":"tool","inputSchema":{}}`},
		{"null", sdk.Meta{"ui": nil, "ui/resourceUri": nil}, `{"name":"tool","inputSchema":{}}`},
		{"current", sdk.Meta{"ui": map[string]any{"resourceUri": "ui://app/view"}, "unrelated": "not exposed"}, `{"name":"tool","inputSchema":{},"_meta":{"ui":{"resourceUri":"ui://app/view"}}}`},
		{"legacy", sdk.Meta{"ui/resourceUri": "ui://app/view"}, `{"name":"tool","inputSchema":{},"_meta":{"ui/resourceUri":"ui://app/view"}}`},
		{"app-only", sdk.Meta{"ui": map[string]any{"visibility": []string{"app"}}}, `{"name":"tool","inputSchema":{},"_meta":{"ui":{"visibility":["app"]}}}`},
	} {
		t.Run(row.name, func(t *testing.T) {
			access := NewSessionAccess()
			access.Publish("fixture", 1, nil, []*sdk.Tool{{Name: "tool", InputSchema: map[string]any{}, Meta: row.meta}}, nil, time.Second)
			raw, err := json.Marshal(access.List()[0].Tools[0])
			if err != nil {
				t.Fatal(err)
			}
			var got, want any
			if json.Unmarshal(raw, &got) != nil || json.Unmarshal([]byte(row.want), &want) != nil {
				t.Fatal("invalid tool JSON")
			}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("got %s; want %s", raw, row.want)
			}
		})
	}
}
