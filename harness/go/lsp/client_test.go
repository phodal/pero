//go:build linux || darwin

package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func fixtureServer(t *testing.T, root, mode string) Server {
	t.Helper()
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Skip("Python 3 is required for the real stdio fixture")
	}
	python, err = filepath.Abs(python)
	if err != nil {
		t.Fatal(err)
	}
	fixture, err := filepath.Abs("testdata/server.py")
	if err != nil {
		t.Fatal(err)
	}
	content, err := json.Marshal(map[string]any{"fixture": map[string]any{"command": python, "args": []string{"-u", fixture}, "extensionToLanguage": map[string]string{".go": "go"}, "env": map[string]string{"LSP_FIXTURE_LOG": filepath.Join(root, "protocol.jsonl"), "LSP_FIXTURE_MODE": mode}, "settings": map[string]any{"fixture": map[string]bool{"enabled": true}}, "initializationOptions": map[string]string{"selection": "fixture"}, "startupTimeout": 1000, "requestTimeout": 1000, "shutdownTimeout": 100, "diagnostics": false}})
	if err != nil {
		t.Fatal(err)
	}
	servers, err := DecodeServers(content)
	if err != nil {
		t.Fatal(err)
	}
	return servers[0]
}

func fixtureApp(t *testing.T, mode string, adjust ...func(*Config)) (*App, *harness.Harness, *harness.Agent, string) {
	t.Helper()
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "fixture.go"), []byte("package fixture\nfunc Greet() {}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("LSP must not run a model")
		return harness.Completion{}, nil
	}), AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	server := fixtureServer(t, root, mode)
	for _, configure := range adjust {
		configure(&server.Config)
	}
	app, err := Mount(t.Context(), h, Options{Workspace: root, Servers: []Selection{{Server: server}}, Environment: []string{"HOME=" + root, "PATH=" + os.Getenv("PATH")}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = h.Dispose(context.Background())
		_ = h.Drain(context.Background())
		if err := app.Close(); err != nil {
			t.Error(err)
		}
	})
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "lsp-fixture", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	return app, h, agent, root
}

type fixtureEvent struct {
	Method string
	Params json.RawMessage
	Result json.RawMessage
	PID    int
	CWD    string
}

func readEvents(t *testing.T, root string) []fixtureEvent {
	t.Helper()
	file, err := os.Open(filepath.Join(root, "protocol.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 4096), 2<<20)
	events := []fixtureEvent{}
	for scanner.Scan() {
		var event fixtureEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return events
}

func TestLSPRealStdioRegistryQueriesAndWorkspaceBoundary(t *testing.T) {
	app, h, agent, root := fixtureApp(t, "normal")
	for _, operation := range operations {
		args, _ := json.Marshal(struct {
			Operation Operation `json:"operation"`
			File      string    `json:"filePath"`
			Line      int       `json:"line"`
			Character int       `json:"character"`
		}{operation, "fixture.go", 2, 6})
		out, err := h.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, CallID: harness.ToolCallID(operation), Name: "LSP", Arguments: args})
		if err != nil || out.Result.IsError || len(out.Result.Content) != 1 || strings.Contains(out.Result.Content[0].Text, "No results") {
			t.Fatalf("operation=%s result=%+v error=%v", operation, out.Result, err)
		}
	}
	for _, path := range []string{"../outside.go", filepath.Join(t.TempDir(), "outside.go")} {
		if _, err := app.Query(t.Context(), agent, Query{Operation: Hover, FilePath: path, Line: 1, Character: 1}); err == nil {
			t.Fatalf("outside source accepted: %s", path)
		}
	}
	outside := filepath.Join(t.TempDir(), "target.go")
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "escape.go")); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Query(t.Context(), agent, Query{Operation: Hover, FilePath: "escape.go", Line: 1, Character: 1}); err == nil {
		t.Fatal("outside symlink source was uploaded")
	}
	if err := app.Close(); err != nil {
		t.Fatal(err)
	}
	events := readEvents(t, root)
	counts := map[string]int{}
	pid := 0
	configured, editDenied, initialOptions := false, false, false
	for _, event := range events {
		counts[event.Method]++
		pid = event.PID
		configured = configured || strings.Contains(string(event.Result), `"enabled": true`)
		editDenied = editDenied || strings.Contains(string(event.Result), `"applied": false`)
		initialOptions = initialOptions || event.Method == "initialize" && strings.Contains(string(event.Params), `"selection": "fixture"`)
		if event.CWD != root {
			t.Errorf("server cwd escaped current workspace: %s", event.CWD)
		}
		if event.Method == "textDocument/definition" {
			var params positionParams
			if err := json.Unmarshal(event.Params, &params); err != nil {
				t.Fatal(err)
			}
			if params.Position != (Position{1, 5}) {
				t.Fatalf("one-based cursor was not converted: %+v", params.Position)
			}
		}
	}
	if counts["initialize"] != 1 || counts["textDocument/didOpen"] != 9 || counts["textDocument/didClose"] != 9 || counts["shutdown"] != 1 || counts["exit"] != 1 {
		t.Fatalf("stdio lifecycle was not real: %+v", counts)
	}
	if !configured || !editDenied || !initialOptions {
		t.Fatalf("configuration, initialize options or edit refusal was not applied: config=%t refused=%t init=%t", configured, editDenied, initialOptions)
	}
	if err := syscall.Kill(pid, 0); !errors.Is(err, syscall.ESRCH) {
		t.Fatalf("server still alive after owned close: pid=%d error=%v", pid, err)
	}
}

