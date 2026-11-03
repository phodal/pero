package plugins

import (
	"reflect"
	"strings"
	"testing"
)

func TestComponentDefinitions(t *testing.T) {
	tests := []struct {
		name, path, content string
		kind                ComponentKind
		wantName            string
		wantDescription     string
		wantVisibility      InvocationVisibility
		wantTools           []string
		wantAllowedTools    []string
		wantBody            string
		wantEffort          string
		wantCodes           []string
	}{
		{name: "skill directory default", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "Review this change.", wantName: "review", wantVisibility: InvocationVisibility{true, true}, wantBody: "Review this change."},
		{name: "skill logical name and multiline description", kind: ComponentSkill, path: "skills/original/SKILL.md", content: "---\nname: renamed\ndescription: >\n  Review a change\n  with evidence.\n---\nRun the review.\n", wantName: "renamed", wantDescription: "Review a change with evidence.", wantVisibility: InvocationVisibility{true, true}, wantBody: "Run the review."},
		{name: "user only entry", kind: ComponentSkill, path: "skills/entry/SKILL.md", content: "---\ndisable-model-invocation: true\n---\nStart.", wantName: "entry", wantVisibility: InvocationVisibility{true, false}, wantBody: "Start."},
		{name: "internal skill", kind: ComponentSkill, path: "skills/internal/SKILL.md", content: "---\nuser-invocable: false\n---\nContinue.", wantName: "internal", wantVisibility: InvocationVisibility{false, true}, wantBody: "Continue."},
		{name: "both visibility controls", kind: ComponentSkill, path: "skills/hidden/SKILL.md", content: "---\nuser-invocable: false\ndisable-model-invocation: true\n---\nHidden.", wantName: "hidden", wantVisibility: InvocationVisibility{false, false}, wantBody: "Hidden."},
		{name: "command identity", kind: ComponentCommand, path: "commands/deploy.md", content: "---\nname: other\nargument-hint: <target>\n---\nDeploy $ARGUMENTS.", wantName: "deploy", wantVisibility: InvocationVisibility{true, true}, wantBody: "Deploy $ARGUMENTS.", wantCodes: []string{"IGNORED_COMMAND_NAME"}},
		{name: "agent tool forms", kind: ComponentAgent, path: "agents/reviewer.md", content: "---\nname: reviewer\ndescription: Review code.\ntools: [Read, Write, 'Bash(git status:*)']\nmodel: opus\neffort: high\n---\nReview independently.", wantName: "reviewer", wantDescription: "Review code.", wantVisibility: InvocationVisibility{true, true}, wantTools: []string{"Read", "Write", "Bash(git status:*)"}, wantBody: "Review independently.", wantEffort: "high"},
		{name: "tool expressions keep inner separators", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\nallowed-tools: Read, Bash(git log --format=a,b:*), Grep Read\n---\nInspect.", wantName: "review", wantVisibility: InvocationVisibility{true, true}, wantAllowedTools: []string{"Read", "Bash(git log --format=a,b:*)", "Grep"}, wantBody: "Inspect."},
		{name: "tool yaml list", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\nallowed-tools:\n  - Read\n  - Bash(npm test:*)\n---\nInspect.", wantName: "review", wantVisibility: InvocationVisibility{true, true}, wantAllowedTools: []string{"Read", "Bash(npm test:*)"}, wantBody: "Inspect."},
		{name: "empty tool grant", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\nallowed-tools: []\n---\nInspect.", wantName: "review", wantVisibility: InvocationVisibility{true, true}, wantAllowedTools: []string{}, wantBody: "Inspect."},
		{name: "windows newlines", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "\ufeff---\r\nname: review\r\n---\r\nInspect.\r\n", wantName: "review", wantVisibility: InvocationVisibility{true, true}, wantBody: "Inspect."},
		{name: "agent required metadata", kind: ComponentAgent, path: "agents/empty.md", content: "Prompt only.", wantName: "empty", wantDescription: "Prompt only.", wantVisibility: InvocationVisibility{true, true}, wantBody: "Prompt only.", wantCodes: []string{"AGENT_NAME_DEFAULTED", "AGENT_DESCRIPTION_DEFAULTED"}},
		{name: "missing agent name", kind: ComponentAgent, path: "agents/empty.md", content: "---\ndescription: Analyze.\n---\nPrompt.", wantName: "empty", wantDescription: "Analyze.", wantVisibility: InvocationVisibility{true, true}, wantBody: "Prompt.", wantCodes: []string{"AGENT_NAME_DEFAULTED"}},
		{name: "agent ignored permission field", kind: ComponentAgent, path: "agents/review.md", content: "---\nname: review\ndescription: Analyze.\npermissionMode: bypassPermissions\n---\nPrompt.", wantName: "review", wantDescription: "Analyze.", wantVisibility: InvocationVisibility{true, true}, wantBody: "Prompt.", wantCodes: []string{"IGNORED_PLUGIN_AGENT_FIELD"}},
		{name: "agent display fallback", kind: ComponentAgent, path: "agents/review.md", content: "---\nname: review\ndescription: Analyze.\ncolor: magenta\n---\nPrompt.", wantName: "review", wantDescription: "Analyze.", wantVisibility: InvocationVisibility{true, true}, wantBody: "Prompt.", wantCodes: []string{"INVALID_AGENT_COLOR"}},
		{name: "skill visibility does not configure agent", kind: ComponentAgent, path: "agents/review.md", content: "---\nname: review\ndescription: Analyze.\nuser-invocable: false\n---\nPrompt.", wantName: "review", wantDescription: "Analyze.", wantVisibility: InvocationVisibility{true, true}, wantBody: "Prompt.", wantCodes: []string{"UNSUPPORTED_COMPONENT_FIELD"}},
		{name: "unsupported behavior diagnosed", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\ntemperature: 0\n---\nInspect.", wantName: "review", wantVisibility: InvocationVisibility{true, true}, wantBody: "Inspect.", wantCodes: []string{"UNSUPPORTED_COMPONENT_FIELD"}},
		{name: "skill effort", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\neffort: high\n---\nInspect.", wantName: "review", wantVisibility: InvocationVisibility{true, true}, wantBody: "Inspect.", wantEffort: "high"},
		{name: "invalid skill effort", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\neffort: turbo\n---\nInspect.", wantName: "review", wantVisibility: InvocationVisibility{true, true}, wantBody: "Inspect.", wantCodes: []string{"INVALID_COMPONENT_FIELD"}},
		{name: "invalid logical name", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\nname: bad:name\n---\nInspect.", wantName: "bad:name", wantVisibility: InvocationVisibility{true, true}, wantBody: "Inspect.", wantCodes: []string{"INVALID_COMPONENT_NAME"}},
		{name: "unclosed frontmatter", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\nname: review\nInspect.", wantVisibility: InvocationVisibility{true, true}, wantCodes: []string{"INVALID_FRONTMATTER"}},
		{name: "frontmatter must be mapping", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\n- review\n---\nInspect.", wantVisibility: InvocationVisibility{true, true}, wantCodes: []string{"INVALID_FRONTMATTER"}},
		{name: "strict text type", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\ndescription: 123\n---\nInspect.", wantVisibility: InvocationVisibility{true, true}, wantCodes: []string{"INVALID_COMPONENT_FIELD"}},
		{name: "strict visibility type", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\nuser-invocable: not-a-boolean\n---\nInspect.", wantVisibility: InvocationVisibility{true, true}, wantCodes: []string{"INVALID_COMPONENT_FIELD"}},
		{name: "duplicate yaml keys", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\nname: review\nname: different\n---\nInspect.", wantVisibility: InvocationVisibility{true, true}, wantCodes: []string{"INVALID_COMPONENT_FIELD"}},
		{name: "invalid tools shape", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\nallowed-tools: {Read: true}\n---\nInspect.", wantVisibility: InvocationVisibility{true, true}, wantCodes: []string{"INVALID_COMPONENT_FIELD"}},
		{name: "invalid tools expression", kind: ComponentSkill, path: "skills/review/SKILL.md", content: "---\nallowed-tools: Bash(git log\n---\nInspect.", wantVisibility: InvocationVisibility{true, true}, wantCodes: []string{"INVALID_COMPONENT_FIELD"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, diagnostics := ParseComponent("example", tt.kind, tt.path, []byte(tt.content))
			if got.Name != tt.wantName || got.Description != tt.wantDescription || got.Content != tt.wantBody || got.Visibility != tt.wantVisibility || got.Effort != tt.wantEffort {
				t.Fatalf("component = %+v, want name=%q description=%q body=%q visibility=%+v", got, tt.wantName, tt.wantDescription, tt.wantBody, tt.wantVisibility)
			}
			if tt.wantName != "" && got.QualifiedName != "example:"+tt.wantName {
				t.Errorf("qualified name = %q", got.QualifiedName)
			}
			if !reflect.DeepEqual(got.Tools, tt.wantTools) || !reflect.DeepEqual(got.AllowedTools, tt.wantAllowedTools) {
				t.Errorf("tools = %v allowed = %v; want tools = %v allowed = %v", got.Tools, got.AllowedTools, tt.wantTools, tt.wantAllowedTools)
			}
			var codes []string
			for _, diagnostic := range diagnostics {
				codes = append(codes, diagnostic.Code)
				if diagnostic.Path != tt.path {
					t.Errorf("diagnostic path = %q", diagnostic.Path)
				}
			}
			if !reflect.DeepEqual(codes, tt.wantCodes) {
				t.Errorf("diagnostics = %v; want %v", codes, tt.wantCodes)
			}
		})
	}
}

func TestAgentSkillsField(t *testing.T) {
	component, diagnostics := ParseComponent("sample", ComponentAgent, "agents/review.md", []byte("---\nname: review\ndescription: Review.\nskills: [checks, sample:extra]\n---\nReview."))
	if len(diagnostics) != 0 || !reflect.DeepEqual(component.Skills, []string{"checks", "sample:extra"}) {
		t.Fatalf("component=%+v diagnostics=%v", component, diagnostics)
	}
	_, diagnostics = ParseComponent("sample", ComponentAgent, "agents/review.md", []byte("---\nname: review\ndescription: Review.\nskills: [../outside]\n---\nReview."))
	if len(diagnostics) != 1 || diagnostics[0].Code != "INVALID_COMPONENT_FIELD" {
		t.Fatalf("diagnostics=%v", diagnostics)
	}
}

func TestAgentBackgroundField(t *testing.T) {
	component, diagnostics := ParseComponent("sample", ComponentAgent, "agents/review.md", []byte("---\nname: review\ndescription: Review.\nbackground: true\n---\nReview."))
	if len(diagnostics) != 0 || component.Background == nil || !*component.Background {
		t.Fatalf("component=%+v diagnostics=%v", component, diagnostics)
	}
}

func TestAgentDisallowedToolsField(t *testing.T) {
	component, diagnostics := ParseComponent("sample", ComponentAgent, "agents/review.md", []byte("---\nname: review\ndescription: Review.\ndisallowedTools: [Write, Edit]\n---\nReview."))
	if len(diagnostics) != 0 || !reflect.DeepEqual(component.DisallowedTools, []string{"Write", "Edit"}) {
		t.Fatalf("component=%+v diagnostics=%v", component, diagnostics)
	}
}

func TestAgentMaxTurnsField(t *testing.T) {
	component, diagnostics := ParseComponent("sample", ComponentAgent, "agents/review.md", []byte("---\nname: review\ndescription: Review.\nmaxTurns: 3\n---\nReview."))
	if component.MaxTurns != 3 || len(diagnostics) != 0 {
		t.Fatalf("component=%+v diagnostics=%v", component, diagnostics)
	}
	_, diagnostics = ParseComponent("sample", ComponentAgent, "agents/review.md", []byte("---\nname: review\ndescription: Review.\nmaxTurns: 0\n---\nReview."))
	if len(diagnostics) != 1 || diagnostics[0].Code != "INVALID_COMPONENT_FIELD" {
		t.Fatalf("diagnostics=%v", diagnostics)
	}
}

func TestAgentIsolationField(t *testing.T) {
	component, diagnostics := ParseComponent("sample", ComponentAgent, "agents/review.md", []byte("---\nname: review\ndescription: Review.\nisolation: worktree\n---\nReview."))
	if component.Isolation != "worktree" || len(diagnostics) != 0 {
		t.Fatalf("component=%+v diagnostics=%v", component, diagnostics)
	}
	_, diagnostics = ParseComponent("sample", ComponentAgent, "agents/review.md", []byte("---\nname: review\ndescription: Review.\nisolation: remote\n---\nReview."))
	if len(diagnostics) != 1 || diagnostics[0].Code != "INVALID_COMPONENT_FIELD" {
		t.Fatalf("diagnostics=%v", diagnostics)
	}
	_, diagnostics = ParseComponent("sample", ComponentSkill, "skills/review/SKILL.md", []byte("---\nisolation: worktree\n---\nReview."))
	if len(diagnostics) != 1 || diagnostics[0].Code != "UNSUPPORTED_COMPONENT_FIELD" {
		t.Fatalf("skill diagnostics=%v", diagnostics)
	}
}

func TestForkComponentFields(t *testing.T) {
	for _, test := range []struct {
		name, frontmatter, context, agent string
		kind                              ComponentKind
		background                        *bool
		codes                             []string
	}{
		{name: "default fork", kind: ComponentSkill, frontmatter: "context: fork\n", context: "fork"},
		{name: "builtin synchronous", kind: ComponentSkill, frontmatter: "context: fork\nagent: Explore\nbackground: false\n", context: "fork", agent: "Explore", background: boolPointer(false)},
		{name: "plugin agent", kind: ComponentCommand, frontmatter: "context: fork\nagent: sample:reviewer\nbackground: true\n", context: "fork", agent: "sample:reviewer", background: boolPointer(true)},
		{name: "invalid context", kind: ComponentSkill, frontmatter: "context: shared\n", context: "shared", codes: []string{"INVALID_SKILL_CONTEXT"}},
		{name: "nonstring context", kind: ComponentSkill, frontmatter: "context: false\n", codes: []string{"INVALID_COMPONENT_FIELD"}},
		{name: "strict background", kind: ComponentSkill, frontmatter: "context: fork\nbackground: 'false'\n", codes: []string{"INVALID_COMPONENT_FIELD"}},
		{name: "agent must be a name", kind: ComponentSkill, frontmatter: "context: fork\nagent: ../outside\n", context: "fork", agent: "../outside", codes: []string{"INVALID_FORK_AGENT"}},
		{name: "fork fields ignored inline", kind: ComponentSkill, frontmatter: "agent: Explore\nbackground: false\n", agent: "Explore", background: boolPointer(false), codes: []string{"IGNORED_SKILL_FORK_FIELD", "IGNORED_SKILL_FORK_FIELD"}},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := "skills/review/SKILL.md"
			if test.kind == ComponentCommand {
				path = "commands/review.md"
			}
			component, diagnostics := ParseComponent("sample", test.kind, path, []byte("---\n"+test.frontmatter+"---\nRun the task."))
			if component.Context != test.context || component.Agent != test.agent || !reflect.DeepEqual(component.Background, test.background) {
				t.Fatalf("fork metadata: %+v", component)
			}
			var codes []string
			for _, diagnostic := range diagnostics {
				codes = append(codes, diagnostic.Code)
			}
			if !reflect.DeepEqual(codes, test.codes) {
				t.Fatalf("diagnostics=%v want=%v", codes, test.codes)
			}
		})
	}
}

func TestComponentHooksParseCommandFrontmatter(t *testing.T) {
	component, diagnostics := ParseComponent("sample", ComponentSkill, "skills/secure/SKILL.md", []byte("---\nname: secure\ndescription: Check commands.\nhooks:\n  PreToolUse:\n    - matcher: Bash\n      hooks:\n        - type: command\n          command: ./scripts/check.sh\n          once: true\n          shell: bash\n          statusMessage: Checking\n---\nCheck.\n"))
	if len(diagnostics) != 0 || len(component.Hooks) != 1 || component.Hooks[0].Event != "PreToolUse" || component.Hooks[0].Matcher != "Bash" || component.Hooks[0].Command != "./scripts/check.sh" || !component.Hooks[0].Once || component.Hooks[0].Shell != "bash" {
		t.Fatalf("hooks=%+v diagnostics=%v", component.Hooks, diagnostics)
	}
	agent, diagnostics := ParseComponent("sample", ComponentAgent, "agents/reviewer.md", []byte("---\nname: reviewer\ndescription: Review.\nhooks:\n  Stop:\n    - hooks:\n        - type: command\n          command: ./scripts/stop.sh\n---\nReview.\n"))
	if len(diagnostics) != 0 || len(agent.Hooks) != 1 || agent.Hooks[0].Event != "Stop" || agent.Hooks[0].Command != "./scripts/stop.sh" {
		t.Fatalf("agent hooks=%+v diagnostics=%v", agent.Hooks, diagnostics)
	}
}

func boolPointer(value bool) *bool { return &value }

func TestComponentDiagnosticsDoNotEchoValues(t *testing.T) {
	secret := "secret-canary-value"
	_, diagnostics := ParseComponent("example", ComponentSkill, "skills/review/SKILL.md", []byte("---\nuser-invocable: "+secret+"\n---\nPrompt."))
	if len(diagnostics) == 0 {
		t.Fatal("expected a typed field diagnostic")
	}
	for _, diagnostic := range diagnostics {
		if strings.Contains(diagnostic.Message, secret) {
			t.Fatalf("diagnostic exposed the invalid value: %q", diagnostic.Message)
		}
	}
}
