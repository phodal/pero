package shell

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func testExecutor(t *testing.T, options LocalOptions) *LocalExecutor {
	t.Helper()
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("shell intentionally unavailable")
	}
	binary, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("Bash unavailable")
	}
	binary, err = filepath.Abs(binary)
	if err != nil {
		t.Fatal(err)
	}
	options.Shell = binary
	if options.CWD == "" {
		options.CWD = t.TempDir()
	}
	if options.Grace == 0 {
		options.Grace = 40 * time.Millisecond
	}
	e, err := NewLocalExecutor(options)
	if err != nil {
		t.Fatal(err)
	}
	return e
}
func runCommand(t *testing.T, e *LocalExecutor, ctx context.Context, command string) (RunResult, error) {
	t.Helper()
	spec, err := e.Resolve(ExecRequest{Command: command})
	if err != nil {
		t.Fatal(err)
	}
	return e.Run(ctx, spec)
}

func TestForegroundOutputExitAndEnvironment(t *testing.T) {
	t.Setenv("UNUSUAL_PRIVATE_VALUE", "fixture-must-not-inherit")
	t.Setenv("BASH_ENV", "/definitely/not/used")
	e := testExecutor(t, LocalOptions{})
	r, err := runCommand(t, e, context.Background(), `printf 'hello'; printf 'warning' >&2; printf '%s' "${UNUSUAL_PRIVATE_VALUE-unset}"; exit 7`)
	if err != nil || r.ExitCode == nil || *r.ExitCode != 7 || r.Stdout.Text != "hellounset" || r.Stderr.Text != "warning" {
		t.Fatalf("result=%+v err=%v", r, err)
	}
	if r.Aborted || r.TimedOut {
		t.Fatal(r)
	}
}

