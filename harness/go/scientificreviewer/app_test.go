package scientificreviewer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/scientificreview"
)

// One fake at the model adapter seam; all execution, structured tool capture,
// child retirement and durable session behavior use the actual Harness.
type reviewAdapter struct {
	mu       sync.Mutex
	requests []harness.GenerateRequest
	parent   func(harness.GenerateRequest) (harness.Completion, error)
	child    func(harness.GenerateRequest) (harness.Completion, error)
}

func (a *reviewAdapter) Generate(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
	a.mu.Lock()
	a.requests = append(a.requests, request)
	a.mu.Unlock()
	if request.Agent.Delegated() {
		if a.child != nil {
			return a.child(request)
		}
		return structured(`{"findings":[]}`), nil
	}
	if a.parent != nil {
		return a.parent(request)
	}
	return answer(request, "The yield was 90%."), nil
}

func (a *reviewAdapter) observed() (parents, children []harness.GenerateRequest) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, request := range a.requests {
		if request.Agent.Delegated() {
			children = append(children, request)
		} else {
			parents = append(parents, request)
		}
	}
	return parents, children
}

func answer(request harness.GenerateRequest, text string) harness.Completion {
	return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{ID: fmt.Sprintf("answer-%d-%d", request.Turn, request.Step), Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}
}

func structured(raw string) harness.Completion {
	return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "structured_output", ToolCallID: "assessment", Arguments: json.RawMessage(raw)}}}}
}

func reviewerFixture(t *testing.T, adapter *reviewAdapter) (context.Context, *harness.Harness, *App, *harness.Agent, *harness.JSONLSessionPersistence, func() error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	t.Cleanup(cancel)
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := h.Dispose(context.Background()); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
			t.Error(err)
		}
		if err := h.Drain(context.Background()); err != nil {
			t.Error(err)
		}
	})
	persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app, err := Mount(ctx, h, persistence)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "research", CWD: t.TempDir(), MaxSteps: 4, MaxTokens: 8192})
	if err != nil {
		t.Fatal(err)
	}
	detach, err := persistence.Attach(ctx, agent.Session())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := detach(); err != nil {
			t.Error(err)
		}
	})
	return ctx, h, app, agent, persistence, detach
}

func prompt(t *testing.T, ctx context.Context, app *App, agent *harness.Agent) harness.TurnResult {
	t.Helper()
	result, err := agent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Analyze the yield and retain uncertainty."}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := app.AfterTurn(ctx, agent, result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestReviewExecutionPolicy(t *testing.T) {
	for _, row := range []struct {
		name, mode string
		children   int
	}{
		{"automatic defaults off", "default", 0},
		{"automatic one bounded child", "on", 1},
		{"automatic explicitly disabled", "off", 0},
		{"manual request", "manual", 1},
	} {
		t.Run(row.name, func(t *testing.T) {
			adapter := &reviewAdapter{}
			ctx, h, app, agent, _, _ := reviewerFixture(t, adapter)
			if row.mode == "on" || row.mode == "off" {
				if _, err := app.Command(ctx, agent, "/review auto "+row.mode); err != nil {
					t.Fatal(err)
				}
			}
			prompt(t, ctx, app, agent)
			if row.mode == "manual" {
				if _, err := app.Command(ctx, agent, "/review"); err != nil {
					t.Fatal(err)
				}
			}
			parents, children := adapter.observed()
			if len(parents) != 1 || len(children) != row.children {
				reports, _ := readReports(agent)
				t.Fatalf("parent=%d child=%d; want one parent and %d bounded reviews; reports=%#v", len(parents), len(children), row.children, reports)
			}
			reports, err := readReports(agent)
			if err != nil || len(reports) != row.children {
				t.Fatalf("reports=%d error=%v", len(reports), err)
			}
			if row.children == 0 {
				return
			}
			if reports[0].Status != "completed" || reports[0].Conclusion != "no_issues_identified" {
				t.Fatalf("review did not complete: %#v", reports[0])
			}
			if len(children[0].Tools) != 1 || children[0].Tools[0].Name != "structured_output" || children[0].Agent.MaxSteps() > 2 || children[0].MaxTokens > 4096 {
				t.Fatal("reviewer received executable authority or an enlarged budget")
			}
			if _, live := h.Agents().Get(children[0].Agent.ID()); live {
				t.Fatal("completed reviewer child remains live")
			}
			if !strings.Contains(reports[0].Markdown(), "scientific acceptance remains unverified") {
				t.Fatal("model review promoted to scientific acceptance")
			}
		})
	}
}

