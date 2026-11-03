package fstools

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestWorkspacePatch(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("replacement is unavailable")
	}
	for _, test := range []struct {
		name, patch string
		wantError   bool
	}{
		{"add update delete move", "*** Begin Patch\n*** Add File: added\n+new\n*** Update File: source\n*** Move to: moved\n@@\n-before\n+after\n*** Delete File: obsolete\n*** End Patch", false},
		{"preflight all files", "*** Begin Patch\n*** Add File: added\n+new\n*** Update File: source\n@@\n-missing\n+after\n*** End Patch", true},
		{"reject escape", "*** Begin Patch\n*** Add File: ../escape\n+new\n*** End Patch", true},
		{"reject overwrite", "*** Begin Patch\n*** Add File: source\n+new\n*** End Patch", true},
		{"reject duplicate", "*** Begin Patch\n*** Delete File: source\n*** Add File: source\n+new\n*** End Patch", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			for _, name := range []string{"source", "obsolete"} {
				if err := os.WriteFile(filepath.Join(root, name), []byte("before\n"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			workspace, err := OpenWorkspace(root)
			if err != nil {
				t.Fatal(err)
			}
			defer workspace.Close()
			receipt, err := workspace.ApplyPatch(t.Context(), test.patch)
			if (err != nil) != test.wantError {
				t.Fatalf("%+v: %v", receipt, err)
			}
			if test.wantError {
				data, _ := os.ReadFile(filepath.Join(root, "source"))
				if string(data) != "before\n" {
					t.Fatal("preflight failure changed source")
				}
				if _, err := os.Stat(filepath.Join(root, "added")); !os.IsNotExist(err) {
					t.Fatal("preflight failure published first file")
				}
				return
			}
			if !receipt.Complete || len(receipt.Files) != 4 {
				t.Fatalf("missing receipts: %+v", receipt)
			}
			for _, file := range receipt.Files {
				if file.State != "applied" {
					t.Fatalf("incomplete effect: %+v", file)
				}
			}
			data, _ := os.ReadFile(filepath.Join(root, "moved"))
			if string(data) != "after\n" {
				t.Fatal("move lost edits")
			}
			for _, name := range []string{"source", "obsolete"} {
				if _, err := os.Stat(filepath.Join(root, name)); !os.IsNotExist(err) {
					t.Fatal("source/delete retained")
				}
			}
		})
	}
}

func TestWorkspacePatchPartialReceipt(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("replacement is unavailable")
	}
	root := t.TempDir()
	workspace, err := OpenWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	defer workspace.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	workspace.afterCreate = cancel
	receipt, err := workspace.ApplyPatch(ctx, "*** Begin Patch\n*** Add File: first\n+one\n*** Add File: second\n+two\n*** End Patch")
	if err == nil || receipt.Complete || len(receipt.Files) != 2 || receipt.Files[0].State != "unknown" || receipt.Files[1].State != "not-applied" {
		t.Fatalf("partial effect lied: %+v %v", receipt, err)
	}
	data, _ := os.ReadFile(filepath.Join(root, "first"))
	if string(data) != "one\n" {
		t.Fatal("missing actual partial effect")
	}
	if _, err := os.Stat(filepath.Join(root, "second")); !os.IsNotExist(err) {
		t.Fatal("unattempted file exists")
	}
}

func TestPatchExactContext(t *testing.T) {
	for _, tc := range []struct {
		before, patch, want string
		bad                 bool
	}{
		{"same\nsame\n", "*** Begin Patch\n*** Update File: f\n@@\n-same\n+new\n*** End Patch", "", true},
		{"same\nsame\n", "*** Begin Patch\n*** Update File: f\n@@\n-same\n+new\n*** End of File\n*** End Patch", "same\nnew\n", false},
		{"top\nold", "*** Begin Patch\n*** Update File: f\n@@ top\n-old\n+new\n*** End Patch", "top\nnew", false},
	} {
		files, err := parsePatch(tc.patch)
		if err != nil {
			t.Fatal(err)
		}
		got, err := patchText(tc.before, files[0].hunks)
		if (err != nil) != tc.bad || got != tc.want {
			t.Fatalf("exact context: %q %v", got, err)
		}
	}
	if _, err := parsePatch(strings.Repeat("x", MaxFileBytes+1)); err == nil {
		t.Fatal("oversized patch accepted")
	}
}