func TestTrustedPluginEnvironmentIsExplicit(t *testing.T) {
	t.Setenv("PERO_NOT_SELECTED", "must-not-inherit")
	e := testExecutor(t, LocalOptions{BaseEnv: []string{"PLUGIN_ACCOUNT=explicit-fixture"}, TrustedBaseEnvironment: true})
	r, err := runCommand(t, e, context.Background(), `printf '%s/%s' "$PLUGIN_ACCOUNT" "${PERO_NOT_SELECTED-unset}"`)
	if err != nil || r.Stdout.Text != "explicit-fixture/unset" {
		t.Fatalf("result=%+v error=%v", r, err)
	}
}
func TestOutputCapsBothStreams(t *testing.T) {
	e := testExecutor(t, LocalOptions{MaxOutputBytes: 128})
	r, err := runCommand(t, e, context.Background(), `for ((i=0;i<5000;i++)); do printf 1234567890; printf abcdefghij >&2; done`)
	if err != nil {
		t.Fatal(err)
	}
	if !r.Stdout.Truncated || !r.Stderr.Truncated || len(r.Stdout.Text) > 128 || len(r.Stderr.Text) > 128 {
		t.Fatal(r)
	}
}
func TestTimeoutAndCallerCancellation(t *testing.T) {
	e := testExecutor(t, LocalOptions{Timeout: 60 * time.Millisecond})
	started := time.Now()
	r, err := runCommand(t, e, context.Background(), `trap '' TERM; sleep 30`)
	if !errors.Is(err, ErrTimeout) || !r.TimedOut || r.Aborted || time.Since(started) > 2*time.Second {
		t.Fatalf("result=%+v err=%v elapsed=%v", r, err, time.Since(started))
	}
	e = testExecutor(t, LocalOptions{})
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Millisecond)
	defer cancel()
	started = time.Now()
	r, err = runCommand(t, e, ctx, `trap '' TERM; sleep 30`)
	if !errors.Is(err, context.DeadlineExceeded) || !r.Aborted || r.TimedOut || time.Since(started) > 2*time.Second {
		t.Fatalf("result=%+v err=%v", r, err)
	}
}
func TestChildHoldingPipesCannotHoldWaitForever(t *testing.T) {
	e := testExecutor(t, LocalOptions{})
	started := time.Now()
	r, err := runCommand(t, e, context.Background(), `(trap '' TERM; sleep 30) & printf finished`)
	if !errors.Is(err, exec.ErrWaitDelay) || r.Stdout.Text != "finished" || time.Since(started) > 2*time.Second {
		t.Fatalf("result=%+v err=%v elapsed=%v", r, err, time.Since(started))
	}
}
func TestResolveAndRunRejectBoundaryBypass(t *testing.T) {
	e := testExecutor(t, LocalOptions{})
	for _, request := range []ExecRequest{{Command: ""}, {Command: "x", Timeout: 121 * time.Second}, {Command: "x", Timeout: -1}, {Command: "x", StdoutMaxBytes: 65537}, {Command: "x", Workdir: filepath.Dir(e.cwd)}, {Command: strings.Repeat("x", 16385)}} {
		if _, err := e.Resolve(request); err == nil {
			t.Fatalf("accepted %+v", request)
		}
	}
	if _, err := e.Run(context.Background(), ExecSpec{Command: "echo bypass", Workdir: e.cwd, Timeout: time.Hour, StdoutMaxBytes: 1}); err == nil {
		t.Fatal("direct Run bypass accepted")
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(e.cwd, "escape")); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Resolve(ExecRequest{Command: "true", Workdir: "escape"}); err == nil {
		t.Fatal("outside symlink launch accepted")
	}
}
func TestExplicitEnvironmentRejectsSecretAndStartupVariables(t *testing.T) {
	for _, entry := range []string{"MY_CREDENTIAL=fixture", "BASH_ENV=fixture", "LD_PRELOAD=fixture", "PATH=bad\x00value"} {
		if _, err := explicitEnvironment([]string{entry}); err == nil {
			t.Fatalf("accepted %q", entry)
		}
	}
}
func TestPreCancelledDoesNotSpawn(t *testing.T) {
	e := testExecutor(t, LocalOptions{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r, err := runCommand(t, e, ctx, `printf bad > spawned`)
	if !errors.Is(err, context.Canceled) || !r.Aborted {
		t.Fatalf("result=%+v err=%v", r, err)
	}
	if _, err := os.Stat(filepath.Join(e.cwd, "spawned")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("cancelled request spawned")
	}
}
func TestTailWriterRetainsBoundedTail(t *testing.T) {
	w := newTailWriter(5)
	_, _ = w.Write([]byte("123"))
	_, _ = w.Write([]byte("456"))
	if r := w.Output(); r.Text != "23456" || !r.Truncated {
		t.Fatal(r)
	}
	_, _ = w.Write([]byte("abcdefghi"))
	if r := w.Output(); r.Text != "efghi" || !r.Truncated {
		t.Fatal(r)
	}
}

func TestWorkspaceReplacementRejectsPreviouslyResolvedCommand(t *testing.T) {
	parent := t.TempDir()
	root := filepath.Join(parent, "workspace")
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	e := testExecutor(t, LocalOptions{CWD: root})
	spec, err := e.Resolve(ExecRequest{Command: "printf unsafe > spawned"})
	if err != nil {
		t.Fatal(err)
	}
	moved := filepath.Join(parent, "original")
	if err := os.Rename(root, moved); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Resolve(ExecRequest{Command: "true"}); err == nil {
		t.Fatal("replacement accepted by Resolve")
	}
	if _, err := e.Run(context.Background(), spec); err == nil {
		t.Fatal("replacement accepted by Run")
	}
	if _, err := os.Stat(filepath.Join(root, "spawned")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("command spawned in replacement directory")
	}
	if err := os.Remove(root); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(moved, root); err != nil {
		t.Fatal(err)
	}
	if _, err := e.Resolve(ExecRequest{Command: "true"}); err == nil {
		t.Fatal("replacement symlink accepted")
	}
}

func TestUnconfinedExecutorCannotAttest(t *testing.T) {
	e := testExecutor(t, LocalOptions{})
	if err := e.CheckConfinement(t.Context()); err == nil {
		t.Fatal("unconfined executor attested")
	}
}

func TestUnsupportedExecutorAdmission(t *testing.T) {
	if platformSupported() {
		t.Skip("unsupported-platform contract")
	}
	e, err := NewLocalExecutor(LocalOptions{Shell: filepath.Join(t.TempDir(), "shell.exe"), CWD: t.TempDir()})
	if e != nil || err == nil || !strings.Contains(err.Error(), "process-group ownership is unsupported") {
		t.Fatalf("executor admission: %v %v", e, err)
	}
}

func TestShellCommandUsesFixedNoninteractiveStartup(t *testing.T) {
	for _, tc := range []struct {
		platform string
		want     []string
	}{
		{"linux", []string{"shell", "--noprofile", "--norc", "-c", "body; unchanged"}},
		{"darwin", []string{"shell", "--noprofile", "--norc", "-c", "body; unchanged"}},
		{"windows", []string{"shell", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "body; unchanged"}},
	} {
		got := shellCommand("shell", "body; unchanged", tc.platform)
		if strings.Join(got, "\x00") != strings.Join(tc.want, "\x00") {
			t.Fatalf("%s argv=%q want=%q", tc.platform, got, tc.want)
		}
	}
}

func TestSessionCWDUsesExactWorkspaceIdentity(t *testing.T) {
	e := testExecutor(t, LocalOptions{})
	if err := e.CheckCWD(e.cwd); err != nil {
		t.Fatal(err)
	}
	if err := e.CheckCWD("."); err == nil {
		t.Fatal("relative session cwd accepted")
	}
	if err := e.CheckCWD(t.TempDir()); err == nil {
		t.Fatal("unrelated session cwd accepted")
	}
	child := filepath.Join(e.cwd, "child")
	if err := os.Mkdir(child, 0700); err != nil {
		t.Fatal(err)
	}
	if err := e.CheckCWD(child); err == nil {
		t.Fatal("subdirectory changed session authority")
	}
}
