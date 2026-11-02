//go:build linux || darwin

package nativetools

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestColdShellTaskRecoveryNeverReplaysEffects(t *testing.T) {
	for _, running := range []bool{false, true} {
		t.Run(map[bool]string{false: "terminal result", true: "uncertain running intent"}[running], func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			old := newBackgroundFixture(t)
			command := "printf x >> effects; printf recovered-output"
			if running {
				command = "printf x >> effects; printf running-log; printf '%s' $$ > task.pid; sleep 30"
			}
			task := startShell(t, old, command)
			if running {
				waitShellPID(t, filepath.Join(old.root, "task.pid"))
			} else if result := old.call(t, old.allowed, "TaskOutput", taskQuery(task.ID, true, 2000)); result.IsError {
				t.Fatal(result)
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
			if receipt.Status != want || result.IsError != running || !running && (receipt.Result == nil || receipt.Result.Stdout.Text != "recovered-output") {
				t.Fatalf("cold task manufactured an outcome: %+v %+v", receipt, result)
			}
			if receipt.OutputFile == "" || receipt.OutputFile != task.OutputFile || receipt.OutputFilePartial != running {
				t.Fatalf("cold recovery lost the real output reference: %+v", receipt)
			}
			log, err := os.ReadFile(receipt.OutputFile)
			wantLog := "recovered-output"
			if running {
				wantLog = "running-log"
			}
			if err != nil || string(log) != wantLog {
				t.Fatalf("cold log unavailable: %q %v", log, err)
			}
			persisted, err := reader.Load(ctx, parent.ID())
			if err != nil {
				t.Fatal(err)
			}
			history, err := foldShellTasks(persisted.Events(), parent.ID())
			if err != nil || history[task.ID].terminal == nil || history[task.ID].terminal.Status != want {
				t.Fatalf("recovery fact was not durable: %+v %v", history, err)
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