func TestUnavailableReviewRetainsAnswer(t *testing.T) {
	for _, row := range []struct {
		name  string
		child func(harness.GenerateRequest) (harness.Completion, error)
	}{
		{"missing structured assessment", func(r harness.GenerateRequest) (harness.Completion, error) { return answer(r, "I approve."), nil }},
		{"invented message anchor", func(harness.GenerateRequest) (harness.Completion, error) {
			return structured(`{"findings":[{"category":"numeric_conflict","messageId":"invented","quote":"The yield was 90%.","evidenceIds":[],"rationale":"No saved value.","suggestion":"Supply a result.","certainty":"insufficient_evidence"}]}`), nil
		}},
		{"provider unavailable", func(harness.GenerateRequest) (harness.Completion, error) {
			return harness.Completion{}, errors.New("provider unavailable")
		}},
	} {
		t.Run(row.name, func(t *testing.T) {
			adapter := &reviewAdapter{child: row.child}
			ctx, _, app, agent, _, _ := reviewerFixture(t, adapter)
			if err := app.SetAutomatic(ctx, agent, true); err != nil {
				t.Fatal(err)
			}
			prompt(t, ctx, app, agent)
			reports, err := readReports(agent)
			if err != nil || len(reports) != 1 || reports[0].Status != "unavailable" || len(reports[0].Findings) != 0 {
				t.Fatalf("reports=%#v error=%v", reports, err)
			}
			if len(reports[0].Snapshot.Messages) != 1 || reports[0].Snapshot.Messages[0].Text != "The yield was 90%." {
				t.Fatal("failed review replaced the retained answer")
			}
			parents, children := adapter.observed()
			if len(parents) != 1 || len(children) > 2 {
				t.Fatal("failed review started automatic repair or exceeded its bound")
			}
		})
	}
}

