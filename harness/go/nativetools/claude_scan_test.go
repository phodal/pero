package nativetools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestClaudeSearchContinuationAndIgnores(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	write := func(name, content string) {
		t.Helper()
		file := filepath.Join(f.root, name)
		if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(file, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 600; i++ {
		write(fmt.Sprintf("many/file-%03d.txt", i), "needle\n")
	}
	write(".gitignore", "*.log\nignored/\n")
	write("root.log", "needle\n")
	write("sub/.gitignore", "!keep.log\nbuild/\n/root-only.txt\n")
	write("sub/keep.log", "needle\n")
	write("sub/drop.log", "needle\n")
	write("sub/build/drop.txt", "needle\n")
	write("sub/root-only.txt", "needle\n")
	write("sub/deep/root-only.txt", "needle\n")
	for i := 0; i < 600; i++ {
		write(fmt.Sprintf("ignored/file-%03d.txt", i), "needle\n")
	}
	input := arguments{Path: "many", Pattern: "*.txt"}
	seen := map[string]bool{}
	for pages := 0; ; pages++ {
		if pages >= 20 {
			t.Fatal("Glob cursor failed to finish")
		}
		page, err := claudeGlob(t.Context(), f.app.files, input)
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range page.Files {
			if seen[file] {
				t.Fatalf("repeated file %s", file)
			}
			seen[file] = true
		}
		if page.NextCursor == "" {
			break
		}
		if !page.Truncated || page.NextCursor == input.Cursor {
			t.Fatal("Glob cursor did not advance")
		}
		input.Cursor = page.NextCursor
	}
	if len(seen) != 600 {
		t.Fatalf("Glob reached %d files", len(seen))
	}
	input = arguments{Path: "many", Pattern: "*.absent"}
	page, err := claudeGlob(t.Context(), f.app.files, input)
	if err != nil || len(page.Files) != 0 || !page.Truncated || page.NextCursor == "" {
		t.Fatalf("empty traversal page lacks recovery: %+v %v", page, err)
	}
	input.Cursor = page.NextCursor
	if page, err = claudeGlob(t.Context(), f.app.files, input); err != nil || page.NextCursor != "" {
		t.Fatalf("empty traversal did not finish: %+v %v", page, err)
	}
	input.Pattern = "*.txt"
	if _, err := claudeGlob(t.Context(), f.app.files, input); err == nil {
		t.Fatal("cursor accepted a different query")
	}
	page, err = claudeGlob(t.Context(), f.app.files, arguments{Path: "sub", Pattern: "**/*"})
	if err != nil {
		t.Fatal(err)
	}
	if want := []string{"sub/.gitignore", "sub/deep/root-only.txt", "sub/keep.log"}; !reflect.DeepEqual(page.Files, want) {
		t.Fatalf("nested ignore rules: %v want %v", page.Files, want)
	}
	page, err = claudeGlob(t.Context(), f.app.files, arguments{Pattern: "ignored/**"})
	if err != nil || len(page.Files) != 0 {
		t.Fatalf("ignored tree was traversed: %+v %v", page, err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := claudeGlob(ctx, f.app.files, arguments{Pattern: "**/*"}); err == nil {
		t.Fatal("cancelled search continued")
	}
}

func TestClaudeGrepResumesWithinFile(t *testing.T) {
	f := newClaudeFixture(t, Options{})
	if err := os.WriteFile(filepath.Join(f.root, "many.txt"), []byte(strings.Repeat("needle\n", 150)), 0600); err != nil {
		t.Fatal(err)
	}
	input := arguments{Pattern: "needle", OutputMode: "content"}
	lines := map[int]bool{}
	for pages := 0; ; pages++ {
		if pages >= 5 {
			t.Fatal("Grep cursor failed to finish")
		}
		page, err := claudeGrep(t.Context(), f.app.files, input)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range page.Matches {
			if match.Line == nil || lines[*match.Line] {
				t.Fatalf("repeated/missing Grep line: %+v", match)
			}
			lines[*match.Line] = true
		}
		if page.NextCursor == "" {
			break
		}
		if !page.Truncated || page.NextCursor == input.Cursor {
			t.Fatal("Grep cursor did not advance")
		}
		input.Cursor = page.NextCursor
	}
	if len(lines) != 150 {
		t.Fatalf("Grep reached %d lines", len(lines))
	}
	page, err := claudeGrep(t.Context(), f.app.files, arguments{Path: "many.txt", Pattern: "needle", OutputMode: "content", SearchOffset: 128})
	if err != nil || len(page.Matches) != 22 {
		t.Fatalf("direct-file offset changed: %+v %v", page, err)
	}
}
