package nativetools

import (
	"os"
	"path/filepath"
	"testing"
)

func TestClaudeAtomicBatchEdit(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	if !f.app.files.SupportsReplacement() {
		t.Skip("file replacement unavailable")
	}
	path := filepath.Join(f.root, "batch.txt")
	for _, row := range []struct {
		name        string
		agentDenied bool
		fields      map[string]any
		want        string
		failed      bool
	}{
		{"two edits", false, map[string]any{"edits": []any{map[string]any{"old_string": "alpha", "new_string": "A"}, map[string]any{"old_string": "beta", "new_string": "B"}}}, "A B", false},
		{"denied", true, map[string]any{"edits": []any{map[string]any{"old_string": "alpha", "new_string": "A"}}}, "alpha beta", true},
		{"missing second match", false, map[string]any{"edits": []any{map[string]any{"old_string": "alpha", "new_string": "A"}, map[string]any{"old_string": "absent", "new_string": "B"}}}, "alpha beta", true},
		{"overlap", false, map[string]any{"edits": []any{map[string]any{"old_string": "alpha", "new_string": "A"}, map[string]any{"old_string": "alpha beta", "new_string": "B"}}}, "alpha beta", true},
		{"missing new text", false, map[string]any{"old_string": "alpha"}, "alpha beta", true},
		{"mixed empty fields", false, map[string]any{"new_string": "", "edits": []any{map[string]any{"old_string": "beta", "new_string": "B"}}}, "alpha beta", true},
		{"mixed forms", false, map[string]any{"old_string": "alpha", "new_string": "A", "edits": []any{map[string]any{"old_string": "beta", "new_string": "B"}}}, "alpha beta", true},
	} {
		t.Run(row.name, func(t *testing.T) {
			if err := os.WriteFile(path, []byte("alpha beta"), 0600); err != nil {
				t.Fatal(err)
			}
			row.fields["file_path"] = path
			agent := f.allowed
			if row.agentDenied {
				agent = f.denied
			}
			got := f.call(t, agent, "Edit", row.fields)
			data, err := os.ReadFile(path)
			if err != nil || got.IsError != row.failed || string(data) != row.want {
				t.Fatalf("result=%+v file=%q err=%v", got, data, err)
			}
		})
	}
}
