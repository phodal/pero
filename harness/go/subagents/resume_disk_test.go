package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestClaudeResumeFromJSONLKeepsOriginalEffectsAndNarrowTools(t *testing.T) {
	for _, restriction := range []string{"allow", "deny"} {
		t.Run(restriction, func(t *testing.T) {
			root, directory := t.TempDir(), t.TempDir()
			disk, err := harness.NewJSONLSessionPersistence(directory)
			if err != nil {
				t.Fatal(err)
			}
			var initialCalls atomic.Int32
			definitions := []AgentDefinition{{Name: "sample:worker", Description: "Disk worker", Instructions: "Keep original context.", Model: "sonnet", Tools: []string{"Write", "Read"}}}
			f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
				if initialCalls.Add(1) == 1 {
					claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"disk-initial-write","type":"function","function":{"name":"Write","arguments":"{\"file_path\":\"disk-proof.txt\",\"content\":\"durable original effect\"}"}}]},"finish_reason":"tool_calls"}]}`)
					return
				}
				claudeTextAnswer(w, "durable-original-history")
			}, true, definitions, ClaudeOptions{Persistence: disk})
			detach, err := disk.Attach(f.ctx, f.parent.Session())
			if err != nil {
				t.Fatal(err)
			}
			result := f.call(t, f.parent, "Agent", `{"subagent_type":"sample:worker","description":"initial","prompt":"create one proof"}`)
			initial := taskReceipt(t, result)
			if result.IsError || initial.Status != harness.SubagentCompleted {
				t.Fatal(result)
			}
			if err := detach(); err != nil {
				t.Fatal(err)
			}
			if err := f.h.Dispose(f.ctx); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
				t.Fatal(err)
			}
			if err := f.h.Drain(f.ctx); err != nil {
				t.Fatal(err)
			}
			freshDisk, err := harness.NewJSONLSessionPersistence(directory)
			if err != nil {
				t.Fatal(err)
			}
			var resumedCalls atomic.Int32
			if restriction == "allow" {
				definitions[0].Tools = []string{"Read"}
			} else {
				definitions[0].DisallowedTools = []string{"Write"}
			}
			fresh := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
				var request struct {
					Messages json.RawMessage `json:"messages"`
					Tools    []struct {
						Function struct {
							Name string `json:"name"`
						} `json:"function"`
					} `json:"tools"`
				}
				_ = json.NewDecoder(r.Body).Decode(&request)
				if !strings.Contains(string(request.Messages), "durable-original-history") || !strings.Contains(string(request.Messages), "disk-initial-write") {
					t.Error("cold resume lost complete history")
				}
				for _, tool := range request.Tools {
					if tool.Function.Name == "Write" {
						t.Error("cold resume widened current selected tool set")
					}
				}
				if resumedCalls.Add(1) == 1 {
					claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"cold-read","type":"function","function":{"name":"Read","arguments":"{\"file_path\":\"disk-proof.txt\"}"}}]},"finish_reason":"tool_calls"}]}`)
					return
				}
				if !strings.Contains(string(request.Messages), "durable original effect") {
					t.Error("cold Read did not observe original file")
				}
				claudeTextAnswer(w, "cold-resumed-result")
			}, true, definitions, ClaudeOptions{Persistence: freshDisk})
			foreign, err := fresh.h.Agents().Create(fresh.ctx, harness.AgentOptions{ID: "foreign-cold-parent", CWD: root, Provider: "fixture", Model: "parent-model"})
			if err != nil {
				t.Fatal(err)
			}
			if result := fresh.call(t, foreign, "Agent", fmt.Sprintf(`{"resume":%q,"description":"foreign","prompt":"must not load another parent history"}`, initial.ID)); !result.IsError || resumedCalls.Load() != 0 {
				t.Fatal("cold child escaped direct-parent authority")
			}
			// The fixture's unused root is not the persisted controller generation.
			placeholder := fresh.parent
			if err := fresh.h.Agents().RemoveExact(fresh.ctx, placeholder); err != nil && !errors.Is(err, harness.ErrAgentDisposalInProgress) {
				t.Fatal(err)
			}
			if err := fresh.h.Agents().WaitRetired(fresh.ctx, placeholder); err != nil {
				t.Fatal(err)
			}
			fresh.h.Sessions().RemoveExact(placeholder.Session())
			loaded, err := freshDisk.Load(fresh.ctx, f.parent.ID())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := harness.SetPermissionMode(loaded, harness.PermissionReadOnly); err != nil {
				t.Fatal(err)
			}
			fresh.parent, err = fresh.h.Agents().Resume(fresh.ctx, loaded, harness.AgentOptions{Provider: "fixture", Model: "parent-model", MaxSteps: 5, MaxTokens: 128, DisableCompaction: true})
			if err != nil {
				t.Fatal(err)
			}
			detach, err = freshDisk.Attach(fresh.ctx, fresh.parent.Session())
			if err != nil {
				t.Fatal(err)
			}
			defer detach()
			resumedResult := fresh.call(t, fresh.parent, "Agent", fmt.Sprintf(`{"resume":%q,"description":"cold","prompt":"continue with prior context"}`, initial.ID))
			resumed := taskReceipt(t, resumedResult)
			if resumedResult.IsError || resumed.ID != initial.ID || resumed.Status != harness.SubagentCompleted {
				t.Fatalf("cold resume failed: %+v", resumedResult)
			}
			if initialCalls.Load() != 2 || resumedCalls.Load() != 2 || f.approvals.Load() != 1 || fresh.approvals.Load() != 0 {
				t.Fatalf("effects/requests replayed: initial=%d resumed=%d approvals=%d/%d", initialCalls.Load(), resumedCalls.Load(), f.approvals.Load(), fresh.approvals.Load())
			}
			if data, err := os.ReadFile(filepath.Join(root, "disk-proof.txt")); err != nil || string(data) != "durable original effect" {
				t.Fatal("cold resume changed original artifact")
			}
		})
	}
}

