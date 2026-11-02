//go:build linux || darwin

package nativetools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestColdShellTaskRecoveryNeverReplaysEffects(t *testing.T) {
	for _, test := range []struct {
		name                        string
		running, artifact, promoted bool
	}{{"terminal result", false, false, false}, {"uncertain running intent", true, false, false}, {"success artifact", false, true, false}, {"promoted running intent", true, false, true}} {
		t.Run(test.name, func(t *testing.T) {
			running := test.running
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			old := newBackgroundFixture(t)
			command := "printf x >> effects; printf recovered-output"
			wantLog := "recovered-output"
			if test.artifact {
				wantLog = strings.Repeat("a", 30001)
				if err := os.WriteFile(filepath.Join(old.root, "artifact-input.txt"), []byte(wantLog), 0600); err != nil {
					t.Fatal(err)
				}
				command = "printf x >> effects; cat artifact-input.txt"
			}
			if running {
				command = "printf x >> effects; printf running-log; printf '%s' $$ > task.pid; sleep 30"
				wantLog = "running-log"
			}
			var task shellTaskReceipt
			if test.promoted {
				promotion := promoteBash(t, old, t.Context(), command)
				task = shellTaskReceipt{ID: promotion.ID, WorkingLogFile: promotion.WorkingLog}
			} else {
				task = startShell(t, old, command)
			}
			savedArtifact := ""
			if running {
				waitShellPID(t, filepath.Join(old.root, "task.pid"))
			} else {
				result := old.call(t, old.allowed, "TaskOutput", taskQuery(task.ID, true, 2000))
				if result.IsError {
					t.Fatal(result)
				}
				savedArtifact = shellReceipt(t, result).OutputFile
			}
			// Persist the exact checkpoint observed before cleanup, including the
			// uncertainty window between a durable intent and a terminal receipt.
			checkpoint, err := harness.RestoreSession(old.allowed.Session().Header(), old.allowed.Session().Events())
			if err != nil {
				t.Fatal(err)
			}
			directory := t.TempDir()
			persistence, err := harness.NewJSONLSessionPersistence(directory)
			if err != nil {
				t.Fatal(err)
			}
			detach, err := persistence.Attach(ctx, checkpoint)
			if err != nil {
				t.Fatal(err)
			}
			if err := detach(); err != nil {
				t.Fatal(err)
			}
			if running {
				old.call(t, old.allowed, "TaskStop", struct {
					ID string `json:"task_id"`
				}{task.ID})
			}
			if err := old.harness.Dispose(ctx); err != nil {
				t.Fatal(err)
			}
			if err := old.harness.Drain(ctx); err != nil {
				t.Fatal(err)
			}

			fresh, err := harness.Boot(ctx, harness.Options{})
			if err != nil {
				t.Fatal(err)
			}
			app, err := Mount(ctx, fresh, Options{Workspace: old.root, EnableShell: true, ClaudeTools: true})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = fresh.Dispose(cleanup)
				_ = fresh.Drain(cleanup)
				_ = app.Close()
			})
			for _, tool := range []harness.Tool{harness.TaskOutputTool(app.LookupTask), harness.TaskStopTool(app.LookupTask)} {
				if _, err := fresh.RegisterTool(ctx, "recovered/"+tool.Schema.Name, tool); err != nil {
					t.Fatal(err)
				}
			}
			reader, err := harness.NewJSONLSessionPersistence(directory)
			if err != nil {
				t.Fatal(err)
			}
			loaded, err := reader.Load(ctx, old.allowed.ID())
			if err != nil {
				t.Fatal(err)
			}
			detach, err = reader.Attach(ctx, loaded)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := detach(); err != nil {
					t.Error(err)
				}
			})
			parent, err := fresh.Agents().Resume(ctx, loaded, harness.AgentOptions{})
			if err != nil {
				t.Fatal(err)
			}
			fixture := &claudeFixture{root: old.root, app: app, harness: fresh, allowed: parent}
			result := fixture.call(t, parent, "TaskOutput", taskQuery(task.ID, true, 2000))
			receipt := shellReceipt(t, result)
			want := shellTaskCompleted
			if running {
				want = shellTaskInterrupted
			}
			expectedInline := wantLog
			if test.artifact {
				expectedInline = expectedInline[:2000]
			}
			if receipt.Status != want || result.IsError != running || !running && (receipt.Result == nil || receipt.Result.Stdout.Text != expectedInline) {
				t.Fatalf("cold task manufactured an outcome: %+v %+v", receipt, result)
			}
			if receipt.WorkingLogFile == "" || receipt.WorkingLogFile != task.WorkingLogFile || receipt.WorkingLogPartial != running || receipt.OutputFile != savedArtifact {
				t.Fatalf("cold recovery lost the real output reference: %+v", receipt)
			}
			log, err := os.ReadFile(receipt.WorkingLogFile)
			if err != nil || string(log) != wantLog {
				t.Fatalf("cold log unavailable: %q %v", log, err)
			}
			if test.artifact {
				artifact, err := os.ReadFile(receipt.OutputFile)
				if err != nil || string(artifact) != wantLog {
					t.Fatalf("cold artifact unavailable: bytes=%d error=%v", len(artifact), err)
				}
			}
			persisted, err := reader.Load(ctx, parent.ID())
			if err != nil {
				t.Fatal(err)
			}
			history, err := foldShellTasks(persisted.Events(), parent.ID())
			if err != nil || history[task.ID].terminal == nil || history[task.ID].terminal.Status != want {
				t.Fatalf("recovery fact was not durable: %+v %v", history, err)
			}
			if test.promoted && (history[task.ID].promotion == nil || history[task.ID].intent.Background) {
				t.Fatal("cold recovery lost the real promotion or rewrote its original intent")
			}
			if err := fresh.Dispose(ctx); err != nil {
				t.Fatal(err)
			}
			if err := fresh.Drain(ctx); err != nil {
				t.Fatal(err)
			}
			effects, err := os.ReadFile(filepath.Join(old.root, "effects"))
			if err != nil || string(effects) != "x" {
				t.Fatalf("cold recovery replayed a command: %q %v", effects, err)
			}
		})
	}
}
