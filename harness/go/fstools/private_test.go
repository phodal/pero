//go:build linux || darwin

package fstools

import (
	"os"
	"path/filepath"
	"testing"
)

func TestHostPrivateDirectoryIsOutsideFileAuthority(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	directory := filepath.Join(root, "private")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(directory, "environment")
	if err := os.WriteFile(file, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	workspace, err := OpenWorkspace(root)
	if err != nil {
		t.Fatal(err)
	}
	defer workspace.Close()
	scoped, err := OpenScopedTextFiles(root, []string{"private/environment"}, MaxFileBytes)
	if err != nil {
		t.Fatal(err)
	}
	defer scoped.Close()
	release := ProtectDirectory(directory)
	defer release()
	for _, test := range []struct {
		name string
		run  func() error
	}{
		{"write", func() error { _, err := workspace.Write(t.Context(), "private/environment", "changed"); return err }},
		{"edit", func() error {
			_, err := workspace.Edit(t.Context(), "private/environment", "original", "changed", false)
			return err
		}},
		{"create parents", func() error {
			_, err := workspace.WriteCreatingParents(t.Context(), "private/sub/new", "changed")
			return err
		}},
		{"patch", func() error {
			_, err := workspace.ApplyPatch(t.Context(), "*** Begin Patch\n*** Delete File: private/environment\n*** End Patch")
			return err
		}},
		{"existing scoped access", func() error { _, err := scoped.Read(t.Context(), "private/environment"); return err }},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := test.run(); err == nil {
				t.Fatal("host-private path was accessible")
			}
		})
	}
	data, err := os.ReadFile(file)
	if err != nil || string(data) != "original" {
		t.Fatalf("private environment changed: %q, %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(directory, "sub")); !os.IsNotExist(err) {
		t.Fatalf("created private parent: %v", err)
	}
	if _, err := workspace.Write(t.Context(), "ordinary", "allowed"); err != nil {
		t.Fatal(err)
	}
}