func TestNativeManagedResumeFromJSONLPreservesCreatorAndRoute(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cwd := t.TempDir()
	requests := make(chan harness.GenerateRequest, 4)
	boot := func() *harness.Harness {
		t.Helper()
		h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, AdapterProviders: []string{"fixture"},
			Adapter: harness.AdapterFunc(func(_ context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				requests <- req
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "persisted native result"}}}}, nil
			})})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := MountInProcess(ctx, h, InProcessOptions{Name: "dsh-spawn", Persistence: disk, Managed: true}); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
		return h
	}
	h := boot()
	rootOptions := harness.AgentOptions{ID: "native-creator", CWD: cwd, Provider: "fixture", Model: "saved-model"}
	root, err := h.Agents().Create(ctx, rootOptions)
	if err != nil {
		t.Fatal(err)
	}
	detach, err := disk.Attach(ctx, root.Session())
	if err != nil {
		t.Fatal(err)
	}
	child, err := h.Subagents().StartActivation(ctx, "dsh-spawn", harness.SubagentRequest{Parent: root, Prompt: "original child input", Label: "Inspect fixture", MaxDepth: 1}, "caller")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-child.Result:
		if result.Status != harness.SubagentCompleted {
			t.Fatal(result)
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if err := child.Wait(ctx); err != nil {
		t.Fatal(err)
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	if err := h.Dispose(ctx); err != nil && !errors.Is(err, harness.ErrHarnessDisposalInProgress) {
		t.Fatal(err)
	}
	if err := h.Drain(ctx); err != nil {
		t.Fatal(err)
	}
	original := <-requests
	fresh := boot()
	loaded, err := disk.Load(ctx, root.ID())
	if err != nil {
		t.Fatal(err)
	}
	root, err = fresh.Agents().Resume(ctx, loaded, rootOptions)
	if err != nil {
		t.Fatal(err)
	}
	message := harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "continue original child"}}}
	foreign, err := fresh.Agents().Create(ctx, harness.AgentOptions{ID: "foreign", CWD: cwd, Provider: "fixture", Model: "saved-model"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fresh.Subagents().DeliverSubagentPrompt(ctx, foreign, child.ChildID, message, "steer"); err == nil || len(requests) != 0 {
		t.Fatal("foreign caller resumed an existing direct child")
	}
	id, err := fresh.Subagents().DeliverSubagentPrompt(ctx, root, child.ChildID, message, "steer")
	if err != nil || id == "" {
		t.Fatalf("direct-parent cold send %s: %v", id, err)
	}
	select {
	case actual := <-requests:
		if original.Agent.ID() != child.ChildID || actual.Agent.ID() != child.ChildID || actual.Agent.Session().Header().ParentSession != root.ID() ||
			actual.Model != original.Model || actual.Agent.ModelSelection().Provider != original.Agent.ModelSelection().Provider {
			t.Fatalf("cold continuation lost original session, creator or route")
		}
		payload, _ := json.Marshal(actual.Messages)
		for _, want := range []string{"original child input", "persisted native result", "continue original child"} {
			if !strings.Contains(string(payload), want) {
				t.Fatalf("cold continuation lost %q", want)
			}
		}
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}