func waitFixtureFile(t *testing.T, path string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		if _, err := os.Stat(path); err == nil {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}

func TestLSPCancellationAcknowledgementAndForcedReaping(t *testing.T) {
	for _, mode := range []string{"cancel", "uncancellable"} {
		t.Run(mode, func(t *testing.T) {
			app, _, agent, root := fixtureApp(t, mode)
			ctx, cancel := context.WithCancel(t.Context())
			done := make(chan error, 1)
			go func() {
				_, err := app.Query(ctx, agent, Query{Operation: Hover, FilePath: "fixture.go", Line: 2, Character: 6})
				done <- err
			}()
			waitFixtureFile(t, filepath.Join(root, "protocol.jsonl.query-ready"))
			cancel()
			bound, stop := context.WithTimeout(t.Context(), 3*time.Second)
			defer stop()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
			case <-bound.Done():
				t.Fatal("cancelled LSP query did not settle")
			}
			if err := app.Close(); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, event := range readEvents(t, root) {
				found = found || event.Method == "$/cancelRequest"
				if err := syscall.Kill(event.PID, 0); !errors.Is(err, syscall.ESRCH) {
					t.Fatal("cancelled/disposed language-server process survived")
				}
			}
			if !found {
				t.Fatal("real $/cancelRequest was not received")
			}
		})
	}
}

func TestLSPStartupRequestShutdownAndRestartPolicy(t *testing.T) {
	for _, mode := range []string{"startup-hang", "shutdown-hang", "crash", "missing-capability", "wrong-encoding"} {
		t.Run(mode, func(t *testing.T) {
			app, _, agent, root := fixtureApp(t, mode)
			_, err := app.Query(t.Context(), agent, Query{Operation: Hover, FilePath: "fixture.go", Line: 2, Character: 6})
			if mode == "shutdown-hang" {
				if err != nil {
					t.Fatal(err)
				}
			} else if err == nil {
				t.Fatalf("%s returned fake success", mode)
			}
			if mode == "crash" {
				result, err := app.Query(t.Context(), agent, Query{Operation: Hover, FilePath: "fixture.go", Line: 2, Character: 6})
				if err != nil || !strings.Contains(result.Hover, "Greet") {
					t.Fatalf("lazy restart did not create a real initialized replacement: %+v %v", result, err)
				}
			}
			if err := app.Close(); err != nil {
				t.Fatal(err)
			}
			for _, event := range readEvents(t, root) {
				if err := syscall.Kill(event.PID, 0); !errors.Is(err, syscall.ESRCH) {
					t.Fatal("failed/stopped server survived cleanup")
				}
			}
		})
	}
}

