package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/claudehooks"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/pluginruntime"
	"github.com/phodal/pero/harness/go/plugins"
)

func TestPrintUsesTheSessionStartMessageThenThePrompt(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("command hooks require Unix")
	}
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	pluginRoot := filepath.Join(base, "plugin")
	workspace := filepath.Join(base, "workspace")
	sessions := filepath.Join(base, "sessions")
	for _, path := range []string{filepath.Join(pluginRoot, ".claude-plugin"), filepath.Join(pluginRoot, "hooks"), workspace, sessions} {
		if err := os.MkdirAll(path, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(pluginRoot, ".claude-plugin", "plugin.json"), []byte(`{"name":"sample"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pluginRoot, "hooks", "hooks.json"), []byte(`{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"printf '%s' '{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"initialUserMessage\":\"begin\",\"additionalContext\":\"startup-context\"}}'"}]}]}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var bodies []string
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(raw))
		mu.Unlock()
		chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"content": "printed"}, "finish_reason": "stop"}}})
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintf(w, "data: %s\n\ndata: [DONE]\n\n", chunk)
	}))
	defer provider.Close()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	contractFile := filepath.Join(base, "contract.json")
	const contractGoal = "PRINT_HUMAN_CONTRACT_ONLY"
	if err := os.WriteFile(contractFile, []byte(`{"id":"print","kind":"explain","goal":"`+contractGoal+`"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	extra, _ := json.Marshal([]string{"--engineering-profile", "observe", "--engineering-contract", contractFile, "--print", "follow"})
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
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
	var stdout, stderr bytes.Buffer
	child.Stdout, child.Stderr = &stdout, &stderr
	if err := child.Run(); err != nil {
		t.Fatalf("print failed: %v\n%s", err, stderr.String())
	}
	if strings.Count(stdout.String(), "printed") != 2 {
		t.Fatalf("stdout=%q\n%s", stdout.String(), stderr.String())
	}
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 || !strings.Contains(bodies[0], "begin") || !strings.Contains(bodies[0], "startup-context") || !strings.Contains(bodies[1], "follow") {
		t.Fatalf("bodies=%v", bodies)
	}
	if strings.Contains(bodies[0], contractGoal) || !strings.Contains(bodies[1], contractGoal) {
		t.Fatalf("launch contract must bind the human prompt after plugin startup: %v", bodies)
	}
}

func TestPrintCancellationSettlesPluginStartup(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("command hooks require Unix")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	started := make(chan *harness.Agent, 1)
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"configured"}, Adapter: harness.AdapterFunc(func(ctx context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		started <- request.Agent
		<-ctx.Done()
		return harness.Completion{}, ctx.Err()
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
	root := t.TempDir()
	hooks, err := pluginruntime.MountHooks(ctx, h, []plugins.Package{{Root: root, Definition: plugins.Plugin{Name: "startup"}, Hooks: []claudehooks.Hook{{Event: "SessionStart", Command: `printf '%s' '{"hookSpecificOutput":{"initialUserMessage":"begin"}}'`}}}}, pluginruntime.HookOptions{Shell: "/bin/sh", StateDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer hooks.Close()
	printCtx, cancelPrint := context.WithCancel(ctx)
	defer cancelPrint()
	result := make(chan error, 1)
	go func() {
		result <- runPrintPrepared(printCtx, h, hooks, "fixture", root, "follow", func(context.Context, *harness.Agent, *harness.Message) (func(), error) {
			t.Error("plugin startup or a cancelled human prompt reached trusted preparation")
			return nil, nil
		})
	}()
	var agent *harness.Agent
	select {
	case agent = <-started:
	case <-ctx.Done():
		t.Fatal("startup did not reach the provider", ctx.Err())
	}
	cancelPrint()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatal("print did not return cancellation", err)
		}
	case <-ctx.Done():
		t.Fatal("cancelled startup remained active", ctx.Err())
	}
	if err := agent.WhenIdle(ctx); err != nil {
		t.Fatal("print returned before startup settled", err)
	}
	for _, event := range agent.Session().Events() {
		if event.Type != "turn/start" {
			continue
		}
		var start struct{ Source harness.TurnSource }
		if err := json.Unmarshal(event.Data, &start); err != nil || start.Source != harness.TurnSourcePlugin {
			t.Fatalf("startup provenance=%q error=%v", start.Source, err)
		}
	}
}
