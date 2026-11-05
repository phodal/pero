package engineeringprofile

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestDeliveryRequirements(t *testing.T) {
	for _, row := range []struct {
		name, content  string
		extra, symlink bool
		want           bool
	}{
		{"complete", "答案🙂\n", false, false, true},
		{"wrong length", "答案\n", false, false, false},
		{"extra file", "答案🙂\n", true, false, false},
		{"symlink", "答案🙂\n", false, true, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			root := t.TempDir()
			if err := os.Mkdir(filepath.Join(root, "out."), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "out.", "answer"), []byte(row.content), 0600); err != nil {
				t.Fatal(err)
			}
			if row.extra {
				if err := os.WriteFile(filepath.Join(root, "out.", "extra"), []byte("extra"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if row.symlink {
				if err := os.Symlink("answer", filepath.Join(root, "out.", "linked")); err != nil {
					t.Skip(err)
				}
			}
			n := 3
			d := &DeliverySpec{Artifacts: []ArtifactSpec{{Path: "out./answer", NonEmpty: true, Runes: &n, TrimSpace: true}}, FileSet: &FileSetSpec{Directory: "out.", Files: []string{"answer"}}}
			if err := d.validate(); err != nil {
				t.Fatal(err)
			}
			rows := evaluateDelivery(t.Context(), root, d)
			a := Assess(Contract{ID: "delivery", Revision: 1}, nil, nil, rows...)
			if a.Ready != row.want {
				t.Fatalf("assessment=%+v", a)
			}
		})
	}
}

func TestDeliveryGitConflicts(t *testing.T) {
	root := t.TempDir()
	for _, args := range [][]string{{"init", "-q"}, {"hash-object", "-w", "--stdin"}} {
		command := exec.Command("git", append([]string{"-C", root}, args...)...)
		if err := command.Run(); err != nil {
			t.Skip("Git fixture unavailable")
		}
	}
	clean := evaluateDelivery(t.Context(), root, &DeliverySpec{NoGitConflicts: true})
	if len(clean) != 1 || clean[0].Status != Passed {
		t.Fatalf("clean=%+v", clean)
	}
	command := exec.Command("git", "-C", root, "hash-object", "-w", "--stdin")
	hash, err := command.Output()
	if err != nil {
		t.Fatal(err)
	}
	// A staged conflict is constructed directly; no identity, network or merge
	// timing is needed to inspect the real index's unmerged entries.
	command = exec.Command("git", "-C", root, "update-index", "--index-info")
	command.Stdin = strings.NewReader("100644 " + strings.TrimSpace(string(hash)) + " 1\tconflicted.txt\n")
	if err := command.Run(); err != nil {
		t.Fatal(err)
	}
	rows := evaluateDelivery(t.Context(), root, &DeliverySpec{NoGitConflicts: true})
	if rows[0].Status != Failed {
		t.Fatalf("conflict=%+v", rows)
	}
}

func TestUnboundDeliveryReviewWithUnlimitedSteps(t *testing.T) {
	f := setup(t, Feedback, harness.UnlimitedMaxSteps, checkCall(), answer(harness.FinishStop), answer(harness.FinishStop))
	// The absent contract makes engineering_check fail, but does not manufacture
	// acceptance. A single public-requirement review must still be admitted.
	if _, err := f.agent.Prompt(f.ctx, harness.Message{ID: "public-task", Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "produce the requested output"}}}); err != nil {
		t.Fatal(err)
	}
	if len(f.adapter.requests) != 3 {
		t.Fatalf("requests=%d", len(f.adapter.requests))
	}
	count := 0
	for _, e := range f.agent.Session().Events() {
		if e.Type == "engineering/delivery-review" {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("review count=%d", count)
	}
}
