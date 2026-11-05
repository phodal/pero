package fstools

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDisjointTextEdits(t *testing.T) {
	for _, row := range []struct {
		name   string
		edits  []TextEdit
		want   string
		reject bool
	}{
		{"two replacements", []TextEdit{{OldText: "alpha", NewText: "A"}, {OldText: "gamma", NewText: "G"}}, "A beta G\r\n🙂", false},
		{"original matching", []TextEdit{{OldText: "alpha", NewText: "beta"}, {OldText: "beta", NewText: "B"}}, "beta B gamma\r\n🙂", false},
		{"overlap", []TextEdit{{OldText: "alpha beta", NewText: "A"}, {OldText: "beta", NewText: "B"}}, "", true},
		{"second missing", []TextEdit{{OldText: "alpha", NewText: "A"}, {OldText: "missing", NewText: "B"}}, "", true},
		{"ambiguous", []TextEdit{{OldText: "a", NewText: "A"}}, "", true},
		{"empty", nil, "", true},
	} {
		t.Run(row.name, func(t *testing.T) {
			root := t.TempDir()
			path := filepath.Join(root, "file")
			before := "alpha beta gamma\r\n🙂"
			if err := os.WriteFile(path, []byte(before), 0600); err != nil {
				t.Fatal(err)
			}
			w, err := OpenWorkspace(root)
			if err != nil {
				t.Fatal(err)
			}
			defer w.Close()
			if !w.SupportsReplacement() {
				t.Skip("replacement unavailable")
			}
			_, err = w.EditBatch(t.Context(), "file", row.edits)
			if (err != nil) != row.reject {
				t.Fatalf("edit error=%v", err)
			}
			got, readErr := os.ReadFile(path)
			if readErr != nil {
				t.Fatal(readErr)
			}
			want := row.want
			if row.reject {
				want = before
			}
			if string(got) != want {
				t.Fatalf("file=%q want=%q", got, want)
			}
		})
	}
}
