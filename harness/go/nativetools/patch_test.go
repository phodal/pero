package nativetools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPatchUsesExistingApprovalAndReceipts(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	if !f.app.files.SupportsReplacement() {
		t.Skip("replacement unavailable")
	}
	input := map[string]any{"patch": "*** Begin Patch\n*** Add File: first\n+one\n*** Add File: second\n+two\n*** End Patch"}
	if result := f.call(t, f.denied, "apply_patch", input); !result.IsError {
		t.Fatal("denied patch succeeded")
	}
	if _, err := os.Stat(filepath.Join(f.root, "first")); !os.IsNotExist(err) {
		t.Fatal("denied patch wrote files")
	}
	before := f.approvals.Load()
	result := f.call(t, f.allowed, "apply_patch", input)
	if result.IsError || f.approvals.Load() != before+1 || !strings.Contains(result.Content[0].Text, `"complete":true`) {
		t.Fatalf("approval/receipt: %+v", result)
	}
	for _, name := range []string{"first", "second"} {
		if _, err := os.Stat(filepath.Join(f.root, name)); err != nil {
			t.Fatal(err)
		}
	}
}
