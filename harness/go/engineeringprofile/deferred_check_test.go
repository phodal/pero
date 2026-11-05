//go:build linux || darwin

package engineeringprofile

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestDeferredCheckRequiresDeclaredExecutionTool(t *testing.T) {
	search := func(id, query string) harness.Completion {
		arguments, err := json.Marshal(struct {
			Query string `json:"query"`
		}{query})
		if err != nil {
			t.Fatal(err)
		}
		return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: harness.ToolCallID(id), Name: "tool_search", Arguments: arguments}}}}
	}
	for _, test := range []struct {
		name                 string
		discoverShell, strip bool
		want                 CheckStatus
	}{
		{"wrapper only", false, false, Failed},
		{"wrapper and execution tool", true, false, Passed},
		{"wrapper removed from request", true, true, Missing},
	} {
		t.Run(test.name, func(t *testing.T) {
			responses := []harness.Completion{search("discover-check", "engineering_check")}
			if test.discoverShell {
				responses = append(responses, search("discover-shell", "approved foreground Bash"))
			}
			if !test.strip {
				responses = append(responses, checkCall())
			}
			responses = append(responses, answer(harness.FinishStop))
			if test.strip {
				responses = append(responses, answer(harness.FinishStop))
			}
			f := setup(t, Feedback, 8, responses...)
			native, err := nativetools.Mount(f.ctx, f.h, nativetools.Options{Workspace: f.root, EnableShell: true, DeferToolLoading: true, PDFRendererPath: "-"})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := native.Close(); err != nil {
					t.Error(err)
				}
			})
			definition := point.Define(point.Descriptor{ID: "fixture/deferred-check"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
				if _, err := f.h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
					return harness.ApprovalAllowedOnce, nil
				}); err != nil {
					return nil, err
				}
				if test.strip {
					return f.h.Hooks().Request.Use(run, func(_ context.Context, request harness.GenerateRequest, next point.Next[harness.GenerateRequest]) (harness.GenerateRequest, error) {
						var tools []harness.ToolSchema
						for _, tool := range request.Tools {
							if tool.Name != "engineering_check" {
								tools = append(tools, tool)
							}
						}
						request.Tools = tools
						return next(request)
					})
				}
				return nil, nil
			})
			instance, err := f.h.Runtime().Mount(nil, "fixture/deferred-check", definition, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := instance.WaitStable(f.ctx); err != nil {
				t.Fatal(err)
			}
			c := testContract()
			c.Checks[0].Command = "printf checked > check-marker"
			f.prompt(t, &c)
			if err := f.agent.WhenIdle(f.ctx); err != nil {
				t.Fatal(err)
			}
			got := f.assessment(t)
			if got.Checks[0].Status != test.want || got.Ready != (test.want == Passed) {
				t.Fatalf("check assessment=%+v", got)
			}
			marker, err := os.ReadFile(filepath.Join(f.root, "check-marker"))
			if test.want == Passed {
				if err != nil || string(marker) != "checked" {
					t.Fatalf("discovered native shell did not execute: %q %v", marker, err)
				}
			} else if !os.IsNotExist(err) {
				t.Fatalf("undeclared check executed: %q %v", marker, err)
			}
			for _, request := range f.adapter.requests {
				declared := harness.PromptCapabilities{Tools: request.Tools}.HasTool("engineering_check")
				if strings.Contains(request.System, "use engineering_check with its exact checkId") != declared {
					t.Fatalf("check guidance differs from final request tools: %s", request.System)
				}
				if request.RuntimeContext == nil || strings.Contains(request.RuntimeContext.Text, "engineering_check") {
					t.Fatal("runtime facts advertised a tool invocation")
				}
				for _, message := range request.Messages {
					var source struct{ Kind string }
					if json.Unmarshal(message.Source, &source) != nil || source.Kind != "engineeringprofile" {
						continue
					}
					for _, block := range message.Content {
						if strings.Contains(block.Text, "engineering_check") {
							t.Fatal("feedback advertised a tool absent from the final request")
						}
					}
				}
			}
			if test.strip {
				if count, _, err := attempts(f.agent.Session(), c, ""); err != nil || count != 1 {
					t.Fatalf("fixture did not exercise factual stop feedback: count=%d error=%v", count, err)
				}
			}
		})
	}
}
