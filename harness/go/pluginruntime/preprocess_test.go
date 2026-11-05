//go:build linux || darwin

package pluginruntime

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/plugins"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/skills"
)

func expansionFixture(t *testing.T) (*harness.Harness, *harness.Agent, skills.Definition, ExpansionOptions, *atomic.Int32) {
	t.Helper()
	program, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("Bash is required by the existing foreground executor")
	}
	program, err = filepath.Abs(program)
	if err != nil {
		t.Fatal(err)
	}
	h, err := harness.Boot(t.Context(), harness.Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = h.Dispose(ctx)
		if err := h.Drain(ctx); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	if _, err := h.RegisterTool(t.Context(), "expansion/bash", harness.Tool{
		Schema: harness.ToolSchema{Name: "Bash", InputSchema: json.RawMessage(`{"type":"object"}`)},
		Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
			return harness.ToolResult{}, errors.New("dynamic commands use the dedicated foreground executor")
		},
	}); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	var answerers atomic.Int32
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "expansion", CWD: root, Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			answerers.Add(1)
			return harness.ApprovalAllowedOnce, nil
		})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().Append("turn/start", struct{ Turn int }{1}); err != nil {
		t.Fatal(err)
	}
	definition := skills.Definition{Summary: skills.Summary{Name: "fixture:dynamic", Digest: "fixture"}, ResourceBase: root, Directory: "skills/dynamic", Claude: true, AllowedTools: []string{"Bash"}}
	options := ExpansionOptions{Shell: program, Environment: []string{"PATH=/usr/bin:/bin"}}
	return h, agent, definition, options, &answerers
}

func TestSkillShellUsesTheRequestedExecutable(t *testing.T) {
	bin := t.TempDir()
	script := filepath.Join(bin, "pwsh")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho pwsh-marker\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", bin)
	h, agent, definition, options, _ := expansionFixture(t)
	definition.Shell = "powershell"
	definition.Content = "!`printf from-bash`"
	got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
	if err != nil || !strings.Contains(got.Content, "pwsh-marker") || strings.Contains(got.Content, "from-bash") {
		t.Fatalf("content=%q err=%v", got.Content, err)
	}
}

