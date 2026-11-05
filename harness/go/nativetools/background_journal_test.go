package nativetools

import (
	"encoding/json"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/shell"
)

func shellFact(seq uint64, kind string, fact any) harness.Event {
	raw, _ := json.Marshal(fact)
	return harness.Event{Seq: seq, Type: kind, Data: raw}
}

func TestShellTaskTerminalObservation(t *testing.T) {
	for _, row := range []struct {
		name, tool, callTask, receiptTask, kind string
		status                                  shellTaskStatus
		retrieval                               harness.TaskRetrieval
		terminal, replaced, reused, want        bool
	}{
		{"completed", "TaskOutput", "bash-one", "bash-one", "shell", shellTaskCompleted, harness.TaskRetrieved, true, false, false, true},
		{"failed execution retrieved", "TaskOutput", "bash-one", "bash-one", "shell", shellTaskFailed, harness.TaskRetrieved, true, false, false, true},
		{"stopped execution retrieved", "TaskStop", "bash-one", "bash-one", "shell", shellTaskInterrupted, harness.TaskRetrieved, true, false, false, true},
		{"running read", "TaskOutput", "bash-one", "bash-one", "shell", shellTaskRunning, harness.TaskNotReady, false, false, false, false},
		{"read timeout", "TaskOutput", "bash-one", "bash-one", "shell", shellTaskCompleted, harness.TaskTimedOut, true, false, false, false},
		{"wrong requested task", "TaskOutput", "bash-other", "bash-one", "shell", shellTaskCompleted, harness.TaskRetrieved, true, false, false, false},
		{"wrong receipt task", "TaskOutput", "bash-one", "bash-other", "shell", shellTaskCompleted, harness.TaskRetrieved, true, false, false, false},
		{"wrong task kind", "TaskOutput", "bash-one", "bash-one", "agent", shellTaskCompleted, harness.TaskRetrieved, true, false, false, false},
		{"without terminal fact", "TaskOutput", "bash-one", "bash-one", "shell", shellTaskCompleted, harness.TaskRetrieved, false, false, false, false},
		{"other tool", "Read", "bash-one", "bash-one", "shell", shellTaskCompleted, harness.TaskRetrieved, true, false, false, false},
		{"surface replacement", "TaskOutput", "bash-one", "bash-one", "shell", shellTaskCompleted, harness.TaskRetrieved, true, true, false, false},
		{"reused id belongs to later call", "Read", "bash-one", "bash-one", "shell", shellTaskCompleted, harness.TaskRetrieved, true, false, true, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			intent := shellTaskIntent{Version: 1, ID: "bash-one", Owner: "owner", Command: "true", Workdir: "/workspace", TimeoutMS: 30000, Background: true}
			events := []harness.Event{shellFact(1, shellTaskStarted, intent)}
			if row.terminal {
				exit := 0
				events = append(events, shellFact(2, shellTaskEnded, shellTaskTerminal{Version: 1, ID: intent.ID, Owner: intent.Owner, Status: row.status, Result: &shell.RunResult{ExitCode: &exit}}))
			}
			call := func(seq uint64, name string) harness.Event {
				return harness.Event{Seq: seq, Type: "tool/call", Data: json.RawMessage(`{"callId":"read","name":"` + name + `","arguments":{"task_id":"` + row.callTask + `"}}`)}
			}
			if row.reused {
				events = append(events, call(3, "TaskOutput"))
			}
			events = append(events, call(4, row.tool))
			receipt := `{"task_id":"` + row.receiptTask + `","kind":"` + row.kind + `","status":"` + string(row.status) + `","retrieval_status":"` + string(row.retrieval) + `"}`
			result := shellFact(5, "tool/result", harness.ContentBlock{Type: harness.BlockToolResult, ToolCallID: "read", IsError: row.status == shellTaskFailed, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: receipt}}})
			if row.replaced {
				result.SurfaceOp = json.RawMessage(`{"op":"replace","start":3,"end":3}`)
			}
			events = append(events, result)
			history, err := foldShellTasks(events, intent.Owner)
			if err != nil || (history[intent.ID].observedSeq != 0) != row.want {
				t.Fatalf("observation=%d want=%t err=%v", history[intent.ID].observedSeq, row.want, err)
			}
		})
	}
}

