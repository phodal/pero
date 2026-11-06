package nativetools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
)

func TestFreshReadReuseReachesModel(t *testing.T) {
	var f *claudeFixture
	original := strings.Repeat("alpha beta gamma delta\n", 60)
	changed := strings.ReplaceAll(original, "alpha", "omega")
	requestCount := 0
	adapter := harness.AdapterFunc(func(_ context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		requestCount++
		var results []harness.ContentBlock
		for _, m := range req.Messages {
			if m.Role == harness.RoleTool {
				results = append(results, m.Content...)
			}
		}
		if requestCount == 2 && !strings.Contains(results[0].Content[0].Text, "alpha") {
			t.Fatal("first complete read missing")
		}
		if requestCount == 3 {
			if len(results) != 3 || !strings.Contains(results[1].Content[0].Text, "identical") || !strings.Contains(results[2].Content[0].Text, "alpha") {
				t.Fatalf("duplicate/range behavior: %+v", results)
			}
			path := filepath.Join(f.root, "sample.txt")
			stat, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(path, []byte(changed), 0600); err != nil {
				t.Fatal(err)
			}
			if err = os.Chtimes(path, stat.ModTime(), stat.ModTime()); err != nil {
				t.Fatal(err)
			}
		}
		if requestCount == 4 {
			if !strings.Contains(results[len(results)-1].Content[0].Text, "omega") {
				t.Fatal("mtime-preserving external write was hidden")
			}
			return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
		}
		calls := []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Read", ToolCallID: harness.ToolCallID(string(rune('a' + requestCount))), Arguments: json.RawMessage(`{"file_path":"sample.txt"}`)}}
		if requestCount == 2 {
			calls = append(calls, harness.ContentBlock{Type: harness.BlockToolCall, Name: "Read", ToolCallID: "forced", Arguments: json.RawMessage(`{"file_path":"sample.txt","offset":1}`)})
		}
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: calls}}, nil
	})
	f = newClaudeFixture(t, Options{}, adapter)
	if err := os.WriteFile(filepath.Join(f.root, "sample.txt"), []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := f.allowed.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "read"}}}); err != nil {
		t.Fatal(err)
	}
	if requestCount != 4 {
		t.Fatal("unexpected requests", requestCount)
	}
	rawDuplicate := false
	for _, e := range f.allowed.Session().Events() {
		if e.Type != "tool/result" {
			continue
		}
		var b harness.ContentBlock
		if json.Unmarshal(e.Data, &b) == nil && b.ToolCallID == "c" && strings.Contains(b.Content[0].Text, "alpha") {
			rawDuplicate = true
		}
	}
	if !rawDuplicate {
		t.Fatal("projection overwrote raw evidence")
	}
}

func TestReadReuseAdmission(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	for _, tt := range []struct {
		name, text, args string
		eligible         bool
	}{
		{"complete", strings.Repeat("line\n", 30), `{"file_path":"file.txt"}`, true},
		{"range", strings.Repeat("line\n", 30), `{"file_path":"file.txt","limit":200}`, false},
		{"partial", strings.Repeat("line\n", 201), `{"file_path":"file.txt"}`, false},
		{"long line", strings.Repeat("x", 2001), `{"file_path":"file.txt"}`, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(f.root, "file.txt"), []byte(tt.text), 0600); err != nil {
				t.Fatal(err)
			}
			result := f.call(t, f.allowed, "Read", json.RawMessage(tt.args))
			if result.IsError || (len(result.Meta) > 0) != tt.eligible {
				t.Fatalf("admission: %+v", result)
			}
		})
	}
	// Plugin resources can contain instructions even when short and complete.
	if _, ok := nativeReadResult(fstools.ReadWindow{Offset: 1, Content: "instructions"}, 0, 0, "plugin://instructions").(reusableReadWindow); ok {
		t.Fatal("resource instructions eligible")
	}
}
