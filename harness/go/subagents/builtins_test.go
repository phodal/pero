package subagents

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
)

func TestBuiltinExploreAndPlanReallyReadWithoutWriting(t *testing.T) {
	for _, kind := range []string{"Explore", "Plan"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			existing := filepath.Join(root, "existing.txt")
			forbidden := filepath.Join(root, "forbidden.txt")
			if err := os.WriteFile(existing, []byte("existing-code-evidence"), 0600); err != nil {
				t.Fatal(err)
			}
			var calls atomic.Int32
			f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Model    string          `json:"model"`
					Messages json.RawMessage `json:"messages"`
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
				var names []string
				for _, tool := range body.Tools {
					names = append(names, tool.Function.Name)
				}
				sort.Strings(names)
				expected := []string{"AgentList", "Glob", "Grep", "NotebookImage", "NotebookRead", "Read", "ToolSearch"}
				// PDF rendering is a probed host capability and may be absent in CI.
				if containsName(names, "PDFRead") {
					expected = append(expected, "PDFRead")
					sort.Strings(expected)
				}
				if body.Model != "parent-model" || !reflect.DeepEqual(names, expected) {
					t.Errorf("builtin route or tools: model=%s tools=%v", body.Model, names)
				}
				if calls.Add(1) == 1 {
					read, _ := json.Marshal(struct {
						Path string `json:"file_path"`
					}{existing})
					quotedRead, _ := json.Marshal(string(read))
					write, _ := json.Marshal(struct {
						Path    string `json:"file_path"`
						Content string `json:"content"`
					}{forbidden, "forbidden"})
					quotedWrite, _ := json.Marshal(string(write))
					claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"read-existing","type":"function","function":{"name":"Read","arguments":`+string(quotedRead)+`}},{"index":1,"id":"attempt-write","type":"function","function":{"name":"Write","arguments":`+string(quotedWrite)+`}}]},"finish_reason":"tool_calls"}]}`)
					return
				}
				if !strings.Contains(string(body.Messages), "existing-code-evidence") {
					t.Error("builtin did not receive real file content")
				}
				claudeTextAnswer(w, "readonly-research-result")
			}, true, nil, ClaudeOptions{})
			if _, err := harness.SetPermissionMode(f.parent.Session(), harness.PermissionAutoReview); err != nil {
				t.Fatal(err)
			}
			result := f.call(t, f.parent, "Agent", fmt.Sprintf(`{"subagent_type":%q,"description":"research","prompt":"Read existing code and report."}`, kind))
			if result.IsError || taskReceipt(t, result).Status != harness.SubagentCompleted || !strings.Contains(fmt.Sprint(result.Content), "readonly-research-result") {
				t.Fatalf("builtin did not run: %+v", result)
			}
			if _, err := os.Stat(forbidden); !os.IsNotExist(err) {
				t.Fatal("read-only builtin wrote a file")
			}
			if f.approvals.Load() != 0 {
				t.Fatal("invisible write reached approval handler")
			}
		})
	}
}

func TestBuiltinExploreAllowsReadOnlyBashAndRejectsWrites(t *testing.T) {
	root := t.TempDir()
	existing := filepath.Join(root, "existing.txt")
	forbidden := filepath.Join(root, "forbidden.txt")
	if err := os.WriteFile(existing, []byte("probe-content"), 0600); err != nil {
		t.Fatal(err)
	}
	var calls atomic.Int32
	f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages json.RawMessage `json:"messages"`
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
		foundBash := false
		for _, tool := range body.Tools {
			foundBash = foundBash || tool.Function.Name == "Bash"
			if tool.Function.Name == "Write" || tool.Function.Name == "Edit" {
				t.Errorf("read-only builtin exposed %s", tool.Function.Name)
			}
		}
		if !foundBash {
			t.Error("Explore lost mounted Bash")
		}
		switch calls.Add(1) {
		case 1:
			readArgs, _ := json.Marshal(struct {
				Command string `json:"command"`
			}{`cat existing.txt`})
			quotedRead, _ := json.Marshal(string(readArgs))
			writeArgs, _ := json.Marshal(struct {
				Command string `json:"command"`
			}{`printf changed > forbidden.txt`})
			quotedWrite, _ := json.Marshal(string(writeArgs))
			claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"readonly-bash","type":"function","function":{"name":"Bash","arguments":`+string(quotedRead)+`}},{"index":1,"id":"write-bash","type":"function","function":{"name":"Bash","arguments":`+string(quotedWrite)+`}}]},"finish_reason":"tool_calls"}]}`)
		default:
			messages := string(body.Messages)
			if !strings.Contains(messages, "probe-content") {
				t.Error("Explore did not receive read-only Bash output")
			}
			if !strings.Contains(messages, "read-only shell commands") {
				t.Error("Explore missing deny reason for mutating Bash")
			}
			if strings.Contains(messages, `"is_error":false`) && strings.Contains(messages, "write-bash") {
				t.Error("Explore reported mutating Bash as success")
			}
			claudeTextAnswer(w, "explore-bash-result")
		}
	}, true, nil, ClaudeOptions{}, nativetools.Options{Workspace: root, ClaudeTools: true, EnableShell: true})
	if _, err := harness.SetPermissionMode(f.parent.Session(), harness.PermissionAutoReview); err != nil {
		t.Fatal(err)
	}
	result := f.call(t, f.parent, "Agent", `{"subagent_type":"Explore","description":"shell research","prompt":"Inspect existing.txt with Bash."}`)
	if result.IsError || taskReceipt(t, result).Status != harness.SubagentCompleted || !strings.Contains(fmt.Sprint(result.Content), "explore-bash-result") {
		t.Fatalf("Explore Bash path failed: %+v", result)
	}
	if _, err := os.Stat(forbidden); !os.IsNotExist(err) {
		t.Fatal("mutating Bash wrote a file through Explore")
	}
}

func TestBuiltinGeneralPurposeIsDefaultAndUsesParentTools(t *testing.T) {
	root := t.TempDir()
	output := filepath.Join(root, "result.txt")
	var calls atomic.Int32
	f := newClaudeHTTPFixture(t, root, func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
			Tools []struct {
				Function struct {
					Name string `json:"name"`
				} `json:"function"`
			} `json:"tools"`
		}
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			w.WriteHeader(400)
			return
		}
		if body.Model != "parent-model" {
			t.Error("general-purpose did not inherit model")
		}
		found := false
		for _, tool := range body.Tools {
			found = found || tool.Function.Name == "Write"
		}
		if !found {
			t.Error("general-purpose lost inherited Write")
		}
		if calls.Add(1) == 1 {
			args, _ := json.Marshal(struct {
				Path    string `json:"file_path"`
				Content string `json:"content"`
			}{output, "general-artifact"})
			quoted, _ := json.Marshal(string(args))
			claudeHTTPAnswer(w, `{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"general-write","type":"function","function":{"name":"Write","arguments":`+string(quoted)+`}}]},"finish_reason":"tool_calls"}]}`)
			return
		}
		claudeTextAnswer(w, "general-purpose-result")
	}, true, nil, ClaudeOptions{})
	result := f.call(t, f.parent, "Agent", `{"description":"general work","prompt":"Write result.txt."}`)
	if result.IsError || !strings.Contains(fmt.Sprint(result.Content), "general-purpose-result") {
		t.Fatalf("default builtin failed: %+v", result)
	}
	text, err := os.ReadFile(output)
	if err != nil || string(text) != "general-artifact" || f.approvals.Load() != 1 {
		t.Fatalf("general-purpose did not use real inherited authority: %q %v", text, err)
	}
}
