package engineeringprofile

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type scriptedAdapter struct {
	responses []harness.Completion
	requests  []harness.GenerateRequest
	before    func(int)
}

func (s *scriptedAdapter) Generate(_ context.Context, r harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
	index := len(s.requests)
	s.requests = append(s.requests, r)
	if s.before != nil {
		s.before(index)
	}
	if index >= len(s.responses) {
		return harness.Completion{}, errors.New("script exhausted")
	}
	return s.responses[index], nil
}
func answer(finish harness.FinishKind) harness.Completion {
	return harness.Completion{Finish: finish, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}
}
func checkCall() harness.Completion {
	return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "check-call", Name: "engineering_check", Arguments: json.RawMessage(`{"checkId":"unit"}`)}}}}
}

type fixture struct {
	ctx     context.Context
	h       *harness.Harness
	app     *App
	agent   *harness.Agent
	adapter *scriptedAdapter
	root    string
}

func setup(t *testing.T, mode Mode, maxSteps int, responses ...harness.Completion) *fixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	adapter := &scriptedAdapter{responses: responses}
	h, err := harness.Boot(ctx, harness.Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := h.Dispose(context.Background()); err != nil {
			t.Error(err)
		}
		if err := h.Drain(context.Background()); err != nil {
			t.Error(err)
		}
	})
	app, err := Mount(ctx, h, Options{Mode: mode})
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "input.txt"), []byte("version one"), 0600); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "engineering", CWD: root, MaxSteps: maxSteps})
	if err != nil {
		t.Fatal(err)
	}
	return &fixture{ctx, h, app, agent, adapter, root}
}
func (f *fixture) shell(t *testing.T, raw string, requiresApproval bool, body func()) {
	t.Helper()
	_, err := f.h.RegisterTool(f.ctx, "fixture/shell", harness.Tool{Schema: harness.ToolSchema{Name: "shell", InputSchema: json.RawMessage(`{"type":"object","properties":{"command":{"type":"string"}},"required":["command"],"additionalProperties":false}`)}, RequiresApproval: requiresApproval, ExecuteRequest: func(_ context.Context, _ harness.ToolRequest) (harness.ToolResult, error) {
		if body != nil {
			body()
		}
		return harness.ToolResult{Value: json.RawMessage(raw), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: raw}}}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
}
func (f *fixture) prompt(t *testing.T, c *Contract) harness.TurnResult {
	t.Helper()
	if c != nil {
		if err := f.app.StageContract(f.agent, *c); err != nil {
			t.Fatal(err)
		}
	}
	result, err := f.agent.Prompt(f.ctx, harness.Message{ID: "human-1", Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "perform the work"}}})
	if err != nil {
		t.Fatal(err)
	}
	return result
}
func (f *fixture) assessment(t *testing.T) Assessment {
	t.Helper()
	got, ok, err := f.app.Assessment(f.ctx, f.agent)
	if err != nil || !ok {
		t.Fatalf("assessment: %+v %t %v", got, ok, err)
	}
	return got
}

func TestBoundContractContinuesToSettledCheck(t *testing.T) {
	f := setup(t, Feedback, 8, answer(harness.FinishStop), checkCall(), answer(harness.FinishStop))
	calls := 0
	f.shell(t, `{"exitCode":0,"timedOut":false,"aborted":false}`, false, func() { calls++ })
	c := testContract()
	f.prompt(t, &c)
	if calls != 1 || len(f.adapter.requests) != 3 {
		t.Fatalf("execution=%d requests=%d", calls, len(f.adapter.requests))
	}
	got := f.assessment(t)
	if !got.Ready || got.Checks[0].Status != Passed || got.Checks[0].ResultSeq == 0 {
		t.Fatalf("acceptance: %+v", got)
	}
	count, _, err := attempts(f.agent.Session(), c, "")
	if err != nil || count != 1 {
		t.Fatalf("feedback count=%d err=%v", count, err)
	}
	if !strings.Contains(f.adapter.requests[0].System, "Engineering task contract:") {
		t.Fatal("base guidance missing from final request")
	}
	measurements := 0
	for _, event := range f.agent.Session().Events() {
		if event.Type == measurementEvent {
			measurements++
		}
	}
	if measurements != 3 {
		t.Fatalf("measurements=%d", measurements)
	}
}

