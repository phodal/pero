package team

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strconv"
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
	assertGuidance := func(agent *harness.Agent, want bool) {
		t.Helper()
		prompt, err := h.Prompts().Assemble(ctx, agent)
		if err != nil {
			t.Fatal(err)
		}
		if got := strings.Count(prompt, "Agent Teams is available in this session."); (want && got != 1) || (!want && got != 0) {
			t.Fatalf("Team guidance for %s: got %d sections, enabled = %t", agent.ID(), got, want)
		}
	}
	call := func(runtime *harness.Harness, agent *harness.Agent, name, input string) harness.ToolResult {
		t.Helper()
		out, err := runtime.Tools().Execute(ctx, harness.ToolRequest{
			Agent: agent, Name: name, CallID: harness.ToolCallID(name + "-fixture"), Arguments: json.RawMessage(input),
		})
		if err != nil {
			t.Fatal(err)
		}
		return out.Result
	}
	assertTools(root, 0)
	assertGuidance(root, false)
	if _, err := board.List(root); !errors.Is(err, ErrDisabled) {
		t.Fatalf("team enabled without opt-in: %v", err)
	}
	result, matched, err := h.Commands().Execute(ctx, root, "/team on")
	if err != nil || !matched || result.Result.Kind != harness.CommandSuccess {
		t.Fatalf("Team opt-in command: %+v, %v, %v", result, matched, err)
	}
	assertTools(root, 4)
	assertTools(other, 0)
	assertGuidance(root, true)
	assertGuidance(other, false)
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
	assertGuidance(a, true)
	assertGuidance(b, true)
	if _, err := board.Mode(a); !errors.Is(err, ErrForbidden) {
		t.Fatalf("child advertised a root-only mode setting: %v", err)
	}
	if _, err := board.Snapshot(a); !errors.Is(err, ErrForbidden) {
		t.Fatalf("child could read a root-only Host projection: %v", err)
	}
	if err := board.SetEnabled(ctx, a, false); !errors.Is(err, ErrForbidden) {
		t.Fatalf("child changed root mode: %v", err)
	}
	created := call(h, a, "team_task_create", `{"subject":"Check dataset","description":"Verify the checksum"}`)
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
			results <- claimResult{agent, task.Task, err}
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
	if out := call(h, lost.agent, "team_task_update", `{"task_id":"1","expected_revision":2,"action":"claim","owner":"root"}`); !out.IsError {
		t.Fatal("tool accepted a forged owner")
	}
	owned := call(h, root, "team_task_list", `{"owner":`+strconv.Quote(string(won.agent.ID()))+`,"status":"in_progress"}`)
	var selected taskPage
	if owned.IsError || json.Unmarshal([]byte(owned.Content[0].Text), &selected) != nil ||
		len(selected.Tasks) != 1 || selected.Tasks[0].ID != first.ID || selected.Tasks[0].Owner != won.agent.ID() {
		t.Fatalf("exact child ownership filter did not resolve the saved owner: %+v", owned)
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
	assertGuidance(root, false)
	assertGuidance(a, false)
	if out := call(h, a, "team_task_get", `{"task_id":"1"}`); !out.IsError {
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
	if err := Mount(ctx, fresh); err != nil {
		t.Fatal(err)
	}
	assertTool := func(runtime *harness.Harness, caller *harness.Agent, name, args, fault string, dst any) {
		t.Helper()
		out := call(runtime, caller, "team_task_"+name, args)
		if len(out.Content) != 1 || out.IsError != (fault != "") {
			t.Fatalf("unexpected %s response: %+v", name, out)
		}
		if fault != "" {
			if !strings.Contains(out.Content[0].Text, fault) {
				t.Fatalf("%s: wanted %s, got %s", name, fault, out.Content[0].Text)
			}
		} else if err := json.Unmarshal([]byte(out.Content[0].Text), dst); err != nil {
			t.Fatalf("%s response: %v", name, err)
		}
	}
	var view TaskView
	var task Task
	assertTool(fresh, resumed, "get", `{"task_id":"2"}`, "", &view)
	if !view.Ready || view.Revision != 3 {
		t.Fatalf("completed prerequisite did not project readiness: %+v", view)
	}
	assertTool(fresh, resumed, "update", `{"task_id":"1","expected_revision":3,"action":"set_dependencies","blocked_by":["2"]}`, ErrCycle.Error(), nil)
	assertTool(fresh, resumed, "update", `{"task_id":"1","expected_revision":3,"action":"reopen"}`, "", &task)
	if task.Revision != 4 || task.Status != Pending || task.Owner != "" {
		t.Fatalf("reopen did not preserve ID and clear the owner: %+v", task)
	}
	assertTool(fresh, resumed, "get", `{"task_id":"2"}`, "", &view)
	if view.Ready || view.Revision != 3 {
		t.Fatalf("reopening prerequisite did not reblock unchanged dependent: %+v", view)
	}
	assertTool(fresh, resumed, "update", `{"task_id":"1","expected_revision":4,"action":"delete"}`, ErrDependents.Error(), nil)
	assertTool(fresh, resumed, "update", `{"task_id":"2","expected_revision":2,"action":"set_dependencies","blocked_by":[]}`, ErrStale.Error(), nil)
	assertTool(fresh, resumed, "update", `{"task_id":"2","expected_revision":3,"action":"set_dependencies"}`, ErrArgument.Error(), nil)
	assertTool(fresh, resumed, "update", `{"task_id":"2","expected_revision":3,"action":"set_dependencies","blocked_by":[]}`, "", &task)
	assertTool(fresh, resumed, "update", `{"task_id":"2","expected_revision":4,"action":"edit","subject":"Reproduce the revised figure","write_scopes":["./src/foo/a.go/","src/foo/a.go"]}`, "", &task)
	assertTool(fresh, resumed, "update", `{"task_id":"1","expected_revision":4,"action":"delete"}`, "", &task)
	assertTool(fresh, resumed, "update", `{"task_id":"1","expected_revision":5,"action":"claim"}`, ErrDeleted.Error(), nil)
	assertTool(fresh, resumed, "create", `{"subject":"Missing input","description":"Do not create","blocked_by":["1"]}`, ErrNotFound.Error(), nil)
	if err := fresh.Dispose(ctx); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
		t.Fatal(err)
	}
	if err := fresh.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	if err := resumedDetach(); err != nil {
		t.Fatal(err)
	}
	restarted := boot()
	if err := Mount(ctx, restarted); err != nil {
		t.Fatal(err)
	}
	reloaded, err := freshDisk.Load(ctx, resumed.ID())
	if err != nil {
		t.Fatal(err)
	}
	agent, err := restarted.Agents().Resume(ctx, reloaded, config)
	if err != nil {
		t.Fatal(err)
	}
	lastDetach, err := freshDisk.Attach(ctx, reloaded)
	if err != nil {
		t.Fatal(err)
	}
	defer lastDetach()
	view = TaskView{}
	assertTool(restarted, agent, "get", `{"task_id":"1"}`, "", &view)
	if view.Status != Deleted || view.Revision != 5 || view.Ready {
		t.Fatalf("restart lost tombstone: %+v", view)
	}
	view = TaskView{}
	assertTool(restarted, agent, "get", `{"task_id":"2"}`, "", &view)
	if !view.Ready || view.Revision != 5 || view.Title != "Reproduce the revised figure" || view.Details != "Reproduce the figure" || !reflect.DeepEqual(view.WriteScopes, []writeScope{"src/foo/a.go"}) {
		t.Fatalf("restart lost edited ready task: %+v", view)
	}
	var page struct{ Tasks []TaskView }
	assertTool(restarted, agent, "list", `{}`, "", &page)
	if len(page.Tasks) != 1 || page.Tasks[0].ID != 2 || !page.Tasks[0].Ready || page.Tasks[0].Details != "" {
		t.Fatalf("list leaked a tombstone or omitted the active task: %+v", page)
	}
	assertTool(restarted, agent, "create", `{"subject":"New task","description":"Never recycle deleted IDs","write_scopes":["src/foo"]}`, "", &task)
	if task.ID != 3 {
		t.Fatalf("task ID recycled after deletion: %+v", task)
	}
	assertTool(restarted, agent, "update", `{"task_id":"3","expected_revision":1,"action":"claim"}`, "", &task)
	assertTool(restarted, agent, "create", `{"subject":"Separate tree","description":"Not a scope overlap","write_scopes":["src/foobar"]}`, "", &task)
	assertTool(restarted, agent, "list", `{}`, "", &page)
	if len(page.Tasks) != 3 || page.Tasks[0].ID != 2 || !page.Tasks[0].Ready ||
		!reflect.DeepEqual(page.Tasks[0].WriteScopeWarnings, []string{"write scopes overlap with task 3"}) ||
		len(page.Tasks[2].WriteScopeWarnings) != 0 {
		t.Fatalf("scope advisory crossed a path boundary or changed readiness: %+v", page)
	}
	view = TaskView{}
	assertTool(restarted, agent, "update", `{"task_id":"2","expected_revision":5,"action":"claim"}`, "", &view)
	if view.Status != InProgress || view.Ready || !reflect.DeepEqual(view.WriteScopeWarnings, []string{"write scopes overlap with task 3"}) {
		t.Fatalf("claim did not succeed with current advisory: %+v", view)
	}
	assertTool(restarted, agent, "update", `{"task_id":"3","expected_revision":2,"action":"complete"}`, "", &task)
	view = TaskView{}
	assertTool(restarted, agent, "get", `{"task_id":"2"}`, "", &view)
	if view.Revision != 6 || len(view.WriteScopeWarnings) != 0 {
		t.Fatalf("completion did not clear advisory without changing the other task: %+v", view)
	}
	assertTool(restarted, agent, "update", `{"task_id":"2","expected_revision":6,"action":"edit","write_scopes":["src/../outside"]}`, ErrWriteScope.Error(), nil)
	task = Task{}
	assertTool(restarted, agent, "update", `{"task_id":"2","expected_revision":6,"action":"edit","write_scopes":[]}`, "", &task)
	if task.Revision != 7 || len(task.WriteScopes) != 0 {
		t.Fatalf("explicit empty scopes did not clear only that field: %+v", task)
	}

	assertTool(restarted, agent, "create", `{"subject":"Blocked","description":"Wait on task 4","blocked_by":["4"]}`, "", &task)
	view = TaskView{}
	assertTool(restarted, agent, "create", `{"subject":"Ready","description":"Another ready task"}`, "", &view)
	if !view.Ready || view.Revision != 1 {
		t.Fatalf("create omitted newly committed readiness: %+v", view)
	}
	for _, tc := range []struct {
		args string
		ids  []TaskID
		next int
	}{
		{`{"status":"pending","unowned":true,"ready":true,"limit":1}`, []TaskID{4}, 1},
		{`{"status":"pending","unowned":true,"ready":true,"limit":1,"cursor":1}`, []TaskID{6}, 0},
		{`{"status":"pending","ready":false}`, []TaskID{5}, 0},
		{`{"owner":"lead","ready":false,"status":"completed"}`, []TaskID{3}, 0},
		{`{"unowned":false}`, []TaskID{2, 3}, 0},
		{`{"owner":"unknown"}`, []TaskID{}, 0},
		{`{"cursor":9007199254740991}`, []TaskID{}, 0},
	} {
		var response taskPage
		assertTool(restarted, agent, "list", tc.args, "", &response)
		ids := make([]TaskID, 0, len(response.Tasks))
		for _, v := range response.Tasks {
			ids = append(ids, v.ID)
		}
		if !reflect.DeepEqual(ids, tc.ids) || response.NextCursor != tc.next || response.Tasks == nil {
			t.Fatalf("list %s returned ids %v, cursor %d", tc.args, ids, response.NextCursor)
		}
	}
	assertTool(restarted, agent, "list", `{"owner":"lead","unowned":false}`, ErrArgument.Error(), nil)
	assertTool(restarted, agent, "list", `{"limit":0}`, "invalid tool arguments", nil)
}

