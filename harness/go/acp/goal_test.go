package acp

import (
	"context"
	"encoding/json"
	"io"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	harnesssession "github.com/phodal/pero/harness/go/session"
)

func TestGoalACPExplicitResumeAndCap(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	firstStarted := make(chan struct{})
	var mu sync.Mutex
	var requests []string
	adapter := harness.AdapterFunc(func(ctx context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		last := req.Messages[len(req.Messages)-1]
		line, _, _ := strings.Cut(last.Content[0].Text, ".")
		mu.Lock()
		requests = append(requests, line)
		first := len(requests) == 1
		mu.Unlock()
		if first {
			close(firstStarted)
			<-ctx.Done()
			return harness.Completion{}, ctx.Err()
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{
			Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "evidence updated"}},
		}}, nil
	})
	home, cwd := t.TempDir(), t.TempDir()
	newServer := func() *Server {
		t.Helper()
		h, err := harness.Boot(ctx, harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
		disk, err := harness.NewJSONLSessionPersistence(home)
		if err != nil {
			t.Fatal(err)
		}
		server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture", Goal: true})
		if err != nil {
			t.Fatal(err)
		}
		server.writer = &wireWriter{encoder: json.NewEncoder(io.Discard)}
		t.Cleanup(func() { _ = server.closeAll(context.Background()) })
		return server
	}
	first := newServer()
	id, err := first.newSession(ctx, NewSessionParams{CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	run := func(s *Server, line string) (any, *rpcError) {
		body, _ := json.Marshal(PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: line}}})
		return s.handle(ctx, request{Method: "session/prompt", Params: body})
	}
	expect := func(s *Server, line string, stop string) {
		t.Helper()
		r, err := run(s, line)
		if err != nil || !reflect.DeepEqual(r, map[string]any{"stopReason": stop}) {
			t.Fatalf("%s: result=%+v error=%+v", line, r, err)
		}
	}
	if _, err := run(first, "/goal start 11 Too many rounds"); err == nil || err.Code != -32602 {
		t.Fatalf("invalid cap was not rejected: %+v", err)
	}
	var cancelledStop any
	var cancelledErr *rpcError
	done := make(chan struct{})
	go func() {
		cancelledStop, cancelledErr = run(first, "/goal start 2 Verify the recorded result")
		close(done)
	}()
	select {
	case <-firstStarted:
	case <-ctx.Done():
		t.Fatal("first round did not reach provider")
	}
	// The round must already be durable when the model starts; a stop must
	// not refund an admitted round even when the provider did not finish.
	saved, err := first.persistence.Load(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	if state := foldGoal(saved.Events()); state.Objective != "Verify the recorded result" || state.Rounds != 1 || state.Limit != 2 {
		t.Fatalf("round was not durable before dispatch: %+v", state)
	}
	params, _ := json.Marshal(SessionParams{SessionID: string(id)})
	first.handleNotification(request{Method: "session/cancel", Params: params})
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("cancelled Goal did not settle")
	}
	if cancelledErr != nil || !reflect.DeepEqual(cancelledStop, map[string]any{"stopReason": "cancelled"}) {
		t.Fatalf("cancel result=%+v error=%+v", cancelledStop, cancelledErr)
	}
	if err := first.closeSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	check := func(want ...string) {
		t.Helper()
		mu.Lock()
		defer mu.Unlock()
		if !reflect.DeepEqual(requests, want) {
			t.Fatalf("requests = %q; want %q", requests, want)
		}
	}
	second := newServer()
	if err := second.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: cwd}); err != nil {
		t.Fatal(err)
	}
	record, err := second.currentRecord(id)
	if err != nil {
		t.Fatal(err)
	}
	if err := record.agent.WhenIdle(ctx); err != nil {
		t.Fatal(err)
	}
	expect(second, "/goal status", "end_turn")
	check("Goal round 1/2")
	expect(second, "/goal resume", "end_turn")
	expect(second, "/goal resume", "end_turn")
	check("Goal round 1/2", "Goal round 2/2")
	if state := foldGoal(record.agent.Session().Events()); state.Rounds != 2 || state.Stop != "round-limit" {
		t.Fatalf("resumed Goal did not stop at its original cap: %+v", state)
	}
	expect(second, "/goal complete", "end_turn")
	expect(second, "/goal resume", "end_turn")
	check("Goal round 1/2", "Goal round 2/2")
}

func TestGoalForkRoundRequiresMatchingMessage(t *testing.T) {
	parent := harnesssession.NewSession("parent", t.TempDir())
	def, err := parent.Append(goalDefined, goalDefinition{"revision-1", "Verify evidence", 2})
	if err != nil {
		t.Fatal(err)
	}
	var facts = []harnesssession.AdmissionFact{{Type: goalAdmitted, Value: goalRound{"revision-1", 1, "admitted"}}}
	batch, err := parent.AppendUserAdmissionCAS(t.Context(), def.Seq, facts, []harness.Message{{
		ID: "admitted", Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "first"}},
	}})
	if err != nil || len(batch) != 2 {
		t.Fatalf("admission batch=%v error=%v", batch, err)
	}
	for _, row := range []struct {
		id     harness.SessionID
		anchor uint64
		want   int
	}{{"before-message", batch[0].Seq, 0}, {"with-message", batch[1].Seq, 1}} {
		forked, err := parent.ForkPublic(row.id, &row.anchor)
		if err != nil {
			t.Fatal(err)
		}
		if got := foldGoal(forked.Events()); got.ID != "revision-1" || got.Rounds != row.want {
			t.Fatalf("%s: %+v", row.id, got)
		}
	}
}