func TestAutomaticReviewWaitsForFinalInjectedContinuation(t *testing.T) {
	adapter := &reviewAdapter{parent: func(request harness.GenerateRequest) (harness.Completion, error) {
		if request.Step == 1 {
			return answer(request, "The preliminary result needs another approved reading step."), nil
		}
		return answer(request, "The yield was 90%."), nil
	}}
	ctx, h, app, agent, _, _ := reviewerFixture(t, adapter)
	definition := point.Define(point.Descriptor{ID: "fixture/research-continuation", Requires: []point.Requirement{point.Require(harness.AgentHooksKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		_, err := h.Hooks().TurnStopping.On(run, func(_ context.Context, input harness.TurnStoppingInput) error {
			if input.Agent.Delegated() {
				return nil
			}
			reports, err := readReports(input.Agent)
			if err != nil {
				return err
			}
			if len(reports) != 0 {
				return errors.New("automatic review ran before the completed parent turn")
			}
			if input.Step != 1 {
				return nil
			}
			return input.Agent.Inject(harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "The approved research checkpoint requires the remaining reading step."}}})
		})
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, "fixture/research-continuation", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := instance.WaitStable(ctx); err != nil {
		t.Fatal(err)
	}
	if err := app.SetAutomatic(ctx, agent, true); err != nil {
		t.Fatal(err)
	}
	result := prompt(t, ctx, app, agent)
	// The protocol owner may report the same completed turn again; it must
	// never spend another model request or manufacture another repair turn.
	if err := app.AfterTurn(ctx, agent, result); err != nil {
		t.Fatal(err)
	}
	parents, children := adapter.observed()
	if len(parents) != 2 || parents[0].Turn != parents[1].Turn || len(children) != 1 {
		t.Fatalf("parent steps=%d child requests=%d; want one continued turn then one review", len(parents), len(children))
	}
	reports, err := readReports(agent)
	if err != nil || len(reports) != 1 {
		t.Fatalf("reports=%#v error=%v", reports, err)
	}
	snapshot := reports[0].Snapshot
	if len(snapshot.Messages) != 2 || snapshot.Messages[1].Text != "The yield was 90%." {
		t.Fatal("review did not bind the final response after injected continuation")
	}
	var ended uint64
	for _, event := range agent.Session().Events() {
		if event.Type == "turn/end" {
			ended = event.Seq
		}
	}
	if ended == 0 || snapshot.ThroughSeq < int64(ended) {
		t.Fatal("review snapshot was frozen before the parent turn settled")
	}
}

func TestFindingsReachNextUserTurnAndRetainDispositionAfterResume(t *testing.T) {
	adapter := &reviewAdapter{child: func(harness.GenerateRequest) (harness.Completion, error) {
		return structured(`{"findings":[{"category":"missing_execution","messageId":"answer-1-1","quote":"The yield was 90%.","evidenceIds":[],"rationale":"No execution receipt supports this reported result in the frozen packet.","suggestion":"Supply the run receipt or qualify the yield as unverified.","certainty":"insufficient_evidence"}]}`), nil
	}}
	ctx, h, app, agent, persistence, detach := reviewerFixture(t, adapter)
	if err := app.SetAutomatic(ctx, agent, true); err != nil {
		t.Fatal(err)
	}
	prompt(t, ctx, app, agent)
	if _, err := app.Command(ctx, agent, "/review auto off"); err != nil {
		t.Fatal(err)
	}
	reports, err := readReports(agent)
	if err != nil || len(reports) != 1 || len(reports[0].Findings) != 1 {
		t.Fatalf("reports=%#v error=%v", reports, err)
	}
	finding := reports[0].Findings[0]
	if _, err := app.Command(ctx, agent, "/review resolve "+finding.ID); err == nil {
		t.Fatal("accepted a resolution without a reason")
	}
	reason := "The follow-up answer labels the saved yield as unverified pending an execution receipt."
	correction := "Correction: the reported 90% yield is unverified until an execution receipt is supplied."
	arguments, err := json.Marshal(disposition{SnapshotHash: reports[0].SnapshotHash, FindingID: finding.ID, State: "resolved", Reason: reason})
	if err != nil {
		t.Fatal(err)
	}
	adapter.parent = func(request harness.GenerateRequest) (harness.Completion, error) {
		if request.Step == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "correct-yield", Name: "scientific_review_disposition", Arguments: arguments}}}}, nil
		}
		return answer(request, correction), nil
	}
	prompt(t, ctx, app, agent)
	parents, children := adapter.observed()
	if len(parents) != 3 || len(children) != 1 || !strings.Contains(parents[1].System, "Supply the run receipt") {
		t.Fatal("the user-requested correction did not receive findings or started an extra review")
	}
	corrected, toolSucceeded := false, false
	for _, event := range agent.Session().Events() {
		switch event.Type {
		case "assistant/message":
			var payload struct {
				Message harness.Message `json:"message"`
			}
			if err := json.Unmarshal(event.Data, &payload); err != nil {
				t.Fatal(err)
			}
			for _, block := range payload.Message.Content {
				corrected = corrected || block.Type == harness.BlockText && block.Text == correction
			}
		case "tool/result":
			var result harness.ContentBlock
			if err := json.Unmarshal(event.Data, &result); err != nil {
				t.Fatal(err)
			}
			if result.ToolCallID != "correct-yield" || result.IsError {
				continue
			}
			for _, block := range result.Content {
				toolSucceeded = toolSucceeded || strings.Contains(block.Text, "Recorded resolved with reason")
			}
		}
	}
	if !corrected || !toolSucceeded {
		t.Fatal("the model's disposition tool failed or its corrected assistant response was not retained")
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	if err := h.Agents().RemoveExact(ctx, agent); err != nil {
		t.Fatal(err)
	}
	loaded, err := persistence.Load(ctx, agent.ID())
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := h.Agents().Resume(ctx, loaded, harness.AgentOptions{MaxSteps: 4, MaxTokens: 8192})
	if err != nil {
		t.Fatal(err)
	}
	reattach, err := persistence.Attach(ctx, resumed.Session())
	if err != nil {
		t.Fatal(err)
	}
	defer reattach()
	status, err := app.Command(ctx, resumed, "/review status")
	if err != nil || !strings.Contains(status, reason) || !strings.Contains(status, "resolved") || !strings.Contains(status, "Manual") {
		t.Fatalf("resume lost review state: %s (%v)", status, err)
	}
	retained, err := readReports(resumed)
	if err != nil || retained[0].SnapshotHash != reports[0].SnapshotHash || retained[0].Snapshot.Hash() != reports[0].Snapshot.Hash() || retained[0].Findings[0].Quote != finding.Quote || retained[0].Findings[0].State != scientificreview.Resolved {
		t.Fatal("disposition rewrote original assessment provenance")
	}
}