func TestLSPRequestDeadlineAndDisabledRestart(t *testing.T) {
	t.Run("request deadline", func(t *testing.T) {
		app, _, agent, _ := fixtureApp(t, "cancel", func(config *Config) { config.RequestTimeout = 40 * time.Millisecond })
		_, err := app.Query(t.Context(), agent, Query{Operation: Hover, FilePath: "fixture.go", Line: 2, Character: 6})
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("requestTimeout was ignored: %v", err)
		}
	})
	for _, policy := range []string{"disabled", "zero attempts"} {
		t.Run(policy, func(t *testing.T) {
			app, _, agent, root := fixtureApp(t, "crash", func(config *Config) {
				if policy == "disabled" {
					config.RestartOnCrash = false
				} else {
					config.MaxRestarts = 0
				}
			})
			query := Query{Operation: Hover, FilePath: "fixture.go", Line: 2, Character: 6}
			if _, err := app.Query(t.Context(), agent, query); err == nil {
				t.Fatal("crashed server returned success")
			}
			if _, err := app.Query(t.Context(), agent, query); err == nil || !strings.Contains(err.Error(), "restart policy") {
				t.Fatalf("restart bound ignored: %v", err)
			}
			if err := app.Close(); err != nil {
				t.Fatal(err)
			}
			count := 0
			for _, event := range readEvents(t, root) {
				if event.Method == "initialize" {
					count++
				}
			}
			if count != 1 {
				t.Fatalf("disabled restart launched %d servers", count)
			}
		})
	}
}

func TestLSPUsesCurrentCWDWithinLaunchWorkspace(t *testing.T) {
	app, h, _, root := fixtureApp(t, "normal")
	cwd := filepath.Join(root, "subproject")
	if err := os.Mkdir(cwd, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cwd, "fixture.go"), []byte("package fixture\nfunc Greet() {}\n"), 0600); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "subproject-lsp", CWD: cwd, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.Query(t.Context(), agent, Query{Operation: Definition, FilePath: "fixture.go", Line: 2, Character: 6}); err != nil {
		t.Fatal(err)
	}
	outside, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "outside-lsp", CWD: t.TempDir(), Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.Query(t.Context(), outside, Query{Operation: Definition, FilePath: "fixture.go", Line: 2, Character: 6}); err == nil {
		t.Fatal("outside session cwd was accepted")
	}
	if err := app.Close(); err != nil {
		t.Fatal(err)
	}
	for _, event := range readEvents(t, root) {
		if event.CWD != cwd {
			t.Fatal("server did not launch in the current session cwd")
		}
		if event.Method == "initialize" {
			var params struct {
				RootURI string `json:"rootUri"`
			}
			if err := json.Unmarshal(event.Params, &params); err != nil {
				t.Fatal(err)
			}
			if params.RootURI != fileURI(cwd) {
				t.Fatal("initialize used the launch root instead of current workspace cwd")
			}
		}
	}
}

func TestLSPRealClangdOptIn(t *testing.T) {
	if os.Getenv("PERO_LSP_REAL_CLANGD") != "1" {
		t.Skip("set PERO_LSP_REAL_CLANGD=1 for the installed compiler server")
	}
	clangd, err := exec.LookPath("clangd")
	if err != nil {
		t.Skip("clangd is not installed")
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "fixture.cpp"), []byte("int answer() { return 42; }\nint main() { return answer(); }\n"), 0600); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(map[string]any{"clangd": map[string]any{"command": clangd, "args": []string{"--background-index=false", "--log=error"}, "extensionToLanguage": map[string]string{".cpp": "cpp"}, "diagnostics": false}})
	servers, err := DecodeServers(raw)
	if err != nil {
		t.Fatal(err)
	}
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		return harness.Completion{}, fmt.Errorf("no model may run")
	}), AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	app, err := Mount(t.Context(), h, Options{Workspace: root, Servers: []Selection{{Server: servers[0]}}, Environment: []string{"HOME=" + root, "PATH=" + os.Getenv("PATH")}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = app.Close() }()
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "clangd-fixture", CWD: root, Provider: "fixture", Model: "scripted"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := app.Query(t.Context(), agent, Query{Operation: Hover, FilePath: "fixture.cpp", Line: 1, Character: 5})
	if err != nil || !strings.Contains(result.Hover, "answer") {
		t.Fatalf("real clangd hover: %+v %v", result, err)
	}
}

func TestLSPDynamicStdioCapabilities(t *testing.T) {
	app, _, agent, _ := fixtureApp(t, "dynamic")
	query := Query{Operation: Hover, FilePath: "fixture.go", Line: 2, Character: 6}
	result, err := app.Query(t.Context(), agent, query)
	if err != nil || result.Hover == "" {
		t.Fatalf("registered hover=%+v err=%v", result, err)
	}
	if _, err := app.Query(t.Context(), agent, query); err == nil {
		t.Fatal("unregistered capability was called")
	}
}
