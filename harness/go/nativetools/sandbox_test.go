package nativetools

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/sandbox"
)

func TestStrictConfigFailsBeforeRegistration(t *testing.T) {
	for _, c := range []Options{
		{Workspace: t.TempDir(), Sandbox: &sandbox.Config{Mode: sandbox.ReadOnly}},
		{Workspace: t.TempDir(), EnableShell: true, Shell: "/bin/bash", Sandbox: &sandbox.Config{Mode: sandbox.Mode("danger-full-access")}},
		{Workspace: t.TempDir(), EnableShell: true, Shell: "/bin/bash", Sandbox: &sandbox.Config{Mode: sandbox.ReadOnly, RuntimePaths: []string{"/"}}},
	} {
		h, e := harness.Boot(t.Context(), harness.Options{})
		if e != nil {
			t.Fatal(e)
		}
		a, e := Mount(t.Context(), h, c)
		if e == nil || a != nil {
			t.Fatalf("unsafe config mounted: %v", e)
		}
	}
}

// A failed mount must release its workspace before returning to its caller.
func TestFailedMountReleasesWorkspace(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "windows" {
		t.Skip("requires Linux descriptor inspection or Windows directory sharing semantics")
	}
	root := t.TempDir()
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	app, err := Mount(t.Context(), h, Options{Workspace: root, EnableShell: true, Shell: "relative-shell"})
	if err == nil || app != nil {
		t.Fatalf("invalid shell mounted: app=%v err=%v", app, err)
	}
	if runtime.GOOS == "linux" {
		// Unix permits renaming open directories, so check the live descriptors too.
		info, err := os.Stat(root)
		if err != nil {
			t.Fatal(err)
		}
		descriptors, err := os.ReadDir("/proc/self/fd")
		if err != nil {
			t.Fatal(err)
		}
		for _, descriptor := range descriptors {
			opened, err := os.Stat(filepath.Join("/proc/self/fd", descriptor.Name()))
			if err == nil && os.SameFile(info, opened) {
				t.Fatal("failed mount retained an open workspace descriptor")
			}
		}
	}
	if err := os.Rename(root, root+"-released"); err != nil {
		t.Fatalf("failed mount retained workspace: %v", err)
	}
	if err := os.Rename(root+"-released", root); err != nil {
		t.Fatal(err)
	}
}