func TestShellTaskPromotionTransitions(t *testing.T) {
	intent := shellTaskIntent{Version: 1, ID: "bash-promoted", Owner: "owner", Command: "printf work", Workdir: "/workspace", TimeoutMS: 100}
	promotion := shellTaskPromotion{Version: 1, ID: intent.ID, Owner: intent.Owner, TimeoutMS: 1800000}
	exit := 0
	terminal := shellTaskTerminal{Version: 1, ID: intent.ID, Owner: intent.Owner, Status: shellTaskCompleted, Result: &shell.RunResult{ExitCode: &exit}}
	start, move, end := shellFact(1, shellTaskStarted, intent), shellFact(2, shellTaskPromoted, promotion), shellFact(3, shellTaskEnded, terminal)
	background := intent
	background.Background = true
	interactive := intent
	interactive.HostMode = BashInteractive
	unlimited := promotion
	unlimited.TimeoutMS = 0
	unlimited.NoDeadline = true
	for _, test := range []struct {
		name   string
		events []harness.Event
		fail   bool
	}{
		{"running promotion", []harness.Event{start, move}, false},
		{"finished promotion", []harness.Event{start, move, end}, false},
		{"without foreground intent", []harness.Event{move}, true},
		{"repeated promotion", []harness.Event{start, move, move}, true},
		{"after terminal", []harness.Event{start, end, move}, true},
		{"explicit background cannot promote", []harness.Event{shellFact(1, shellTaskStarted, background), move}, true},
		{"interactive unlimited", []harness.Event{shellFact(1, shellTaskStarted, interactive), shellFact(2, shellTaskPromoted, unlimited)}, false},
		{"unattended cannot be unlimited", []harness.Event{start, shellFact(2, shellTaskPromoted, unlimited)}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			history, err := foldShellTasks(test.events, intent.Owner)
			if (err != nil) != test.fail {
				t.Fatalf("history=%+v error=%v", history, err)
			}
			if !test.fail && history[intent.ID].promotion == nil {
				t.Fatal("missing promotion fact")
			}
		})
	}
}

func TestShellTaskJournalTransitions(t *testing.T) {
	intent := shellTaskIntent{Version: 1, ID: "bash-fixture", Owner: "parent", Command: "printf fixture", Workdir: "/workspace", TimeoutMS: 1800000}
	zero := 0
	terminal := shellTaskTerminal{Version: 1, ID: intent.ID, Owner: intent.Owner, Status: shellTaskCompleted, Result: &shell.RunResult{ExitCode: &zero}}
	start, end := shellFact(1, shellTaskStarted, intent), shellFact(2, shellTaskEnded, terminal)
	otherIntent, otherTerminal := intent, terminal
	otherIntent.Owner, otherTerminal.Owner = "other", "other"
	unknown := terminal
	unknown.Status = "invented"
	for _, test := range []struct {
		name        string
		events      []harness.Event
		count       int
		ended, fail bool
	}{
		{"running intent", []harness.Event{start}, 1, false, false},
		{"completed result", []harness.Event{start, end}, 1, true, false},
		{"inherited owner excluded", []harness.Event{shellFact(1, shellTaskStarted, otherIntent), shellFact(2, shellTaskEnded, otherTerminal)}, 0, false, false},
		{"terminal without intent", []harness.Event{end}, 0, false, true},
		{"repeated identity", []harness.Event{start, start}, 0, false, true},
		{"repeated terminal", []harness.Event{start, end, end}, 0, false, true},
		{"unknown status", []harness.Event{start, shellFact(2, shellTaskEnded, unknown)}, 0, false, true},
		{"unknown intent field", []harness.Event{{Type: shellTaskStarted, Data: json.RawMessage(`{"version":1,"task_id":"bash-fixture","owner":"parent","command":"true","workdir":"/workspace","timeout_ms":1,"unexpected":true}`)}}, 0, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			state, err := foldShellTasks(test.events, "parent")
			if (err != nil) != test.fail || !test.fail && len(state) != test.count {
				t.Fatalf("state=%+v error=%v", state, err)
			}
			if !test.fail && test.count > 0 && (state[intent.ID].terminal != nil) != test.ended {
				t.Fatalf("terminal changed: %+v", state)
			}
		})
	}
}
