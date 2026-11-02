package plugins

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestLoadPackageRuntimeDeclarations(t *testing.T) {
	const secret = "private-canary-value"
	root := t.TempDir()
	writePluginFiles(t, root, map[string]string{
		".claude-plugin/plugin.json":     `{"name":"sample","hooks":["./hooks/hooks.json",{"SessionStart":[{"hooks":[{"type":"command","command":"python3","args":[],"timeout":1.5}]}]},"./configuration/extra-hooks.json"],"mcpServers":["./.mcp.json",{"alpha":{"type":"http","url":"https://private-canary-value.invalid/mcp","headers":{"Authorization":"private-canary-value"},"timeout":120000}},"./configuration/servers.json"]}`,
		"skills/draft/SKILL.md":          "---\ndescription: Draft a document\n---\nUse templates/report.md.",
		"hooks/hooks.json":               `{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"echo private-canary-value"}]}]}}`,
		"configuration/extra-hooks.json": `{"hooks":{"Stop":[{"matcher":"ignored","hooks":[{"type":"command","command":"node","args":["private-canary-value"]}]}]}}`,
		".mcp.json":                      `{"mcpServers":{"alpha":{"command":"old-command"},"zeta":{"command":"node","args":["private-canary-value"],"env":{"TOKEN":"private-canary-value"}}}}`,
		"configuration/servers.json":     `{"zeta":{"command":"new-command","env":{"TOKEN":"private-canary-value"}},"beta":{"url":"${SERVER_URL}"}}`,
		"templates/report.md":            "# Template",
		"hooks/guard.sh":                 "#!/bin/sh\nexit 0\n",
		".env":                           "TOKEN=private-canary-value",
		".private/token.json":            `{"token":"private-canary-value"}`,
		"credentials.env":                "TOKEN=private-canary-value",
		"binary.svg":                     "\x00binary",
		"bad-utf8.md":                    string([]byte{0xff}),
		"oversized.txt":                  strings.Repeat("x", maxConfigurationBytes+1),
		"not-text.png":                   "not selected by extension",
	})
	packages, err := LoadPackages(t.Context(), []string{root})
	if err != nil {
		t.Fatal(err)
	}
	if len(packages) != 1 {
		t.Fatalf("packages = %d", len(packages))
	}
	compiled := packages[0]
	canonical, err := filepath.EvalSymlinks(root)
	if err != nil {
		t.Fatal(err)
	}
	if compiled.Root != canonical || compiled.Definition.Path != "." || len(compiled.Definition.Components) != 1 || compiled.Definition.Components[0].Digest == "" {
		t.Fatalf("invalid compiled identity: %+v", compiled.Definition)
	}
	if !reflect.DeepEqual(compiled.Resources, []string{"hooks/guard.sh", "skills/draft/SKILL.md", "templates/report.md"}) {
		t.Fatalf("resource selection = %v", compiled.Resources)
	}
	if len(compiled.Hooks) != 3 || compiled.Hooks[0].Command != "echo "+secret || compiled.Hooks[1].Command != "python3" || !compiled.Hooks[1].ExecForm || len(compiled.Hooks[1].Args) != 0 || compiled.Hooks[1].Timeout != 1500*time.Millisecond || compiled.Hooks[2].Matcher != "" {
		t.Fatal("hook merge order, executable form or timeout was lost")
	}
	if len(compiled.MCP) != 3 || compiled.MCP[0].Name != "alpha" || compiled.MCP[0].Transport != "http" || compiled.MCP[0].Headers["Authorization"] != secret || compiled.MCP[0].TimeoutMilliseconds != 120000 || compiled.MCP[1].Name != "zeta" || compiled.MCP[1].Command != "new-command" || compiled.MCP[1].Env["TOKEN"] != secret || compiled.MCP[2].Name != "beta" || compiled.MCP[2].URL != "${SERVER_URL}" {
		t.Fatal("MCP later definitions did not replace in their original positions")
	}
	encoded, err := json.Marshal(packages)
	if err != nil {
		t.Fatal(err)
	}
	serverJSON, err := json.Marshal(compiled.MCP)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded)+string(serverJSON), secret) || strings.Contains(string(encoded), "SERVER_URL") {
		t.Fatal("compiled runtime declarations leaked raw values through JSON")
	}
}

