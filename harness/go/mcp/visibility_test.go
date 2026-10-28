package mcp

import (
	"testing"
	"time"

	sdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestModelToolVisibility(t *testing.T) {
	for _, test := range []struct {
		name    string
		value   any
		visible bool
	}{
		{"app", []string{"app"}, false}, {"model", []string{"model"}, true},
		{"both", []string{"app", "model"}, true}, {"malformed", "model", false},
		{"unknown", []string{"model", "other"}, false}, {"empty", []string{}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			tools, err := buildMCPTools(nil, "example", []*sdk.Tool{{Name: "action", InputSchema: map[string]any{"type": "object"}, Meta: sdk.Meta{"ui": map[string]any{"visibility": test.value}}}}, time.Second, nil)
			if err != nil {
				t.Fatal(err)
			}
			if (len(tools) == 1) != test.visible {
				t.Fatalf("model visibility: got %d tools", len(tools))
			}
		})
	}
	tools, err := buildMCPTools(nil, "legacy", []*sdk.Tool{{Name: "action", InputSchema: map[string]any{"type": "object"}}}, time.Second, nil)
	if err != nil || len(tools) != 1 {
		t.Fatalf("legacy tool: %v %v", tools, err)
	}
}

