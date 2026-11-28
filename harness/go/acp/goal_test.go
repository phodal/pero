package acp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
	harnesssession "github.com/phodal/pero/harness/go/session"
	"github.com/phodal/pero/harness/go/subagents"
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
	newServer := func() *Server { return newGoalTestServer(t, ctx, home, adapter, false, 0) }
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
	ref := foldGoal(saved.Events()).ref()
	if _, rpc := run(first, fmt.Sprintf("/goal edit %s 3 Edit while running", ref)); rpc == nil || rpc.Code != -32602 || !strings.Contains(rpc.Message, "active prompt") {
		t.Fatalf("edit was not rejected during the active round: %+v", rpc)
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

func TestGoalWaitsForOwnedDescendantsBetweenRounds(t *testing.T) {
	for _, name := range []string{"settle", "cancel", "admitting next turn"} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			ownedStarted, releaseOwned := make(chan struct{}), make(chan struct{})
			ownedCancelled := make(chan error, 1)
			unrelatedStarted, releaseUnrelated := make(chan struct{}), make(chan struct{})
			nextRound := make(chan struct{}, 2)
			owned := make(chan harness.SubagentActivation, 1)
			var startOwned func() (harness.SubagentActivation, error)
			adapter := harness.AdapterFunc(func(turnCtx context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				last := req.Messages[len(req.Messages)-1].Content[0].Text
				switch {
				case strings.HasPrefix(last, "Goal round 1/2"):
					child, err := startOwned()
					if err != nil {
						return harness.Completion{}, err
					}
					owned <- child
				case strings.HasPrefix(last, "Goal round 2/2"):
					nextRound <- struct{}{}
				case last == "owned evidence":
					close(ownedStarted)
					select {
					case <-releaseOwned:
					case <-turnCtx.Done():
						ownedCancelled <- context.Cause(turnCtx)
						return harness.Completion{}, turnCtx.Err()
					}
				case last == "unrelated evidence":
					close(unrelatedStarted)
					select {
					case <-releaseUnrelated:
					case <-turnCtx.Done():
						return harness.Completion{}, turnCtx.Err()
					}
				default:
					return harness.Completion{}, fmt.Errorf("unexpected test prompt %q", last)
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{
					Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "evidence checked"}},
				}}, nil
			})
			server := newGoalTestServer(t, ctx, t.TempDir(), adapter, true, 0)
			if _, err := subagents.MountInProcess(ctx, server.h, subagents.InProcessOptions{}); err != nil {
				t.Fatal(err)
			}
			newAgent := func() *harness.Agent {
				t.Helper()
				id, err := server.newSession(ctx, NewSessionParams{CWD: t.TempDir()})
				if err != nil {
					t.Fatal(err)
				}
				record, err := server.currentRecord(id)
				if err != nil {
					t.Fatal(err)
				}
				return record.agent
			}
			root, other := newAgent(), newAgent()
			admitting, releaseAdmission := make(chan struct{}), make(chan struct{})
			finishAdmission := sync.OnceFunc(func() { close(releaseAdmission) })
			defer finishAdmission()
			if name == "admitting next turn" {
				definition := point.Define(point.Descriptor{ID: "fixture/goal-child-admission"}, point.DecodeJSON[struct{}],
					func(run *point.Run, _ struct{}) (point.Dispose, error) {
						_, err := server.h.Hooks().InboxInserted.On(run, func(_ context.Context, in harness.InboxInsertedInput) error {
							if in.Agent.Parent() == root && in.Target == harness.InboxNextTurn {
								// Prompt has published a waking input, but hasn't
								// moved the child from idle to running yet.
								close(admitting)
								<-releaseAdmission
							}
							return nil
						})
						return nil, err
					})
				instance, err := server.h.Runtime().Mount(nil, "fixture/goal-child-admission", definition, nil)
				if err != nil {
					t.Fatal(err)
				}
				if err := instance.WaitStable(ctx); err != nil || instance.Snapshot().State != point.Active {
					t.Fatalf("child admission fixture listener did not activate: %+v, %v", instance.Snapshot(), err)
				}
			}
			start := func(parent *harness.Agent, prompt string) (harness.SubagentActivation, error) {
				return server.h.Subagents().StartActivation(ctx, "spawn", harness.SubagentRequest{
					Parent: parent, Prompt: prompt, MaxDepth: 1,
				}, "caller")
			}
			startOwned = func() (harness.SubagentActivation, error) { return start(root, "owned evidence") }
			unrelated, err := start(other, "unrelated evidence")
			if err != nil {
				t.Fatal(err)
			}
			defer close(releaseUnrelated)
			waitStarted := func(started <-chan struct{}) {
				t.Helper()
				select {
				case <-started:
				case <-ctx.Done():
					t.Fatal("subagent never reached the model adapter")
				}
			}
			waitStarted(unrelatedStarted)
			run := func(line string) (any, *rpcError) {
				body, _ := json.Marshal(PromptParams{SessionID: string(root.ID()), Prompt: []PromptContent{{Type: "text", Text: line}}})
				return server.handle(ctx, request{Method: "session/prompt", Params: body})
			}
			var result any
			var rpc *rpcError
			finished := make(chan struct{})
			go func() {
				result, rpc = run("/goal start 2 Verify the evidence")
				close(finished)
			}()
			if name == "admitting next turn" {
				waitStarted(admitting)
			} else {
				waitStarted(ownedStarted)
			}
			child := <-owned
			select {
			case <-nextRound:
				agent, live := server.h.Agents().Get(child.ChildID)
				var status harness.AgentStatus
				if live {
					status = agent.Status()
				}
				t.Fatalf("round two dispatched before owned child settled: live=%t status=%s", live, status)
			case err := <-ownedCancelled:
				t.Fatalf("owned child was unexpectedly cancelled: %v", err)
			case <-finished:
				t.Fatalf("Goal stopped before owned child settled: %v %v", result, rpc)
			case <-time.After(100 * time.Millisecond):
			}
			if name == "admitting next turn" {
				finishAdmission()
				waitStarted(ownedStarted)
			}
			if state := foldGoal(root.Session().Events()); state.Rounds != 1 {
				t.Fatalf("round two reserved before child settlement: %+v", state)
			}
			want := "end_turn"
			if name == "cancel" {
				body, _ := json.Marshal(SessionParams{SessionID: string(root.ID())})
				server.handleNotification(request{Method: "session/cancel", Params: body})
				want = "cancelled"
			} else {
				close(releaseOwned)
			}
			select {
			case <-finished:
			case <-ctx.Done():
				t.Fatal("Goal did not settle while the unrelated session remained active")
			}
			if rpc != nil || !reflect.DeepEqual(result, map[string]any{"stopReason": want}) {
				t.Fatalf("result=%+v error=%+v", result, rpc)
			}
			if name == "cancel" {
				close(releaseOwned)
				if err := child.Wait(ctx); err != nil {
					t.Fatal(err)
				}
				if state := foldGoal(root.Session().Events()); state.Rounds != 1 || len(nextRound) != 0 {
					t.Fatalf("cancelled Goal advanced after child settled: %+v", state)
				}
				r, err := run("/goal resume")
				if err != nil || !reflect.DeepEqual(r, map[string]any{"stopReason": "end_turn"}) {
					t.Fatalf("explicit resume: result=%+v error=%+v", r, err)
				}
			}
			if len(nextRound) != 1 || foldGoal(root.Session().Events()).Rounds != 2 {
				t.Fatal("expected exactly one second model call and admission")
			}
			select {
			case <-unrelated.Done:
				t.Fatal("unrelated control was not active when Goal finished")
			default:
			}
		})
	}
}

