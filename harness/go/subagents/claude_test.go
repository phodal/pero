package subagents

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	openaiadapter "github.com/phodal/pero/harness/go/providers/openai"
	point "github.com/phodal/pero/harness/go/runtime"
)

type claudeHTTPFixture struct {
	ctx       context.Context
	h         *harness.Harness
	parent    *harness.Agent
	claude    *ClaudeContribution
	root      string
	approvals atomic.Int32
}

func newClaudeHTTPFixture(t *testing.T, root string, handler http.HandlerFunc, allowed bool, definitions []AgentDefinition, options ClaudeOptions, nativeOptions ...nativetools.Options) *claudeHTTPFixture {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	adapter, err := openaiadapter.New(openaiadapter.Config{Endpoint: server.URL + "/v1", APIKey: "fixture-only", ProviderName: "fixture", Models: []openaiadapter.ModelConfig{{ID: "parent-model", ContextWindow: 8192}, {ID: "worker-model", ContextWindow: 8192}}, MaxRequests: 20})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	t.Cleanup(cancel)
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"fixture"}, ModelInfo: adapter, ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	nativeConfig := nativetools.Options{Workspace: root, ClaudeTools: true}
	if len(nativeOptions) != 0 {
		nativeConfig = nativeOptions[0]
	}
	native, err := nativetools.Mount(ctx, h, nativeConfig)
	if err != nil {
		t.Fatal(err)
	}
	f := &claudeHTTPFixture{ctx: ctx, h: h, root: root}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = h.Dispose(cleanup)
		if err := h.Drain(cleanup); err != nil {
			t.Error(err)
		}
		native.Close()
	})
	if options.ModelRoutes == nil {
		options.ModelRoutes = []ModelRoute{{Alias: "sonnet", Provider: "fixture", Model: "worker-model"}}
	}
	if f.claude, err = MountClaude(ctx, h, definitions, options); err != nil {
		t.Fatal(err)
	}
	f.parent, err = h.Agents().Create(ctx, harness.AgentOptions{ID: "claude-parent", CWD: root, Provider: "fixture", Model: "parent-model", MaxSteps: 5, MaxTokens: 128, DisableCompaction: true, Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			f.approvals.Add(1)
			if allowed {
				return harness.ApprovalAllowedOnce, nil
			}
			return harness.ApprovalRejected, nil
		})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	return f
}

func claudeHTTPAnswer(w http.ResponseWriter, payload string) {
	w.Header().Set("Content-Type", "text/event-stream")
	fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", payload)
}
func claudeTextAnswer(w http.ResponseWriter, text string) {
	raw, _ := json.Marshal(text)
	claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"content":`+string(raw)+`},"finish_reason":"stop"}]}`)
}

func (f *claudeHTTPFixture) call(t *testing.T, parent *harness.Agent, name string, input string) harness.ToolResult {
	t.Helper()
	out, err := f.h.Tools().Execute(f.ctx, harness.ToolRequest{Agent: parent, Name: name, CallID: harness.ToolCallID(name + "-fixture"), Arguments: json.RawMessage(input)})
	if err != nil {
		t.Fatal(err)
	}
	return out.Result
}

type claudeTaskReceipt struct {
	ID        string                 `json:"task_id"`
	Status    harness.SubagentStatus `json:"status"`
	Retrieval string                 `json:"retrieval_status"`
}

func taskReceipt(t *testing.T, result harness.ToolResult) claudeTaskReceipt {
	t.Helper()
	var value claudeTaskReceipt
	if len(result.Content) == 0 || json.Unmarshal([]byte(result.Content[0].Text), &value) != nil {
		t.Fatalf("missing task receipt: %+v", result)
	}
	return value
}

func TestClaudeAgentWritesWithInheritedApprovalAndRoute(t *testing.T) {
	for _, test := range []struct {
		name          string
		allow         bool
		mode          harness.PermissionMode
		policy        harness.ApprovalPolicy
		wantFile      bool
		wantApprovals int32
	}{{"approved", true, "", "", true, 1}, {"rejected", false, "", "", false, 1}, {"parent-read-only", true, harness.PermissionReadOnly, "", false, 0}, {"parent-never", true, "", harness.ApprovalNever, false, 0}} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			file := filepath.Join(root, "report.txt")
			var calls atomic.Int32
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
				if body.Model != "worker-model" || len(body.Tools) != 1 || body.Tools[0].Function.Name != "Write" {
					t.Errorf("child widened model or tools: %+v", body)
				}
				if calls.Add(1) == 1 {
					args, _ := json.Marshal(struct {
						Path    string `json:"file_path"`
						Content string `json:"content"`
					}{file, "child-artifact"})
					quoted, _ := json.Marshal(string(args))
					claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"write-child","type":"function","function":{"name":"Write","arguments":`+string(quoted)+`}}]},"finish_reason":"tool_calls"}]}`)
					return
				}
				claudeTextAnswer(w, "child-write-observed")
			}, test.allow, []AgentDefinition{{Name: "sample:writer", Description: "Write a report", Instructions: "Write report.txt using the Write tool.", Model: "sonnet", Tools: []string{"Write"}}}, ClaudeOptions{})
			if test.mode != "" {
				if _, err := harness.SetPermissionMode(f.parent.Session(), test.mode); err != nil {
					t.Fatal(err)
				}
			}
			if test.policy != "" {
				if _, err := harness.SetApprovalPolicy(f.parent.Session(), test.policy); err != nil {
					t.Fatal(err)
				}
			}
			result := f.call(t, f.parent, "Agent", `{"subagent_type":"sample:writer","description":"write report","prompt":"Write the report."}`)
			if result.IsError || taskReceipt(t, result).Status != harness.SubagentCompleted || !strings.Contains(fmt.Sprint(result.Content), "child-write-observed") {
				t.Fatalf("child did not settle: %+v", result)
			}
			text, err := os.ReadFile(file)
			if test.wantFile {
				if err != nil || string(text) != "child-artifact" {
					t.Fatalf("child write missing: %q %v", text, err)
				}
			} else if !os.IsNotExist(err) {
				t.Fatalf("denied child changed files: %q %v", text, err)
			}
			if f.approvals.Load() != test.wantApprovals {
				t.Fatalf("approval count %d want %d", f.approvals.Load(), test.wantApprovals)
			}
		})
	}
}

