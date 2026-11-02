package tasks

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestTaskToolsUseTheCallingSessionAndStructuredReceipts(t *testing.T) {
	h, err := harness.Boot(t.Context(), harness.Options{ApprovalPolicy: harness.ApprovalNever})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Dispose(context.Background()); h.Drain(context.Background()) })
	if _, err := Mount(t.Context(), h); err != nil {
		t.Fatal(err)
	}
	parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "task-parent", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	other, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "task-other", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	call := func(agent *harness.Agent, name, input string) harness.ToolResult {
		t.Helper()
		out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, Name: name, CallID: harness.ToolCallID(name + "-call"), Arguments: json.RawMessage(input)})
		if err != nil {
			t.Fatal(err)
		}
		return out.Result
	}
	created := call(parent, "TaskCreate", `{"subject":"Implement","description":"detailed-task-description","activeForm":"Implementing","metadata":{"priority":1}}`)
	var receipt struct {
		Task TaskView `json:"task"`
	}
	if created.IsError || json.Unmarshal([]byte(created.Content[0].Text), &receipt) != nil || receipt.Task.ID != "1" || receipt.Task.Status != Pending {
		t.Fatalf("create receipt: %+v", created)
	}
	updated := call(parent, "TaskUpdate", `{"taskId":"1","status":"completed","owner":"engineer","metadata":{"priority":null,"verified":true}}`)
	if updated.IsError {
		t.Fatalf("update: %+v", updated)
	}
	listed := call(parent, "TaskList", `{}`)
	if listed.IsError || strings.Contains(listed.Content[0].Text, "detailed-task-description") || !strings.Contains(listed.Content[0].Text, `"completed"`) {
		t.Fatalf("list summary: %+v", listed)
	}
	got := call(parent, "TaskGet", `{"taskId":"1"}`)
	if got.IsError || json.Unmarshal([]byte(got.Content[0].Text), &receipt) != nil || receipt.Task.Description != "detailed-task-description" || receipt.Task.Owner != "engineer" {
		t.Fatalf("get: %+v", got)
	}
	metadata, _ := json.Marshal(receipt.Task.Metadata)
	if string(metadata) != `{"verified":true}` {
		t.Fatalf("metadata: %s", metadata)
	}
	if got := call(other, "TaskGet", `{"taskId":"1"}`); !got.IsError {
		t.Fatal("another session read the task")
	}
	if got := call(other, "TaskList", `{}`); got.IsError || !strings.Contains(got.Content[0].Text, `"tasks":[]`) {
		t.Fatal("task list leaked between sessions")
	}
	if got := call(parent, "TaskUpdate", `{"taskId":"1","session":"task-other"}`); !got.IsError {
		t.Fatal("task tool accepted a target session")
	}
	if got := call(parent, "TaskUpdate", `{"taskId":"1","status":"deleted"}`); got.IsError {
		t.Fatal("delete failed")
	}
	if got := call(parent, "TaskGet", `{"taskId":"1"}`); !got.IsError {
		t.Fatal("deleted task remained visible")
	}
}
