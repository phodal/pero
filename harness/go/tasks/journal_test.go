package tasks

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestConcurrentTaskCommitsKeepIDsMetadataAndDependencies(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	session := harness.NewSession("concurrent-tasks", t.TempDir())
	const workers = 16
	var work sync.WaitGroup
	errors := make(chan error, workers)
	for i := 0; i < workers; i++ {
		work.Add(1)
		go func(i int) {
			defer work.Done()
			_, err := Commit(ctx, session, Command{Create: &NewTask{Subject: fmt.Sprintf("task %d", i)}})
			if err != nil {
				errors <- err
			}
		}(i)
	}
	work.Wait()
	close(errors)
	for err := range errors {
		t.Fatal(err)
	}
	state, err := Current(session)
	if err != nil || len(state.List()) != workers {
		t.Fatalf("concurrent creates: %v %v", state.List(), err)
	}
	for i := 1; i <= workers; i++ {
		if _, err := state.Get(TaskID(strconv.Itoa(i))); err != nil {
			t.Fatal("concurrent creates lost an ID")
		}
	}
	errors = make(chan error, workers)
	for i := 2; i <= workers; i++ {
		work.Add(1)
		go func(i int) {
			defer work.Done()
			value, _ := NewJSONValue([]byte(strconv.Itoa(i)))
			_, err := Commit(ctx, session, Command{Update: &Update{TaskID: "1", AddBlockedBy: []TaskID{TaskID(strconv.Itoa(i))}, Metadata: Metadata{{Name: fmt.Sprintf("key-%d", i), Value: value}}}})
			if err != nil {
				errors <- err
			}
		}(i)
	}
	work.Wait()
	close(errors)
	for err := range errors {
		t.Fatal(err)
	}
	state, err = Current(session)
	if err != nil {
		t.Fatal(err)
	}
	task, err := state.Get("1")
	if err != nil || len(task.BlockedBy) != workers-1 || len(task.Metadata) != workers-1 {
		t.Fatalf("concurrent update lost fields: %+v %v", task, err)
	}
	for _, other := range state.List() {
		if other.ID != "1" && !reflect.DeepEqual(other.Blocks, []TaskID{"1"}) {
			t.Fatalf("reverse graph lost: %+v", other)
		}
	}
}

func TestTasksPersistAndResumeWithoutTurnReset(t *testing.T) {
	session := harness.NewSession("durable-tasks", t.TempDir())
	persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	detach, err := persistence.Attach(t.Context(), session)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := session.Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	first, err := Commit(t.Context(), session, Command{Create: &NewTask{Subject: "write", Description: "Write implementation"}})
	if err != nil {
		t.Fatal(err)
	}
	second, err := Commit(t.Context(), session, Command{Create: &NewTask{Subject: "verify"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Commit(t.Context(), session, Command{Update: &Update{TaskID: second.Task.ID, AddBlockedBy: []TaskID{first.Task.ID}, Status: pointer(InProgress)}}); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Append("turn/end", struct {
		Turn   int    `json:"turn"`
		Reason string `json:"reason"`
	}{1, "stop"}); err != nil {
		t.Fatal(err)
	}
	before, err := Current(session)
	if err != nil {
		t.Fatal(err)
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	loaded, err := persistence.Load(t.Context(), session.Header().ID)
	if err != nil {
		t.Fatal(err)
	}
	after, err := Current(loaded)
	if err != nil || !reflect.DeepEqual(after.List(), before.List()) {
		t.Fatalf("cold restore lost task state: %v %v", after.List(), err)
	}
	if len(loaded.SurfaceSeqs()) != 0 {
		t.Fatal("task facts became prompt surface messages")
	}
	detach, err = persistence.Attach(t.Context(), loaded)
	if err != nil {
		t.Fatal(err)
	}
	defer detach()
	if _, err := loaded.Append("turn/start", struct {
		Turn int `json:"turn"`
	}{2}); err != nil {
		t.Fatal(err)
	}
	created, err := Commit(t.Context(), loaded, Command{Create: &NewTask{Subject: "release"}})
	if err != nil || created.Task.ID != "3" {
		t.Fatalf("resume reused task ID: %+v %v", created, err)
	}
	current, err := Current(loaded)
	if err != nil || len(current.List()) != 3 {
		t.Fatal("new turn cleared task table")
	}
}

func TestTaskJournalRejectsUnsupportedOrMalformedChanges(t *testing.T) {
	for _, raw := range []string{`{"version":2,"command":{"create":{"subject":"future"}}}`, `{"version":1,"command":{"update":{"taskId":"missing"}}}`, `{"version":1,"command":{"create":{"subject":"x"}},"unknown":true}`} {
		session := harness.NewSession("malformed", "")
		if _, err := session.Append(EventType, json.RawMessage(raw)); err != nil {
			t.Fatal(err)
		}
		if _, err := Current(session); err == nil {
			t.Fatalf("invalid task record was ignored: %s", raw)
		}
	}
}