func TestCheckEvidenceUsesFinalReceiptAndCurrentInputs(t *testing.T) {
	for _, row := range []struct {
		name, raw                   string
		finalizer, mutate, approval bool
		want                        CheckStatus
	}{
		{"passed", `{"exitCode":0}`, false, false, false, Passed},
		{"failed", `{"exitCode":1}`, false, false, false, Failed},
		{"running", `{"status":"running","task_id":"job"}`, false, false, false, Unverified},
		{"aborted", `{"exitCode":0,"aborted":true}`, false, false, false, Failed},
		{"cleanup", `{"exitCode":0}`, true, false, false, Failed},
		{"stale", `{"exitCode":0}`, false, true, false, Stale},
		{"approval denied", `{"exitCode":0}`, false, false, true, Failed},
	} {
		t.Run(row.name, func(t *testing.T) {
			f := setup(t, Observe, 8, checkCall(), answer(harness.FinishStop))
			calls := 0
			f.shell(t, row.raw, row.approval, func() { calls++ })
			if row.finalizer {
				definition := point.Define(point.Descriptor{ID: "fixture/finalizer"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
					_, err := f.h.Tools().Finalized.On(run, func(_ context.Context, outcome harness.ToolOutcome) error {
						if outcome.Request.Name == "engineering_check" {
							return errors.New("cleanup failed")
						}
						return nil
					})
					return nil, err
				})
				instance, err := f.h.Runtime().Mount(nil, "fixture/finalizer", definition, nil)
				if err != nil {
					t.Fatal(err)
				}
				if err := instance.WaitStable(f.ctx); err != nil {
					t.Fatal(err)
				}
			}
			if row.mutate {
				f.adapter.before = func(index int) {
					if index == 1 {
						if err := os.WriteFile(filepath.Join(f.root, "input.txt"), []byte("version two"), 0600); err != nil {
							t.Error(err)
						}
					}
				}
			}
			c := testContract()
			f.prompt(t, &c)
			got := f.assessment(t)
			if got.Checks[0].Status != row.want || got.Ready != (row.want == Passed) {
				t.Fatalf("acceptance: %+v", got)
			}
			if row.approval && calls != 0 {
				t.Fatal("wrapper bypassed underlying approval")
			}
		})
	}
}

func TestStopLimitsAndReadOnlyRequests(t *testing.T) {
	for _, row := range []struct {
		name      string
		kind      RequestKind
		finish    harness.FinishKind
		maxSteps  int
		concluded bool
	}{
		{"explain", Explain, harness.FinishStop, 8, false}, {"diagnose", Diagnose, harness.FinishStop, 8, false}, {"max tokens", Change, harness.FinishMaxTokens, 8, false}, {"refusal", Change, harness.FinishRefusal, 8, false}, {"last step", Change, harness.FinishStop, 1, false}, {"explicit conclusion", Change, harness.FinishToolCalls, 8, true},
	} {
		t.Run(row.name, func(t *testing.T) {
			completion := answer(row.finish)
			if row.concluded {
				completion.Message.Content = []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "finish-call", Name: "finish", Arguments: json.RawMessage(`{}`)}}
			}
			f := setup(t, Feedback, row.maxSteps, completion)
			if row.concluded {
				if _, err := f.h.RegisterTool(f.ctx, "fixture/finish", harness.Tool{Schema: harness.ToolSchema{Name: "finish", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
					return harness.ToolResult{ConcludesTurn: true}, nil
				}}); err != nil {
					t.Fatal(err)
				}
			}
			f.shell(t, `{"exitCode":0}`, false, nil)
			c := testContract()
			c.Kind = row.kind
			result := f.prompt(t, &c)
			if len(f.adapter.requests) != 1 {
				t.Fatal("stop policy exceeded its request boundary")
			}
			if row.finish == harness.FinishMaxTokens && result.Reason != harness.FinishMaxTokens {
				t.Fatalf("lost max token result: %+v", result)
			}
			count, _, err := attempts(f.agent.Session(), c, "")
			if err != nil || count != 0 {
				t.Fatalf("unexpected attempts: %d %v", count, err)
			}
		})
	}
}

