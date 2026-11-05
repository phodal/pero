package nativetools

import (
	"encoding/json"
	"testing"

	"github.com/phodal/pero/harness/go/tool"
)

func TestForegroundDiagnosticEligibility(t *testing.T) {
	f := newClaudeFixture(t, Options{EnableShell: true, BashOutput: BashOutputOptions{BashOutputMaxChars: 1024}})
	for _, row := range []struct {
		name, command string
		dedup         bool
	}{
		{"complete foreground failure", "printf 'error: invalid input\\n' >&2; exit 1", true},
		{"truncated foreground failure", "printf 'error: '; printf '%05000d' 0; exit 1", false},
	} {
		t.Run(row.name, func(t *testing.T) {
			args := struct {
				Command string `json:"command"`
			}{row.command}
			result := f.call(t, f.allowed, "Bash", args)
			raw, _ := json.Marshal(args)
			d := tool.ObserveDiagnostic("Bash", raw, result.Content, result.IsError)
			if !d.Settled || !d.Failed || d.Fingerprint == "" || d.Deduplicable != row.dedup {
				t.Fatalf("diagnostic=%+v result=%+v", d, result)
			}
		})
	}
}