func TestClaudeBackgroundJoinStopAndCapacity(t *testing.T) {
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	var calls atomic.Int32
	f := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		entered <- struct{}{}
		select {
		case <-release:
			claudeTextAnswer(w, "background-result")
		case <-r.Context().Done():
		}
	}, true, []AgentDefinition{{Name: "sample:worker", Description: "Wait for work", Instructions: "Return a result", Model: "inherit"}}, ClaudeOptions{MaxActive: 1})
	start := func() claudeTaskReceipt {
		return taskReceipt(t, f.call(t, f.parent, "Agent", `{"subagent_type":"sample:worker","description":"background","prompt":"Work","run_in_background":true}`))
	}
	first := start()
	select {
	case <-entered:
	case <-f.ctx.Done():
		t.Fatal(f.ctx.Err())
	}
	if first.ID == "" {
		t.Fatal("background did not return real task ID")
	}
	if result := f.call(t, f.parent, "Agent", `{"subagent_type":"sample:worker","description":"excess","prompt":"Work","run_in_background":true}`); !result.IsError {
		t.Fatal("background exceeded activation capacity")
	}
	query := fmt.Sprintf(`{"task_id":%q,"block":false}`, first.ID)
	if got := taskReceipt(t, f.call(t, f.parent, "TaskOutput", query)); got.Status != harness.SubagentRunning || got.Retrieval != "not_ready" {
		t.Fatalf("unfinished task fabricated result: %+v", got)
	}
	query = fmt.Sprintf(`{"task_id":%q,"timeout":1}`, first.ID)
	if got := taskReceipt(t, f.call(t, f.parent, "TaskOutput", query)); got.Retrieval != "timeout" {
		t.Fatalf("timeout: %+v", got)
	}
	close(release)
	query = fmt.Sprintf(`{"task_id":%q,"timeout":1000}`, first.ID)
	result := f.call(t, f.parent, "TaskOutput", query)
	if result.IsError || taskReceipt(t, result).Status != harness.SubagentCompleted || !strings.Contains(fmt.Sprint(result.Content), "background-result") {
		t.Fatalf("join lost actual result: %+v", result)
	}
	if got := taskReceipt(t, f.call(t, f.parent, "TaskOutput", query)); got.Status != harness.SubagentCompleted {
		t.Fatal("repeat lookup lost completion")
	}
	other, err := f.h.Agents().Create(f.ctx, harness.AgentOptions{ID: "other-parent", CWD: f.root})
	if err != nil {
		t.Fatal(err)
	}
	if result := f.call(t, other, "TaskOutput", query); !result.IsError {
		t.Fatal("another parent read task")
	}
	if calls.Load() != 1 {
		t.Fatal("capacity failure contacted provider")
	}

	// A fresh fixture uses an unreleased HTTP request to prove TaskStop reaches
	// the actual child, not only a model-facing status record.
	t.Run("stop", func(t *testing.T) {
		started, cancelled := make(chan struct{}), make(chan struct{})
		forceRelease := make(chan struct{})
		g := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) {
			_, _ = io.Copy(io.Discard, r.Body)
			close(started)
			select {
			case <-r.Context().Done():
				close(cancelled)
			case <-forceRelease:
			}
		}, true, []AgentDefinition{{Name: "sample:worker", Description: "Wait", Instructions: "Wait"}}, ClaudeOptions{})
		t.Cleanup(func() { close(forceRelease) })
		task := taskReceipt(t, g.call(t, g.parent, "Agent", `{"subagent_type":"sample:worker","description":"stop me","prompt":"Wait","run_in_background":true}`))
		select {
		case <-started:
		case <-g.ctx.Done():
			t.Fatal(g.ctx.Err())
		}
		stopped := g.call(t, g.parent, "TaskStop", fmt.Sprintf(`{"task_id":%q}`, task.ID))
		if got := taskReceipt(t, stopped); stopped.IsError || got.Status != harness.SubagentAborted {
			t.Fatalf("not aborted: %+v", got)
		}
		select {
		case <-cancelled:
		case <-g.ctx.Done():
			t.Fatal("HTTP child was not cancelled")
		}
	})
}

