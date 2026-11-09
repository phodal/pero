package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestFetchSkillCommandRejectsUnsafeSources(t *testing.T) {
	commit := strings.Repeat("a", 40)
	digest := strings.Repeat("b", 64)
	for _, source := range []string{"/tmp/skills", "ssh://git@github.com/owner/repo.git", "https://github.com/owner/repo.git?token=1", "https://example.com/owner/repo.git"} {
		err := runPlugins([]string{"fetch-skill", source, t.TempDir(), commit, "SKILL.md", "market-test", digest}, &bytes.Buffer{})
		if err == nil || !strings.Contains(err.Error(), "public GitHub") {
			t.Fatalf("%s: %v", source, err)
		}
	}
	err := runPlugins([]string{"fetch-skill", "https://github.com/owner/repo.git", t.TempDir(), "HEAD", "SKILL.md", "market-test", digest}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "invalid pinned skill selection") {
		t.Fatalf("unpinned revision accepted: %v", err)
	}
	err = runPlugins([]string{"fetch-skill", "https://github.com/owner/repo.git", t.TempDir(), commit, "skills/archive!/SKILL.md", "market-test", digest}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "invalid pinned skill selection") {
		t.Fatalf("archive path accepted: %v", err)
	}
	err = runPlugins([]string{"skill-observe", "git@github.com:owner/repo.git", "SKILL.md"}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "public GitHub") {
		t.Fatalf("observe source: %v", err)
	}
}

func TestPluginInspectionCommands(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, ".claude-plugin"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".claude-plugin/plugin.json"), []byte(`{"name":"invalid name"}`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		args                []string
		wantError, wantJSON bool
	}{
		{[]string{"inspect", root}, false, true},
		{[]string{"validate", root}, true, true},
		{[]string{"install", root}, true, false},
		{[]string{"inspect"}, true, false},
	} {
		var output bytes.Buffer
		err := runPlugins(test.args, &output)
		if (err != nil) != test.wantError {
			t.Fatalf("%v: %v", test.args, err)
		}
		if test.wantJSON {
			var report struct {
				Valid          bool `json:"valid"`
				InspectionOnly bool `json:"inspectionOnly"`
			}
			if err := json.Unmarshal(output.Bytes(), &report); err != nil {
				t.Fatal(err)
			}
			if report.Valid || !report.InspectionOnly {
				t.Fatalf("unexpected report: %+v", report)
			}
		} else if output.Len() != 0 {
			t.Fatal("usage errors must not output a report")
		}
	}
}

// The real run dispatch must bypass all provider/ACP initialization, keep its
// environment intact and never execute the supplied hook or MCP executable.
func TestPluginInspectionDispatch(t *testing.T) {
	if os.Getenv("PERO_PLUGIN_INSPECTION_CHILD") == "1" {
		os.Args = []string{"pero-agent-acp", "plugins", "inspect", os.Getenv("PERO_PLUGIN_INSPECTION_ROOT")}
		if err := run(); err != nil {
			os.Exit(2)
		}
		if os.Getenv("AGENT_PROVIDER_API_KEY") != "fixture-provider-value" {
			os.Exit(3)
		}
		os.Exit(0)
	}
	root := t.TempDir()
	sentinel := filepath.Join(root, "unexpected-execution")
	marker, err := json.Marshal(sentinel)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "hooks"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "hooks/hooks.json"), []byte(`{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch `+sentinel+`"}]}]}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, ".mcp.json"), []byte(`{"mcpServers":{"local":{"command":"touch","args":[`+string(marker)+`]}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.CommandContext(t.Context(), executable, "-test.run=^TestPluginInspectionDispatch$")
	child.Env = append(os.Environ(), "PERO_PLUGIN_INSPECTION_CHILD=1", "PERO_PLUGIN_INSPECTION_ROOT="+root, "AGENT_PROVIDER_API_KEY=fixture-provider-value")
	output, err := child.Output()
	if err != nil {
		t.Fatal(err)
	}
	var report struct {
		InspectionOnly bool `json:"inspectionOnly"`
	}
	if err := json.Unmarshal(output, &report); err != nil || !report.InspectionOnly {
		t.Fatalf("bad report: %v", err)
	}
	if _, err := os.Stat(sentinel); !os.IsNotExist(err) {
		t.Fatal("inspection ran plugin code")
	}
}

func TestPluginFetchCommand(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "commands"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "commands", "hello.md"), []byte("Hello."), 0600); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"init", "-q"}, {"add", "."}, {"-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "initial"}} {
		command := exec.CommandContext(t.Context(), "git", append([]string{"-C", root}, args...)...)
		if out, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git: %v %s", err, out)
		}
	}
	var output bytes.Buffer
	if err := runPlugins([]string{"fetch", root, t.TempDir()}, &output); err != nil {
		t.Fatal(err)
	}
	var receipt struct{ Directory, Revision string }
	if err := json.Unmarshal(output.Bytes(), &receipt); err != nil || !filepath.IsAbs(receipt.Directory) || len(receipt.Revision) < 40 {
		t.Fatalf("receipt=%+v err=%v", receipt, err)
	}
	if _, err := os.Stat(filepath.Join(receipt.Directory, "commands", "hello.md")); err != nil {
		t.Fatal(err)
	}
}
