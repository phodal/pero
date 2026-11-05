package tasks

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"
)

func taskState(t *testing.T) State {
	t.Helper()
	var state State
	for _, subject := range []string{"first", "second", "third"} {
		next, _, err := Apply(state, Command{Create: &NewTask{Subject: subject}})
		if err != nil {
			t.Fatal(err)
		}
		state = next
	}
	return state
}
func pointer[T any](value T) *T { return &value }

func TestTaskGraphAndStatusTransitions(t *testing.T) {
	for _, test := range []struct {
		name                    string
		updates                 []Update
		wantError               bool
		wantBlocked, wantBlocks []TaskID
		wantStatus              TaskStatus
		wantCompletions         int
	}{
		{name: "reverse dependency", updates: []Update{{TaskID: "1", AddBlocks: []TaskID{"2"}}}, wantBlocks: []TaskID{"2"}, wantStatus: Pending},
		{name: "duplicate edge", updates: []Update{{TaskID: "1", AddBlockedBy: []TaskID{"2", "2"}}}, wantBlocked: []TaskID{"2"}, wantStatus: Pending},
		{name: "missing dependency", updates: []Update{{TaskID: "1", AddBlockedBy: []TaskID{"missing"}}}, wantError: true},
		{name: "self dependency", updates: []Update{{TaskID: "1", AddBlockedBy: []TaskID{"1"}}}, wantError: true},
		{name: "cycle", updates: []Update{{TaskID: "1", AddBlockedBy: []TaskID{"2"}}, {TaskID: "2", AddBlockedBy: []TaskID{"1"}}}, wantError: true},
		{name: "reverse cycle", updates: []Update{{TaskID: "1", AddBlocks: []TaskID{"2"}}, {TaskID: "2", AddBlocks: []TaskID{"1"}}}, wantError: true},
		{name: "invalid status", updates: []Update{{TaskID: "1", Status: pointer(TaskStatus("done"))}}, wantError: true},
		{name: "completion once", updates: []Update{{TaskID: "1", Status: pointer(InProgress)}, {TaskID: "1", Status: pointer(Completed)}, {TaskID: "1", Status: pointer(Completed)}}, wantStatus: Completed, wantCompletions: 1},
		{name: "reopened completion", updates: []Update{{TaskID: "1", Status: pointer(Completed)}, {TaskID: "1", Status: pointer(Pending)}, {TaskID: "1", Status: pointer(Completed)}}, wantStatus: Completed, wantCompletions: 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			state := taskState(t)
			completions := 0
			var finalErr error
			for _, update := range test.updates {
				next, transition, err := Apply(state, Command{Update: &update})
				if err != nil {
					finalErr = err
					break
				}
				state = next
				if transition.Completion != nil {
					completions++
				}
			}
			if (finalErr != nil) != test.wantError {
				t.Fatalf("error=%v wantError=%v", finalErr, test.wantError)
			}
			if test.wantError {
				return
			}
			got, err := state.Get("1")
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got.BlockedBy, append([]TaskID{}, test.wantBlocked...)) || !reflect.DeepEqual(got.Blocks, append([]TaskID{}, test.wantBlocks...)) || got.Status != test.wantStatus || completions != test.wantCompletions {
				t.Fatalf("task=%+v completions=%d", got, completions)
			}
		})
	}
}