func TestGraphMutationRules(t *testing.T) {
	s := state{tasks: []Task{
		{ID: 1, Revision: 1, Status: Pending},
		{ID: 2, Revision: 1, Status: InProgress, Owner: "worker", Dependencies: []TaskID{1}},
		{ID: 3, Revision: 1, Status: Completed, Owner: "other", Dependencies: []TaskID{2}},
	}}
	ids := func(v ...TaskID) *[]TaskID { return &v }
	updated, blank := "updated", " "
	for _, tc := range []struct {
		name  string
		id    TaskID
		actor harness.SessionID
		input mutation
		want  error
	}{
		{"transitive cycle", 1, "lead", mutation{operation: SetDependencies, dependencies: ids(3)}, ErrCycle},
		{"self edge", 2, "worker", mutation{operation: SetDependencies, dependencies: ids(2)}, ErrCycle},
		{"duplicate edge", 2, "worker", mutation{operation: SetDependencies, dependencies: ids(1, 1)}, ErrArgument},
		{"missing blocker", 2, "worker", mutation{operation: SetDependencies, dependencies: ids(4)}, ErrNotFound},
		{"unowned edit", 1, "worker", mutation{operation: Edit, title: &updated}, ErrForbidden},
		{"other member edit", 2, "other", mutation{operation: Edit, title: &updated}, ErrForbidden},
		{"owner edit", 2, "worker", mutation{operation: Edit, title: &updated}, nil},
		{"blank title", 2, "worker", mutation{operation: Edit, title: &blank}, ErrArgument},
		{"completed dependent retains provenance", 2, "worker", mutation{operation: Delete}, ErrDependents},
		{"reopen incomplete", 2, "worker", mutation{operation: Reopen}, ErrTransition},
	} {
		t.Run(tc.name, func(t *testing.T) {
			task, err := s.update(TaskRef{tc.id, 1}, tc.input, tc.actor, "lead")
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
			if tc.want == nil && (task.Title != "updated" || task.Revision != 2 || task.Owner != "worker" || task.Status != InProgress) {
				t.Fatalf("edit changed task identity, owner or status: %+v", task)
			}
		})
	}
}

func TestWriteScopeNormalization(t *testing.T) {
	for _, name := range []string{"", ".", "./", "/abs", `C:\abs`, `\\server\share`, "src/./a", "src/../a", "src//a", "nul\x00path"} {
		t.Run(name, func(t *testing.T) {
			if _, err := normalizeWriteScopes([]string{name}); !errors.Is(err, ErrWriteScope) {
				t.Fatalf("accepted non-workspace scope %q: %v", name, err)
			}
		})
	}
	scopes, err := normalizeWriteScopes([]string{`.\src\foo\`, "src/foo", "src/bar/"})
	if err != nil || !reflect.DeepEqual(scopes, []writeScope{"src/foo", "src/bar"}) {
		t.Fatalf("normalization and deduplication: %v, %v", scopes, err)
	}
}
