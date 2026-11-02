package plugins

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestInspectLocalDefinitions(t *testing.T) {
	for _, test := range []struct {
		name      string
		files     map[string]string
		wantNames []string
		wantCode  string
	}{
		{"defaults", map[string]string{
			"skills/draft/SKILL.md":    "---\nname: write-prd\ndescription: Draft a document\n---\nUse template.md.",
			"skills/draft/template.md": "not a skill",
			"commands/review.md":       "Review $ARGUMENTS.",
			"agents/reviewer.md":       "---\nname: reviewer\ndescription: Review documents\ntools: [Read]\n---\nBe precise.",
		}, []string{"sample:reviewer", "sample:review", "sample:write-prd"}, ""},
		{"explicit-replaces-and-appends", map[string]string{
			".claude-plugin/plugin.json": `{"name":"sample","skills":["./extra"],"commands":"./chosen.md","agents":[]}`,
			"skills/one/SKILL.md":        "---\ndescription: first\n---\none",
			"extra/two/SKILL.md":         "---\ndescription: second\n---\ntwo",
			"commands/ignored.md":        "ignored",
			"agents/ignored.md":          "ignored",
			"chosen.md":                  "chosen",
		}, []string{"sample:chosen", "sample:one", "sample:two"}, ""},
		{"same-file-once", map[string]string{
			".claude-plugin/plugin.json": `{"name":"sample","skills":["./skills","./skills/draft"]}`,
			"skills/draft/SKILL.md":      "---\ndescription: Draft\n---\nbody",
		}, []string{"sample:draft"}, ""},
		{"agent-directory", map[string]string{".claude-plugin/plugin.json": `{"name":"sample","agents":["./agents/"]}`, "agents/reviewer.md": "body"}, nil, "INVALID_AGENT_PATH"},
		{"missing-explicit", map[string]string{".claude-plugin/plugin.json": `{"name":"sample","skills":["./skills"]}`}, nil, "UNREADABLE_CONFIGURATION"},
		{"escaping-path", map[string]string{".claude-plugin/plugin.json": `{"name":"sample","commands":"./../outside.md"}`}, nil, "INVALID_COMPONENT_PATH"},
		{"invalid-manifest", map[string]string{".claude-plugin/plugin.json": `{"name":27}`}, nil, "INVALID_MANIFEST"},
		{"invalid-metadata-types", map[string]string{".claude-plugin/plugin.json": `{"name":"sample","description":42,"keywords":"oops"}`}, nil, "INVALID_MANIFEST"},
		{"null-metadata", map[string]string{".claude-plugin/plugin.json": `{"name":"sample","description":null}`}, nil, "INVALID_MANIFEST_FIELD"},
		{"plugin-id-characters", map[string]string{".claude-plugin/plugin.json": `{"name":"Sample.Plugin_v1"}`}, nil, ""},
		{"root-skill", map[string]string{".claude-plugin/plugin.json": `{"name":"sample","skills":"."}`, "SKILL.md": "Root skill."}, []string{"sample:sample"}, ""},
		{"explicit-skill-file", map[string]string{".claude-plugin/plugin.json": `{"name":"sample","skills":"./extra/SKILL.md"}`, "extra/SKILL.md": "Prompt"}, nil, "INVALID_COMPONENT_PATH"},
		{"missing-agent-fields", map[string]string{"agents/reviewer.md": "Prompt only"}, []string{""}, "MISSING_AGENT_NAME"},
		{"duplicate-logical-name", map[string]string{"skills/a/SKILL.md": "---\nname: same\ndescription: A\n---\na", "skills/b/SKILL.md": "---\nname: same\ndescription: B\n---\nb"}, []string{"sample:same", "sample:same"}, "DUPLICATE_COMPONENT"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "sample")
			if err := os.Mkdir(root, 0700); err != nil {
				t.Fatal(err)
			}
			writePluginFiles(t, root, test.files)
			report, err := Inspect(t.Context(), root)
			if err != nil {
				t.Fatal(err)
			}
			if !report.InspectionOnly || len(report.Plugins) != 1 {
				t.Fatalf("report: %+v", report)
			}
			var got []string
			for _, c := range report.Plugins[0].Components {
				got = append(got, c.QualifiedName)
			}
			if strings.Join(got, ",") != strings.Join(test.wantNames, ",") {
				t.Fatalf("names=%v want=%v", got, test.wantNames)
			}
			if test.wantCode != "" && !hasDiagnostic(report.Diagnostics, test.wantCode) {
				t.Fatalf("missing %s: %+v", test.wantCode, report.Diagnostics)
			}
			if test.wantCode == "" && !report.Valid() {
				t.Fatalf("invalid: %+v", report.Diagnostics)
			}
		})
	}
}

func TestInspectMarketplace(t *testing.T) {
	for _, test := range []struct {
		name, source string
		wantPlugins  int
		code         string
	}{
		{"relative", `"./sample"`, 1, "VERSION_DRIFT"},
		{"remote", `{"source":"github","repo":"example/sample"}`, 0, "UNSUPPORTED_MARKETPLACE_SOURCE"},
		{"escape", `"./../sample"`, 0, "UNSUPPORTED_MARKETPLACE_SOURCE"},
		{"missing", `"./missing"`, 0, "UNREADABLE_PLUGIN"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			writePluginFiles(t, root, map[string]string{
				".claude-plugin/marketplace.json":   `{"name":"catalog","owner":{"name":"Fixture"},"plugins":[{"name":"sample","source":` + test.source + `,"version":"1.0.0"}]}`,
				"sample/.claude-plugin/plugin.json": `{"name":"sample","version":"2.0.0"}`,
				"sample/skills/draft/SKILL.md":      "---\ndescription: Draft\n---\nbody",
			})
			report, err := Inspect(t.Context(), root)
			if err != nil {
				t.Fatal(err)
			}
			if len(report.Plugins) != test.wantPlugins || !hasDiagnostic(report.Diagnostics, test.code) {
				t.Fatalf("report: %+v", report)
			}
		})
	}
}