func TestGoalForkRoundRequiresMatchingMessage(t *testing.T) {
	parent := harnesssession.NewSession("parent", t.TempDir())
	def, err := parent.Append(goalDefined, goalDefinition{ID: "revision-1", Objective: "Verify evidence", Limit: 2})
	if err != nil {
		t.Fatal(err)
	}
	var facts = []harnesssession.AdmissionFact{{Type: goalAdmitted, Value: goalRound{goalRef{GoalID: "revision-1"}, 1, "admitted"}}}
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

func newGoalTestServer(t *testing.T, ctx context.Context, home string, adapter harness.AdapterFunc, enableSubagents bool, blockAfter int) *Server {
	t.Helper()
	h, err := harness.Boot(ctx, harness.Options{Adapter: adapter, AdapterProviders: []string{"fixture"}, EnableSubagents: enableSubagents})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
	disk, err := harness.NewJSONLSessionPersistence(home)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture", Goal: true, GoalBlockAfterRounds: blockAfter})
	if err != nil {
		t.Fatal(err)
	}
	server.writer = &wireWriter{encoder: json.NewEncoder(io.Discard)}
	t.Cleanup(func() { _ = server.closeAll(context.Background()) })
	return server
}
func TestGoalModelDecision(t *testing.T) {
	for _, row := range []struct {
		name, outcome, stop string
		wantRounds          int
		canResume           bool
	}{
		{"completed", "completed", "completed", 1, false},
		{"paused", "paused", "paused", 1, true},
		{"invalid", "increase-limit", "round-limit", 3, false},
		{"plain text", "", "round-limit", 3, false},
		{"failed tool finalizer", "completed", "round-limit", 3, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			var requests int
			var advertised, undisclosed, terminalResult bool
			adapter := harness.AdapterFunc(func(_ context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				requests++
				for _, schema := range req.Tools {
					if schema.Name == goalStopTool {
						if requests <= 2 {
							undisclosed = true
						} else {
							advertised = true
						}
					}
				}
				last := req.Messages[len(req.Messages)-1]
				if last.Role == harness.RoleTool && len(last.Content) > 0 &&
					last.Content[0].ToolCallID == "attempt" && last.Content[0].IsError {
					terminalResult = true
				}
				msg := harness.Message{Role: harness.RoleAssistant}
				if requests == 1 || (requests == 3 && row.outcome != "") {
					outcome := row.outcome
					if requests == 1 {
						outcome = "completed"
					}
					args, _ := json.Marshal(goalDecisionArgs{Outcome: goalDecision(outcome)})
					msg.Content = []harness.ContentBlock{{Type: harness.BlockToolCall, Name: goalStopTool, ToolCallID: "attempt", Arguments: args}}
					return harness.Completion{Finish: harness.FinishToolCalls, Message: msg}, nil
				}
				// Plain text, including a spelling of a tool call, is not authority.
				msg.Content = []harness.ContentBlock{{Type: harness.BlockText, Text: `Goal complete. {"outcome":"completed"}`}}
				return harness.Completion{Finish: harness.FinishStop, Message: msg}, nil
			})
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			home, cwd := t.TempDir(), t.TempDir()
			server := newGoalTestServer(t, ctx, home, adapter, false, 0)
			if row.name == "failed tool finalizer" {
				fixture := point.Define(point.Descriptor{ID: "fixture/goal-finalizer"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
					_, err := server.h.Tools().Finalized.On(run, func(_ context.Context, o harness.ToolOutcome) error {
						if o.Request.Name == goalStopTool && !o.Result.IsError {
							return errors.New("fixture: tool did not finalize")
						}
						return nil
					})
					return nil, err
				})
				_, err := server.h.Runtime().Mount(nil, "fixture/goal-finalizer", fixture, nil)
				if err != nil {
					t.Fatal(err)
				}
			}
			id, err := server.newSession(ctx, NewSessionParams{CWD: cwd})
			if err != nil {
				t.Fatal(err)
			}
			run := func(s *Server, line string) {
				t.Helper()
				body, _ := json.Marshal(PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: line}}})
				r, err := s.handle(ctx, request{Method: "session/prompt", Params: body})
				if err != nil || !reflect.DeepEqual(r, map[string]any{"stopReason": "end_turn"}) {
					t.Fatalf("%s: result=%+v error=%+v", line, r, err)
				}
			}
			saved := func(wantRounds int, wantStop string, wantBy goalStopSource) {
				t.Helper()
				session, err := server.persistence.Load(ctx, id)
				if err != nil {
					t.Fatal(err)
				}
				state := foldGoal(session.Events())
				if state.Rounds != wantRounds || state.Stop != wantStop || state.StopBy != wantBy {
					t.Fatalf("goal state %+v; want %d rounds, %s by %s", state, wantRounds, wantStop, wantBy)
				}
			}
			run(server, "ordinary prompt")
			if requests != 2 || undisclosed || !terminalResult {
				t.Fatalf("ordinary prompt: %d requests, tool advertised=%v, rejected=%v", requests, undisclosed, terminalResult)
			}
			saved(0, "", "")
			run(server, "/goal start 3 Verify the evidence")
			by := goalStopDriver
			if row.wantRounds == 1 {
				by = goalStopModel
			}
			saved(row.wantRounds, row.stop, by)
			if !advertised {
				t.Fatal("Goal decision tool was not advertised during the round")
			}
			if row.wantRounds == 1 && requests != 3 {
				t.Fatalf("accepted decision ran extra model requests: %d total", requests)
			}
			beforeRestart := requests
			if err := server.closeSession(ctx, id); err != nil {
				t.Fatal(err)
			}
			second := newGoalTestServer(t, ctx, home, adapter, false, 0)
			if err := second.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: cwd}); err != nil {
				t.Fatal(err)
			}
			run(second, "/goal status")
			if requests != beforeRestart {
				t.Fatalf("restart/status sent %d model requests", requests-beforeRestart)
			}
			run(second, "/goal resume")
			want := beforeRestart
			if row.canResume {
				want += 2
				saved(3, "round-limit", goalStopDriver)
			}
			if requests != want {
				t.Fatalf("explicit resume: got %d total requests, want %d", requests, want)
			}
		})
	}
}

