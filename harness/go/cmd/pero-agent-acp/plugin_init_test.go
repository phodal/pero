package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestPluginInitOnlyAndMaintenanceExitAfterSetup(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("command hooks require Unix")
	}
	for _, test := range []struct {
		name, flag string
		session    bool
	}{
		{name: "init", flag: "--init-only", session: true},
		{name: "maintenance", flag: "--maintenance"},
	} {
		t.Run(test.name, func(t *testing.T) {
			base, err := filepath.EvalSymlinks(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			pluginRoot := filepath.Join(base, "plugin")
			workspace := filepath.Join(base, "workspace")
			sessions := filepath.Join(base, "sessions")
			for _, path := range []string{filepath.Join(pluginRoot, ".claude-plugin"), filepath.Join(pluginRoot, "hooks"), workspace, sessions} {
				if err := os.MkdirAll(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			files := map[string]string{
				".claude-plugin/plugin.json": `{"name":"sample"}`,
				"hooks/hooks.json": `{
					"hooks": {
						"Setup": [{"hooks": [{"type": "command", "command": "printf setup > \"$CLAUDE_PLUGIN_ROOT/setup.txt\""}]}],
						"SessionStart": [{"matcher": "startup", "hooks": [{"type": "command", "command": "printf session > \"$CLAUDE_PLUGIN_ROOT/session.txt\""}]}]
					}
				}`,
			}
			for path, content := range files {
				if err := os.WriteFile(filepath.Join(pluginRoot, filepath.FromSlash(path)), []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			provider := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
				t.Error("init launch called the model")
			}))
			defer provider.Close()
			executable, err := os.Executable()
			if err != nil {
				t.Fatal(err)
			}
			extra, _ := json.Marshal([]string{test.flag})
			ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
			defer cancel()
			child := exec.CommandContext(ctx, executable, "-test.run=^TestPluginRuntimeAgentProcess$")
			child.Env = []string{
				"PATH=" + os.Getenv("PATH"), "HOME=" + base, "TMPDIR=" + base, "LANG=C.UTF-8",
				"PERO_PLUGIN_RUNTIME_CHILD=1",
				"PERO_PLUGIN_RUNTIME_ENDPOINT=" + provider.URL + "/v1",
				"PERO_PLUGIN_RUNTIME_SESSIONS=" + sessions,
				"PERO_PLUGIN_RUNTIME_WORKSPACE=" + workspace,
				"PERO_PLUGIN_RUNTIME_DIRECTORY=" + pluginRoot,
				"PERO_PLUGIN_RUNTIME_CREDENTIAL=local-fixture-placeholder",
				"PERO_PLUGIN_RUNTIME_EXTRA_ARGS=" + string(extra),
				"PERO_PLUGIN_DATA_HOME=" + filepath.Join(base, "plugin-data"),
			}
			var diagnostics bytes.Buffer
			child.Stdout, child.Stderr = &diagnostics, &diagnostics
			if err := child.Run(); err != nil {
				t.Fatalf("init process failed: %v\n%s", err, diagnostics.String())
			}
			setup, err := os.ReadFile(filepath.Join(pluginRoot, "setup.txt"))
			if err != nil || string(setup) != "setup" {
				t.Fatalf("setup marker=%q error=%v\n%s", setup, err, diagnostics.String())
			}
			_, sessionErr := os.Stat(filepath.Join(pluginRoot, "session.txt"))
			if test.session && sessionErr != nil {
				t.Fatalf("session start did not run: %v\n%s", sessionErr, diagnostics.String())
			}
			if !test.session && sessionErr == nil {
				t.Fatal("maintenance launch ran SessionStart")
			}
		})
	}
}