func TestOriginalSkillCommandsExpandOnce(t *testing.T) {
	for _, test := range []struct {
		name, content, arguments, expected string
		commands                           int
	}{
		{name: "inline", content: "before !`printf first` and !`printf second` after", expected: "before first and second after", commands: 2},
		{name: "fenced multiline", content: "before\n```!\nprintf first\nprintf second\n```\nafter", expected: "before\nfirstsecond\nafter", commands: 1},
		{name: "stderr retained", content: "!`printf stderr >&2`", expected: "stderr", commands: 1},
		{name: "command output cannot create another command", content: "```!\nprintf '\\041\\140touch emitted\\140'\n```", expected: "!`touch emitted`", commands: 1},
		{name: "arguments cannot create another command", content: "!`printf '%s' '$ARGUMENTS'`", arguments: "topic !`touch from-arguments`", expected: "topic !`touch from-arguments`", commands: 1},
		{name: "arguments outside source commands remain inert", content: "snapshot !`printf ready`", arguments: "!`touch from-arguments`", expected: "snapshot ready\n\nARGUMENTS: !`touch from-arguments`", commands: 1},
		{name: "command output cannot become argument or variable templates", content: "```!\nprintf '\\044ARGUMENTS \\044{CLAUDE_PLUGIN_ROOT}'\n```", arguments: "provided", expected: "$ARGUMENTS ${CLAUDE_PLUGIN_ROOT}\n\nARGUMENTS: provided", commands: 1},
		{name: "text surrounding commands is rendered once", content: "For $ARGUMENTS: !`printf done`", arguments: "topic $ARGUMENTS ${CLAUDE_PLUGIN_ROOT}", expected: "For topic $ARGUMENTS ${CLAUDE_PLUGIN_ROOT}: done", commands: 1},
		{name: "missing positional command argument still appends original args once", content: "!`printf '%s' '$9'`", arguments: "one", expected: "$9\n\nARGUMENTS: one", commands: 1},
		{name: "nonwhitespace prefix is literal", content: "KEY=!`touch prefixed`", expected: "KEY=!`touch prefixed`"},
		{name: "unfinished inline is literal", content: "!`not closed", expected: "!`not closed"},
	} {
		t.Run(test.name, func(t *testing.T) {
			h, agent, definition, options, answerers := expansionFixture(t)
			definition.Content = test.content
			got, err := ExpandSkill(t.Context(), h, agent, definition, test.arguments, options)
			if err != nil || got.Content != test.expected || answerers.Load() != 0 {
				t.Fatalf("content=%q answerers=%d error=%v", got.Content, answerers.Load(), err)
			}
			if test.commands > 0 {
				rerendered, err := skills.RenderInvocation(got, test.arguments, string(agent.ID()), agent.Session().Header().CWD)
				if err != nil || rerendered.Content != got.Content {
					t.Fatalf("command output was scanned a second time: %q %v", rerendered.Content, err)
				}
			}
			var commands []string
			identities := make(map[harness.ToolCallID]bool)
			for _, event := range agent.Session().Events() {
				if event.Type != "approval/asked" {
					continue
				}
				var request harness.ApprovalRequest
				if err := json.Unmarshal(event.Data, &request); err != nil {
					t.Fatal(err)
				}
				if request.ToolName != "Bash" || request.CallID == "" || identities[request.CallID] {
					t.Fatalf("permission identity is missing or reused: %+v", request)
				}
				identities[request.CallID] = true
				commands = append(commands, request.Reason)
				if test.name == "arguments outside source commands remain inert" && request.Reason != "printf ready" {
					t.Fatalf("unused arguments were appended to the executable command: %q", request.Reason)
				}
			}
			if len(commands) != test.commands {
				t.Fatalf("authorized %d commands, expected %d", len(commands), test.commands)
			}
			for _, marker := range []string{"emitted", "from-arguments", "prefixed"} {
				if _, err := os.Stat(filepath.Join(agent.Session().Header().CWD, marker)); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("literal text became an executable command: %s, %v", marker, err)
				}
			}
			assertNoSkillOutputs(t, agent.Session().Header().CWD)
		})
	}
}

func TestSkillCommandsRequireScopedBashBeforePermission(t *testing.T) {
	for _, mode := range []harness.PermissionMode{harness.PermissionFullAccess, harness.PermissionAutoReview} {
		t.Run(string(mode), func(t *testing.T) {
			h, agent, definition, options, answerers := expansionFixture(t)
			if _, err := h.RegisterToolRestrictionAt(t.Context(), agent, "expansion/no-bash", harness.ToolRestriction{Deny: []string{"Bash"}}); err != nil {
				t.Fatal(err)
			}
			if _, err := harness.SetPermissionMode(agent.Session(), mode); err != nil {
				t.Fatal(err)
			}
			definition.Content = "!`touch forbidden`"
			if got, err := ExpandSkill(t.Context(), h, agent, definition, "", options); !errors.Is(err, ErrSkillCommandDenied) || got.Content != "" {
				t.Fatalf("unavailable Bash expanded despite its allowed-tools grant: %q %v", got.Content, err)
			}
			if answerers.Load() != 0 {
				t.Fatal("missing tool incorrectly reached a permission answerer")
			}
			if _, err := os.Stat(filepath.Join(agent.Session().Header().CWD, "forbidden")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("unavailable shell created a side effect: %v", err)
			}
			definition.Content = "static skill"
			if got, err := ExpandSkill(t.Context(), h, agent, definition, "", options); err != nil || got.Content != definition.Content {
				t.Fatalf("static skill incorrectly requires Bash: %q %v", got.Content, err)
			}
		})
	}
}