func TestSnapshotUsesObservedToolEvidenceAndPinnedHostVersions(t *testing.T) {
	adapter := &reviewAdapter{parent: func(request harness.GenerateRequest) (harness.Completion, error) {
		if request.Step == 1 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{
				{Type: harness.BlockToolCall, ToolCallID: "run", Name: "compute", Arguments: json.RawMessage(`{}`)},
				{Type: harness.BlockToolCall, ToolCallID: "delivery", Name: harness.PublicMCPToolName("pero-app-use", "deliver_artifact"), Arguments: json.RawMessage(`{}`)},
			}}}, nil
		}
		return answer(request, "The yield was 90%."), nil
	}}
	ctx, h, app, agent, _, _ := reviewerFixture(t, adapter)
	receipt := `{"artifact":{"id":"yield","versions":[{"version":2,"sha256":"` + strings.Repeat("a", 64) + `"}]}}`
	for _, name := range []string{"compute", harness.PublicMCPToolName("pero-app-use", "deliver_artifact")} {
		_, err := h.RegisterTool(ctx, "fixture/"+name, harness.Tool{Schema: harness.ToolSchema{Name: name, InputSchema: json.RawMessage(`{"type":"object"}`)}, ExecuteRequest: func(_ context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			text := receipt
			if request.Name == "compute" {
				text = "yield_percent=12\n" + receipt
			}
			return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}, nil
		}})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := app.SetAutomatic(ctx, agent, true); err != nil {
		t.Fatal(err)
	}
	prompt(t, ctx, app, agent)
	reports, err := readReports(agent)
	if err != nil || len(reports) != 1 {
		t.Fatalf("reports=%#v error=%v", reports, err)
	}
	versions, calls, results, requirements := 0, 0, 0, 0
	for _, evidence := range reports[0].Snapshot.Evidence {
		switch evidence.Kind {
		case "artifact_version":
			versions++
			if evidence.ArtifactID != "yield" || evidence.ArtifactVersion != 2 || evidence.SHA256 != strings.Repeat("a", 64) {
				t.Fatal("review lost exact saved version")
			}
		case "tool_call":
			calls++
		case "tool_result":
			results++
		case "user_requirement":
			if strings.Contains(evidence.Text, "retain uncertainty") {
				requirements++
			}
		}
	}
	if versions != 1 || calls != 2 || results != 2 || requirements != 1 {
		t.Fatalf("versions=%d tool calls=%d results=%d user requirements=%d", versions, calls, results, requirements)
	}
	_, children := adapter.observed()
	if len(children) != 1 || !strings.Contains(children[0].Messages[0].Content[0].Text, "yield_percent=12") {
		t.Fatal("actual execution result did not reach frozen reviewer context")
	}
}

func TestSnapshotBoundsEscapedHistoryAndKeepsLatestAnswer(t *testing.T) {
	ctx, _, _, agent, _, _ := reviewerFixture(t, &reviewAdapter{})
	for i := 0; i < 8; i++ {
		if _, err := agent.Session().Append("assistant/message", struct {
			Message harness.Message `json:"message"`
		}{harness.Message{ID: fmt.Sprintf("long-%d", i), Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "answer " + strings.Repeat("<\"\\\n测", 4000)}}}}); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 60; i++ {
		if _, err := agent.Session().Append("tool/result", harness.ContentBlock{Type: harness.BlockToolResult, ToolCallID: harness.ToolCallID(fmt.Sprintf("result-%d", i)), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: strings.Repeat("<\"\\\n测", 4000)}}}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := agent.Session().Append("science/cell", map[string]any{
		"language": "python", "cell": map[string]any{
			"id": 1, "status": "unknown", "origin": "user", "generation": 1,
			"execution_count": 1, "error": "completion was not observed",
			"code": strings.Repeat("<\"\\\n测", 4000), "outputs": []any{},
		},
	}); err != nil {
		t.Fatal(err)
	}
	if err := agent.Session().Flush(ctx); err != nil {
		t.Fatal(err)
	}
	snapshot, err := freeze(agent.Session())
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(snapshot)
	if !snapshot.Truncated || len(encoded) > scientificreview.MaxSnapshotBytes || len(snapshot.Messages) != 6 || snapshot.Messages[5].ID != "long-7" || !utf8.Valid(encoded) {
		t.Fatalf("invalid bounded review packet: bytes=%d messages=%d truncated=%v", len(encoded), len(snapshot.Messages), snapshot.Truncated)
	}
	for _, evidence := range snapshot.Evidence {
		if evidence.Kind == "science_cell" && strings.Contains(evidence.Text, `"status":"unknown"`) && strings.Contains(evidence.Text, `"origin":"user"`) {
			return
		}
	}
	t.Fatal("bounded shared-cell evidence lost its unknown outcome or user origin")
}