func TestFeedbackReservationSurvivesRemount(t *testing.T) {
	f := setup(t, Feedback, 8, answer(harness.FinishStop), answer(harness.FinishStop), answer(harness.FinishStop))
	f.shell(t, `{"exitCode":0}`, false, nil)
	c := testContract()
	f.prompt(t, &c)
	if len(f.adapter.requests) != 2 {
		t.Fatalf("duplicate feedback: %d requests", len(f.adapter.requests))
	}
	if err := f.app.Dispose(f.ctx); err != nil {
		t.Fatal(err)
	}
	var err error
	f.app, err = Mount(f.ctx, f.h, Options{Mode: Feedback})
	if err != nil {
		t.Fatal(err)
	}
	outcomes, err := f.agent.FollowupResultContext(f.ctx, contextMessage("followup", "continue within the same contract"))
	if err != nil {
		t.Fatal(err)
	}
	if outcome := <-outcomes; outcome.Err != nil {
		t.Fatal(outcome.Err)
	}
	count, _, err := attempts(f.agent.Session(), c, "")
	if err != nil || count != 1 || len(f.adapter.requests) != 3 {
		t.Fatalf("reservation lost: count=%d requests=%d err=%v", count, len(f.adapter.requests), err)
	}
	restored, err := harness.RestoreSession(f.agent.Session().Header(), f.agent.Session().Events())
	if err != nil {
		t.Fatal(err)
	}
	if got, ok, err := Current(restored); err != nil || !ok || got.ID != c.ID {
		t.Fatalf("restore contract: %+v %t %v", got, ok, err)
	}
	if count, _, err := attempts(restored, c, ""); err != nil || count != 1 {
		t.Fatalf("restored attempts=%d %v", count, err)
	}
}

func TestUnboundHumanInputSuspendsPreviousContract(t *testing.T) {
	f := setup(t, Observe, 8, answer(harness.FinishStop), answer(harness.FinishStop))
	c := testContract()
	f.prompt(t, &c)
	_, err := f.agent.Prompt(f.ctx, harness.Message{ID: "human-2", Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "just explain status"}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok, err := Current(f.agent.Session()); err != nil || ok {
		t.Fatalf("unbound message retained old authority: %t %v", ok, err)
	}
}

func TestHumanSteeringUsesItsExactContractWithinTheSameTurn(t *testing.T) {
	for _, bound := range []bool{false, true} {
		name := "unbound"
		if bound {
			name = "revised contract"
		}
		t.Run(name, func(t *testing.T) {
			f := setup(t, Observe, 8, answer(harness.FinishStop), checkCall(), answer(harness.FinishStop))
			calls := 0
			f.shell(t, `{"exitCode":0}`, false, func() { calls++ })
			f.adapter.before = func(index int) {
				if index != 0 {
					return
				}
				if bound {
					c := testContract()
					c.MessageID, c.Revision, c.Goal = "human-2", 2, "Revised work with its own acceptance"
					if err := f.app.StageContract(f.agent, c); err != nil {
						t.Error(err)
						return
					}
				}
				if _, err := f.agent.AdmitDSHMessage(f.ctx, harness.Message{ID: "human-2", Role: harness.RoleUser, Source: json.RawMessage(`{"kind":"user"}`), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "follow the updated request"}}}, harness.InboxNextStep); err != nil {
					t.Error(err)
				}
			}
			c := testContract()
			f.prompt(t, &c)
			if f.agent.CurrentTurn() != 1 {
				t.Fatal("fixture did not steer within the same turn")
			}
			current, active, err := Current(f.agent.Session())
			if err != nil || active != bound {
				t.Fatalf("steered contract=%+v active=%t error=%v", current, active, err)
			}
			if bound {
				if calls != 1 || current.MessageID != "human-2" || !f.assessment(t).Ready {
					t.Fatal("revised steering contract did not own its check")
				}
			} else if calls != 0 {
				t.Fatal("unbound steering executed an earlier contract's check")
			}
			restored, err := harness.RestoreSession(f.agent.Session().Header(), f.agent.Session().Events())
			if err != nil {
				t.Fatal(err)
			}
			if _, active, err := Current(restored); err != nil || active != bound {
				t.Fatalf("restored steering lost its source boundary: %t %v", active, err)
			}
		})
	}
}