func TestSkillCommandRuntimeVariables(t *testing.T) {
	h, agent, definition, options, _ := expansionFixture(t)
	definition.Content = "!`printf '%s|%s|%s|%s' '${CLAUDE_PLUGIN_ROOT}' '${CLAUDE_PROJECT_DIR}' '${CLAUDE_SESSION_ID}' \"$CLAUDE_SESSION_ID\"`"
	got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
	want := definition.ResourceBase + "|" + agent.Session().Header().CWD + "|" + string(agent.ID()) + "|" + string(agent.ID())
	if err != nil || got.Content != want {
		t.Fatalf("content=%q want=%q error=%v", got.Content, want, err)
	}
}

func TestSkillCommandRequiresExistingPermission(t *testing.T) {
	for _, test := range []struct {
		name   string
		policy harness.ApprovalPolicy
		mode   harness.PermissionMode
		allow  bool
	}{
		{name: "ask and unmatched abort without prompting"},
		{name: "never", policy: harness.ApprovalNever, allow: true},
		{name: "read only", mode: harness.PermissionReadOnly, allow: true},
		{name: "workspace write", mode: harness.PermissionWorkspaceWrite, allow: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			h, agent, definition, options, answerers := expansionFixture(t)
			definition.Content = "!`touch forbidden`"
			if !test.allow {
				definition.AllowedTools = nil
			}
			if test.policy != "" {
				if _, err := harness.SetApprovalPolicy(agent.Session(), test.policy); err != nil {
					t.Fatal(err)
				}
			}
			if test.mode != "" {
				if _, err := harness.SetPermissionMode(agent.Session(), test.mode); err != nil {
					t.Fatal(err)
				}
			}
			got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
			if !errors.Is(err, ErrSkillCommandDenied) || got.Content != "" || answerers.Load() != 0 {
				t.Fatalf("denied command prompted or yielded source as output: %+v answerers=%d error=%v", got, answerers.Load(), err)
			}
			if _, err := os.Stat(filepath.Join(agent.Session().Header().CWD, "forbidden")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("denied command changed the workspace: %v", err)
			}
			if _, err := os.Stat(filepath.Join(agent.Session().Header().CWD, ".pero")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("denied command created output artifacts: %v", err)
			}
		})
	}
}

func TestSkillCommandFailureDoesNotReturnItsSource(t *testing.T) {
	h, agent, definition, options, _ := expansionFixture(t)
	for _, command := range []string{"printf failure >&2; exit 7", "head -c 70000 /dev/zero; exit 7"} {
		definition.Content = "before !`" + command + "` after"
		got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
		if err == nil || got.Content != "" {
			t.Fatalf("failed command was treated as successful expansion: %q %v", got.Content, err)
		}
		assertNoSkillOutputs(t, agent.Session().Header().CWD)
	}
	definition.Content = "!`touch should-not-run`\n```!\nprintf unclosed"
	if _, err := ExpandSkill(t.Context(), h, agent, definition, "", options); err == nil {
		t.Fatal("unclosed executable fence was accepted")
	}
	if _, err := os.Stat(filepath.Join(agent.Session().Header().CWD, "should-not-run")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("command ran before the complete source had been validated: %v", err)
	}
}

func TestSkillCommandExitOneUsesSearchAndComparisonExceptions(t *testing.T) {
	for _, test := range []struct {
		name, command string
		success       bool
	}{
		{"no grep matches", "grep missing first.txt", true},
		{"different files", "diff first.txt second.txt", true},
		{"false test", "test one = two", true},
		{"false bracket test", "[ one = two ]", true},
		{"cmp is not exempt", "cmp first.txt second.txt", false},
		{"grep usage error", "grep --fixture-invalid-option first.txt", false},
		{"later failure is not grep status", "grep missing first.txt; false", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			h, agent, definition, options, _ := expansionFixture(t)
			workspace := agent.Session().Header().CWD
			if err := os.WriteFile(filepath.Join(workspace, "first.txt"), []byte("first\n"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(workspace, "second.txt"), []byte("second\n"), 0600); err != nil {
				t.Fatal(err)
			}
			definition.Content = "before !`" + test.command + "` after"
			got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
			if (err == nil) != test.success || test.success && !strings.HasPrefix(got.Content, "before ") || !test.success && got.Content != "" {
				t.Fatalf("wrong command outcome: %q %v", got.Content, err)
			}
			assertNoSkillOutputs(t, workspace)
		})
	}
}

