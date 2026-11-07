package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type paperResearchConfig struct {
	ProgramID     string    `json:"programId"`
	Deadline      time.Time `json:"deadline"`
	ModelRequests int       `json:"modelRequests"`
	AuditPath     string    `json:"auditPath"`
}

type paperResearchFeedback struct {
	PendingJob       bool   `json:"pendingJob"`
	ContinueResearch bool   `json:"continueResearch"`
	Checkpoint       string `json:"checkpoint"`
	NextAction       string `json:"nextAction"`
}

func mountPaperResearch(ctx context.Context, h *harness.Harness, config paperResearchConfig) error {
	allowed := make(map[string]bool)
	for _, tool := range []string{"app_describe", "app_write", "content_read", "app__paper-agent__research-program", "app__paper-agent__research-search", "app__paper-agent__research-acquire", "app__paper-agent__research-deliver"} {
		allowed[harness.PublicMCPToolName("pero-app-use", tool)] = true
	}
	definition := point.Define(point.Descriptor{ID: "harness/paper-research", Requires: []point.Requirement{point.Require(harness.ToolRegistryKey), point.Require(harness.AgentHooksKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		tools, err := point.Resolve(run, harness.ToolRegistryKey)
		if err != nil {
			return nil, err
		}
		if _, err = tools.RestrictWhen(run, func(_ *harness.Agent, name string) bool { return allowed[name] }); err != nil {
			return nil, err
		}
		hooks, err := point.Resolve(run, harness.AgentHooksKey)
		if err != nil {
			return nil, err
		}
		_, err = hooks.TurnStopping.On(run, func(ctx context.Context, input harness.TurnStoppingInput) error {
			if !input.CanContinue || input.Concluded || ctx.Err() != nil || time.Now().After(config.Deadline) {
				return nil
			}
			var feedback paperResearchFeedback
			for {
				feedback = paperResearchFeedback{}
				outcome, err := h.Tools().Execute(ctx, harness.ToolRequest{Agent: input.Agent, CallID: harness.ToolCallID(fmt.Sprintf("paper-feedback-%d-%d", input.Turn, input.Step)), Name: harness.PublicMCPToolName("pero-app-use", "app__paper-agent__research-program"), Arguments: json.RawMessage(`{"operation":"feedback"}`)})
				if err != nil || outcome.Result.IsError || ctx.Err() != nil {
					return nil
				}
				for _, content := range outcome.Result.Content {
					if content.Type != harness.BlockText {
						continue
					}
					var envelope struct {
						Result json.RawMessage `json:"result"`
					}
					if json.Unmarshal([]byte(content.Text), &envelope) != nil {
						continue
					}
					raw := envelope.Result
					if len(raw) == 0 {
						raw = []byte(content.Text)
					}
					if json.Unmarshal(raw, &feedback) == nil {
						break
					}
				}
				if !feedback.ContinueResearch || feedback.Checkpoint == "" {
					return nil
				}
				if !feedback.PendingJob {
					break
				}
				// Observe a finite external worker without spending model or continuation allowance.
				if !time.Now().Before(config.Deadline) {
					return nil
				}
				timer := time.NewTimer(250 * time.Millisecond)
				select {
				case <-ctx.Done():
					timer.Stop()
					return nil
				case <-timer.C:
				}
			}
			count, repeated := 0, 0
			for _, event := range input.Agent.Session().Events() {
				if event.Type != "paper/research-feedback" {
					continue
				}
				var record struct {
					ProgramID  string `json:"programId"`
					Checkpoint string `json:"checkpoint"`
				}
				if err := json.Unmarshal(event.Data, &record); err != nil {
					return err
				}
				if record.ProgramID == config.ProgramID {
					count++
					if record.Checkpoint == feedback.Checkpoint {
						repeated++
					}
				}
			}
			if count >= 8 || repeated >= 2 {
				return nil
			}
			if _, err = input.Agent.Session().Append("paper/research-feedback", struct {
				ProgramID  string `json:"programId"`
				Checkpoint string `json:"checkpoint"`
			}{config.ProgramID, feedback.Checkpoint}); err != nil {
				return err
			}
			if err = input.Agent.Session().Flush(ctx); err != nil {
				return err
			}
			return input.Agent.Inject(harness.Message{ID: fmt.Sprintf("paper-feedback-%s-%d", config.ProgramID, count+1), Role: harness.RoleUser, Source: json.RawMessage(`{"kind":"paper-research-feedback"}`), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Runtime research checkpoint: the approved program is unfinished. Continue within its remaining allowance. " + feedback.NextAction}}})
		})
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, "paper-research", definition, nil)
	if err == nil {
		err = instance.WaitStable(ctx)
	}
	if err == nil && instance.Snapshot().State == point.Failed {
		err = errors.New(instance.Snapshot().LastError)
	}
	return err
}