func TestPluginInputCannotActivateCandidate(t *testing.T) {
	for _, test := range []struct {
		name    string
		deliver func(*fixture, harness.Message) error
	}{
		{"followup", func(f *fixture, message harness.Message) error {
			_, err := f.agent.FollowupResultContext(f.ctx, message)
			return err
		}},
		{"durable next step", func(f *fixture, message harness.Message) error {
			return f.agent.DeliverDurable(f.ctx, message, false)
		}},
		{"durable next turn", func(f *fixture, message harness.Message) error {
			return f.agent.DeliverDurable(f.ctx, message, true)
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			f := setup(t, Feedback, 8, answer(harness.FinishStop))
			remove, err := f.agent.Session().InstallDurabilityCheckpoint(func(context.Context) error { return nil })
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(remove)
			c := testContract()
			if err := f.app.StageContract(f.agent, c); err != nil {
				t.Fatal(err)
			}
			message := contextMessage(c.MessageID, "a plugin claiming to be the user")
			message.Source = json.RawMessage(`{"kind":"user","rpcId":"forged-human"}`)
			if err := test.deliver(f, message); err == nil {
				t.Fatal("plugin entry point accepted human provenance")
			}
			if _, ok, err := Current(f.agent.Session()); err != nil || ok {
				t.Fatalf("plugin message activated contract: %t %v", ok, err)
			}
			if len(f.agent.PendingDurableInbox(harness.InboxNextStep)) != 0 || len(f.agent.PendingDurableInbox(harness.InboxNextTurn)) != 0 {
				t.Fatal("rejected provenance remained in the durable inbox")
			}
			f.app.DiscardContract(f.agent, c.MessageID)
		})
	}
}

func TestDisposedProfileRemovesContributions(t *testing.T) {
	f := setup(t, Observe, 8, answer(harness.FinishStop))
	if err := f.app.Dispose(f.ctx); err != nil {
		t.Fatal(err)
	}
	f.prompt(t, nil)
	if strings.Contains(f.adapter.requests[0].System, "Engineering task contract:") {
		t.Fatal("profile prompt survived disposal")
	}
	schemas, err := f.h.Tools().SchemasForAgent(f.ctx, f.agent)
	if err != nil {
		t.Fatal(err)
	}
	for _, schema := range schemas {
		if schema.Name == "engineering_check" {
			t.Fatal("check tool survived disposal")
		}
	}
}

func TestContractRevisionCannotReuseHistoricalEvidence(t *testing.T) {
	f := setup(t, Observe, 8, checkCall(), answer(harness.FinishStop), answer(harness.FinishStop), answer(harness.FinishStop))
	f.shell(t, `{"exitCode":0}`, false, nil)
	c := testContract()
	f.prompt(t, &c)
	if !f.assessment(t).Ready {
		t.Fatal("fixture check did not pass")
	}
	for _, id := range []string{"human-2"} {
		if _, err := f.agent.Prompt(f.ctx, harness.Message{ID: id, Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "explain status"}}}); err != nil {
			t.Fatal(err)
		}
	}
	c.MessageID = "human-3"
	c.Checks[0].Command = "different check"
	if err := f.app.StageContract(f.agent, c); err == nil {
		t.Fatal("reused an old revision after a different human turn")
	}
	c.Revision++
	if err := f.app.StageContract(f.agent, c); err != nil {
		t.Fatal(err)
	}
	if _, err := f.agent.Prompt(f.ctx, harness.Message{ID: c.MessageID, Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "perform the revised work"}}}); err != nil {
		t.Fatal(err)
	}
	if got := f.assessment(t); got.Ready || got.Checks[0].Status != Missing {
		t.Fatalf("old proof accepted for changed contract: %+v", got)
	}
}

func TestQueuedContractRevisionsRecheckHistoryAtBinding(t *testing.T) {
	for _, row := range []struct {
		name          string
		first, second int
		rejected      bool
	}{
		{"same revision", 1, 1, true},
		{"out of order", 2, 1, true},
		{"advancing", 1, 2, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			f := setup(t, Observe, 8, checkCall(), answer(harness.FinishStop), answer(harness.FinishStop))
			f.shell(t, `{"exitCode":0}`, false, nil)
			first := testContract()
			first.Revision = row.first
			second := cloneContract(first)
			second.MessageID, second.Revision = "human-2", row.second
			for _, c := range []Contract{first, second} {
				if err := f.app.StageContract(f.agent, c); err != nil {
					t.Fatal(err)
				}
			}
			f.prompt(t, nil)
			if !f.assessment(t).Ready {
				t.Fatal("first contract check did not pass")
			}
			_, err := f.agent.Prompt(f.ctx, harness.Message{ID: second.MessageID, Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "new work"}}})
			if (err != nil) != row.rejected {
				t.Fatalf("binding error=%v, want rejected=%t", err, row.rejected)
			}
			if row.rejected {
				if _, active, err := Current(f.agent.Session()); err != nil || active {
					t.Fatalf("rejected revision activated: %t %v", active, err)
				}
			} else if f.assessment(t).Ready {
				t.Fatal("new revision reused an earlier request's proof")
			}
		})
	}
}

