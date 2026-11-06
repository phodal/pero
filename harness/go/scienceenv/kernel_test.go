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

	if _, err := py.Exec(t.Context(), "marker = 'py'", nil); err != nil {
		t.Fatal(err)
	}
	got, err := py.Exec(t.Context(), "marker", nil)
	if err != nil || !strings.Contains(got.Stdout, "'py'") || got.Error != "" {
		t.Fatalf("python state: %+v %v", got, err)
	}
	missing, err := py.Exec(t.Context(), "import host", nil)
	if err != nil || !strings.Contains(missing.Error, "host") {
		t.Fatalf("python imported host: %+v %v", missing, err)
	}
	still, err := py.Exec(t.Context(), "marker", nil)
	if err != nil || !strings.Contains(still.Stdout, "'py'") {
		t.Fatalf("exception cleared python state: %+v %v", still, err)
	}

	isolated, err := repl.Exec(t.Context(), "marker", nil)
	if err != nil || !strings.Contains(isolated.Error, "marker") {
		t.Fatalf("repl shared python state: %+v %v", isolated, err)
	}
	called := 0
	out, err := repl.Exec(t.Context(), "import host\nprint(host.mcp('demo', 'echo', text='hi'))", func(_ context.Context, call MCPCall) (json.RawMessage, error) {
		called++
		if call.Server != "demo" || call.Tool != "echo" || !strings.Contains(string(call.Arguments), `"text": "hi"`) && !strings.Contains(string(call.Arguments), `"text":"hi"`) {
			t.Fatalf("mcp call: %+v", call)
		}
		return json.RawMessage(`{"text":"hi"}`), nil
	})
	if err != nil || called != 1 || !strings.Contains(out.Stdout, "hi") || out.Error != "" {
		t.Fatalf("repl mcp: called=%d %+v %v", called, out, err)
	}
}

func TestKernelCancelDiscardsState(t *testing.T) {
	python := pythonBin(t)
	kernel, err := Start(Config{Language: Python, Interpreter: python, Workspace: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { kernel.Close() })
	if _, err := kernel.Exec(t.Context(), "kept = 1", nil); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
	defer cancel()
	if _, err := kernel.Exec(ctx, "import time\ntime.sleep(30)", nil); err == nil || !strings.Contains(err.Error(), "discarded") {
		t.Fatalf("cancel: %v", err)
	}
	out, err := kernel.Exec(t.Context(), "kept", nil)
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
	if _, err := kernel.Exec(t.Context(), "kept <- 7", nil); err != nil {
		t.Fatal(err)
	}
	out, err := kernel.Exec(t.Context(), "kept + 1", nil)
	if err != nil || !strings.Contains(out.Stdout, "8") || out.Error != "" {
		t.Fatalf("r state: %+v %v", out, err)
	}
	if _, err := kernel.Exec(t.Context(), "stop('boom')", nil); err != nil {
		t.Fatal(err)
	}
	again, err := kernel.Exec(t.Context(), "kept", nil)
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
