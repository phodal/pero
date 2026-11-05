//go:build linux || darwin

package nativetools

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

func TestClaudeBashFullOutputFileForBothExecutionForms(t *testing.T) {
	for _, background := range []bool{false, true} {
		t.Run(map[bool]string{false: "foreground", true: "background"}[background], func(t *testing.T) {
			f := newBackgroundFixture(t)
			command := "printf 'BEGIN\\n'; head -c 70000 /dev/zero | tr '\\000' a; printf '\\nEND\\n'"
			response := f.call(t, f.allowed, "Bash", struct {
				Command    string `json:"command"`
				Background bool   `json:"run_in_background"`
			}{command, background})
			var result shell.RunResult
			if background {
				id := shellReceipt(t, response).ID
				response = f.call(t, f.allowed, "TaskOutput", taskQuery(id, true, 2000))
				receipt := shellReceipt(t, response)
				if receipt.Result == nil || receipt.OutputFile == "" || receipt.OutputFilePartial {
					t.Fatalf("missing completed file reference: %+v", receipt)
				}
				result = *receipt.Result
			} else if len(response.Content) == 0 || json.Unmarshal([]byte(response.Content[0].Text), &result) != nil {
				t.Fatal(response)
			}
			want := "BEGIN\n" + strings.Repeat("a", 70000) + "\nEND\n"
			data, err := os.ReadFile(result.OutputFile)
			if response.IsError || err != nil || string(data) != want || result.OutputBytes != int64(len(want)) || result.OutputFilePartial || !result.Stdout.Truncated {
				t.Fatalf("complete log lost bytes: result=%+v bytes=%d error=%v", result, len(data), err)
			}
			info, err := os.Stat(result.OutputFile)
			if err != nil || info.Mode().Perm() != 0600 {
				t.Fatalf("output is not private: %v %v", info, err)
			}
			read := f.call(t, f.allowed, "Read", struct {
				File  string `json:"file_path"`
				Limit int    `json:"limit"`
			}{result.OutputFile, 1})
			if read.IsError || !strings.Contains(read.Content[0].Text, "BEGIN") {
				t.Fatalf("Read cannot retrieve the log: %+v", read)
			}
		})
	}
}

func TestForegroundBashCancellationPreservesAuditOutput(t *testing.T) {
	f := newBackgroundFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := f.harness.Tools().Execute(ctx, harness.ToolRequest{Agent: f.allowed, Name: "Bash", CallID: "cancel-foreground", Arguments: json.RawMessage(`{"command":"printf before-cancel; printf '%s' $$ > foreground.pid; sleep 30"}`)})
		done <- err
	}()
	waitShellPID(t, filepath.Join(f.root, "foreground.pid"))
	cancel()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("foreground cancellation did not settle")
	}
	history, err := foldShellTasks(f.allowed.Session().Events(), f.allowed.ID())
	if err != nil || len(history) != 1 {
		t.Fatalf("missing audit intent: %+v %v", history, err)
	}
	for _, task := range history {
		if task.terminal == nil || task.terminal.OutputFile == "" || !task.terminal.OutputFilePartial {
			t.Fatalf("cancelled task discarded its actual log: %+v", task)
		}
		data, err := os.ReadFile(task.terminal.OutputFile)
		if err != nil || string(data) != "before-cancel" {
			t.Fatalf("cancelled output disappeared: %q %v", data, err)
		}
	}
}

func TestBashOutputFileIsNotCreatedBeforeIntentFlush(t *testing.T) {
	for _, background := range []bool{false, true} {
		t.Run(map[bool]string{false: "foreground", true: "background"}[background], func(t *testing.T) {
			f := newBackgroundFixture(t)
			detach, err := f.allowed.Session().InstallDurabilityCheckpoint(func(context.Context) error { return errors.New("fixture intent flush failed") })
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(detach)
			result := f.call(t, f.allowed, "Bash", struct {
				Command    string `json:"command"`
				Background bool   `json:"run_in_background"`
			}{"touch forbidden", background})
			if !result.IsError {
				t.Fatal("command ran without durable intent")
			}
			if _, err := os.Stat(filepath.Join(f.root, ".pero")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("output created before flush: %v", err)
			}
		})
	}
}

func TestBashRechecksWorkspaceAfterIntentFlush(t *testing.T) {
	for _, background := range []bool{false, true} {
		t.Run(map[bool]string{false: "foreground", true: "background"}[background], func(t *testing.T) {
			f := newBackgroundFixture(t)
			moved := f.root + "-original"
			swapped := false
			detach, err := f.allowed.Session().InstallDurabilityCheckpoint(func(context.Context) error {
				if swapped {
					return nil
				}
				for _, event := range f.allowed.Session().Events() {
					if event.Type == shellTaskStarted {
						if err := os.Rename(f.root, moved); err != nil {
							return err
						}
						if err := os.Mkdir(f.root, 0700); err != nil {
							return err
						}
						swapped = true
						break
					}
				}
				return nil
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				detach()
				if swapped {
					_ = os.RemoveAll(f.root)
					if err := os.Rename(moved, f.root); err != nil {
						t.Error(err)
					}
				}
			})
			result := f.call(t, f.allowed, "Bash", struct {
				Command    string `json:"command"`
				Background bool   `json:"run_in_background"`
			}{"touch forbidden", background})
			if !result.IsError || !swapped {
				t.Fatalf("replaced workspace accepted: %+v swapped=%v", result, swapped)
			}
			files, err := os.ReadDir(f.root)
			if err != nil || len(files) != 0 {
				t.Fatalf("output or command used a replacement workspace: %v %v", files, err)
			}
		})
	}
}
