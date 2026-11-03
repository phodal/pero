package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestBackgroundForkReturnsBeforeTheChildFinishes(t *testing.T) {
	release := make(chan struct{})
	entered := make(chan struct{})
	var once sync.Once
	f := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, _ *http.Request) {
		once.Do(func() { close(entered) })
		<-release
		claudeTextAnswer(w, "background-result")
	}, true, nil, ClaudeOptions{})
	result, err := f.claude.Start(f.ctx, f.parent, ClaudeInvocation{Prompt: "run later", Background: true, ReportCompletion: true})
	if err != nil || result.Status != harness.SubagentRunning || result.ChildID == "" {
		t.Fatalf("start=%+v err=%v", result, err)
	}
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("child did not reach the model")
	}
	close(release)
	deadline := time.Now().Add(5 * time.Second)
	for {
		messages, err := f.parent.Session().DeriveMessages()
		if err != nil {
			t.Fatal(err)
		}
		var text string
		for _, message := range messages {
			for _, block := range message.Content {
				text += block.Text
			}
		}
		if strings.Contains(text, "background-result") && strings.Contains(text, string(result.ChildID)) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("parent did not receive the background result: %s", text)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestClaudeInvocationHonorsAChildStepCap(t *testing.T) {
	f := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, _ *http.Request) {
		claudeTextAnswer(w, "done")
	}, true, nil, ClaudeOptions{})
	var steps int
	if _, err := f.claude.Invoke(f.ctx, f.parent, ClaudeInvocation{Prompt: "cap", MaxSteps: 3, ConfigureChild: func(_ context.Context, _ *point.Run, child *harness.Agent) error {
		steps = child.MaxSteps()
		return nil
	}}); err != nil || steps != 3 {
		t.Fatalf("steps=%d err=%v", steps, err)
	}
	if _, err := f.claude.Invoke(f.ctx, f.parent, ClaudeInvocation{Prompt: "too many", MaxSteps: 50}); err == nil || !strings.Contains(err.Error(), "exceeds parent") {
		t.Fatalf("over-cap err=%v", err)
	}
}

func TestClaudeTrustedInvocationUsesExistingChildAuthority(t *testing.T) {
	for _, allowed := range []bool{true, false} {
		t.Run(fmt.Sprintf("allowed=%v", allowed), func(t *testing.T) {
			root := t.TempDir()
			file := filepath.Join(root, "fork.txt")
			var calls, configured atomic.Int32
			f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Model    string            `json:"model"`
					Messages []json.RawMessage `json:"messages"`
					Tools    []struct {
						Function struct {
							Name string `json:"name"`
						} `json:"function"`
					} `json:"tools"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				var content strings.Builder
				for _, message := range body.Messages {
					content.Write(message)
				}
				messages := content.String()
				if body.Model != "worker-model" || len(body.Tools) != 1 || body.Tools[0].Function.Name != "Write" || !strings.Contains(messages, "BETA_PERSONA") || strings.Contains(messages, "ALPHA_PERSONA") {
					t.Errorf("trusted invocation bypassed selection: %+v", body)
				}
				if calls.Add(1) == 1 {
					if !strings.Contains(messages, "FORK_ONLY_BODY") || !strings.Contains(messages, "TRUSTED_CHILD_RECEIPT") || configured.Load() != 1 {
						t.Errorf("child setup did not precede its first request: %s", messages)
					}
					args, _ := json.Marshal(struct {
						Path    string `json:"file_path"`
						Content string `json:"content"`
					}{file, "fork-child-write"})
					quoted, _ := json.Marshal(string(args))
					claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"write-fork","type":"function","function":{"name":"Write","arguments":`+string(quoted)+`}}]},"finish_reason":"tool_calls"}]}`)
					return
				}
				claudeTextAnswer(w, "fork finished")
			}, allowed, []AgentDefinition{
				{Name: "alpha:worker", Description: "alpha", Instructions: "ALPHA_PERSONA", Tools: []string{"Write"}},
				{Name: "beta:worker", Description: "beta", Instructions: "BETA_PERSONA", Tools: []string{"Write"}},
			}, ClaudeOptions{})
			result, err := f.claude.Invoke(f.ctx, f.parent, ClaudeInvocation{Definition: "worker", Origin: "beta", Prompt: "FORK_ONLY_BODY", Model: "sonnet", ConfigureChild: func(_ context.Context, run *point.Run, child *harness.Agent) error {
				configured.Add(1)
				_, err := f.h.Hooks().PreStep.Use(run, func(_ context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
					input, err := next(input)
					if err == nil && input.Agent == child && input.Turn == 1 && input.Step == 1 {
						input.Messages = append(input.Messages, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "TRUSTED_CHILD_RECEIPT"}}})
					}
					return input, err
				})
				return err
			}})
			if err != nil || result.Status != harness.SubagentCompleted || result.ChildID == "" || len(result.Output) == 0 || result.Output[0].Text != "fork finished" {
				t.Fatalf("trusted result=%+v error=%v", result, err)
			}
			text, readErr := os.ReadFile(file)
			if allowed && (readErr != nil || string(text) != "fork-child-write") || !allowed && !errors.Is(readErr, os.ErrNotExist) || f.approvals.Load() != 1 {
				t.Fatalf("write=%s error=%v approvals=%d", text, readErr, f.approvals.Load())
			}
			for _, event := range f.parent.Session().Events() {
				if strings.Contains(string(event.Data), "FORK_ONLY_BODY") || strings.Contains(string(event.Data), "TRUSTED_CHILD_RECEIPT") || event.Type == "tool/call" {
					t.Fatalf("trusted invoke fabricated a parent tool call or leaked child instructions: %+v", event)
				}
			}
			if len(f.h.Agents().List()) != 1 {
				t.Fatal("synchronous invocation did not join child cleanup")
			}
			before := calls.Load()
			_, err = f.claude.Invoke(f.ctx, f.parent, ClaudeInvocation{Prompt: "invalid route", Model: "unmapped", ConfigureChild: func(context.Context, *point.Run, *harness.Agent) error { configured.Add(1); return nil }})
			if err == nil || calls.Load() != before || configured.Load() != 1 {
				t.Fatalf("invalid route reached child configuration or provider: %v", err)
			}
		})
	}
}

func TestClaudeTrustedInvocationCancellationJoinsChild(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	f := newClaudeHTTPFixture(t, t.TempDir(), func(_ http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		close(started)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}, true, nil, ClaudeOptions{})
	ctx, cancel := context.WithCancel(f.ctx)
	defer cancel()
	type outcome struct {
		result harness.SubagentResult
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := f.claude.Invoke(ctx, f.parent, ClaudeInvocation{Prompt: "wait for cancellation"})
		done <- outcome{result, err}
	}()
	select {
	case <-started:
	case <-f.ctx.Done():
		t.Fatal(f.ctx.Err())
	}
	cancel()
	select {
	case outcome := <-done:
		if !errors.Is(outcome.err, context.Canceled) || outcome.result.Status != harness.SubagentAborted || len(f.h.Agents().List()) != 1 {
			t.Fatalf("cancelled invocation=%+v error=%v", outcome.result, outcome.err)
		}
	case <-f.ctx.Done():
		t.Fatal("trusted invocation did not cancel and join its child")
	}
}
