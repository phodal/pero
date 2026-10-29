//go:build linux

package collector

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
)

type writer struct {
	files map[string][]byte
	after func()
	fail  bool
}

func (w *writer) Put(_ context.Context, e artifacts.Entry, r io.Reader) error {
	b, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	if w.fail {
		return errors.New("upload interrupted")
	}
	w.files[e.ObjectKey] = b
	if w.after != nil {
		w.after()
	}
	return nil
}
func fixture(t *testing.T) (string, artifacts.Export, *writer) {
	t.Helper()
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "outputs"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "outputs", "result.txt"), []byte("result"), 0600); err != nil {
		t.Fatal(err)
	}
	s := artifacts.Source{ProjectID: "p", TaskID: "t", RunID: "r", Generation: 1, ClusterID: "c", Namespace: "p", SandboxUID: "s", PodUID: "pod", PVCName: "volume", PVCUID: "pvc", VolumeName: "pv", ImageDigest: "sha256:" + strings.Repeat("a", 64), TemplateDigest: "sha256:" + strings.Repeat("b", 64), WorkspaceRevision: strings.Repeat("c", 40)}
	now := time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC)
	e, err := artifacts.NewExport(s, artifacts.Policy{Paths: []string{"outputs/result.txt"}, MaxFiles: 1, MaxFileBytes: 32, MaxTotalBytes: 32}, "export", now)
	if err != nil {
		t.Fatal(err)
	}
	e, err = e.Begin(artifacts.Quiescence{PodUID: s.PodUID, PVCUID: s.PVCUID, ComputeReleaseDigest: s.ImageDigest, StorageFenceDigest: s.TemplateDigest, ObservedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	return root, e, &writer{files: map[string][]byte{}}
}

func TestCollectorRegularFilesAndFailureBoundaries(t *testing.T) {
	for _, name := range []string{"regular", "file_symlink", "directory_symlink", "hardlink", "fifo", "directory", "oversize", "mutation", "upload_failure", "missing_required", "missing_allowed", "unquiesced", "cancelled"} {
		t.Run(name, func(t *testing.T) {
			root, e, w := fixture(t)
			p := filepath.Join(root, "outputs", "result.txt")
			ctx := context.Background()
			switch name {
			case "file_symlink":
				_ = os.Remove(p)
				if err := os.Symlink("/etc/passwd", p); err != nil {
					t.Fatal(err)
				}
			case "directory_symlink":
				_ = os.Remove(p)
				_ = os.Remove(filepath.Dir(p))
				if err := os.Symlink(t.TempDir(), filepath.Dir(p)); err != nil {
					t.Fatal(err)
				}
			case "hardlink":
				if err := os.Link(p, filepath.Join(root, "alias")); err != nil {
					t.Fatal(err)
				}
			case "fifo":
				_ = os.Remove(p)
				if err := syscall.Mkfifo(p, 0600); err != nil {
					t.Fatal(err)
				}
			case "directory":
				_ = os.Remove(p)
				if err := os.Mkdir(p, 0700); err != nil {
					t.Fatal(err)
				}
			case "oversize":
				if err := os.Truncate(p, artifacts.MaxFileBytes+1); err != nil {
					t.Fatal(err)
				}
			case "mutation":
				w.after = func() { _ = os.WriteFile(p, []byte("change"), 0600) }
			case "upload_failure":
				w.fail = true
			case "missing_required", "missing_allowed":
				_ = os.Remove(p)
				if name == "missing_allowed" {
					e.Policy.AllowMissing = true
					e.PolicyDigest, _ = artifacts.Digest(e.Policy)
				}
			case "unquiesced":
				e.Quiescence = nil
			case "cancelled":
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			}
			m, err := Collect(ctx, e, root, w, e.CreatedAt.Add(time.Second))
			if name == "regular" {
				if err != nil || m.Validate(e.Policy) != nil || len(w.files) != 1 || m.TotalBytes != 6 {
					t.Fatalf("regular export: %+v %v", m, err)
				}
			} else if name == "missing_allowed" {
				if err != nil || m.Outcome != "partial" || len(m.Missing) != 1 || len(w.files) != 0 {
					t.Fatalf("partial export: %+v %v", m, err)
				}
			} else if err == nil {
				t.Fatalf("unsafe export returned a manifest: %+v", m)
			}
		})
	}
}
