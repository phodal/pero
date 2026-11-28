package team

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/subagents"
)

func TestLeadReassignsOnlyReachableContinuableMembers(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	attempts := atomic.Int32{}
	entered := make(chan struct{}, 4)
	leave := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(leave) })
	defer unblock()
	adapter := harness.AdapterFunc(func(ctx context.Context, _ harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		attempts.Add(1)
		entered <- struct{}{}
		select {
		case <-leave:
		case <-ctx.Done():
			return harness.Completion{}, ctx.Err()
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{
			Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}},
		}}, nil
	})
	home := t.TempDir()
	boot := func() (*harness.Harness, *harness.JSONLSessionPersistence, *subagents.ClaudeContribution) {
		t.Helper()
		disk, err := harness.NewJSONLSessionPersistence(home)
		if err != nil {
			t.Fatal(err)
		}
		h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"test"}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
		if err := Mount(ctx, h); err != nil {
			t.Fatal(err)
		}
		definitions := []subagents.AgentDefinition{{Name: "checker", Description: "Check a receipt", Instructions: "Provide evidence.", Background: true}}
		contribution, err := subagents.MountClaude(ctx, h, definitions, subagents.ClaudeOptions{Persistence: disk})
		if err != nil {
			t.Fatal(err)
		}
		return h, disk, contribution
	}
	h, disk, claude := boot()
	if _, err := subagents.MountInProcess(ctx, h, subagents.InProcessOptions{Persistence: disk}); err != nil {
		t.Fatal(err)
	}
	opts := harness.AgentOptions{ID: "lead-session", CWD: t.TempDir(), Provider: "test", Model: "fixture"}
	lead, err := h.Agents().Create(ctx, opts)
	if err != nil {
		t.Fatal(err)
	}
	detach, err := disk.Attach(ctx, lead.Session())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = detach() })
	board := Board{Registry: h.Subagents()}
	if err := board.SetEnabled(ctx, lead, true); err != nil {
		t.Fatal(err)
	}
	oneShot, err := h.Subagents().StartActivation(ctx, "spawn", harness.SubagentRequest{Parent: lead, Prompt: "work", MaxDepth: 1}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	a, ok := h.Agents().Get(oneShot.ChildID)
	if !ok {
		t.Fatal("missing one-shot member")
	}
	b, err := claude.Start(ctx, lead, subagents.ClaudeInvocation{Definition: "checker", Prompt: "work", Description: "receipt checker", Background: true})
	if err != nil {
		t.Fatal(err)
	}
	foreignOpts := opts
	foreignOpts.ID = "unrelated-root"
	foreign, err := h.Agents().Create(ctx, foreignOpts)
	if err != nil {
		t.Fatal(err)
	}
	other, err := claude.Start(ctx, foreign, subagents.ClaudeInvocation{Definition: "checker", Prompt: "other work", Description: "receipt checker", Background: true})
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		select {
		case <-entered:
		case <-ctx.Done():
			t.Fatal("both members did not start")
		}
	}
	task, err := board.Create(ctx, lead, NewTask{Title: "Verify the evidence", Details: "Compare the hashes"})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := board.Update(ctx, a, TaskRef{task.ID, task.Revision}, Claim)
	if err != nil {
		t.Fatal(err)
	}
	ref := TaskRef{task.ID, claimed.Revision}
	if _, err := board.Reassign(ctx, a, ref, b.ChildID); !errors.Is(err, ErrLeadRequired) {
		t.Fatalf("non-lead assigned another member: %v", err)
	}
	if _, err := board.Reassign(ctx, lead, ref, a.ID()); !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("one-shot child accepted as a transfer target: %v", err)
	}
	if _, err := board.Reassign(ctx, lead, ref, other.ChildID); !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("another root’s continuation was accepted: %v", err)
	}
	out, err := h.Tools().Execute(ctx, harness.ToolRequest{
		Agent: lead, Name: "team_task_update", CallID: "transfer",
		Arguments: json.RawMessage(fmt.Sprintf(`{"task_id":"%d","expected_revision":%d,"action":"reassign","owner":%q}`, task.ID, ref.Revision, "receipt checker")),
	})
	var transferred Task
	if err != nil || out.Result.IsError || len(out.Result.Content) != 1 ||
		json.Unmarshal([]byte(out.Result.Content[0].Text), &transferred) != nil ||
		transferred.Owner != b.ChildID || transferred.Status != InProgress || transferred.Revision != 3 {
		t.Fatalf("transfer receipt = %+v, %v", out.Result, err)
	}
	if _, err := board.Update(ctx, a, ref, Complete); !errors.Is(err, ErrStale) {
		t.Fatalf("old owner completed using stale revision: %v", err)
	}
	if _, err := board.Update(ctx, a, TaskRef{task.ID, 3}, Complete); !errors.Is(err, ErrForbidden) {
		t.Fatalf("old owner completed using new revision: %v", err)
	}
	unblock()
	if _, err := h.Subagents().WaitForChildren(ctx, lead); err != nil {
		t.Fatal(err)
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
	fresh, freshDisk, freshClaude := boot()
	history, err := freshDisk.Load(ctx, lead.ID())
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := fresh.Agents().Resume(ctx, history, opts)
	if err != nil {
		t.Fatal(err)
	}
	newDetach, err := freshDisk.Attach(ctx, history)
	if err != nil {
		t.Fatal(err)
	}
	defer newDetach()
	board = Board{Registry: fresh.Subagents()}
	rows, err := board.List(reopened)
	if err != nil || len(rows) != 1 || rows[0].Owner != b.ChildID || rows[0].Revision != 3 {
		t.Fatalf("reopen lost the transferred owner: %+v, %v", rows, err)
	}
	unassigned, err := board.Reassign(ctx, reopened, TaskRef{task.ID, 3}, "")
	if err != nil || unassigned.Owner != "" || unassigned.Status != Pending || unassigned.Revision != 4 {
		t.Fatalf("Lead could not unassign: %+v, %v", unassigned, err)
	}
	unarchive := fresh.Subagents().RegisterArchivedSessionCheck(func(id harness.SessionID) bool { return id == b.ChildID })
	if _, err := board.Reassign(ctx, reopened, TaskRef{task.ID, 4}, "receipt checker"); !errors.Is(err, ErrMemberNotFound) {
		t.Fatalf("archived child was eligible: %v", err)
	}
	unarchive()
	cold, err := board.Reassign(ctx, reopened, TaskRef{task.ID, 4}, "receipt checker")
	_, woke := fresh.Agents().Get(b.ChildID)
	if err != nil || cold.Owner != b.ChildID || cold.Revision != 5 || woke || attempts.Load() != 3 {
		t.Fatalf("cold transfer = %+v, err=%v, woke=%t, requests=%d", cold, err, woke, attempts.Load())
	}
	list, err := fresh.Tools().Execute(ctx, harness.ToolRequest{
		Agent: reopened, Name: "team_task_list", CallID: "owners",
		Arguments: json.RawMessage(`{"owner":"receipt checker"}`),
	})
	var page taskPage
	if err != nil || list.Result.IsError || len(list.Result.Content) != 1 ||
		json.Unmarshal([]byte(list.Result.Content[0].Text), &page) != nil ||
		len(page.Tasks) != 1 || page.Tasks[0].Owner != b.ChildID || attempts.Load() != 3 {
		t.Fatalf("label filter woke a member or lost the exact owner: %+v, %v", list.Result, err)
	}
	if _, err := freshClaude.Start(ctx, reopened, subagents.ClaudeInvocation{Definition: "checker", Prompt: "Duplicate label control", Description: "receipt checker", Background: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := board.Reassign(ctx, reopened, TaskRef{task.ID, 5}, "receipt checker"); err == nil || !strings.Contains(err.Error(), "more than one continuable child") {
		t.Fatalf("ambiguous label silently selected an owner: %v", err)
	}
	exact, err := board.Reassign(ctx, reopened, TaskRef{task.ID, 5}, b.ChildID)
	if err != nil || exact.Owner != b.ChildID || exact.Revision != 6 {
		t.Fatalf("ambiguous label changed the original revision or exact ID route: %+v, %v", exact, err)
	}
}
