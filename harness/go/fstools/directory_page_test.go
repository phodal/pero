package fstools

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func TestDirectoryPagesReachEveryEntry(t *testing.T) {
	root := t.TempDir()
	for i := 0; i < 600; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("file-%03d", i)), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	w, err := OpenWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	seen := map[string]bool{}
	offset := 0
	for {
		page, err := w.ListPage(t.Context(), ".", offset)
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range page.Entries {
			if seen[entry.Name] {
				t.Fatalf("repeated entry %s", entry.Name)
			}
			seen[entry.Name] = true
		}
		if page.NextOffset == 0 {
			break
		}
		if page.NextOffset <= offset {
			t.Fatal("directory cursor did not advance")
		}
		offset = page.NextOffset
	}
	if len(seen) != 600 {
		t.Fatalf("visited %d entries", len(seen))
	}
	if _, err := w.ListPage(t.Context(), "../", 0); err == nil {
		t.Fatal("pagination widened directory authority")
	}
}
