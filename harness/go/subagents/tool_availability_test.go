package subagents

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestAgentDropsUnavailableDeclaredTools(t *testing.T) {
	root := t.TempDir()
	var names []string
	f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Tools []struct {
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
		names = nil
		for _, tool := range body.Tools {
			names = append(names, tool.Function.Name)
			if tool.Function.Name == "NotMounted" {
				t.Error("unavailable declared tool was exposed")
			}
		}
		claudeTextAnswer(w, "tools-checked")
	}, true, []AgentDefinition{{
		Name: "worker", Description: "Check tools", Instructions: "Use only the tools you can see.", Model: "inherit",
		Tools: []string{"Read", "NotMounted"},
	}}, ClaudeOptions{})
	result := f.call(t, f.parent, "Agent", `{"subagent_type":"worker","description":"check tools","prompt":"List nothing and finish."}`)
	if result.IsError || !strings.Contains(fmtResult(result), "tools-checked") || !containsName(names, "Read") {
		t.Fatalf("child did not keep the available tool: names=%v result=%+v", names, result)
	}
}

func TestAgentFailsWhenNoDeclaredToolIsAvailable(t *testing.T) {
	root := t.TempDir()
	f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
		t.Error("model was called with no available tools")
		w.WriteHeader(400)
	}, true, []AgentDefinition{{
		Name: "worker", Description: "Check tools", Instructions: "Stop.", Model: "inherit",
		Tools: []string{"NotMounted"},
	}}, ClaudeOptions{})
	out, err := f.h.Tools().Execute(f.ctx, harness.ToolRequest{Agent: f.parent, Name: "Agent", CallID: "missing-tools", Arguments: json.RawMessage(`{"subagent_type":"worker","description":"check tools","prompt":"Stop."}`)})
	text := ""
	if err != nil {
		text = err.Error()
	} else {
		text = fmtResult(out.Result)
	}
	if !strings.Contains(text, "none of the declared tools are available") {
		t.Fatalf("unavailable tool list was accepted: %s", text)
	}
}

func containsName(names []string, want string) bool {
	for _, name := range names {
		if name == want {
			return true
		}
	}
	return false
}