func TestClaudeModelAliasesFailBeforeChildRequest(t *testing.T) {
	var calls atomic.Int32
	f := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) { calls.Add(1); claudeTextAnswer(w, "unexpected") }, true, []AgentDefinition{{Name: "sample:worker", Description: "Worker", Instructions: "Do work", Model: "opus"}}, ClaudeOptions{})
	for _, input := range []string{`{"subagent_type":"sample:worker","description":"route","prompt":"Work"}`, `{"subagent_type":"sample:worker","description":"resume","prompt":"Work","resume":"old-task"}`, `{"subagent_type":"sample:missing","description":"unknown","prompt":"Work"}`} {
		if result := f.call(t, f.parent, "Agent", input); !result.IsError {
			t.Fatalf("unavailable request accepted: %s", input)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid delegation contacted model")
	}
}

func TestClaudeParentCancellationStopsBackgroundChild(t *testing.T) {
	childStarted, parentStarted := make(chan struct{}), make(chan struct{})
	childCancelled := make(chan struct{})
	f := newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			w.WriteHeader(400)
			return
		}
		if body.Model == "parent-model" {
			close(parentStarted)
			<-r.Context().Done()
			return
		}
		close(childStarted)
		<-r.Context().Done()
		close(childCancelled)
	}, true, []AgentDefinition{{Name: "sample:worker", Description: "Worker", Instructions: "Wait", Model: "sonnet"}}, ClaudeOptions{})
	task := taskReceipt(t, f.call(t, f.parent, "Agent", `{"subagent_type":"sample:worker","description":"background","prompt":"Wait","run_in_background":true}`))
	select {
	case <-childStarted:
	case <-f.ctx.Done():
		t.Fatal(f.ctx.Err())
	}
	done := make(chan error, 1)
	go func() {
		_, err := f.parent.Prompt(f.ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Wait"}}})
		done <- err
	}()
	select {
	case <-parentStarted:
	case <-f.ctx.Done():
		t.Fatal(f.ctx.Err())
	}
	f.parent.Cancel(context.Canceled)
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("parent cancellation succeeded")
		}
	case <-f.ctx.Done():
		t.Fatal(f.ctx.Err())
	}
	select {
	case <-childCancelled:
	case <-f.ctx.Done():
		t.Fatal("parent cancellation did not stop background HTTP request")
	}
	result := f.call(t, f.parent, "TaskOutput", fmt.Sprintf(`{"task_id":%q,"timeout":1000}`, task.ID))
	if got := taskReceipt(t, result); got.Status != harness.SubagentAborted {
		t.Fatalf("cancelled child state: %+v", got)
	}
}