func TestSkillCommandFlushAndCancellationPreventExecution(t *testing.T) {
	t.Run("permission audit must flush before dispatch", func(t *testing.T) {
		h, agent, definition, options, _ := expansionFixture(t)
		flushError := errors.New("fixture checkpoint unavailable")
		detach, err := agent.Session().InstallDurabilityCheckpoint(func(context.Context) error { return flushError })
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(detach)
		definition.Content = "!`touch forbidden`"
		if _, err := ExpandSkill(t.Context(), h, agent, definition, "", options); !errors.Is(err, flushError) {
			t.Fatalf("missing checkpoint failure: %v", err)
		}
		if _, err := os.Stat(filepath.Join(agent.Session().Header().CWD, "forbidden")); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("command ran without a durable permission decision: %v", err)
		}
		if _, err := os.Stat(filepath.Join(agent.Session().Header().CWD, ".pero")); !errors.Is(err, os.ErrNotExist) {
			t.Fatalf("output artifact created before permission audit flushed: %v", err)
		}
	})
	t.Run("caller cancellation stops the foreground executor", func(t *testing.T) {
		h, agent, definition, options, _ := expansionFixture(t)
		definition.Content = "!`printf ready > ready; sleep 30`"
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		done := make(chan error, 1)
		go func() { _, err := ExpandSkill(ctx, h, agent, definition, "", options); done <- err }()
		deadline := time.NewTimer(3 * time.Second)
		defer deadline.Stop()
		tick := time.NewTicker(5 * time.Millisecond)
		defer tick.Stop()
		for {
			if _, err := os.Stat(filepath.Join(agent.Session().Header().CWD, "ready")); err == nil {
				break
			}
			select {
			case err := <-done:
				t.Fatalf("command stopped before readiness: %v", err)
			case <-deadline.C:
				t.Fatal("command did not publish readiness")
			case <-tick.C:
			}
		}
		cancel()
		select {
		case err := <-done:
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("missing cancellation: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("preprocessing continued after cancellation")
		}
		assertNoSkillOutputs(t, agent.Session().Header().CWD)
	})
}

func TestLegacyDefinitionIsNotExecutable(t *testing.T) {
	definition := skills.Definition{Content: "!`touch forbidden`"}
	got, err := ExpandSkill(t.Context(), nil, nil, definition, "!`another command`", ExpansionOptions{})
	if err != nil || got.Content != definition.Content {
		t.Fatalf("legacy or model-supplied text became executable: %+v %v", got, err)
	}
}

func TestDynamicCommandBoundaries(t *testing.T) {
	for _, test := range []struct {
		name, content string
		count         int
		fail          bool
	}{
		{"inline", "!`printf ok`", 1, false},
		{"compound fallback stays one command", "!`node missing 2>/dev/null || echo ready`", 1, false},
		{"unicode whitespace", "text\u3000!`printf ok`", 1, false},
		{"punctuation is not whitespace", "text:!`printf ok`", 0, false},
		{"inline cannot cross lines", "!`printf\nok`", 0, false},
		{"fence with CRLF", "```!\r\nprintf ok\r\n```\r\n", 1, false},
		{"fence may be indented three spaces", "   ```!\nprintf ok\n   ```", 1, false},
		{"four spaces are literal code", "    ```!\nprintf ok\n    ```", 0, false},
		{"empty command", "!``", 0, true},
		{"empty fenced command", "```!\n```", 0, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			commands, err := dynamicCommands(test.content)
			if (err != nil) != test.fail || len(commands) != test.count {
				t.Fatalf("commands=%+v error=%v", commands, err)
			}
			for _, command := range commands {
				if strings.TrimSpace(command.command) == "" {
					t.Fatal("scanner selected an empty executable span")
				}
			}
			if test.name == "compound fallback stays one command" && (len(commands) != 1 || commands[0].command != "node missing 2>/dev/null || echo ready") {
				t.Fatalf("compound command was split: %+v", commands)
			}
		})
	}
}

