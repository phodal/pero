package engineeringprofile

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/tool"
)

func TestValidationProgress(t *testing.T) {
	for _, row := range []struct {
		name, digest, diagnostic string
		status                   CheckStatus
		settled                  bool
		want                     string
	}{
		{"same inputs", "v1", "error", Failed, true, "identical declared inputs"},
		{"changed inputs", "v2", "error", Failed, true, "input bytes changed"},
		{"changing diagnostic", "v2", "new error", Failed, true, ""},
		{"passed", "v2", "error", Passed, true, ""},
		{"uncertain", "v1", "error", Failed, false, ""},
	} {
		t.Run(row.name, func(t *testing.T) {
			previous := validationObservation{ContractID: "c", Revision: 1, CheckID: "unit", ResultSeq: 10, Proof: proof{Status: Failed, SpecDigest: "spec", BeforeDigest: "v1", AfterDigest: "v1", Diagnostic: &tool.Diagnostic{Settled: true, Fingerprint: "error"}}}
			current := previous
			current.ResultSeq = 20
			current.CurrentDigest = row.digest
			current.Proof = proof{Status: row.status, SpecDigest: "spec", BeforeDigest: row.digest, AfterDigest: row.digest, Diagnostic: &tool.Diagnostic{Settled: row.settled, Fingerprint: row.diagnostic}}
			got := validationFeedback(previous, current)
			if row.want == "" && got != "" || row.want != "" && !strings.Contains(got, row.want) {
				t.Fatalf("feedback=%q", got)
			}
		})
	}
}

func TestSettledValidationFeedbackReachesRequest(t *testing.T) {
	for _, row := range []struct {
		name    string
		mode    Mode
		changed bool
		want    string
	}{
		{"same inputs", Feedback, false, "identical declared inputs"},
		{"changed inputs", Feedback, true, "input bytes changed"},
		{"observe remains quiet", Observe, false, ""},
	} {
		t.Run(row.name, func(t *testing.T) {
			f := setup(t, row.mode, 3, checkCall(), checkCall(), answer(harness.FinishMaxTokens))
			if row.changed {
				f.adapter.before = func(index int) {
					if index == 1 {
						if err := os.WriteFile(filepath.Join(f.root, "input.txt"), []byte("version two"), 0600); err != nil {
							t.Error(err)
						}
					}
				}
			}
			f.shell(t, `{"exitCode":1,"stdout":{"text":"error: invalid input","truncated":false}}`, false, nil)
			c := testContract()
			f.prompt(t, &c)
			if len(f.adapter.requests) != 3 {
				t.Fatal("missing next request")
			}
			found := false
			for _, message := range f.adapter.requests[2].Messages {
				for _, block := range message.Content {
					if strings.Contains(block.Text, "Validation progress for check") {
						found = true
						if row.want != "" && !strings.Contains(block.Text, row.want) {
							t.Fatalf("feedback=%s", block.Text)
						}
					}
				}
			}
			if found != (row.want != "") {
				t.Fatal("unexpected validation feedback", found)
			}
		})
	}
}
