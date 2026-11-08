package subagents

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestDeferredChildDiscoversAuthorizedUnactivatedTools(t *testing.T) {
	shellAvailable := runtime.GOOS != "windows"
	for _, kind := range []string{"Explore", "Plan", "worker", "parent-denied", "no-tools"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			if err := os.WriteFile(filepath.Join(root, "existing.txt"), []byte("real-child-evidence"), 0600); err != nil {
				t.Fatal(err)
			}
			calls := 0
			allowed := []string{"Read", "NotMounted"}
			if kind == "no-tools" {
				allowed = []string{}
			}
			f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Tools    []struct{ Function struct{ Name string } }
					Messages json.RawMessage
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				names := []string{}
				for _, tool := range body.Tools {
					names = append(names, tool.Function.Name)
				}
				calls++
				switch calls {
				case 1:
					if kind == "no-tools" {
						if len(names) != 0 {
							t.Errorf("empty allowlist gained tools: %v", names)
						}
						claudeTextAnswer(w, "no-tools-preserved")
						return
					}
					if !slices.Equal(names, []string{"ToolSearch"}) {
						t.Errorf("initial child declarations=%v", names)
					}
					claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"discover","type":"function","function":{"name":"ToolSearch","arguments":"{\"query\":\"select:Read,Write,Bash,ReadToolOutput\"}"}}]},"finish_reason":"tool_calls"}]}`)
				case 2:
					if (kind != "worker") != slices.Contains(names, "ReadToolOutput") {
						t.Errorf("readback did not follow child tool policy: %v", names)
					}
					if slices.Contains(names, "Write") {
						t.Error("child discovered forbidden Write")
					}
					if kind == "parent-denied" {
						if slices.Contains(names, "Read") {
							t.Error("discovery bypassed parent deny")
						}
						claudeTextAnswer(w, "parent-deny-preserved")
						return
					}
					if !slices.Contains(names, "Read") || (kind != "worker" && shellAvailable != slices.Contains(names, "Bash")) {
						t.Errorf("lost unactivated authorized tools: %v", names)
					}
					if kind == "worker" && slices.Contains(names, "Bash") {
						t.Error("custom child exceeded its Read allowlist")
					}
					claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"read","type":"function","function":{"name":"Read","arguments":"{\"file_path\":\"existing.txt\"}"}}]},"finish_reason":"tool_calls"}]}`)
				case 3:
					if !strings.Contains(string(body.Messages), "real-child-evidence") {
						t.Error("child did not execute the discovered Read")
					}
					claudeTextAnswer(w, "read-completed")
				default:
					t.Error("unexpected provider continuation")
					w.WriteHeader(400)
				}
			}, true, []AgentDefinition{{Name: "worker", Description: "Read only", Instructions: "Read the existing file.", Tools: allowed}}, ClaudeOptions{}, nativetools.Options{Workspace: root, ClaudeTools: true, EnableShell: shellAvailable, DeferToolLoading: true, SpillStore: harness.NewLocalSpillStore(t.TempDir() + "/saved")})
			if kind == "parent-denied" {
				parent, err := f.h.Agents().Create(f.ctx, harness.AgentOptions{CWD: root, Provider: "fixture", Model: "parent-model", MaxSteps: 5, DisableCompaction: true, Configure: func(ctx context.Context, run *point.Run, agent *harness.Agent) error {
					_, err := f.h.Tools().Restrict(ctx, run, agent, harness.ToolRestriction{Deny: []string{"Read"}})
					return err
				}})
				if err != nil {
					t.Fatal(err)
				}
				f.parent = parent
			}
			search := f.call(t, f.parent, "ToolSearch", `{"query":"Agent"}`)
			if search.IsError {
				t.Fatalf("Agent discovery failed: %+v", search)
			}
			parentTools, err := f.h.Tools().SchemasForAgent(f.ctx, f.parent)
			if err != nil {
				t.Fatal(err)
			}
			for _, tool := range parentTools {
				if tool.Name == "Read" || tool.Name == "Bash" {
					t.Fatal("parent unexpectedly activated native tools")
				}
			}
			selected := kind
			if kind == "no-tools" {
				selected = "worker"
			}
			if kind == "parent-denied" {
				selected = "Explore"
			}
			result := f.call(t, f.parent, "Agent", fmt.Sprintf(`{"subagent_type":%q,"description":"research","prompt":"Discover Read and inspect existing.txt."}`, selected))
			if result.IsError || taskReceipt(t, result).Status != harness.SubagentCompleted {
				t.Fatalf("child failed: %+v", result)
			}
			want := 3
			if kind == "no-tools" {
				want = 1
			}
			if kind == "parent-denied" {
				want = 2
			}
			if calls != want {
				t.Fatalf("provider calls=%d want=%d", calls, want)
			}
		})
	}
}
