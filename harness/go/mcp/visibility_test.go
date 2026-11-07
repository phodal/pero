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
		app     bool
	}{
		{"app", []string{"app"}, false, true}, {"model", []string{"model"}, true, false},
		{"both", []string{"app", "model"}, true, true}, {"malformed", "model", false, false},
		{"unknown", []string{"model", "other"}, false, false}, {"empty", []string{}, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := appVisible(sdk.Meta{"ui": map[string]any{"visibility": test.value}}); got != test.app {
				t.Fatalf("app visibility=%v", got)
			}
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

func TestExplicitMCPMutationRequiresApproval(t *testing.T) {
	for _, row := range []struct {
		name        string
		annotations *sdk.ToolAnnotations
		ask         bool
	}{
		{"legacy", nil, false}, {"read", &sdk.ToolAnnotations{ReadOnlyHint: true}, false},
		{"write", &sdk.ToolAnnotations{ReadOnlyHint: false}, true},
	} {
		tools, err := buildMCPTools(nil, "fixture", []*sdk.Tool{{Name: row.name, InputSchema: map[string]any{"type": "object"}, Annotations: row.annotations}}, time.Second, nil)
		if err != nil || len(tools) != 1 {
			t.Fatalf("%s: %v", row.name, err)
		}
		if tools[0].RequiresApproval != row.ask {
			t.Fatalf("%s: approval=%v", row.name, tools[0].RequiresApproval)
		}
	}
}
