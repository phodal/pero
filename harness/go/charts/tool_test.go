package charts

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"testing"
)

func TestChartReceiptPreservesSourceAndRejectsInvalidData(t *testing.T) {
	name := os.Getenv("PERO_CHART_TEST_PYTHON")
	if name == "" {
		name = "python3"
	}
	python, err := exec.LookPath(name)
	if err != nil {
		t.Fatal("Python 3.10+ is required")
	}
	for _, tc := range []struct {
		name, input string
		valid       bool
	}{
		{"declared", `{"document":{"schemaVersion":1,"id":"sales","title":"Sales","chart":{"type":"line","x":"month","y":"value"},"rows":[{"month":"Jan","value":null},{"month":"Feb","value":2}],"source":{"label":"Supplied data"}}}`, true},
		{"dataset", `{"dataset":{"name":"exact.json","content":"[{\"group\":\"甲\",\"n\":9007199254740993},{\"group\":\"乙\",\"n\":2}]","format":"json"},"view":{"selection":[0]},"chartDocument":{"title":"精确来源","chart":{"type":"bar","x":"label","y":"value"}},"aggregation":{"category":"group","measure":"n","aggregation":"sum"}}`, true},
		{"invalid pie", `{"document":{"schemaVersion":1,"id":"bad","title":"Bad","chart":{"type":"pie","x":"x","y":"y"},"rows":[{"x":"A","y":-1}],"source":{"label":"test"}}}`, false},
		{"forged source", `{"document":{"schemaVersion":1,"id":"bad","title":"Bad","chart":{"type":"bar","x":"x","y":"y"},"rows":[{"x":"A","y":1}],"source":{"label":"test","dataset":"invented"}}}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			output, err := Render(context.Background(), python, json.RawMessage(tc.input))
			if !tc.valid {
				if err == nil {
					t.Fatal("accepted invalid chart")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var receipt struct {
				Kind, ArtifactID, Content string
				SourceDocument            *struct{ Text string }
			}
			if err = json.Unmarshal(output, &receipt); err != nil {
				t.Fatal(err)
			}
			if receipt.Kind != "pero.chart.v1" || len(receipt.ArtifactID) != 64 {
				t.Fatalf("invalid receipt: %s", output)
			}
			if tc.name == "dataset" {
				var doc struct {
					Source struct {
						ExactValues []string
						Records     []struct{ Pointer string }
					}
				}
				if err = json.Unmarshal([]byte(receipt.Content), &doc); err != nil {
					t.Fatal(err)
				}
				if len(doc.Source.ExactValues) != 1 || doc.Source.ExactValues[0] != "9007199254740993" || doc.Source.Records[0].Pointer != "/0" || receipt.SourceDocument == nil {
					t.Fatalf("lost exact source: %s", output)
				}
			}
		})
	}
}
