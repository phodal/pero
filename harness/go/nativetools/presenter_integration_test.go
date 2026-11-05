//go:build linux || darwin

package nativetools

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/shell"
)

func TestBashArtifactUsesBoundedUtf8PrefixOfWorkingLog(t *testing.T) {
	workspace := t.TempDir()
	plan, err := shell.PlanOutputFile(workspace, ".pero/bash-output", "bash-artifact.log", 0)
	if err != nil {
		t.Fatal(err)
	}
	capture := &shell.FileCapture{}
	if err := capture.Open(plan); err != nil {
		t.Fatal(err)
	}
	defer capture.Close(true)
	buffer := make([]byte, 1<<20)
	for remaining := bashArtifactBytes - 1; remaining > 0; {
		n := min(remaining, int64(len(buffer)))
		if _, err := capture.Write(buffer[:n]); err != nil {
			t.Fatal(err)
		}
		remaining -= n
	}
	if _, err := capture.Write([]byte("🙂tail")); err != nil {
		t.Fatal(err)
	}
	policy, _ := resolveBashOutputPolicy(BashOutputOptions{}, nil)
	owner := &shellTasks{options: shell.LocalOptions{CWD: workspace}, outputPolicy: policy}
	executor, err := shell.NewLocalExecutor(shell.LocalOptions{CWD: workspace, Shell: "/bin/bash"})
	if err != nil {
		t.Fatal(err)
	}
	task := &shellTask{intent: shellTaskIntent{ID: "bash-artifact", Workdir: workspace}, capture: capture, executor: executor}
	presentation, err := owner.presentCapture(task, true)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(presentation.OutputFile)
	if err != nil || info.Size() != bashArtifactBytes-1 || !presentation.OutputFileTruncated || presentation.OutputFileBytes != info.Size() || utf8.RuneCountInString(presentation.Text) != 2000 {
		t.Fatalf("artifact boundary=%+v info=%v error=%v", presentation, info, err)
	}
	if capture.Bytes() != bashArtifactBytes+7 {
		t.Fatalf("working log was truncated with artifact: %d", capture.Bytes())
	}
	failed, err := owner.presentCapture(task, false)
	if err != nil || failed.OutputFile != "" || utf8.RuneCountInString(failed.Text) != 10000 {
		t.Fatalf("failure advertised a success artifact: %+v %v", failed, err)
	}
}

func TestBashArtifactRejectsReplacedWorkspaceAfterCommand(t *testing.T) {
	f := newClaudeFixture(t, Options{EnableShell: true})
	replacement := t.TempDir()
	moved := f.root + "-original"
	defer func() {
		if err := os.Remove(f.root); err != nil {
			t.Error(err)
		}
		if err := os.Rename(moved, f.root); err != nil {
			t.Error(err)
		}
	}()
	command := fmt.Sprintf("printf x >> effects; mv %q %q; ln -s %q %q; head -c 30001 /dev/zero | tr '\\000' a", f.root, moved, replacement, f.root)
	response := f.call(t, f.allowed, "Bash", struct {
		Command string `json:"command"`
	}{command})
	var failure struct {
		Result bashPresentedResult `json:"result"`
		Error  string              `json:"error"`
	}
	if len(response.Content) != 1 || json.Unmarshal([]byte(response.Content[0].Text), &failure) != nil || !response.IsError || !strings.Contains(failure.Error, "artifact workspace changed") || failure.Result.OutputFile != "" {
		t.Fatalf("replaced workspace did not fail presentation explicitly: %+v", response)
	}
	if _, err := os.Stat(filepath.Join(replacement, ".pero")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("presenter wrote into the replacement workspace: %v", err)
	}
	effects, err := os.ReadFile(filepath.Join(moved, "effects"))
	if err != nil || string(effects) != "x" || f.approvals.Load() != 1 {
		t.Fatalf("command replayed after presentation failed: effects=%q approvals=%d error=%v", effects, f.approvals.Load(), err)
	}
	history, err := foldShellTasks(f.allowed.Session().Events(), f.allowed.ID())
	if err != nil || len(history) != 1 {
		t.Fatalf("missing actual command receipt: %v", err)
	}
	for _, task := range history {
		if task.terminal == nil || task.terminal.Status != shellTaskFailed || task.terminal.Result == nil || task.terminal.Result.ExitCode == nil || *task.terminal.Result.ExitCode != 0 {
			t.Fatalf("presentation failure lost the actual exit result: %+v", task)
		}
		logPath := filepath.Join(moved, ".pero", "bash-output", filepath.Base(task.terminal.OutputFile))
		output, err := os.ReadFile(logPath)
		if err != nil || string(output) != strings.Repeat("a", 30001) {
			t.Fatalf("original descriptor output was lost: bytes=%d error=%v", len(output), err)
		}
	}
}

