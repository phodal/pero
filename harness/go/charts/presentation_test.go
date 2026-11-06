package charts

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/model"
)

func TestScientificPresentationSurvivesSpill(t *testing.T) {
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
	if err := Mount(t.Context(), h, "python3"); err != nil {
		t.Fatal(err)
	}
	if _, err := h.RegisterSpillStore(t.Context(), "output", harness.NewLocalSpillStore(t.TempDir()+"/output"), harness.SpillPolicyOptions{}); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	source := "[" + strings.Repeat(`{"group":"A","n":9007199254740993},`, 1999) + `{"group":"A","n":9007199254740993}]`
	encoded, _ := json.Marshal(source)
	for _, tc := range []struct{ name, document string }{
		{"table_render", `"tableDocument":{"title":"Selected results","columns":[{"field":"n"}]}`},
		{"chart_render", `"chartDocument":{"title":"Selected results","chart":{"type":"bar","x":"label","y":"value"}},"aggregation":{"category":"group","measure":"n","aggregation":"sum"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := json.RawMessage(`{"dataset":{"name":"results.json","format":"json","content":` + string(encoded) + `},"view":{"selection":[0]},` + tc.document + `}`)
			outcome, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, CallID: harness.ToolCallID(tc.name), Name: tc.name, Arguments: input})
			if err != nil || outcome.Result.IsError {
				t.Fatalf("execution: %v, %+v", err, outcome.Result)
			}
			if !strings.Contains(outcome.Result.Content[0].Text, "Full formatted result stored at:") {
				t.Fatal("real spill was not exercised")
			}
			var presentation model.ToolPresentation
			if err := json.Unmarshal(outcome.Result.Meta, &presentation); err != nil {
				t.Fatal(err)
			}
			var receipt struct {
				SourceDocument struct{ Text string }
				Content        string
			}
			if err := json.Unmarshal([]byte(presentation.DisplayText), &receipt); err != nil {
				t.Fatal(err)
			}
			if receipt.SourceDocument.Text != source || !strings.Contains(receipt.Content, "9007199254740993") {
				t.Fatal("lost complete source or exact numeric token")
			}
		})
	}
}