func TestInspectIntegrationPathsAndRedaction(t *testing.T) {
	const secret = "fixture-private-value"
	for _, test := range []struct {
		name, manifest string
		count          int
		code           string
	}{
		{"same-default-once", `{"name":"sample","mcpServers":"./.mcp.json"}`, 1, ""},
		{"inline-merges-default", `{"name":"sample","mcpServers":{"inline":{"command":"fixture-private-value"}}}`, 2, ""},
		{"inline-replaces-server", `{"name":"sample","mcpServers":{"local":{"command":"fixture-private-value"}}}`, 1, ""},
		{"mixed-array", `{"name":"sample","mcpServers":["./.mcp.json",{"inline":{"command":"fixture-private-value"}}]}`, 2, ""},
		{"missing-explicit", `{"name":"sample","mcpServers":"./missing.json"}`, 1, "UNREADABLE_CONFIGURATION"},
		{"escape", `{"name":"sample","mcpServers":"./../private.json"}`, 1, "INVALID_INTEGRATION_PATH"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			writePluginFiles(t, root, map[string]string{
				".claude-plugin/plugin.json": test.manifest,
				".mcp.json":                  `{"mcpServers":{"local":{"type":"http","url":"https://fixture-private-value.invalid/mcp","headers":{"Authorization":"fixture-private-value"}}}}`,
				"hooks/hooks.json":           `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"fixture-private-value"}]}]}}`,
			})
			report, err := Inspect(t.Context(), root)
			if err != nil {
				t.Fatal(err)
			}
			if len(report.Plugins[0].MCP.Servers) != test.count {
				t.Fatalf("servers: %+v", report.Plugins[0].MCP)
			}
			if test.name == "inline-replaces-server" && report.Plugins[0].MCP.Servers[0].Transport != "stdio" {
				t.Fatal("explicit server did not replace the default definition")
			}
			if test.code != "" && !hasDiagnostic(report.Diagnostics, test.code) {
				t.Fatalf("missing %s", test.code)
			}
			encoded, err := json.Marshal(report)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(encoded), secret) {
				t.Fatal("inspection leaked process or connection values")
			}
		})
	}
}

func TestInspectMarketplaceEntryIdentityAndDeclarations(t *testing.T) {
	for _, test := range []struct {
		name, entry string
		code        string
		valid       bool
	}{
		{"install-alias", `{"name":"install.alias_v1","source":"./sample"}`, "", true},
		{"entry-components", `{"name":"sample","source":"./sample","commands":"./extra.md"}`, "UNSUPPORTED_MARKETPLACE_COMPONENT", false},
		{"entry-metadata", `{"name":"sample","source":"./sample","description":42}`, "INVALID_MANIFEST", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			writePluginFiles(t, root, map[string]string{
				".claude-plugin/marketplace.json":   `{"name":"catalog","owner":{"name":"Fixture"},"plugins":[` + test.entry + `]}`,
				"sample/.claude-plugin/plugin.json": `{"name":"sample"}`,
			})
			report, err := Inspect(t.Context(), root)
			if err != nil {
				t.Fatal(err)
			}
			if report.Valid() != test.valid || len(report.Plugins) != 1 {
				t.Fatalf("report: %+v", report)
			}
			if test.code != "" && !hasDiagnostic(report.Diagnostics, test.code) {
				t.Fatalf("missing %s: %+v", test.code, report.Diagnostics)
			}
			if test.name == "install-alias" && (report.Plugins[0].InstallName != "install.alias_v1" || report.Plugins[0].Name != "sample") {
				t.Fatal("installation identity replaced the manifest namespace")
			}
		})
	}
}

func TestInspectInlineHookShape(t *testing.T) {
	root := t.TempDir()
	writePluginFiles(t, root, map[string]string{
		".claude-plugin/plugin.json": `{"name":"sample","hooks":["./hooks/hooks.json",{"SessionStart":[{"hooks":[{"type":"command","command":"fixture-inline"}]}]}]}`,
		"hooks/hooks.json":           `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"fixture-default"}]}]}}`,
	})
	report, err := Inspect(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Valid() || len(report.Plugins[0].Hooks.Hooks) != 2 {
		t.Fatalf("report: %+v", report)
	}
}

func TestInspectLocalBoundary(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	writePluginFiles(t, root, map[string]string{".claude-plugin/plugin.json": `{"name":"sample","commands":"./outside.md"}`})
	writePluginFiles(t, outside, map[string]string{"private.md": "private-file-contents"})
	if err := os.Symlink(filepath.Join(outside, "private.md"), filepath.Join(root, "outside.md")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	report, err := Inspect(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	if !hasDiagnostic(report.Diagnostics, "UNREADABLE_CONFIGURATION") || len(report.Plugins[0].Components) != 0 {
		t.Fatalf("outside file read: %+v", report)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err = Inspect(ctx, root); err == nil {
		t.Fatal("cancelled inspection succeeded")
	}
}

func writePluginFiles(t *testing.T, root string, files map[string]string) {
	t.Helper()
	for path, content := range files {
		path = filepath.Join(root, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func hasDiagnostic(diagnostics []Diagnostic, code string) bool {
	for _, d := range diagnostics {
		if d.Code == code {
			return true
		}
	}
	return false
}
