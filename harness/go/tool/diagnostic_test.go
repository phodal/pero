package tool

import (
	"encoding/json"
	"testing"

	"github.com/phodal/pero/harness/go/model"
)

func TestDiagnosticObservations(t *testing.T) {
	for _, row := range []struct {
		name, raw, category string
		settled, dedup      bool
	}{
		{"missing", `{"exitCode":127,"stderr":{"text":"compiler: command not found"}}`, "missing-dependency", true, true},
		{"compiler", `{"exitCode":1,"stderr":{"text":"main.c:8: error: bad type"}}`, "compiler", true, true},
		{"assertion", `{"exitCode":1,"stdout":{"text":"AssertionError: wrong output"}}`, "assertion", true, true},
		{"syntax", `{"exitCode":2,"stderr":"syntax error near unexpected token"}`, "syntax", true, true},
		{"platform", `{"exitCode":1,"stderr":"Rosetta: unsupported syscall"}`, "platform", true, true},
		{"permission", `{"exitCode":1,"stderr":"permission denied"}`, "permission", true, true},
		{"unknown 127", `{"exitCode":127}`, "unclassified", true, false},
		{"success", `{"exitCode":0,"stdout":"error: quoted source"}`, "", true, false},
		{"uncertain wrapper", `{"cleanupUncertain":true,"result":{"exitCode":1,"stderr":"error: x"}}`, "", false, false},
		{"outer failed wrapper", `{"status":"failed","result":{"exitCode":0,"stdout":"error: x"}}`, "", false, false},
		{"outer running wrapper", `{"status":"running","result":{"exitCode":1,"stderr":"error: x"}}`, "", false, false},
		{"timeout", `{"exitCode":1,"timedOut":true}`, "", false, false},
		{"running", `{"status":"running","task_id":"job"}`, "", false, false},
		{"truncated", `{"exitCode":1,"stderr":{"text":"error: x","truncated":true}}`, "compiler", true, false},
		{"unknown fields", `{"exitCode":1,"stderr":"error: x","new_evidence":"retain me"}`, "compiler", true, false},
		{"spilled", `{"exitCode":1,"stderr":"error: x","output_file":"saved"}`, "compiler", true, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			d := ObserveDiagnostic("Bash", json.RawMessage(`{"command":"check"}`), []model.ContentBlock{{Type: model.BlockText, Text: row.raw}}, false)
			if d.Category != row.category || d.Settled != row.settled || d.Deduplicable != row.dedup {
				t.Fatalf("observation=%+v", d)
			}
		})
	}
	a := ObserveDiagnostic("Bash", json.RawMessage(`{"command":"check"}`), []model.ContentBlock{{Type: model.BlockText, Text: `{"exitCode":1,"stderr":"error: one","durationMs":1}`}}, false)
	b := ObserveDiagnostic("Bash", json.RawMessage(`{"command":"check"}`), []model.ContentBlock{{Type: model.BlockText, Text: `{"exitCode":1,"stderr":"error: one","durationMs":2}`}}, false)
	c := ObserveDiagnostic("Bash", json.RawMessage(`{"command":"check"}`), []model.ContentBlock{{Type: model.BlockText, Text: `{"exitCode":1,"stderr":"error: two"}`}}, false)
	if a.Fingerprint != b.Fingerprint || a.Fingerprint == c.Fingerprint {
		t.Fatal("fingerprint lost changed diagnostics or included transport timing")
	}
}
