package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func researchTestAgent(t *testing.T, adapter harness.Adapter, feedback func(context.Context, harness.ToolRequest) (harness.ToolResult, error)) (context.Context, *harness.Harness, *harness.Agent) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	t.Cleanup(cancel)
	h, err := harness.Boot(ctx, harness.Options{Adapter: adapter})
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
	audit := filepath.Join(t.TempDir(), "attempts.log")
	if err := os.WriteFile(audit, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := mountPaperResearch(ctx, h, paperResearchConfig{
		ProgramID: "program-1", Deadline: time.Now().Add(time.Hour), ModelRequests: 64, AuditPath: audit,
	}); err != nil {
		t.Fatal(err)
	}
	_, err = h.RegisterTool(ctx, "fixture/research-program", harness.Tool{
		Schema: harness.ToolSchema{
			Name:        harness.PublicMCPToolName("pero-app-use", "app__paper-agent__research-program"),
			InputSchema: json.RawMessage(`{"type":"object","properties":{"operation":{"const":"feedback"}},"required":["operation"],"additionalProperties":false}`),
		},
		ExecuteRequest: feedback,
	})
	if err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "research", MaxSteps: 32})
	if err != nil {
		t.Fatal(err)
	}
	return ctx, h, agent
}

func researchAnswer() harness.Completion {
	return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{
		Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "The current reading step is finished."}},
	}}
}

func researchFeedback(keepGoing bool, checkpoint, nextAction string) harness.ToolResult {
	raw, _ := json.Marshal(struct {
		App    string `json:"app"`
		Tool   string `json:"tool"`
		Result struct {
			ContinueResearch bool    `json:"continueResearch"`
			Checkpoint       string  `json:"checkpoint"`
			NextAction       string  `json:"nextAction"`
			StopReason       *string `json:"stopReason"`
		} `json:"result"`
	}{App: "paper-agent", Tool: "research-program", Result: struct {
		ContinueResearch bool    `json:"continueResearch"`
		Checkpoint       string  `json:"checkpoint"`
		NextAction       string  `json:"nextAction"`
		StopReason       *string `json:"stopReason"`
	}{ContinueResearch: keepGoing, Checkpoint: checkpoint, NextAction: nextAction}})
	return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}
}

func TestPaperResearchContinuesInTheSameTurnFromBoundFeedback(t *testing.T) {
	var requests []harness.GenerateRequest
	feedbackCalls := 0
	ctx, _, agent := researchTestAgent(t, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		requests = append(requests, request)
		if len(requests) > 2 {
			return harness.Completion{}, errors.New("unexpected request after terminal feedback")
		}
		return researchAnswer(), nil
	}), func(_ context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
		feedbackCalls++
		return researchFeedback(feedbackCalls == 1, "checkpoint-1", "Read the conflicting replication paper."), nil
	})
	_, err := agent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Start the approved research program."}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 2 || feedbackCalls != 2 {
		t.Fatalf("model requests=%d feedback=%d; want two normal stops with one continuation", len(requests), feedbackCalls)
	}
	if requests[0].Agent != agent || requests[1].Agent != agent || requests[0].Turn != requests[1].Turn {
		t.Fatal("feedback started another agent or turn")
	}
	found := false
	for _, message := range requests[1].Messages {
		for _, content := range message.Content {
			found = found || strings.Contains(content.Text, "Read the conflicting replication paper.")
		}
	}
	if !found {
		t.Fatal("the resumed request did not receive the bound next action")
	}
}

func TestPaperResearchStopsWithoutExtraRequestsOnTerminalOrFailedFeedback(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		feedbackCalls int
	}{
		{"terminal", 1},
		{"feedback-error", 1},
		{"feedback-unavailable", 1},
		{"provider-error", 0},
		{"cancel", 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			requests, feedbackCalls := 0, 0
			ctx, _, agent := researchTestAgent(t, harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				requests++
				if requests > 1 || scenario.name == "provider-error" {
					return harness.Completion{}, errors.New("provider failed")
				}
				if scenario.name == "cancel" {
					request.Agent.Cancel(errors.New("user stopped research"))
					return harness.Completion{}, context.Canceled
				}
				return researchAnswer(), nil
			}), func(context.Context, harness.ToolRequest) (harness.ToolResult, error) {
				feedbackCalls++
				switch scenario.name {
				case "feedback-error":
					return harness.ToolResult{IsError: true, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "program is unavailable"}}}, nil
				case "feedback-unavailable":
					return harness.ToolResult{}, errors.New("feedback transport unavailable")
				default:
					return researchFeedback(false, "checkpoint-1", ""), nil
				}
			})
			_, err := agent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Start research."}}})
			if scenario.name == "terminal" && err != nil {
				t.Fatal(err)
			}
			if requests != 1 || feedbackCalls != scenario.feedbackCalls {
				t.Fatalf("model requests=%d feedback=%d; want 1/%d (prompt error=%v)", requests, feedbackCalls, scenario.feedbackCalls, err)
			}
		})
	}
}

