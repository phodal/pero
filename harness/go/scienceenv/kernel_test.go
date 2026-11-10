package scienceenv

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestPythonKernelKeepsStateAndReplOwnsMCP(t *testing.T) {
	python := pythonBin(t)
	root := t.TempDir()
	py, err := Start(Config{Language: Python, Interpreter: python, Workspace: root})
	if err != nil {
		t.Fatal(err)
	}
	repl, err := Start(Config{Language: Repl, Interpreter: python, Workspace: root})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { py.Close(); repl.Close() })

	if _, err := py.Exec(t.Context(), "marker = 'py'", Host{}); err != nil {
		t.Fatal(err)
	}
	got, err := py.Exec(t.Context(), "marker", Host{})
	if err != nil || !strings.Contains(got.Stdout, "'py'") || got.Error != "" {
		t.Fatalf("python state: %+v %v", got, err)
	}
	missing, err := py.Exec(t.Context(), "import host\nhost.mcp('demo', 'echo')", Host{})
	if err != nil || !strings.Contains(missing.Error, "repl") {
		t.Fatalf("python mcp: %+v %v", missing, err)
	}
	email, err := py.Exec(t.Context(), "import host\nprint(repr(host.get_user_email()))", Host{Email: func() (string, error) { return "a@b.c", nil }})
	if err != nil || !strings.Contains(email.Stdout, "a@b.c") || email.Error != "" {
		t.Fatalf("email: %+v %v", email, err)
	}
	still, err := py.Exec(t.Context(), "marker", Host{})
	if err != nil || !strings.Contains(still.Stdout, "'py'") {
		t.Fatalf("exception cleared python state: %+v %v", still, err)
	}

	isolated, err := repl.Exec(t.Context(), "marker", Host{})
	if err != nil || !strings.Contains(isolated.Error, "marker") {
		t.Fatalf("repl shared python state: %+v %v", isolated, err)
	}
	called := 0
	out, err := repl.Exec(t.Context(), "import host\nprint(host.mcp('demo', 'echo', text='hi'))", Host{MCP: func(_ context.Context, call MCPCall) (json.RawMessage, error) {
		called++
		if call.Server != "demo" || call.Tool != "echo" || !strings.Contains(string(call.Arguments), `"text": "hi"`) && !strings.Contains(string(call.Arguments), `"text":"hi"`) {
			t.Fatalf("mcp call: %+v", call)
		}
		return json.RawMessage(`{"text":"hi"}`), nil
	}})
	if err != nil || called != 1 || !strings.Contains(out.Stdout, "hi") || out.Error != "" {
		t.Fatalf("repl mcp: called=%d %+v %v", called, out, err)
	}
}

func TestKernelCompletedCellCancellationKeepsState(t *testing.T) {
	// A completed cell no longer owns cancellation of the persistent process.
	kernel, err := Start(Config{Language: Python, Interpreter: pythonBin(t), Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { kernel.Close() })
	for _, op := range []string{"load", "exec"} {
		t.Run(op, func(t *testing.T) {
			for i := 0; i < 100; i++ {
				ctx, cancel := context.WithCancel(t.Context())
				var out Output
				var err error
				if op == "load" {
					out, err = kernel.Load(ctx, "MARKER = 42", Host{})
				} else {
					out, err = kernel.Exec(ctx, "MARKER = 42", Host{})
				}
				cancel()
				if err != nil || out.Error != "" {
					t.Fatalf("completed cell %d: %+v %v", i, out, err)
				}
				out, err = kernel.Exec(t.Context(), "print(MARKER)", Host{})
				if err != nil || out.Error != "" || strings.TrimSpace(out.Stdout) != "42" {
					t.Fatalf("state after completed cell %d: %+v %v", i, out, err)
				}
			}
		})
	}
}

func TestKernelCancelDiscardsState(t *testing.T) {
	python := pythonBin(t)
	kernel, err := Start(Config{Language: Python, Interpreter: python, Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { kernel.Close() })
	if _, err := kernel.Exec(t.Context(), "kept = 1", Host{}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	if _, err := kernel.Exec(ctx, "import time\ntime.sleep(30)", Host{}); err == nil || !strings.Contains(err.Error(), "discarded") {
		t.Fatalf("cancel: %v", err)
	}
	out, err := kernel.Exec(t.Context(), "kept", Host{})
	if err != nil || !strings.Contains(out.Error, "kept") {
		t.Fatalf("state survived cancel: %+v %v", out, err)
	}
}

func TestRKernelKeepsState(t *testing.T) {
	rscript, err := exec.LookPath("Rscript")
	if err != nil {
		t.Skip("Rscript is not installed")
	}
	kernel, err := Start(Config{Language: R, Interpreter: rscript, Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { kernel.Close() })
	if _, err := kernel.Exec(t.Context(), "kept <- 7", Host{}); err != nil {
		t.Fatal(err)
	}
	out, err := kernel.Exec(t.Context(), "kept + 1", Host{})
	if err != nil || !strings.Contains(out.Stdout, "8") || out.Error != "" {
		t.Fatalf("r state: %+v %v", out, err)
	}
	if _, err := kernel.Exec(t.Context(), "stop('boom')", Host{}); err != nil {
		t.Fatal(err)
	}
	again, err := kernel.Exec(t.Context(), "kept", Host{})
	if err != nil || !strings.Contains(again.Stdout, "7") {
		t.Fatalf("r error cleared state: %+v %v", again, err)
	}
}

func pythonBin(t *testing.T) string {
	t.Helper()
	path, err := exec.LookPath("python3")
	if err != nil {
		t.Fatal("python3 is required")
	}
	return path
}
