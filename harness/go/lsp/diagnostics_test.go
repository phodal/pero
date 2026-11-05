package lsp

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestDiagnosticReplacement(t *testing.T) {
	const valid = `{"uri":"file:///selected.go","version":3,"diagnostics":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":1}},"severity":1,"message":"错误 🧪"}]}`
	for _, test := range []struct {
		name, replacement string
		count             int
	}{
		{"empty clears", `{"uri":"file:///selected.go","version":3,"diagnostics":[]}`, 0},
		{"another document", strings.Replace(valid, "selected.go", "outside.go", 1), 1},
		{"old version", strings.Replace(valid, `"version":3`, `"version":2`, 1), 1},
		{"future version", strings.Replace(valid, `"version":3`, `"version":4`, 1), 1},
		{"missing array", `{"uri":"file:///selected.go","version":3}`, 1},
		{"invalid range", strings.Replace(valid, `"line":0`, `"line":-1`, 1), 1},
		{"invalid severity", strings.Replace(valid, `"severity":1`, `"severity":5`, 1), 1},
		{"version optional", strings.Replace(valid, `"version":3,`, "", 1), 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			document := documentDiagnostics{uri: "file:///selected.go", version: 3}
			document.publish(json.RawMessage(valid))
			document.publish(json.RawMessage(test.replacement))
			if document.report == nil || len(document.report.Items) != test.count {
				t.Fatalf("incorrect replacement: %+v", document.report)
			}
		})
	}
}

func TestDiagnosticBounds(t *testing.T) {
	item := Diagnostic{Range: Range{Start: Position{}, End: Position{0, 1}}, Message: "错误 🧪"}
	for _, test := range []struct {
		name  string
		items []Diagnostic
	}{
		{"count", make([]Diagnostic, 101)},
		{"characters", []Diagnostic{{Range: item.Range, Message: strings.Repeat("🧪", 16001)}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.name == "count" {
				for i := range test.items {
					test.items[i] = item
				}
			}
			raw, _ := json.Marshal(struct {
				URI   string       `json:"uri"`
				Items []Diagnostic `json:"diagnostics"`
			}{"file:///selected.go", test.items})
			document := documentDiagnostics{uri: "file:///selected.go", version: 1}
			document.publish(raw)
			if document.report == nil || !document.report.Truncated || len(document.report.Items) > 100 {
				t.Fatal("diagnostic budget not enforced")
			}
			text, truncated := (Result{Operation: Hover, Diagnostics: document.report}).Format()
			if !truncated || len([]rune(text)) > 16100 {
				t.Fatal("tool rendering lost diagnostic budget")
			}
		})
	}
}
