package team

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/subagents"
	"github.com/phodal/pero/harness/go/tasks"
)

func TestSharedBoardOwnershipAndRestore(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	defer unblock()
	adapter := harness.AdapterFunc(func(ctx context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		if req.Messages[len(req.Messages)-1].Content[0].Text == "wait for test" {
			select {
			case <-release:
			case <-ctx.Done():
				return harness.Completion{}, ctx.Err()
			}
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{
			Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "evidence checked"}},
		}}, nil
	})
	boot := func() *harness.Harness {
		t.Helper()
		h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"test"}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
		return h
	}
	h := boot()
	home := t.TempDir()
	disk, err := harness.NewJSONLSessionPersistence(home)
	if err != nil {
		t.Fatal(err)
	}
	config := harness.AgentOptions{CWD: t.TempDir(), Provider: "test", Model: "fixture"}
	createRoot := func(id harness.SessionID) (*harness.Agent, func() error) {
		t.Helper()
		opts := config
		opts.ID = id
		agent, err := h.Agents().Create(ctx, opts)
		if err != nil {
			t.Fatal(err)
		}
		detach, err := disk.Attach(ctx, agent.Session())
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = detach() })
		return agent, detach
	}
	root, detach := createRoot("root")
	other, _ := createRoot("unrelated")
	board := Board{Registry: h.Subagents()}
	if err := Mount(ctx, h); err != nil {
		t.Fatal(err)
	}
	assertTools := func(agent *harness.Agent, want int) {
		t.Helper()
		schemas, err := h.Tools().SchemasForAgent(ctx, agent)
		if err != nil {
			t.Fatal(err)
		}
		got := 0
		for _, schema := range schemas {
			if strings.HasPrefix(schema.Name, "team_task_") {
				got++
			}
		}
		if got != want {
			t.Fatalf("Team tool count for %s: got %d, want %d", agent.ID(), got, want)
		}
	}
	call := func(agent *harness.Agent, name, input string) harness.ToolResult {
		t.Helper()
		out, err := h.Tools().Execute(ctx, harness.ToolRequest{
			Agent: agent, Name: name, CallID: harness.ToolCallID(name + "-fixture"), Arguments: json.RawMessage(input),
		})
		if err != nil {
			t.Fatal(err)
		}
		return out.Result
	}
	assertTools(root, 0)
	if _, err := board.List(root); !errors.Is(err, ErrDisabled) {
		t.Fatalf("team enabled without opt-in: %v", err)
	}
	result, matched, err := h.Commands().Execute(ctx, root, "/team on")
	if err != nil || !matched || result.Result.Kind != harness.CommandSuccess {
		t.Fatalf("Team opt-in command: %+v, %v, %v", result, matched, err)
	}
	assertTools(root, 4)
	assertTools(other, 0)
	if _, err := board.List(other); !errors.Is(err, ErrDisabled) {
		t.Fatalf("mode crossed roots: %v", err)
	}
	if err := board.SetEnabled(ctx, other, true); err != nil {
		t.Fatal(err)
	}
	if _, err := subagents.MountInProcess(ctx, h, subagents.InProcessOptions{}); err != nil {
		t.Fatal(err)
	}
	start := func() (*harness.Agent, harness.SubagentActivation) {
		t.Helper()
		child, err := h.Subagents().StartActivation(ctx, "spawn", harness.SubagentRequest{Parent: root, Prompt: "wait for test", MaxDepth: 1}, "caller")
		if err != nil {
			t.Fatal(err)
		}
		agent, ok := h.Agents().Get(child.ChildID)
		if !ok {
			t.Fatal("owned activation did not publish its Agent")
		}
		return agent, child
	}
	a, aRun := start()
	b, bRun := start()
	assertTools(a, 4)
	assertTools(b, 4)
	if err := board.SetEnabled(ctx, a, false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("child changed root mode: %v", err)
	}
	created := call(a, "team_task_create", `{"subject":"Check dataset","description":"Verify the checksum"}`)
	var first Task
	if created.IsError || len(created.Content) != 1 || json.Unmarshal([]byte(created.Content[0].Text), &first) != nil || first.ID != 1 {
		t.Fatalf("create on child produced no shared task: %+v", created)
	}
	second, err := board.Create(ctx, root, NewTask{Title: "Verify notebook", Details: "Reproduce the figure", Dependencies: []TaskID{first.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := board.Update(ctx, b, TaskRef{second.ID, second.Revision}, Claim); !errors.Is(err, ErrBlocked) {
		t.Fatalf("unfinished dependency did not block the claim: %v", err)
	}
	if _, err := board.Update(ctx, other, TaskRef{first.ID, first.Revision}, Claim); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unrelated session found team task: %v", err)
	}
	type claimResult struct {
		agent *harness.Agent
		task  Task
		err   error
	}
	gate := make(chan struct{})
	results := make(chan claimResult, 2)
	for _, agent := range []*harness.Agent{a, b} {
		go func() {
			<-gate
			task, err := board.Update(ctx, agent, TaskRef{first.ID, first.Revision}, Claim)
			results <- claimResult{agent, task, err}
		}()
	}
	close(gate)
	won, lost := <-results, <-results
	if won.err != nil {
		won, lost = lost, won
	}
	if won.err != nil || !errors.Is(lost.err, ErrStale) || won.task.Revision != 2 || won.task.Owner != won.agent.ID() {
		t.Fatalf("expected exactly one owner at revision 2: %v / %v", won, lost)
	}
	if out := call(lost.agent, "team_task_update", `{"task_id":"1","expected_revision":2,"action":"claim","owner":"root"}`); !out.IsError {
		t.Fatal("tool accepted a forged owner")
	}
	if _, err := board.Update(ctx, root, TaskRef{first.ID, 2}, Claim); !errors.Is(err, ErrClaimed) {
		t.Fatalf("Lead stole another member's claim: %v", err)
	}
	if _, err := board.Update(ctx, lost.agent, TaskRef{first.ID, 2}, Complete); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-owner completed task: %v", err)
	}
	if state, err := tasks.Current(root.Session()); err != nil || len(state.List()) != 0 {
		t.Fatalf("Claude session-local task store saw Team data: %v, %v", state.List(), err)
	}
	if _, err := tasks.Commit(ctx, root.Session(), tasks.Command{Create: &tasks.NewTask{Subject: "Claude-only task"}}); err != nil {
		t.Fatal(err)
	}
	if listed, err := board.List(a); err != nil || len(listed) != 2 || !reflect.DeepEqual(listed[0], won.task) {
		t.Fatalf("child view inconsistent with team ownership: %v, %v", listed, err)
	}
	if err := board.SetEnabled(ctx, root, false); err != nil {
		t.Fatal(err)
	}
	assertTools(root, 0)
	assertTools(a, 0)
	if out := call(a, "team_task_get", `{"task_id":"1"}`); !out.IsError {
		t.Fatal("direct Team tool dispatch succeeded while disabled")
	}
	if _, err := board.Update(ctx, won.agent, TaskRef{first.ID, 2}, Complete); !errors.Is(err, ErrDisabled) {
		t.Fatalf("disabled Team accepted mutation: %v", err)
	}
	if err := board.SetEnabled(ctx, root, true); err != nil {
		t.Fatal(err)
	}
	if _, err := root.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "finish fork checkpoint"}}}); err != nil {
		t.Fatal(err)
	}
	fork, err := root.Session().ForkPublic("ordinary-fork", nil)
	if err != nil {
		t.Fatal(err)
	}
	forkAgent, err := h.Agents().Resume(ctx, fork, config)
	if err != nil {
		t.Fatal(err)
	}
	forkDetach, err := disk.Attach(ctx, fork)
	if err != nil {
		t.Fatal(err)
	}
	defer forkDetach()
	if _, err := board.List(forkAgent); !errors.Is(err, ErrDisabled) {
		t.Fatalf("ordinary fork inherited team mode: %v", err)
	}
	if err := board.SetEnabled(ctx, forkAgent, true); err != nil {
		t.Fatal(err)
	}
	if listed, err := board.List(forkAgent); err != nil || len(listed) != 0 {
		t.Fatalf("independently enabled fork inherited source tasks: %v, %v", listed, err)
	}
	unblock()
	for _, run := range []harness.SubagentActivation{aRun, bRun} {
		if err := run.Wait(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if err := h.Dispose(ctx); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
		t.Fatal(err)
	}
	if err := h.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	if _, err := board.List(won.agent); !errors.Is(err, ErrForbidden) {
		t.Fatalf("retired child retained Team authority: %v", err)
	}
	fresh := boot()
	freshDisk, err := harness.NewJSONLSessionPersistence(home)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := freshDisk.Load(ctx, root.ID())
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := fresh.Agents().Resume(ctx, loaded, config)
	if err != nil {
		t.Fatal(err)
	}
	resumedDetach, err := freshDisk.Attach(ctx, loaded)
	if err != nil {
		t.Fatal(err)
	}
	defer resumedDetach()
	if listed, err := (Board{Registry: fresh.Subagents()}).List(resumed); err != nil || len(listed) != 2 || !reflect.DeepEqual(listed[0], won.task) {
		t.Fatalf("restart did not preserve the committed owner and revision: %v, %v", listed, err)
	}
	replayed := Board{Registry: fresh.Subagents()}
	if _, err := replayed.List(root); !errors.Is(err, ErrForbidden) {
		t.Fatalf("old live pointer resolved to reopened root with the same ID: %v", err)
	}
	completed, err := replayed.Update(ctx, resumed, TaskRef{first.ID, 2}, Complete)
	if err != nil || completed.Revision != 3 || completed.Owner != won.agent.ID() || completed.Status != Completed {
		t.Fatalf("lead could not complete recorded owner's task after restore: %+v, %v", completed, err)
	}
	reserved, err := replayed.Update(ctx, resumed, TaskRef{second.ID, 1}, Claim)
	if err != nil || reserved.Status != InProgress || reserved.Owner != resumed.ID() {
		t.Fatalf("completed prerequisite did not unblock downstream task: %+v, %v", reserved, err)
	}
	released, err := replayed.Update(ctx, resumed, TaskRef{second.ID, 2}, Release)
	if err != nil || released.Status != Pending || released.Owner != "" || released.Revision != 3 {
		t.Fatalf("lead could not release its task: %+v, %v", released, err)
	}
}