func TestSkillCommandPermissionHooks(t *testing.T) {
	for _, row := range []struct {
		name, behavior, event, script, want string
		deny, interrupt                     bool
	}{
		{name: "session deny", behavior: "deny", deny: true},
		{name: "session ask defeats skill preapproval", behavior: "ask", deny: true},
		{name: "pretool rewrites command", event: "PreToolUse", script: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"printf rewritten"}}}'`, want: "rewritten"},
		{name: "permission rewrites command", behavior: "ask", event: "PermissionRequest", script: `cat > "$CLAUDE_PLUGIN_ROOT/input.json"; printf '%s' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow","updatedInput":{"command":"printf approved"}}}}'`, want: "approved"},
		{name: "permission interrupts", behavior: "ask", event: "PermissionRequest", script: `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","interrupt":true}}}'`, interrupt: true},
	} {
		t.Run(row.name, func(t *testing.T) {
			h, agent, definition, options, answerers := expansionFixture(t)
			root := agent.Session().Header().CWD
			var hooks []claudehooks.Hook
			if row.event != "" {
				hooks = append(hooks, scriptHook(t, root, row.event, row.script))
			}
			app, err := MountHooks(t.Context(), h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: hooks}}, HookOptions{Retain: true, Shell: options.Shell, StateDirectory: t.TempDir(), Environment: options.Environment})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				if err := app.Close(); err != nil {
					t.Error(err)
				}
			})
			if row.behavior != "" {
				if err := app.rememberSessionPermissions(agent, []claudehooks.PermissionUpdate{{Op: "add", Behavior: row.behavior, Rules: []string{"Bash(touch *)"}}}); err != nil {
					t.Fatal(err)
				}
			}
			definition.Content = "!`touch forbidden`"
			got, err := ExpandSkill(t.Context(), h, agent, definition, "", options)
			var interrupt *harness.ToolInterruptError
			if row.interrupt {
				if !errors.As(err, &interrupt) {
					t.Fatalf("interrupt lost: %v", err)
				}
			} else if row.deny {
				if !errors.Is(err, ErrSkillCommandDenied) {
					t.Fatalf("denial lost: %v", err)
				}
			} else if err != nil || got.Content != row.want {
				t.Fatalf("content=%q error=%v", got.Content, err)
			}
			if answerers.Load() != 0 {
				t.Fatal("render-time command prompted")
			}
			if _, err := os.Stat(filepath.Join(root, "forbidden")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("unapproved command ran: %v", err)
			}
			if row.name == "permission rewrites command" {
				body, err := os.ReadFile(filepath.Join(root, "input.json"))
				if err != nil || !strings.Contains(string(body), `"command":"touch forbidden"`) {
					t.Fatalf("hook input=%s error=%v", body, err)
				}
			}
		})
	}
}