func TestLoadPackageMarketplacePathsAndWarnings(t *testing.T) {
	root := t.TempDir()
	writePluginFiles(t, root, map[string]string{
		".claude-plugin/marketplace.json":   `{"name":"catalog","owner":{"name":"Fixture"},"plugins":[{"name":"installed-alias","source":"./sample","version":"1.0.0"}]}`,
		"sample/.claude-plugin/plugin.json": `{"name":"sample","version":"2.0.0"}`,
		"sample/skills/draft/SKILL.md":      "---\ndescription: Draft a document\n---\nDraft.",
		"sample/commands/review.md":         "---\nname: ignored\n---\nReview.",
		"sample/agents/reviewer.md":         "---\nname: reviewer\ndescription: Review.\nwhenToUse: Nonstandard descriptive metadata.\npermissionMode: bypassPermissions\ncolor: magenta\n---\nReview.",
		"sample/templates/report.md":        "# Template",
	})
	packages, err := LoadPackages(t.Context(), []string{root})
	if err != nil {
		t.Fatal(err)
	}
	if len(packages) != 1 || packages[0].Definition.Name != "sample" || packages[0].Definition.InstallName != "installed-alias" || packages[0].Definition.Version != "2.0.0" || packages[0].Definition.MarketplaceVersion != "1.0.0" {
		t.Fatalf("marketplace identities = %+v", packages)
	}
	for _, component := range packages[0].Definition.Components {
		if strings.HasPrefix(component.Path, "sample/") || !strings.HasPrefix(component.QualifiedName, "sample:") {
			t.Fatalf("component is not package-relative: %+v", component)
		}
	}
	if _, err := LoadPackages(t.Context(), []string{root, filepath.Join(root, "sample")}); err == nil {
		t.Fatal("duplicate package activation was accepted")
	}
}

func TestLoadPackageRejectsUnsupportedExecution(t *testing.T) {
	for _, tc := range []struct {
		name, path, content, code string
	}{
		{"unknown skill context", "skills/draft/SKILL.md", "---\ncontext: shared\n---\nDraft.", "INVALID_SKILL_CONTEXT"},
		{"missing agent", "agents/reviewer.md", "Review.", "MISSING_AGENT"},
		{"manifest execution", ".claude-plugin/plugin.json", `{"name":"sample","settings":{"permissions":{"allow":["all"]}}}`, "UNSUPPORTED_MANIFEST_FIELD"},
		{"unknown hook", "hooks/hooks.json", `{"hooks":{"FutureEvent":[{"hooks":[{"type":"command","command":"private-canary-value"}]}]}}`, "UNSUPPORTED_HOOK_EVENT"},
		{"prompt hook", "hooks/hooks.json", `{"hooks":{"Stop":[{"hooks":[{"type":"prompt","prompt":"private-canary-value"}]}]}}`, "UNSUPPORTED_HOOK_"},
		{"hook failure policy", "hooks/hooks.json", `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"true","onFailure":"block"}]}]}}`, "UNSUPPORTED_HOOK_FIELD"},
		{"MCP auth provider", ".mcp.json", `{"remote":{"url":"https://example.invalid/mcp","headersHelper":"private-canary-value"}}`, "UNSUPPORTED_MCP_FIELD"},
		{"unknown MCP field", ".mcp.json", `{"local":{"command":"node","futureField":"private-canary-value"}}`, "UNKNOWN_MCP_FIELD"},
		{"fractional MCP timeout", ".mcp.json", `{"local":{"command":"node","timeout":1200.5}}`, "integer millisecond"},
		{"oversize hook duration", "hooks/hooks.json", `{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"true","timeout":1e30}]}]}}`, "duration range"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := filepath.Join(t.TempDir(), "sample")
			writePluginFiles(t, root, map[string]string{
				".claude-plugin/plugin.json": `{"name":"sample"}`,
				"skills/draft/SKILL.md":      "---\ndescription: Draft\n---\nDraft.",
			})
			writePluginFiles(t, root, map[string]string{tc.path: tc.content})
			packages, err := LoadPackages(t.Context(), []string{root})
			if err == nil || packages != nil || !strings.Contains(err.Error(), tc.code) || strings.Contains(err.Error(), "private-canary-value") {
				t.Fatalf("expected non-secret %s rejection, got error %v", tc.code, err)
			}
		})
	}
}

func TestLoadPackageResourceBoundsAndCancellation(t *testing.T) {
	root := filepath.Join(t.TempDir(), "sample")
	writePluginFiles(t, root, map[string]string{"skills/draft/SKILL.md": "Draft."})
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := LoadPackages(ctx, []string{root}); !errors.Is(err, context.Canceled) {
		t.Fatalf("load ignored cancellation: %v", err)
	}
	for i := 0; i < 1024; i++ {
		if err := os.WriteFile(filepath.Join(root, fmt.Sprintf("resource-%04d.txt", i)), []byte("text"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := LoadPackages(t.Context(), []string{root}); err == nil || !strings.Contains(err.Error(), "1024") {
		t.Fatalf("resource bound was ignored: %v", err)
	}
	if packages, err := LoadPackages(t.Context(), nil); err != nil || len(packages) != 0 {
		t.Fatalf("empty directories = %v, %v", packages, err)
	}
}
