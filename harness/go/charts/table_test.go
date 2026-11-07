package charts

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestExperimentalTable(t *testing.T) {
	source := `[{"method":"A","n":9007199254740993,"error":0.0100},{"method":"B","n":0,"error":null},{"method":"C","n":2}]`
	request := func(source, columns, view string) string {
		data, _ := json.Marshal(source)
		return fmt.Sprintf(`{"dataset":{"name":"results.json","format":"json","content":%s},"tableDocument":{"title":"Results","columns":%s},"view":%s}`, data, columns, view)
	}
	columns := `[{"field":"method"},{"field":"n","label":"Sample count"},{"field":"error","unit":"m"}]`
	for _, tc := range []struct {
		name, source, columns, view string
		valid                       bool
	}{
		{"exact values and missing", source, columns, `{}`, true},
		{"explicit selection", source, columns, `{"selection":[1]}`, true},
		{"unknown field", source, `[{"field":"invented"}]`, `{}`, false},
		{"duplicate field", source, `[{"field":"n"},{"field":"n"}]`, `{}`, false},
		{"no silent truncation", "[" + strings.Repeat(`{"n":1},`, 100) + `{"n":1}]`, `[{"field":"n"}]`, `{}`, false},
		{"invalid numbers", `[{"n":NaN}]`, `[{"field":"n"}]`, `{}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			output, err := Render(context.Background(), "python3", json.RawMessage(request(tc.source, tc.columns, tc.view)))
			if !tc.valid {
				if err == nil {
					t.Fatal("accepted invalid table")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			var receipt struct {
				Kind, ArtifactID, Content string
				SourceDocument            struct{ Text string }
			}
			if err := json.Unmarshal(output, &receipt); err != nil {
				t.Fatal(err)
			}
			if receipt.Kind != "pero.table.v1" || receipt.ArtifactID != fmt.Sprintf("%x", sha256.Sum256([]byte(receipt.Content))) || receipt.SourceDocument.Text != tc.source {
				t.Fatalf("lost source: %s", output)
			}
			var table struct {
				Rows   [][]struct{ Kind, Display string }
				Source struct {
					Dataset      string
					Records      []struct{ Ordinal int }
					TotalRecords int
				}
			}
			if err := json.Unmarshal([]byte(receipt.Content), &table); err != nil {
				t.Fatal(err)
			}
			if table.Source.Dataset != fmt.Sprintf("%x", sha256.Sum256([]byte("json\n"+tc.source))) || table.Source.TotalRecords != 3 {
				t.Fatal("lost dataset identity or denominator")
			}
			if tc.name == "explicit selection" {
				if len(table.Rows) != 1 || table.Source.Records[0].Ordinal != 1 || table.Rows[0][1].Display != "0" {
					t.Fatal("lost selected scope or zero")
				}
			} else if len(table.Rows) != 3 || table.Rows[0][1].Display != "9007199254740993" || table.Rows[0][2].Display != "0.0100" || table.Rows[1][2].Kind != "null" || table.Rows[2][2].Kind != "missing" {
				t.Fatalf("lost precision or missing values: %s", receipt.Content)
			}
		})
	}
}
