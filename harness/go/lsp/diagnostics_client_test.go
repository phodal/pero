//go:build linux || darwin

package lsp

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestQueryPublishedDiagnostics(t *testing.T) {
	for _, mode := range []string{"diagnostics", "diagnostics-clear"} {
		t.Run(mode, func(t *testing.T) {
			_, h, agent, _ := fixtureApp(t, mode)
			for _, id := range []harness.ToolCallID{"first", "reopened"} {
				args := json.RawMessage(`{"operation":"hover","filePath":"fixture.go","line":2,"character":6}`)
				out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, CallID: id, Name: "LSP", Arguments: args})
				if err != nil || out.Result.IsError || len(out.Result.Content) != 1 {
					t.Fatalf("query failed: %+v %v", out, err)
				}
				text := out.Result.Content[0].Text
				want := "fixture type error 🧪"
				if mode == "diagnostics-clear" {
					want = "empty diagnostic set"
				}
				if !strings.Contains(text, want) || strings.Contains(text, "stale error") || strings.Contains(text, "foreign error") {
					t.Fatalf("incorrect published diagnostics: %s", text)
				}
			}
		})
	}
}
