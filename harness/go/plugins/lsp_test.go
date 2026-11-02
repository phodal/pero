package plugins

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestPluginLSPMergeAndInspectionStayPrivate(t *testing.T) {
	root := t.TempDir()
	writePluginFiles(t, root, map[string]string{
		".claude-plugin/plugin.json": `{"name":"sample","lspServers":["./.lsp.json",{"go":{"command":"selected-private-canary","args":["private-canary"],"extensionToLanguage":{".go":"go"},"env":{"TOKEN":"private-canary"},"settings":{"value":"private-canary"},"requestTimeout":120000}},"./config/extra.json"]}`,
		".lsp.json":                  `{"go":{"command":"old","extensionToLanguage":{".go":"go"}},"python":{"command":"old-python","extensionToLanguage":{".py":"python"}}}`,
		"config/extra.json":          `{"python":{"command":"new-private-canary","extensionToLanguage":{".py":"python"},"initializationOptions":{"key":"private-canary"}}}`,
		"skills/check/SKILL.md":      "---\ndescription: Check code\n---\nInspect the code.",
	})
	packages, err := LoadPackages(t.Context(), []string{root})
	if err != nil {
		t.Fatal(err)
	}
	if len(packages) != 1 || len(packages[0].LSP) != 2 || len(packages[0].Definition.LSP.Servers) != 2 {
		t.Fatalf("LSP selection was lost: %d packages", len(packages))
	}
	goServer, python := packages[0].LSP[0], packages[0].LSP[1]
	if goServer.Name != "go" || goServer.Config.Command != "selected-private-canary" || goServer.Config.RequestTimeout != 120*time.Second || python.Name != "python" || python.Config.Command != "new-private-canary" {
		t.Fatal("later LSP definitions did not replace their original named positions")
	}
	if !packages[0].Definition.LSP.InspectionOnly || !packages[0].Definition.LSP.Servers[0].HasSettings || !packages[0].Definition.LSP.Servers[1].HasInitializationOptions {
		t.Fatal("LSP summaries lost their non-secret configuration facts")
	}
	for _, path := range []string{".lsp.json", "config/extra.json", ".claude-plugin/plugin.json"} {
		if slices.Contains(packages[0].Resources, path) {
			t.Errorf("private integration configuration exposed as a skill resource: %s", path)
		}
	}
	encoded, err := json.Marshal(packages)
	if err != nil || strings.Contains(string(encoded), "private-canary") {
		t.Fatalf("LSP inspection exposed private configuration: %s %v", encoded, err)
	}
}

func TestPluginLSPRejectsInvalidDeclarationsWithoutExecuting(t *testing.T) {
	for _, config := range []string{
		`{"go":{"command":"not-run","extensionToLanguage":{".go":"go"},"transport":"socket"}}`,
		`{"go":{"command":"not-run","extensionToLanguage":{".go":"go"},"diagnostics":true}}`,
		`{"go":{"command":"not-run","extensionToLanguage":{".go":"go"},"unknownExecutionField":"private-canary"}}`,
	} {
		root := t.TempDir()
		writePluginFiles(t, root, map[string]string{".claude-plugin/plugin.json": `{"name":"sample"}`, ".lsp.json": config})
		report, err := Inspect(t.Context(), root)
		if err != nil || report.Valid() {
			t.Fatalf("unsupported LSP declaration passed inspection: %+v %v", report, err)
		}
		if _, err := LoadPackages(t.Context(), []string{root}); err == nil || strings.Contains(err.Error(), "private-canary") {
			t.Fatalf("LSP declaration did not fail with a safe diagnostic: %v", err)
		}
	}
}
