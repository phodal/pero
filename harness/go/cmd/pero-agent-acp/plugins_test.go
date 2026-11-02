package main

import (
	"bytes"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

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
