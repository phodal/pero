package tool

import (
	"encoding/json"
	"github.com/phodal/pero/harness/go/model"
	"testing"
)

func TestMaskedValidationObservations(t *testing.T) {
	for _, tt := range []struct{ name, output, signal string }{
		{"traceback", "Traceback (most recent call last):\n  File \"check.py\", line 2, in <module>\n    assert result == 2\nAssertionError: mismatch\n", "python-traceback"},
		{"unittest", "Ran 3 tests\nFAILED (failures=1, errors=2)\n", "test-failure-summary"},
		{"pytest", "================ 1 failed, 2 passed in 0.03s ================\n", "test-failure-summary"},
		{"doctest", "***Test Failed*** 2 failures.\n", "test-failure-summary"},
		{"go", "FAIL\texample.org/pkg\t0.002s\n", "test-failure-summary"},
		{"expected", "OK (expected failures=1)\n1 xfailed, 2 passed\n", ""},
		{"source", "print('AssertionError: failed')\nassert value == 1\n", ""},
		{"quoted line", "14: FAILED (failures=1)\n", ""},
		{"word", "error: previous failure resolved\n", ""},
		{"zero failures", "FAILED (failures=0, errors=0)", ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			raw, _ := json.Marshal(struct {
				Exit   int    `json:"exitCode"`
				Stderr string `json:"stderr"`
			}{0, tt.output})
			content := []model.ContentBlock{{Type: model.BlockText, Text: string(raw)}}
			d := ObserveDiagnostic("Bash", json.RawMessage(`{"command":"python check.py; echo $?"}`), content, false)
			if !d.Settled || d.Failed || d.ExitCode == nil || *d.ExitCode != 0 || d.ValidationSignal != tt.signal || d.Deduplicable {
				t.Fatalf("%+v", d)
			}
			if other := ObserveDiagnostic("Read", nil, content, false); other.ValidationSignal != "" {
				t.Fatal("file output treated as validation")
			}
		})
	}
}