func TestSkillAndShellEntryPointsShareSessionPermissions(t *testing.T) {
	for _, entry := range []string{"slash", "Skill", "Bash"} {
		for _, behavior := range []string{"deny", "ask", "interrupt"} {
			t.Run(entry+"/"+behavior, func(t *testing.T) {
				root, err := filepath.EvalSymlinks(t.TempDir())
				if err != nil {
					t.Fatal(err)
				}
				var generated atomic.Int32
				var observed string
				adapter := harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
					if generated.Add(1) == 1 {
						args := json.RawMessage(`{"skill":"fixture:dynamic"}`)
						if entry == "Bash" {
							args = json.RawMessage(`{"command":"touch forbidden"}`)
						}
						calls := []harness.ContentBlock{{Type: harness.BlockToolCall, Name: entry, ToolCallID: "entry", Arguments: args}}
						if behavior == "interrupt" {
							calls = append(calls, harness.ContentBlock{Type: harness.BlockToolCall, Name: "Bash", ToolCallID: "later", Arguments: json.RawMessage(`{"command":"touch forbidden"}`)})
						}
						return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: calls}}, nil
					}
					raw, _ := json.Marshal(request.Messages)
					observed = string(raw)
					return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
				})
				hooks := []claudehooks.Hook{scriptHook(t, root, "PreToolUse", "true")}
				if behavior == "interrupt" {
					hooks = append(hooks, scriptHook(t, root, "PermissionRequest", `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","interrupt":true}}}'`))
				}
				h, app := testHookHarness(t, adapter, plugins.Package{Root: root, Definition: plugins.Plugin{Name: "fixture"}, Hooks: hooks}, 0)
				if _, err := h.RegisterTool(t.Context(), "fixture/bash", harness.Tool{Schema: harness.ToolSchema{Name: "Bash", InputSchema: json.RawMessage(`{"type":"object"}`)}, RequiresApproval: true, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
					t.Error("denied command reached execution")
					return harness.ToolResult{}, nil
				}}); err != nil {
					t.Fatal(err)
				}
				const source = "!`touch forbidden`"
				if err := os.WriteFile(filepath.Join(root, "SKILL.md"), []byte(source), 0600); err != nil {
					t.Fatal(err)
				}
				definition := skills.Definition{Summary: skills.Summary{Name: "fixture:dynamic", Description: "Permission fixture", Digest: fmt.Sprintf("sha256:%x", sha256.Sum256([]byte(source)))}, Content: source, Claude: true, AllowedTools: []string{"Bash"}}
				catalog, err := skills.OpenSelected(t.Context(), nil, []skills.FileSelection{{Root: root, Path: "SKILL.md", Definition: definition, UserInvocable: true, ModelInvocable: true}})
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = catalog.Close() })
				if err := skills.MountCatalog(t.Context(), h, catalog, skills.MountOptions{Claude: true, Expand: func(ctx context.Context, agent *harness.Agent, definition skills.Definition, args string) (skills.Definition, error) {
					return ExpandSkill(ctx, h, agent, definition, args, ExpansionOptions{Shell: "/bin/bash", Environment: []string{"PATH=/usr/bin:/bin"}})
				}}); err != nil {
					t.Fatal(err)
				}
				agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "entry", CWD: root, Provider: "fixture", Model: "scripted"})
				if err != nil {
					t.Fatal(err)
				}
				ruleBehavior := behavior
				if ruleBehavior == "interrupt" {
					ruleBehavior = "ask"
				}
				if err := app.rememberSessionPermissions(agent, []claudehooks.PermissionUpdate{{Op: "add", Behavior: ruleBehavior, Rules: []string{"Bash(touch *)"}}, {Op: "add", Behavior: "allow", Rules: []string{"Bash(*)"}}}); err != nil {
					t.Fatal(err)
				}
				text := "run fixture"
				if entry == "slash" {
					text = "/fixture:dynamic"
				}
				err = prompt(t, agent, text)
				if entry == "slash" {
					if err == nil || generated.Load() != 0 {
						t.Fatalf("slash admission error=%v model calls=%d", err, generated.Load())
					}
				} else if err != nil {
					t.Fatal(err)
				} else if behavior == "interrupt" {
					if generated.Load() != 1 {
						t.Fatalf("interrupted model continued: %d", generated.Load())
					}
				} else if !strings.Contains(observed, "denied") && !strings.Contains(observed, "unavailable") {
					t.Fatalf("missing permission failure: %s", observed)
				}
				if _, err := os.Stat(filepath.Join(root, "forbidden")); !errors.Is(err, os.ErrNotExist) {
					t.Fatalf("dynamic command escaped admission: %v", err)
				}
			})
		}
	}
}