func TestPaperResearchFeedbackBoundsPreventEmptyProgressLoops(t *testing.T) {
	for _, scenario := range []struct {
		name               string
		changingCheckpoint bool
		requests           int
	}{
		{"same checkpoint twice", false, 3},
		{"eight continuations per session", true, 9},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			requests, feedbackCalls := 0, 0
			ctx, _, agent := researchTestAgent(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
				requests++
				if requests > 20 {
					return harness.Completion{}, errors.New("feedback loop exceeded the test boundary")
				}
				return researchAnswer(), nil
			}), func(context.Context, harness.ToolRequest) (harness.ToolResult, error) {
				feedbackCalls++
				checkpoint := "unchanged"
				if scenario.changingCheckpoint {
					checkpoint = fmt.Sprintf("checkpoint-%d", feedbackCalls)
				}
				return researchFeedback(true, checkpoint, "Read another candidate paper."), nil
			})
			prompt := harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Research."}}}
			if _, err := agent.Prompt(ctx, prompt); err != nil {
				t.Fatal(err)
			}
			if requests != scenario.requests {
				t.Fatalf("model requests=%d; want %d including bounded feedback continuations", requests, scenario.requests)
			}
			if scenario.changingCheckpoint {
				if _, err := agent.Prompt(ctx, prompt); err != nil {
					t.Fatal(err)
				}
				if requests != scenario.requests+1 {
					t.Fatal("a new prompt reset the session's consumed feedback continuation budget")
				}
			}
		})
	}
}