func TestBashModelPresentationRunsCommandOnce(t *testing.T) {
	for _, test := range []struct {
		name, source string
		options      BashOutputOptions
		environment  []string
		failure      bool
		inlineChars  int
		artifact     bool
	}{
		{"unicode inline bypasses encoded byte cap", strings.Repeat("汉🙂", 15000), BashOutputOptions{}, nil, false, 30000, false},
		{"large success artifact", strings.Repeat("a", 30001), BashOutputOptions{}, nil, false, 2000, true},
		{"subdirectory artifact", strings.Repeat("a", 30001), BashOutputOptions{}, nil, false, 2000, true},
		{"failure head and tail", strings.Repeat("A", 5000) + strings.Repeat("M", 20000) + strings.Repeat("C", 5000) + strings.Repeat("D", 10000), BashOutputOptions{}, nil, true, 10000, false},
		{"trusted override ignores environment", strings.Repeat("x", 40000), BashOutputOptions{BashOutputMaxChars: 50000}, []string{"BASH_MAX_OUTPUT_LENGTH=20"}, false, 40000, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := newClaudeFixture(t, Options{EnableShell: true, BashOutput: test.options, PluginEnvironment: test.environment})
			if err := os.WriteFile(filepath.Join(f.root, "input.txt"), []byte(test.source), 0600); err != nil {
				t.Fatal(err)
			}
			command := "printf x >> effects; cat input.txt"
			workdir := ""
			if test.name == "subdirectory artifact" {
				workdir = filepath.Join(f.root, "subdir")
				if err := os.Mkdir(workdir, 0700); err != nil {
					t.Fatal(err)
				}
				command = "printf x >> ../effects; cat ../input.txt"
			}
			if test.failure {
				command += "; exit 7"
			}
			response := f.call(t, f.allowed, "Bash", struct {
				Command string `json:"command"`
				Workdir string `json:"workdir,omitempty"`
			}{command, workdir})
			var view bashPresentedResult
			if test.failure {
				var failed struct {
					Result bashPresentedResult `json:"result"`
				}
				if err := json.Unmarshal([]byte(response.Content[0].Text), &failed); err != nil {
					t.Fatal(err)
				}
				view = failed.Result
			} else if err := json.Unmarshal([]byte(response.Content[0].Text), &view); err != nil {
				t.Fatal(err)
			}
			if response.IsError != test.failure || utf8.RuneCountInString(view.Stdout.Text) != test.inlineChars || !utf8.ValidString(view.Stdout.Text) || (view.OutputFile != "") != test.artifact || view.Stderr.Text != "" {
				t.Fatalf("presentation status=%v chars=%d artifact=%q", response.IsError, utf8.RuneCountInString(view.Stdout.Text), view.OutputFile)
			}
			if test.artifact {
				data, err := os.ReadFile(view.OutputFile)
				if err != nil || string(data) != test.source || view.OutputFileTruncated {
					t.Fatalf("artifact lost actual output: bytes=%d error=%v", len(data), err)
				}
			}
			if test.failure && strings.Contains(view.Stdout.Text, "D") {
				t.Fatal("failure excerpt used the entire log tail instead of the readback window")
			}
			if test.failure {
				if _, err := os.Stat(filepath.Join(f.root, ".pero", "bash-artifacts")); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("failure created a success artifact: %v", err)
				}
			}
			effects, err := os.ReadFile(filepath.Join(f.root, "effects"))
			if err != nil || string(effects) != "x" || f.approvals.Load() != 1 {
				t.Fatalf("projection reran or reapproved command: effects=%q approvals=%d error=%v", effects, f.approvals.Load(), err)
			}
		})
	}
}