func TestSnapshotUsesLatestSharedCellEvidence(t *testing.T) {
	for _, status := range []string{"completed", "failed", "interrupted", "unknown", "running"} {
		t.Run(status, func(t *testing.T) {
			ctx, _, app, agent, _, _ := reviewerFixture(t, &reviewAdapter{})
			prompt(t, ctx, app, agent)
			expected := make(map[string]map[string]any)
			for _, cell := range []struct {
				language, status, origin, code, output string
				id, generation                         int
			}{
				{"python", "running", "user", "print(shared_value)", "", 1, 1},
				{"python", status, "user", "print(shared_value)", "17\n", 1, 1},
				{"r", "completed", "agent", "print(shared_value)", "900\n", 1, 1},
				{"python", "completed", "user", "print(42)", "42\n", 2, 2},
			} {
				payload := map[string]any{"language": cell.language, "cell": map[string]any{
					"id": cell.id, "status": cell.status, "origin": cell.origin, "code": cell.code,
					"generation": cell.generation, "execution_count": cell.id, "error": "",
					"outputs": []any{map[string]any{"output_type": "stream", "name": "stdout", "text": cell.output}},
				}}
				event, err := agent.Session().Append("science/cell", payload)
				if err != nil {
					t.Fatal(err)
				}
				var retained map[string]any
				if err := json.Unmarshal(event.Data, &retained); err != nil {
					t.Fatal(err)
				}
				expected[fmt.Sprintf("%s:%d", cell.language, cell.id)] = retained
			}
			if _, err := app.Command(ctx, agent, "/review"); err != nil {
				t.Fatal(err)
			}
			reports, err := readReports(agent)
			if err != nil || len(reports) != 1 {
				t.Fatalf("reports=%#v error=%v", reports, err)
			}
			seen := make(map[string]bool)
			for _, evidence := range reports[0].Snapshot.Evidence {
				if evidence.Kind != "science_cell" {
					continue
				}
				var receipt map[string]any
				if err := json.Unmarshal([]byte(evidence.Text), &receipt); err != nil {
					t.Fatal(err)
				}
				cell := receipt["cell"].(map[string]any)
				key := fmt.Sprintf("%s:%.0f", receipt["language"], cell["id"])
				if seen[key] || !reflect.DeepEqual(receipt, expected[key]) {
					t.Fatalf("review lost the latest shared cell: %s = %#v", key, receipt)
				}
				seen[key] = true
			}
			if len(seen) != len(expected) {
				t.Fatalf("review retained %d shared cells, want %d", len(seen), len(expected))
			}
		})
	}
}

func TestSnapshotRetainsApprovalAndPlanningFacts(t *testing.T) {
	ctx, _, app, agent, _, _ := reviewerFixture(t, &reviewAdapter{})
	prompt(t, ctx, app, agent)
	for _, kind := range []string{"approval/asked", "approval/decided", "plan/mode", "permission/claude-mode"} {
		if _, err := agent.Session().Append(kind, struct {
			ID      string `json:"id"`
			Outcome string `json:"outcome"`
			Mode    string `json:"mode"`
		}{ID: "approval-fixture", Outcome: "allowed-once", Mode: "plan"}); err != nil {
			t.Fatal(err)
		}
	}
	snapshot, err := freeze(agent.Session())
	if err != nil {
		t.Fatal(err)
	}
	facts := make(map[string]bool)
	for _, evidence := range snapshot.Evidence {
		facts[evidence.Kind] = true
	}
	for _, kind := range []string{"approval/asked", "approval/decided", "plan/mode", "permission/claude-mode"} {
		if !facts[kind] {
			t.Fatalf("review packet omitted retained %s evidence", kind)
		}
	}
}
