package fstools

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestWorkspaceWriteParents(t *testing.T) {
	for _, test := range []struct {
		name, path, content string
		cancel, link        bool
		wantError           bool
	}{
		{name: "nested", path: ".reports/topic/prd.md", content: "# PRD"},
		{name: "escape", path: "../outside/prd.md", content: "bad", wantError: true},
		{name: "invalid-text", path: "new/topic/prd.md", content: "\x00", wantError: true},
		{name: "cancelled", path: "new/topic/prd.md", content: "bad", cancel: true, wantError: true},
		{name: "symlink-parent", path: "new/topic/prd.md", content: "bad", link: true, wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			if test.link {
				if err := os.Symlink(t.TempDir(), filepath.Join(root, "new")); err != nil {
					t.Skipf("symlinks unavailable: %v", err)
				}
			}
			files, err := OpenWorkspace(root)
			if err != nil {
				t.Fatal(err)
			}
			defer files.Close()
			ctx := t.Context()
			if test.cancel {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			receipt, err := files.WriteCreatingParents(ctx, test.path, test.content)
			if (err != nil) != test.wantError {
				t.Fatalf("receipt=%+v error=%v", receipt, err)
			}
			if !test.wantError {
				got, err := files.Read(t.Context(), test.path)
				if err != nil || got.Text != test.content || receipt.State != "applied" {
					t.Fatalf("readback=%+v error=%v", got, err)
				}
			} else if !test.link && test.path != "../outside/prd.md" {
				if _, err := os.Stat(filepath.Join(root, "new")); !os.IsNotExist(err) {
					t.Fatal("rejected content created parent directories")
				}
			}
		})
	}
}
