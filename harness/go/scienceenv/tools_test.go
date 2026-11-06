package scienceenv

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	runtime "github.com/phodal/pero/harness/go/runtime"
)

func TestScienceToolsRequireApprovalAndDispatchMCP(t *testing.T) {
	root := t.TempDir()
	ctx := t.Context()
	h, err := harness.Boot(ctx, harness.Options{ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		h.Dispose(context.Background())
		h.Drain(context.Background())
	})
	echo := harness.PublicMCPToolName("demo", "echo")
	_, err = h.RegisterTool(ctx, "test/mcp-echo", harness.Tool{
		Schema: harness.ToolSchema{Name: echo, InputSchema: json.RawMessage(`{"type":"object","additionalProperties":true}`)},
		Execute: func(_ context.Context, raw json.RawMessage) (harness.ToolResult, error) {
			return harness.ToolResult{Value: append(json.RawMessage(nil), raw...), Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	env, err := Mount(ctx, h, Options{Workspace: root, Python: pythonBin(t), Rscript: "Rscript", MCP: AgentMCP(h)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { env.Close() })

	create := func(id string, grant bool) *harness.Agent {
		t.Helper()
		agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: harness.SessionID(id), CWD: root, Configure: func(_ context.Context, run *runtime.Run, _ *harness.Agent) error {
			if !grant {
				return nil
			}
			_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
				return harness.ApprovalAllowedOnce, nil
			})
			return err
		}})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := agent.Session().Append("turn/start", map[string]int{"turn": 1}); err != nil {
			t.Fatal(err)
		}
		return agent
	}
	seq := 0
	run := func(agent *harness.Agent, name, code string) harness.ToolResult {
		t.Helper()
		seq++
		out, err := h.Tools().Execute(ctx, harness.ToolRequest{
			Agent: agent, Name: name, CallID: harness.ToolCallID(fmt.Sprintf("%s-%d", name, seq)),
			Arguments: json.RawMessage(`{"code":` + jsonString(code) + `}`),
		})
		if err != nil {
			t.Fatal(err)
		}
		return out.Result
	}

	denied := create("denied", false)
	if result := run(denied, pythonTool, `open("marker.txt","w").write("x")`); !result.IsError {
		t.Fatal("unapproved python ran")
	}
	if _, err := os.Stat(filepath.Join(root, "marker.txt")); !os.IsNotExist(err) {
		t.Fatal("denied python wrote a file")
	}

	allowed := create("allowed", true)
	if result := run(allowed, pythonTool, "marker = 'py'"); result.IsError {
		t.Fatalf("python: %s", result.Content[0].Text)
	}
	if result := run(allowed, pythonTool, "marker"); result.IsError || !strings.Contains(result.Content[0].Text, "py") {
		t.Fatalf("python state: %+v", result)
	}
	if result := run(allowed, replTool, "import host\nprint(host.mcp('demo', 'echo', text='hi')['text'])"); result.IsError || !strings.Contains(result.Content[0].Text, "hi") {
		t.Fatalf("repl mcp: %+v", result)
	}
	if result := run(allowed, replTool, "marker"); !result.IsError {
		t.Fatal("repl saw the python kernel's marker")
	}
	other := create("other", true)
	if result := run(other, pythonTool, "marker"); !result.IsError {
		t.Fatal("another session saw this session's python state")
	}
}

func jsonString(value string) string {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(raw)
}
