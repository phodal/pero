//go:build linux || darwin

package pluginruntime

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/agentinstructions"
	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	"github.com/phodal/pero/harness/go/subagents"
)

func TestInstructionsLoadedObservesActualContext(t *testing.T) {
	for _, scope := range []string{"package", "skill", "agent"} {
		t.Run(scope, func(t *testing.T) {
			root, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"CLAUDE.md", "AGENTS.md", "nested/CLAUDE.md"} {
				path := filepath.Join(root, name)
				if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(path, []byte("Guidance "+name), 0600); err != nil {
					t.Fatal(err)
				}
			}
			hook := scriptHook(t, root, "InstructionsLoaded", `cat >> "$CLAUDE_PLUGIN_ROOT/loads.jsonl"; printf '%s' '{"continue":false,"systemMessage":"must-not-reach-model","terminalSequence":"must-not-reach-terminal"}'; exit 2`)
			hook.Matcher = "session_start|nested_traversal"
			hook.Async = true
			adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				raw, _ := json.Marshal(request.Messages)
				if strings.Contains(string(raw), "must-not-reach") {
					t.Error("observer changed model context")
				}
				return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
			})
			pkg := plugins.Package{Root: root, Definition: plugins.Plugin{Name: "instruction-observer"}}
			if scope == "package" {
				pkg.Hooks = []claudehooks.Hook{hook}
			} else {
				kind := plugins.ComponentSkill
				if scope == "agent" {
					kind = plugins.ComponentAgent
				}
				pkg.Definition.Components = []plugins.Component{{Kind: kind, QualifiedName: "instruction-observer:observe", Hooks: []claudehooks.Hook{hook}}}
			}
			h, err := harness.Boot(t.Context(), harness.Options{EnableSubagents: true, Adapter: adapter, AdapterProviders: []string{"fixture"}})
			if err != nil {
				t.Fatal(err)
			}
			app, err := MountHooks(t.Context(), h, []plugins.Package{pkg}, HookOptions{Shell: "/bin/sh", StateDirectory: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = app.Close() }()
			app.options.EmitTerminal = func(string) { t.Error("observer wrote terminal output") }
			instructions, err := agentinstructions.Mount(t.Context(), h, agentinstructions.Options{Workspace: root, Hierarchical: true})
			if err != nil {
				t.Fatal(err)
			}
			defer instructions.Close()
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "instructions", CWD: root, Provider: "fixture", Model: "scripted"})
			if err != nil {
				t.Fatal(err)
			}
			if scope == "skill" {
				// Admit the first baseline before activation. A later active observer must
				// see the current baseline even without a package-level declaration.
				if err := prompt(t, agent, "before activation"); err != nil {
					t.Fatal(err)
				}
				app.ActivateSkillHooks(agent, "instruction-observer", root, "instruction-observer:observe", []claudehooks.Hook{hook})
			}
			waitFor := func(count int) []claudehooks.Input {
				t.Helper()
				ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
				defer cancel()
				ticker := time.NewTicker(10 * time.Millisecond)
				defer ticker.Stop()
				for {
					raw, _ := os.ReadFile(filepath.Join(root, "loads.jsonl"))
					lines := strings.Split(strings.TrimSpace(string(raw)), "\n")
					if len(lines) == count {
						result := []claudehooks.Input{}
						valid := true
						for _, line := range lines {
							var input claudehooks.Input
							if json.Unmarshal([]byte(line), &input) != nil {
								valid = false
								break
							}
							result = append(result, input)
						}
						if valid {
							return result
						}
					}
					select {
					case <-ctx.Done():
						t.Fatalf("hook did not produce %d records: %s", count, raw)
						return nil
					case <-ticker.C:
					}
				}
			}
			var childID harness.SessionID
			if scope == "agent" {
				service, err := subagents.MountClaude(t.Context(), h, []subagents.AgentDefinition{{Name: "instruction-observer:observe", Description: "Observe instructions", Instructions: "Read the admitted guidance."}}, subagents.ClaudeOptions{})
				if err != nil {
					t.Fatal(err)
				}
				result, err := service.Invoke(t.Context(), agent, subagents.ClaudeInvocation{Definition: "instruction-observer:observe", Prompt: "first"})
				if err != nil || result.Status != harness.SubagentCompleted {
					t.Fatalf("child result=%+v err=%v", result, err)
				}
				childID = result.ChildID
			} else if err := prompt(t, agent, "first"); err != nil {
				t.Fatal(err)
			}
			rows := waitFor(1)
			if rows[0].FilePath != filepath.Join(root, "CLAUDE.md") || rows[0].LoadReason != "session_start" || rows[0].MemoryType != "Project" {
				t.Fatalf("root load=%+v", rows[0])
			}
			if scope == "agent" {
				if rows[0].AgentType != "instruction-observer:observe" || rows[0].AgentID != string(childID) || rows[0].SessionID != string(agent.ID()) {
					t.Fatalf("child attribution=%+v", rows[0])
				}
				return
			}
			if _, err := agent.Session().Append("workspace-instructions/touch", struct {
				Paths []string `json:"paths"`
			}{[]string{"nested/file.go"}}); err != nil {
				t.Fatal(err)
			}
			if err := prompt(t, agent, "nested"); err != nil {
				t.Fatal(err)
			}
			rows = waitFor(2)
			if rows[1].FilePath != filepath.Join(root, "nested/CLAUDE.md") || rows[1].LoadReason != "nested_traversal" {
				t.Fatalf("nested=%+v", rows[1])
			}
			if err := prompt(t, agent, "unchanged"); err != nil {
				t.Fatal(err)
			}
			count := 0
			for _, event := range agent.Session().Events() {
				if event.Type == "claude-hook/instructions-loaded" {
					count++
				}
			}
			if count != 2 {
				t.Fatalf("unchanged instructions re-fired: observations=%d", count)
			}

		})
	}
}
