package scienceenv

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// Real interpreters and the real tool approval seam; no provider or network.
func TestSharedComputationLifecycle(t *testing.T) {
	ctx := t.Context()
	workspace := t.TempDir()
	h, err := harness.Boot(ctx, harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	env, err := Mount(ctx, h, Options{Workspace: workspace, Python: pythonBin(t), Rscript: filepath.Join(workspace, "missing-Rscript")})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = env.Close() })
	create := func(id string) *harness.Agent {
		t.Helper()
		agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: harness.SessionID(id), CWD: workspace, Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
			_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
				return harness.ApprovalAllowedOnce, nil
			})
			return err
		}})
		if err != nil {
			t.Fatal(err)
		}
		_, err = agent.Session().Append("turn/start", map[string]int{"turn": 1})
		if err != nil {
			t.Fatal(err)
		}
		return agent
	}
	agent, other := create("shared"), create("other")
	seq := 0
	tool := func(agent *harness.Agent, code string) harness.ToolResult {
		t.Helper()
		seq++
		raw, _ := json.Marshal(struct {
			Code string `json:"code"`
		}{code})
		result, err := h.Tools().Execute(ctx, harness.ToolRequest{Agent: agent, Name: pythonTool,
			CallID: harness.ToolCallID(fmt.Sprintf("cell-%d", seq)), Arguments: raw})
		if err != nil {
			t.Fatal(err)
		}
		return result.Result
	}
	command := func(agent *harness.Agent, action, code string, language Language) Snapshot {
		t.Helper()
		raw, _ := json.Marshal(Command{Action: Action(action), Code: code, Language: language})
		value, err := env.DispatchJSON(ctx, agent, raw)
		if err != nil {
			t.Fatal(err)
		}
		return value.(Snapshot)
	}
	settled := func(agent *harness.Agent) Snapshot {
		t.Helper()
		deadline := time.NewTimer(10 * time.Second)
		defer deadline.Stop()
		ticker := time.NewTicker(5 * time.Millisecond)
		defer ticker.Stop()
		for {
			value := command(agent, "status", "", Python)
			if value.Status != "running" {
				return value
			}
			select {
			case <-deadline.C:
				t.Fatal("cell did not settle")
			case <-ticker.C:
			}
		}
	}
	if result := tool(agent, "shared = 40\nprint(shared)"); result.IsError {
		t.Fatalf("Agent setup: %+v", result)
	}
	state := command(agent, "status", "", Python)
	if len(state.History) != 1 || state.History[0].Origin != AgentCell || state.History[0].Outputs[0].Text != "40\n" {
		t.Fatalf("Agent cell not observable: %+v", state)
	}
	command(agent, "execute", "print(shared)\nshared += 2\nprint(shared)", Python)
	state = settled(agent)
	if state.History[1].Origin != UserCell || state.Outputs[0].Text != "40\n42\n" {
		t.Fatalf("User did not continue same state: %+v", state)
	}
	if result := tool(agent, "shared"); result.IsError || !strings.Contains(result.Content[0].Text, "42") {
		t.Fatalf("Agent did not read user change: %+v", result)
	}
	if result := tool(other, "shared"); !result.IsError {
		t.Fatal("another Agent saw shared state")
	}
	command(agent, "execute", "print('before failure')\nraise ValueError('cell failed')", Python)
	state = settled(agent)
	if state.Status != "idle" || !strings.Contains(state.History[3].Error, "cell failed") || state.Outputs[0].Text != "before failure\n" {
		t.Fatalf("failure output lost: %+v", state)
	}
	ready := filepath.Join(workspace, "running")
	command(agent, "execute", fmt.Sprintf("from pathlib import Path\nPath(%q).write_text('ready')\nwhile True: pass", ready), Python)
	deadline := time.NewTimer(10 * time.Second)
	ticker := time.NewTicker(5 * time.Millisecond)
	for {
		if _, err := os.Stat(ready); err == nil {
			break
		}
		select {
		case <-deadline.C:
			t.Fatal("running cell readiness file did not arrive")
		case <-ticker.C:
		}
	}
	ticker.Stop()
	deadline.Stop()
	state = command(agent, "interrupt", "", Python)
	if state.Status != "closed" || state.History[4].Status != "interrupted" || !strings.Contains(state.Error, "discarded") {
		t.Fatalf("interrupt state: %+v", state)
	}
	state = command(agent, "restart", "", Python)
	if state.Status != "idle" || state.Generation != 2 || len(state.History) != 5 || len(state.Outputs) != 0 {
		t.Fatalf("restart must retain receipts but clear state: %+v", state)
	}
	if result := tool(agent, "shared"); !result.IsError {
		t.Fatal("restart retained variables")
	}
	command(other, "execute", "isolated = 9", Python)
	settled(other)
	command(agent, "close", "", Python)
	if result := tool(other, "isolated"); result.IsError || !strings.Contains(result.Content[0].Text, "9") {
		t.Fatal("closing first session killed second")
	}
	r := command(agent, "start", "", R)
	if r.Status != "unavailable" || !strings.Contains(r.Error, "retry Start") || !strings.Contains(r.Error, "--science-rscript") {
		t.Fatalf("missing R must be recoverable: %+v", r)
	}
	current, _ := env.computation(other, Python)
	if err := h.Agents().RemoveExact(ctx, other); err != nil {
		t.Fatal(err)
	}
	if _, err := current.execute(ctx, "1", UserCell, false); err == nil {
		t.Fatal("retired Agent restarted a kernel")
	}
	resumed, err := h.Agents().Resume(ctx, other.Session(), harness.AgentOptions{})
	if err != nil {
		t.Fatal(err)
	}
	state = command(resumed, "status", "", Python)
	if state.Status != "closed" || len(state.History) != 3 || state.History[2].Outputs[0].Text != "9\n" {
		t.Fatalf("resume must retain receipts without claiming a live interpreter: %+v", state)
	}
	command(resumed, "start", "", Python)
	command(resumed, "execute", "print('isolated' in globals())", Python)
	state = settled(resumed)
	if state.Outputs[0].Text != "False\n" || state.Generation != 2 {
		t.Fatalf("resumed Agent reused previous interpreter: %+v", state)
	}
	if _, err := env.DispatchJSON(ctx, agent, json.RawMessage(`{"action":"execute","language":"python","code":"1","session":"other"}`)); err == nil {
		t.Fatal("untrusted session selector accepted")
	}
}