func TestFailedCandidateCannotLeakIntoLaterHumanRequest(t *testing.T) {
	f := setup(t, Observe, 8, answer(harness.FinishStop))
	definition := point.Define(point.Descriptor{ID: "fixture/reject-step", Requires: []point.Requirement{point.Require(harness.AgentHooksKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		hooks, err := point.Resolve(run, harness.AgentHooksKey)
		if err != nil {
			return nil, err
		}
		_, err = hooks.PreStep.Use(run, func(ctx context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
			if input.Turn == 1 {
				return input, errors.New("pre-request failure")
			}
			return next(input)
		})
		return nil, err
	})
	instance, err := f.h.Runtime().Mount(nil, "fixture/reject-step", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = instance.WaitStable(f.ctx); err != nil {
		t.Fatal(err)
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		t.Fatalf("reject-step fixture activation: %s", snapshot.LastError)
	}
	c := testContract()
	if err = f.app.StageContract(f.agent, c); err != nil {
		t.Fatal(err)
	}
	if _, err = f.agent.Prompt(f.ctx, harness.Message{ID: c.MessageID, Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "rejected work"}}}); err == nil {
		t.Fatal("fixture was not rejected")
	}
	if _, err = f.agent.Prompt(f.ctx, harness.Message{ID: "human-2", Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "only explain"}}}); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := Current(f.agent.Session()); err != nil || ok {
		t.Fatalf("failed candidate activated: %t %v", ok, err)
	}
	if runtime := f.adapter.requests[0].RuntimeContext; runtime != nil && strings.Contains(runtime.Text, c.Goal) {
		t.Fatal("failed candidate leaked into subsequent request")
	}
}

func TestBoundCheckRejectsMiddlewareCommandRewrite(t *testing.T) {
	f := setup(t, Observe, 8, checkCall(), answer(harness.FinishStop))
	calls := 0
	f.shell(t, `{"exitCode":0}`, false, func() { calls++ })
	definition := point.Define(point.Descriptor{ID: "fixture/rewrite-command"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		_, err := f.h.Tools().Before.Use(run, func(ctx context.Context, request harness.ToolRequest, next point.Next[harness.ToolRequest]) (harness.ToolRequest, error) {
			if request.Name == "shell" {
				request.Arguments = json.RawMessage(`{"command":"a different command"}`)
			}
			return next(request)
		})
		return nil, err
	})
	instance, err := f.h.Runtime().Mount(nil, "fixture/rewrite-command", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = instance.WaitStable(f.ctx); err != nil {
		t.Fatal(err)
	}
	c := testContract()
	f.prompt(t, &c)
	if calls != 0 || f.assessment(t).Checks[0].Status != Failed {
		t.Fatal("rewritten check command executed or passed")
	}
}

func TestDuplicateCallIDsCannotBorrowAnotherToolsSuccess(t *testing.T) {
	completion := checkCall()
	completion.Message.Content = append([]harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "check-call", Name: "noop", Arguments: json.RawMessage(`{}`)}}, completion.Message.Content...)
	f := setup(t, Observe, 8, completion, answer(harness.FinishStop))
	calls := 0
	f.shell(t, `{"exitCode":0}`, false, func() { calls++ })
	if _, err := f.h.RegisterTool(f.ctx, "fixture/noop", harness.Tool{Schema: harness.ToolSchema{Name: "noop", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "success"}}}, nil
	}}); err != nil {
		t.Fatal(err)
	}
	definition := point.Define(point.Descriptor{ID: "fixture/duplicate-finalizer"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		_, err := f.h.Tools().Finalized.On(run, func(_ context.Context, outcome harness.ToolOutcome) error {
			if outcome.Request.Name == "engineering_check" {
				return errors.New("check cleanup failed")
			}
			return nil
		})
		return nil, err
	})
	instance, err := f.h.Runtime().Mount(nil, "fixture/duplicate-finalizer", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = instance.WaitStable(f.ctx); err != nil {
		t.Fatal(err)
	}
	c := testContract()
	f.prompt(t, &c)
	if calls != 0 || f.assessment(t).Ready {
		t.Fatal("ambiguous call borrowed an unrelated success receipt")
	}
}