func TestPaperResearchRejectsForbiddenToolsAtDispatch(t *testing.T) {
	feedbackCalls := 0
	ctx, h, agent := researchTestAgent(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return researchAnswer(), nil
	}), func(context.Context, harness.ToolRequest) (harness.ToolResult, error) {
		feedbackCalls++
		return researchFeedback(false, "checkpoint-1", ""), nil
	})
	for i, name := range []string{
		"shell",
		harness.PublicMCPToolName("external", "search"),
		harness.PublicMCPToolName("external", "app__paper-agent__research-program"),
	} {
		invocations := 0
		_, err := h.RegisterTool(ctx, fmt.Sprintf("fixture/forbidden-%d", i), harness.Tool{
			Schema: harness.ToolSchema{Name: name, InputSchema: json.RawMessage(`{"type":"object"}`)},
			Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
				invocations++
				return harness.ToolResult{}, nil
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		outcome, err := h.Tools().Execute(ctx, harness.ToolRequest{Agent: agent, Name: name, CallID: harness.ToolCallID(fmt.Sprintf("denied-%d", i)), Arguments: json.RawMessage(`{}`)})
		if invocations != 0 || (err == nil && !outcome.Result.IsError) {
			t.Fatalf("forbidden tool %s reached dispatch: invocations=%d outcome=%+v error=%v", name, invocations, outcome, err)
		}
	}
	allowed, err := h.Tools().Execute(ctx, harness.ToolRequest{
		Agent: agent, Name: harness.PublicMCPToolName("pero-app-use", "app__paper-agent__research-program"),
		CallID: "allowed-feedback", Arguments: json.RawMessage(`{"operation":"feedback"}`),
	})
	if err != nil || allowed.Result.IsError || feedbackCalls != 1 {
		t.Fatalf("the bound program tool was denied: feedback=%d outcome=%+v error=%v", feedbackCalls, allowed, err)
	}
}

type researchFeedbackObservation struct {
	ctx   context.Context
	reply chan harness.ToolResult
}

type researchFeedbackGate struct {
	observed chan researchFeedbackObservation
}

func (g researchFeedbackGate) execute(ctx context.Context, _ harness.ToolRequest) (harness.ToolResult, error) {
	observation := researchFeedbackObservation{ctx: ctx, reply: make(chan harness.ToolResult)}
	select {
	case g.observed <- observation:
	case <-ctx.Done():
		return harness.ToolResult{}, ctx.Err()
	}
	select {
	case result := <-observation.reply:
		return result, nil
	case <-ctx.Done():
		return harness.ToolResult{}, ctx.Err()
	}
}

func TestPaperResearchWaitsForPendingWorkerWithoutSpendingContinuations(t *testing.T) {
	var requests atomic.Int32
	gate := researchFeedbackGate{observed: make(chan researchFeedbackObservation)}
	ctx, _, agent := researchTestAgent(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		requests.Add(1)
		return researchAnswer(), nil
	}), gate.execute)
	done := make(chan error, 1)
	go func() {
		_, err := agent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Research the pending source."}}})
		done <- err
	}()
	// Repeated observations of one external job must not spend either feedback
	// allowance or start a model request. The test, not a sleep, releases each result.
	for attempt := 0; attempt < 3; attempt++ {
		select {
		case observation := <-gate.observed:
			if requests.Load() != 1 {
				t.Fatalf("pending worker started model request %d before it completed", requests.Load())
			}
			observation.reply <- harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText,
				Text: `{"app":"paper-agent","tool":"research-program","result":{"continueResearch":true,"pendingJob":true,"checkpoint":"pending","nextAction":"Wait for the source worker.","stopReason":null}}`}}}
		case err := <-done:
			t.Fatalf("turn ended while its worker was pending: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	for continuation := 0; continuation < 8; continuation++ {
		select {
		case observation := <-gate.observed:
			if requests.Load() != int32(continuation+1) {
				t.Fatalf("ready continuation %d saw %d model requests", continuation, requests.Load())
			}
			observation.reply <- researchFeedback(true, fmt.Sprintf("ready-%d", continuation), "Read the acquired source.")
		case err := <-done:
			t.Fatalf("pending observations consumed the continuation allowance at %d: %v", continuation, err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	// A listener may inspect the final state before noticing the overall cap.
	for {
		select {
		case observation := <-gate.observed:
			observation.reply <- researchFeedback(false, "complete", "")
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
			if requests.Load() != 9 {
				t.Fatalf("model requests=%d; want initial request plus eight ready continuations", requests.Load())
			}
			return
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
}

func TestPaperResearchPendingWorkerWaitStopsOnContextCancellation(t *testing.T) {
	var requests atomic.Int32
	gate := researchFeedbackGate{observed: make(chan researchFeedbackObservation)}
	ctx, _, agent := researchTestAgent(t, harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		requests.Add(1)
		return researchAnswer(), nil
	}), gate.execute)
	promptCtx, cancelPrompt := context.WithCancel(ctx)
	defer cancelPrompt()
	done := make(chan error, 1)
	go func() {
		_, err := agent.Prompt(promptCtx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Research the pending source."}}})
		done <- err
	}()
	select {
	case observation := <-gate.observed:
		observation.reply <- harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText,
			Text: `{"app":"paper-agent","tool":"research-program","result":{"continueResearch":true,"pendingJob":true,"checkpoint":"pending","nextAction":"Wait for the source worker.","stopReason":null}}`}}}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	var pending researchFeedbackObservation
	select {
	case pending = <-gate.observed:
		if requests.Load() != 1 {
			t.Fatalf("waiting for the worker started another model request: %d", requests.Load())
		}
	case err := <-done:
		t.Fatalf("turn ended before observing its pending worker again: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	cancelPrompt()
	deadline, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	select {
	case <-pending.ctx.Done():
	case <-deadline.Done():
		t.Fatal("cancelling the prompt did not cancel its in-flight feedback observation")
	}
	select {
	case <-done:
	case <-deadline.Done():
		t.Fatal("cancelling the prompt did not stop the pending-worker wait")
	}
	if requests.Load() != 1 {
		t.Fatalf("cancelled worker wait made %d model requests; want only the initial request", requests.Load())
	}
}