func TestGoalBlockedReasonAfterAdmittedRounds(t *testing.T) {
	for _, tc := range []struct{ configured, minimum int }{{0, 3}, {2, 2}} {
		t.Run(fmt.Sprintf("minimum_%d", tc.minimum), func(t *testing.T) {
			const blocker = "The versioned input dataset is unavailable."
			var requests int
			var earlyError, emptyError bool
			adapter := harness.AdapterFunc(func(_ context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				requests++
				for _, tool := range req.Tools {
					if tool.Name == goalStopTool && !strings.Contains(tool.Description, fmt.Sprintf("from round %d", tc.minimum)) {
						t.Errorf("tool guidance does not use the configured threshold: %s", tool.Description)
					}
				}
				last := req.Messages[len(req.Messages)-1]
				if last.Role == harness.RoleTool && len(last.Content) > 0 {
					result := last.Content[0]
					if result.IsError && len(result.Content) > 0 {
						text := result.Content[0].Text
						earlyError = earlyError || strings.Contains(text, fmt.Sprintf("at least %d admitted Goal rounds", tc.minimum))
						emptyError = emptyError || strings.Contains(text, "requires a nonempty blocked_reason")
					}
				}
				switch requests {
				case 1, tc.minimum + 1, tc.minimum + 2:
					reason := " " + blocker + " "
					if requests == tc.minimum+1 {
						reason = "  "
					}
					args, _ := json.Marshal(goalDecisionArgs{Outcome: goalBlocked, BlockedReason: reason})
					return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{
						Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: goalStopTool,
							ToolCallID: harness.ToolCallID(fmt.Sprintf("block-%d", requests)), Arguments: args}},
					}}, nil
				default:
					return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{
						Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Looked for alternate sources."}},
					}}, nil
				}
			})
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			home, cwd := t.TempDir(), t.TempDir()
			first := newGoalTestServer(t, ctx, home, adapter, false, tc.configured)
			id, err := first.newSession(ctx, NewSessionParams{CWD: cwd})
			if err != nil {
				t.Fatal(err)
			}
			run := func(s *Server, line string) {
				t.Helper()
				body, _ := json.Marshal(PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: line}}})
				result, err := s.handle(ctx, request{Method: "session/prompt", Params: body})
				if err != nil || !reflect.DeepEqual(result, map[string]any{"stopReason": "end_turn"}) {
					t.Fatalf("%s: result=%+v error=%+v", line, result, err)
				}
			}
			run(first, "/goal start 4 Find the required dataset")
			if requests != tc.minimum+2 || !earlyError || !emptyError {
				t.Fatalf("expected round-one rejection, empty reason rejection and no extra closing inference: requests=%d early=%v empty=%v", requests, earlyError, emptyError)
			}
			if err := first.closeSession(ctx, id); err != nil {
				t.Fatal(err)
			}
			second := newGoalTestServer(t, ctx, home, adapter, false, tc.configured)
			var output bytes.Buffer
			second.writer = &wireWriter{encoder: json.NewEncoder(&output)}
			if err := second.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: cwd}); err != nil {
				t.Fatal(err)
			}
			run(second, "/goal status")
			second.writer.mu.Lock()
			status := output.String()
			second.writer.mu.Unlock()
			if requests != tc.minimum+2 || !strings.Contains(status, fmt.Sprintf("%d/4 (blocked by model)", tc.minimum)) || !strings.Contains(status, "Blocker: "+blocker) {
				t.Fatalf("restored status=%s requests=%d", status, requests)
			}
			run(second, "/goal resume")
			saved, err := second.persistence.Load(ctx, id)
			if err != nil {
				t.Fatal(err)
			}
			state := foldGoal(saved.Events())
			if requests != 6 || state.Rounds != 4 || state.Stop != "round-limit" || state.StopDetail != "" {
				t.Fatalf("last round after explicit resume: requests=%d state=%+v", requests, state)
			}
		})
	}
}

