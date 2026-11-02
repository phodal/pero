package subagents

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestClaudeDefinitionResolution(t *testing.T) {
	definitions := make(map[string]AgentDefinition)
	for _, name := range []string{"alpha:worker", "beta:worker", "beta:solo", "beta:review:security", "gamma:review:security", "Explore", "alpha:Explore"} {
		definitions[name] = AgentDefinition{Name: name}
	}
	for _, test := range []struct{ name, origin, want, errorText string }{
		{"worker", "beta", "beta:worker", ""},
		{"alpha:worker", "beta", "alpha:worker", ""},
		{"solo", "", "beta:solo", ""},
		{"security", "beta", "beta:review:security", ""},
		{"Explore", "alpha", "Explore", ""},
		{"worker", "", "", "alpha:worker, beta:worker"},
		{"worker", "absent", "", "ambiguous"},
		{"wrong:worker", "alpha", "", "unknown"},
		{"missing", "alpha", "", "unknown"},
	} {
		t.Run(fmt.Sprintf("%s/%s", test.origin, test.name), func(t *testing.T) {
			definition, err := resolveClaudeDefinition(definitions, test.name, test.origin)
			if test.errorText != "" {
				if err == nil || !strings.Contains(err.Error(), test.errorText) {
					t.Fatalf("definition=%+v error=%v", definition, err)
				}
			} else if err != nil || definition.Name != test.want {
				t.Fatalf("definition=%+v error=%v want=%s", definition, err, test.want)
			}
		})
	}
}

func TestClaudeAgentBareNameRunsSelectedPersona(t *testing.T) {
	for _, test := range []struct{ name, origin, selected, marker string }{
		{"worker", "beta", "beta:worker", "BETA_SELECTED"},
		{"solo", "", "beta:solo", "SOLO_SELECTED"},
		{"beta:worker", "alpha", "beta:worker", "BETA_SELECTED"},
	} {
		t.Run(test.name+"/"+test.origin, func(t *testing.T) {
			definitions := []AgentDefinition{
				{Name: "alpha:worker", Description: "alpha worker", Instructions: "ALPHA_SELECTED", Model: "inherit"},
				{Name: "beta:worker", Description: "beta worker", Instructions: "BETA_SELECTED", Model: "inherit"},
				{Name: "beta:solo", Description: "only solo", Instructions: "SOLO_SELECTED", Model: "inherit"},
			}
			var f *claudeHTTPFixture
			var calls atomic.Int32
			f = newClaudeHTTPFixture(t, t.TempDir(), func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				body, _ := io.ReadAll(r.Body)
				if !strings.Contains(string(body), test.marker) || strings.Contains(string(body), "ALPHA_SELECTED") {
					t.Errorf("wrong persona selected: %s", body)
				}
				found := false
				for _, child := range f.h.Agents().List() {
					if child.Parent() != f.parent {
						continue
					}
					found = true
					// The child owns its selected definition's origin before its
					// first request, even if its parent's active workflow differs.
					origin, err := (&claudeDelegation{}).invocationPlugin(child)
					if err != nil || origin != "beta" {
						t.Errorf("child origin=%s error=%v", origin, err)
					}
					selected, err := resolveClaudeDefinition(map[string]AgentDefinition{definitions[0].Name: definitions[0], definitions[1].Name: definitions[1]}, "worker", origin)
					if err != nil || selected.Name != "beta:worker" {
						t.Errorf("child bare name=%+v error=%v", selected, err)
					}
				}
				if !found {
					t.Error("child not present while executing its first model request")
				}
				claudeTextAnswer(w, "selected "+test.selected)
			}, true, definitions, ClaudeOptions{InvocationOrigin: func(agent *harness.Agent) string {
				if agent.Parent() == nil {
					return test.origin
				}
				return ""
			}})
			result := f.call(t, f.parent, "Agent", fmt.Sprintf(`{"subagent_type":%q,"description":"resolve bare plugin name","prompt":"Run the selected persona"}`, test.name))
			if result.IsError || calls.Load() != 1 || len(result.Content) != 2 || !strings.Contains(result.Content[1].Text, test.selected) {
				t.Fatalf("selected result=%+v requests=%d", result, calls.Load())
			}
		})
	}
}
