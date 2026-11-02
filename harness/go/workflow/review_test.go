//go:build linux || darwin

package workflow

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	openaiadapter "github.com/phodal/pero/harness/go/providers/openai"
)

func modelTool(w http.ResponseWriter, name string, arguments any) {
	args, _ := json.Marshal(arguments)
	chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "workflow-structured", "type": "function", "function": map[string]any{"name": name, "arguments": string(args)}}}}, "finish_reason": "tool_calls"}}})
	w.Header().Set("Content-Type", "text/event-stream")
	fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", chunk)
}

// These original files are unchanged, licensed package scripts. This exercises
// their spec gate, both nested workflows, batched review and skeptic fan-out.
func TestOriginalReviewScriptsUseModelToolsAndStructuredOutput(t *testing.T) {
	for _, allowed := range []bool{true, false} {
		t.Run(fmt.Sprintf("spec-write-approved=%v", allowed), func(t *testing.T) {
			files := make(map[string]string)
			for _, path := range []string{"workflows/coder-review.js", "workflows/phases/review-cr-phase.js", "workflows/phases/review-aggregate-assessment-phase.js"} {
				raw, err := os.ReadFile(filepath.Join("testdata", "review", filepath.FromSlash(path)))
				if err != nil {
					t.Fatal(err)
				}
				files[path] = string(raw)
			}
			root, workspace, packages := selectedPackage(t, files)
			ideaDir := filepath.Join(workspace, "idea")
			specPath := filepath.Join(ideaDir, "cr", "dim-spec-cr.md")
			var calls, active, peak, quality, skeptics atomic.Int32
			barrier := make(chan struct{})
			var release sync.Once
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				raw, err := io.ReadAll(r.Body)
				if err != nil {
					t.Error(err)
					return
				}
				var request struct {
					Model    string `json:"model"`
					Messages []struct {
						Role    string `json:"role"`
						Content string `json:"content"`
					} `json:"messages"`
					Tools []struct {
						Function struct{ Name string } `json:"function"`
					} `json:"tools"`
				}
				if err := json.Unmarshal(raw, &request); err != nil {
					t.Error(err)
					return
				}
				calls.Add(1)
				var content strings.Builder
				toolReceipt := false
				for _, message := range request.Messages {
					content.WriteString(message.Content + "\n")
					toolReceipt = toolReceipt || message.Role == "tool"
				}
				text := content.String()
				structured := false
				for _, tool := range request.Tools {
					structured = structured || tool.Function.Name == "structured_output"
				}
				if !structured {
					t.Error("workflow schema did not reach the real child tool catalog")
				}
				if strings.Contains(text, "You are a spec compliance reviewer") {
					if request.Model != "senior-model" {
						t.Errorf("spec model=%s", request.Model)
					}
					if !toolReceipt {
						modelTool(w, "Write", map[string]string{"file_path": specPath, "content": "---\ndimension: spec\nresult: pass\naffected_tasks: []\nrework_count: 0\n---\n## 结论\nPass\n## Acceptance Criteria 覆盖\nVerified\n## Expected Files 覆盖\nVerified\n## Scope Check Proof\nVerified\n"})
						return
					}
					result, affected := "pass", []string{}
					if !allowed {
						result, affected = "fail", []string{"T1"}
					}
					modelTool(w, "structured_output", map[string]any{"dimension": "spec", "result": result, "affected_tasks": affected, "rework_count": 0})
					return
				}
				if index := strings.Index(text, "Review dimension: "); index >= 0 {
					dimension := strings.Fields(text[index+len("Review dimension: "):])[0]
					quality.Add(1)
					current := active.Add(1)
					defer active.Add(-1)
					for previous := peak.Load(); current > previous && !peak.CompareAndSwap(previous, current); previous = peak.Load() {
					}
					if current == 3 {
						release.Do(func() { close(barrier) })
					}
					if dimension != "testing" {
						select {
						case <-barrier:
						case <-r.Context().Done():
							return
						}
					}
					if request.Model != "senior-model" {
						t.Errorf("quality model=%s", request.Model)
					}
					result := map[string]any{"dimension": dimension, "result": "pass", "affected_tasks": []string{}, "rework_count": 0}
					if dimension == "security" {
						result["result"], result["affected_tasks"] = "fail", []string{"T1"}
						result["findings"] = []any{map[string]any{"id": "F1", "task_id": "T1", "description": "A locally verified issue", "severity": "high", "confidence": 90}}
					}
					modelTool(w, "structured_output", result)
					return
				}
				if strings.Contains(text, "你是独立 skeptic reviewer") {
					skeptics.Add(1)
					if request.Model != "fast-model" {
						t.Errorf("skeptic model=%s", request.Model)
					}
					angle := "runtime-behavior"
					if strings.Contains(text, "只核对代码语义、类型") {
						angle = "code-semantics"
					}
					modelTool(w, "structured_output", map[string]any{"finding_id": "F1", "angle": angle, "verdict": "TRUE_POSITIVE", "confidence": 95, "rationale": "Verified locally", "evidence": []string{"fixture evidence"}})
					return
				}
				if request.Model != "senior-model" {
					t.Errorf("assessment model=%s", request.Model)
				}
				verdict, groups := "UNCERTAIN", []any{}
				if strings.Contains(text, "你是最终 CR 裁决者") {
					verdict = "TRUE_POSITIVE"
					groups = []any{map[string]any{"id": "G1", "title": "Shared issue", "summary": "Verified cause", "finding_ids": []string{"F1"}, "affected_tasks": []string{"T1"}, "severity": "high", "repair_strategy": "Repair the cause"}}
				}
				modelTool(w, "structured_output", map[string]any{"verdicts": []any{map[string]any{"finding_id": "F1", "dimension": "security", "verdict": verdict, "confidence": 95, "rationale": "Verified locally", "root_cause_id": "G1"}}, "root_cause_groups": groups})
			}))
			t.Cleanup(server.Close)
			adapter, err := openaiadapter.New(openaiadapter.Config{Endpoint: server.URL + "/v1", APIKey: "local-fixture", ProviderName: "fixture", Models: []openaiadapter.ModelConfig{{ID: "parent-model", ContextWindow: 32768}, {ID: "senior-model", ContextWindow: 32768}, {ID: "fast-model", ContextWindow: 32768}}, MaxRequests: 32})
			if err != nil {
				t.Fatal(err)
			}
			f := newWorkflowFixture(t, root, workspace, packages, adapter, allowed, 0)
			args, _ := json.Marshal(map[string]any{"pluginRoot": root, "ideaDir": ideaDir, "projectRoot": workspace, "baseRef": "HEAD~1", "complexity": "medium", "riskLevel": "high", "taskIds": []string{"T1"}, "reworkCycle": 0, "activeDimensions": []string{"security", "consistency", "concurrency", "testing"}, "dimensionBatches": [][]string{{"security", "consistency", "concurrency"}, {"testing"}}, "reviewPolicy": map[string]any{"max_concurrency": 3}})
			stringArgs, _ := json.Marshal(string(args))
			call, _ := json.Marshal(Call{ScriptPath: filepath.Join(root, "workflows", "coder-review.js"), Args: stringArgs})
			outcome, err := f.h.Tools().Execute(f.ctx, harness.ToolRequest{Agent: f.parent, Name: "Workflow", CallID: "original-review", Arguments: call})
			var result Result
			if err != nil || outcome.Result.IsError || len(outcome.Result.Content) != 1 || json.Unmarshal([]byte(outcome.Result.Content[0].Text), &result) != nil || result.StopReason != "completed" {
				t.Fatalf("original review failed through Workflow tool: %+v error=%v", outcome.Result, err)
			}
			var value struct {
				Status          string            `json:"status"`
				AffectedTasks   []string          `json:"affected_tasks"`
				RootCauseGroups []json.RawMessage `json:"root_cause_groups"`
			}
			if err := json.Unmarshal(result.Value, &value); err != nil {
				t.Fatal(err)
			}
			if allowed {
				if value.Status != "needs_rework" || len(value.RootCauseGroups) != 1 || len(value.AffectedTasks) != 1 || value.AffectedTasks[0] != "T1" || result.AgentCalls != 9 || calls.Load() != 10 || peak.Load() != 3 || quality.Load() != 4 || skeptics.Load() != 2 {
					t.Fatalf("review orchestration incomplete: result=%s agents=%d calls=%d peak=%d quality=%d skeptics=%d", result.Value, result.AgentCalls, calls.Load(), peak.Load(), quality.Load(), skeptics.Load())
				}
				if data, err := os.ReadFile(specPath); err != nil || !strings.Contains(string(data), "## Scope Check Proof") {
					t.Fatalf("approved child write did not execute: %v", err)
				}
			} else if value.Status != "spec_failed" || result.AgentCalls != 1 || quality.Load() != 0 || calls.Load() != 2 {
				t.Fatalf("spec hard gate did not stop downstream work: %s agents=%d calls=%d", result.Value, result.AgentCalls, calls.Load())
			} else if _, err := os.Stat(specPath); !os.IsNotExist(err) {
				t.Fatalf("denied child write still created a report: %v", err)
			}
			if f.approvals.Load() != 1 || len(f.h.Agents().List()) != 1 {
				t.Fatalf("approval or cleanup bypassed: approvals=%d live=%d", f.approvals.Load(), len(f.h.Agents().List()))
			}
			metadata := 0
			for _, event := range f.parent.Session().Events() {
				if event.Type == "workflow/meta" {
					metadata++
				}
			}
			if allowed && metadata != 3 {
				t.Fatalf("all three original scripts were not executed: metadata events=%d", metadata)
			}
		})
	}
}