func TestTaskDeleteUnblocksWithoutReusingIdentity(t *testing.T) {
	state := taskState(t)
	state, _, _ = Apply(state, Command{Update: &Update{TaskID: "2", AddBlockedBy: []TaskID{"1"}}})
	next, transition, err := Apply(state, Command{Update: &Update{TaskID: "1", Status: pointer(Deleted)}})
	if err != nil || transition.Task.Status != Deleted || len(next.List()) != 2 {
		t.Fatalf("delete: %+v %v", transition, err)
	}
	if _, err := next.Get("1"); !errors.Is(err, ErrTaskNotFound) {
		t.Fatal("deleted task remained readable")
	}
	dependent, _ := next.Get("2")
	if len(dependent.BlockedBy) != 0 {
		t.Fatal("deleted dependency still blocks task")
	}
	_, created, err := Apply(next, Command{Create: &NewTask{Subject: "fourth"}})
	if err != nil || created.Task.ID != "4" {
		t.Fatalf("identity reused: %+v %v", created, err)
	}
	if _, _, err := Apply(next, Command{Update: &Update{TaskID: "1", Status: pointer(Pending)}}); !errors.Is(err, ErrTaskNotFound) {
		t.Fatal("deleted task revived")
	}
}

func TestTaskCompletionReleasesDependentWorkAndKeepsGraphHistory(t *testing.T) {
	state := taskState(t)
	state, _, _ = Apply(state, Command{Update: &Update{TaskID: "2", AddBlockedBy: []TaskID{"1"}}})
	state, _, _ = Apply(state, Command{Update: &Update{TaskID: "1", Status: pointer(Completed)}})
	dependent, _ := state.Get("2")
	prerequisite, _ := state.Get("1")
	if len(dependent.BlockedBy) != 0 || len(prerequisite.Blocks) != 0 {
		t.Fatal("completed prerequisite still blocks work")
	}
	state, _, _ = Apply(state, Command{Update: &Update{TaskID: "1", Status: pointer(Pending)}})
	dependent, _ = state.Get("2")
	if !reflect.DeepEqual(dependent.BlockedBy, []TaskID{"1"}) {
		t.Fatal("reopening lost prerequisite history")
	}
}

func TestTaskMetadataAndDetachedReplay(t *testing.T) {
	var metadata Metadata
	if err := json.Unmarshal([]byte(`{"priority":1,"nested":{"enabled":true}}`), &metadata); err != nil {
		t.Fatal(err)
	}
	command := Command{Create: &NewTask{Subject: "inspect", Description: "original", Metadata: metadata}}
	state, created, err := Apply(State{}, command)
	if err != nil {
		t.Fatal(err)
	}
	command.Create.Subject = "caller-mutated"
	metadata[0].Name = "caller-mutated"
	var patch Metadata
	if err := json.Unmarshal([]byte(`{"priority":2,"nested":null,"extra":[1,2]}`), &patch); err != nil {
		t.Fatal(err)
	}
	next, updated, err := Apply(state, Command{Update: &Update{TaskID: "1", Metadata: patch, Owner: pointer("reviewer"), ActiveForm: pointer("Inspecting")}})
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := Fold([]Change{created.Change, updated.Change})
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(replayed.List(), next.List()) {
		t.Fatal("detached changes did not replay the committed state")
	}
	task, _ := next.Get("1")
	raw, err := json.Marshal(task.Metadata)
	if err != nil || string(raw) != `{"extra":[1,2],"priority":2}` || task.Subject != "inspect" || task.Owner != "reviewer" {
		t.Fatalf("metadata merge: %+v %s %v", task, raw, err)
	}
	previous, _ := state.Get("1")
	previousRaw, _ := json.Marshal(previous.Metadata)
	if string(previousRaw) != `{"nested":{"enabled":true},"priority":1}` {
		t.Fatal("update mutated the previous state")
	}
}

func TestTaskInvalidCommandsAndVersions(t *testing.T) {
	for _, command := range []Command{{}, {Create: &NewTask{Subject: " "}}, {Update: &Update{TaskID: "missing"}}, {Create: &NewTask{Subject: "x"}, Update: &Update{TaskID: "1"}}} {
		if _, _, err := Apply(State{}, command); err == nil {
			t.Fatalf("invalid command accepted: %+v", command)
		}
	}
	if _, err := Fold([]Change{{Version: 2, Command: Command{Create: &NewTask{Subject: "new"}}}}); err == nil {
		t.Fatal("unknown task event version was ignored")
	}
}
