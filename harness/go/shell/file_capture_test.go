//go:build linux || darwin

package shell

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPrivateFileCaptureRetainsOrDiscardsActualBytes(t *testing.T) {
	for _, test := range []struct {
		name           string
		limit          int64
		content        string
		keep, overflow bool
	}{
		{"complete retained", 100, "complete output", true, false},
		{"inline discarded", 100, "inline output", false, false},
		{"bounded partial retained", 8, "larger than cap", true, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			plan, err := PlanOutputFile(t.TempDir(), ".pero/output", "capture.txt", test.limit)
			if err != nil {
				t.Fatal(err)
			}
			capture := &FileCapture{}
			if err := capture.Open(plan); err != nil {
				t.Fatal(err)
			}
			n, err := capture.Write([]byte(test.content))
			if errors.Is(err, ErrOutputFileLimit) != test.overflow || !test.overflow && err != nil {
				t.Fatalf("bytes=%d error=%v", n, err)
			}
			preview, err := capture.Preview(4, 2)
			if err != nil || !preview.Truncated || preview.Bytes != int64(n) {
				t.Fatalf("preview=%+v error=%v", preview, err)
			}
			if err := capture.Close(test.keep); err != nil {
				t.Fatal(err)
			}
			exists, err := plan.Exists()
			if err != nil || exists != test.keep {
				t.Fatalf("retention=%v error=%v", exists, err)
			}
			if test.keep {
				data, err := os.ReadFile(plan.Path())
				if err != nil || string(data) != test.content[:n] {
					t.Fatalf("capture was not exact: %q %v", data, err)
				}
				info, err := os.Stat(plan.Path())
				if err != nil || info.Mode().Perm() != 0600 {
					t.Fatalf("capture not private: %v %v", info, err)
				}
			}
		})
	}
}

func TestFileCaptureRefusesSymlinkParentsAndExistingDestination(t *testing.T) {
	for _, target := range []string{"parent", "file"} {
		t.Run(target, func(t *testing.T) {
			workspace := t.TempDir()
			plan, err := PlanOutputFile(workspace, ".pero/output", "capture.txt", 0)
			if err != nil {
				t.Fatal(err)
			}
			if target == "parent" {
				if err := os.Symlink(t.TempDir(), filepath.Join(workspace, ".pero")); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.MkdirAll(filepath.Dir(plan.Path()), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(plan.Path(), []byte("existing"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			capture := &FileCapture{}
			if err := capture.Open(plan); err == nil {
				capture.Close(false)
				t.Fatal("capture overwrote an existing target or followed a symlink")
			}
			if target == "file" {
				data, _ := os.ReadFile(plan.Path())
				if string(data) != "existing" {
					t.Fatalf("existing data changed: %q", data)
				}
			}
		})
	}
}

func TestFileCaptureReceivesOneFullExecutorRun(t *testing.T) {
	workspace := t.TempDir()
	plan, err := PlanOutputFile(workspace, ".pero/output", "capture.txt", 0)
	if err != nil {
		t.Fatal(err)
	}
	capture := &FileCapture{}
	if err := capture.Open(plan); err != nil {
		t.Fatal(err)
	}
	executor := testExecutor(t, LocalOptions{CWD: workspace, MaxOutputBytes: 128, OutputSink: capture})
	result, err := runCommand(t, executor, t.Context(), `printf BEGIN; head -c 70000 /dev/zero | tr '\000' a; printf END`)
	if err != nil || !result.Stdout.Truncated {
		t.Fatalf("result=%+v error=%v", result, err)
	}
	if err := capture.Close(true); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(plan.Path())
	if err != nil || string(data) != "BEGIN"+strings.Repeat("a", 70000)+"END" {
		t.Fatalf("full log lost bytes: bytes=%d error=%v", len(data), err)
	}
}
