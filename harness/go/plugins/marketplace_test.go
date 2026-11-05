package plugins

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMarketplaceComposition(t *testing.T) {
	for _, row := range []struct {
		name, manifest, extra, wantError string
		commands, hooks, servers         int
	}{
		{"append", `{"name":"actual","commands":"./base.md","hooks":{"Stop":[{"hooks":[{"type":"command","command":"old"}]}],"SessionStart":[{"hooks":[{"type":"command","command":"keep"}]}]}}`, `,"commands":["./nested","./base.md"],"hooks":{"Stop":[{"hooks":[{"type":"command","command":"replacement-private"}]}]}`, "", 2, 2, 0},
		{"strict conflict", `{"name":"actual"}`, `,"strict":false,"commands":"./base.md"`, "CONFLICTING_MANIFESTS", 0, 0, 0},
		{"strict false without components", `{"name":"actual"}`, `,"strict":false`, "", 0, 0, 0},
		{"manifestless", "", `,"commands":"./nested","mcpServers":{"fixture":{"command":"private-program"}},"hooks":{"Stop":[{"hooks":[{"type":"command","command":"replacement-private"}]}]}`, "", 1, 1, 1},
		{"manifest owns servers", `{"name":"actual"}`, `,"mcpServers":{"ignored":{"command":"private-program"}}`, "", 0, 0, 0},
		{"clear hook event", `{"name":"actual","hooks":{"Stop":[{"hooks":[{"type":"command","command":"old"}]}]}}`, `,"hooks":{"Stop":[]}`, "", 0, 0, 0},
		{"entry hook file rejected", `{"name":"actual"}`, `,"hooks":"./hooks.json"`, "INVALID_MARKETPLACE_HOOKS", 0, 0, 0},
		{"null strict", `{"name":"actual"}`, `,"strict":null`, "INVALID_MARKETPLACE_ENTRY", 0, 0, 0},
		{"escaping path", `{"name":"actual"}`, `,"commands":"./../escape.md"`, "INVALID_COMPONENT_PATH", 0, 0, 0},
	} {
		t.Run(row.name, func(t *testing.T) {
			root := t.TempDir()
			files := map[string]string{
				".claude-plugin/marketplace.json": `{"name":"catalog","owner":{"name":"Fixture"},"plugins":[{"name":"installed","source":"./sample"` + row.extra + `}]}`,
				"sample/base.md":                  "Base command.",
				"sample/nested/group/extra.md":    "Nested command.",
			}
			if row.manifest != "" {
				files["sample/.claude-plugin/plugin.json"] = row.manifest
			}
			writePluginFiles(t, root, files)
			packages, err := LoadPackages(t.Context(), []string{root})
			if row.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), row.wantError) {
					t.Fatalf("error=%v want %s", err, row.wantError)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			p := packages[0]
			if len(p.Definition.Components) != row.commands || len(p.Hooks) != row.hooks || len(p.MCP) != row.servers {
				t.Fatalf("components=%d hooks=%d servers=%d", len(p.Definition.Components), len(p.Hooks), len(p.MCP))
			}
			wantName := "actual"
			if row.manifest == "" {
				wantName = "installed"
			}
			if p.Definition.Name != wantName || p.Definition.InstallName != "installed" {
				t.Fatalf("identity=%+v", p.Definition)
			}
			for _, h := range p.Hooks {
				if h.Event == "Stop" && h.Command != "replacement-private" {
					t.Fatal("entry hook did not replace manifest event")
				}
			}
			data, _ := json.Marshal(p)
			if strings.Contains(string(data), "replacement-private") || strings.Contains(string(data), "private-program") {
				t.Fatal("entry configuration leaked through JSON")
			}
		})
	}
}