func TestGoalEditPreservesRoundsAndFencesStaleRevision(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	var roundPrompts []string
	adapter := harness.AdapterFunc(func(_ context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		roundPrompts = append(roundPrompts, req.Messages[len(req.Messages)-1].Content[0].Text)
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{
			Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Checked the record."}},
		}}, nil
	})
	home, cwd := t.TempDir(), t.TempDir()
	first := newGoalTestServer(t, ctx, home, adapter, false, 0)
	id, err := first.newSession(ctx, NewSessionParams{CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	run := func(s *Server, line, wantError string) {
		t.Helper()
		params, _ := json.Marshal(PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: line}}})
		result, err := s.handle(ctx, request{Method: "session/prompt", Params: params})
		if wantError != "" {
			if err == nil || err.Code != -32602 || !strings.Contains(err.Message, wantError) {
				t.Fatalf("%s: error=%+v; want %s", line, err, wantError)
			}
			return
		}
		if err != nil || !reflect.DeepEqual(result, map[string]any{"stopReason": "end_turn"}) {
			t.Fatalf("%s: result=%+v error=%+v", line, result, err)
		}
	}
	saved := func(s *Server) goalState {
		t.Helper()
		sess, err := s.persistence.Load(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		return foldGoal(sess.Events())
	}
	run(first, "/goal start 1 Verify the original evidence", "")
	before := saved(first)
	run(first, fmt.Sprintf("/goal edit %s 3 Verify the revised evidence", before.ref()), "")
	after := saved(first)
	if after.ID != before.ID || after.Revision != 2 || after.Rounds != 1 || after.Limit != 3 ||
		after.Objective != "Verify the revised evidence" || after.Stop != "" || len(roundPrompts) != 1 {
		t.Fatalf("edit changed round admission or did not persist: %+v, prompts=%v", after, roundPrompts)
	}
	run(first, fmt.Sprintf("/goal edit %s 4 Stale", before.ref()), "stale or missing")
	run(first, fmt.Sprintf("/goal edit %s 0", after.ref()), "cap must be")
	record, err := first.currentRecord(id)
	if err != nil {
		t.Fatal(err)
	}
	journal := record.agent.Session()
	// Even if old facts were present in a journal, neither the prior stop
	// nor the prior round can advance the edited revision.
	if _, err := journal.Append(goalStopped, goalStop{goalRef: before.ref(), Reason: "completed", By: goalStopModel}); err != nil {
		t.Fatal(err)
	}
	events := journal.Events()
	if _, err := journal.AppendUserAdmissionCAS(ctx, uint64(len(events)), []harnesssession.AdmissionFact{{
		Type: goalAdmitted, Value: goalRound{before.ref(), 2, "old-round"},
	}}, []harness.Message{{ID: "old-round", Role: harness.RoleUser, Source: json.RawMessage(`{"kind":"pero-goal"}`), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "old work"}}}}); err != nil {
		t.Fatal(err)
	}
	if got := foldGoal(journal.Events()); got != after {
		t.Fatalf("old-revision facts changed the current goal: %+v", got)
	}
	if err := first.closeSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	second := newGoalTestServer(t, ctx, home, adapter, false, 0)
	if err := second.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: cwd}); err != nil {
		t.Fatal(err)
	}
	run(second, "/goal status", "")
	if got := saved(second); got != after || len(roundPrompts) != 1 {
		t.Fatalf("restart changed goal or ran work: %+v, prompts=%v", got, roundPrompts)
	}
	run(second, "/goal resume", "")
	if len(roundPrompts) != 3 || !strings.Contains(roundPrompts[1], `Goal round 2/3. The operator's objective is "Verify the revised evidence"`) ||
		!strings.Contains(roundPrompts[2], `Goal round 3/3. The operator's objective is "Verify the revised evidence"`) {
		t.Fatalf("resumed prompts did not use the edited objective and remaining budget: %q", roundPrompts)
	}
	run(second, "/goal complete", "")
	run(second, fmt.Sprintf("/goal edit %s 4", after.ref()), "")
	run(second, "/goal resume", "")
	if got := saved(second); got.Revision != 3 || got.Rounds != 3 || got.Stop != "completed" || len(roundPrompts) != 3 {
		t.Fatalf("edit reopened a completed goal: %+v", got)
	}
}
