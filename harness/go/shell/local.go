package shell

import (
	"context"
	"errors"
	"fmt"
	"github.com/phodal/pero/harness/go/sandbox"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

const (
	defaultTimeout     = 30 * time.Second
	maximumTimeout     = 120 * time.Second
	absoluteMaxTimeout = 2 * time.Hour
	maximumOutputBytes = 64 * 1024
	defaultGrace       = 250 * time.Millisecond
)

var ErrTimeout = errors.New("shell execution timed out")

type LocalOptions struct {
	Sandbox        *sandbox.Config
	Shell          string
	CWD            string
	Timeout        time.Duration
	MaxTimeout     time.Duration
	MaxOutputBytes int
	Grace          time.Duration
	// BaseEnv is an explicit trusted allowlist input, never inherited implicitly.
	// Only PATH, LANG, LC_ALL and TZ are accepted; no per-command environment seam.
	BaseEnv []string
	// TrustedBaseEnvironment accepts an operator-supplied launch snapshot, such
	// as an explicitly enabled plugin profile. Model requests cannot set it.
	TrustedBaseEnvironment bool
	// OutputSink is an optional trusted foreground capture for both streams.
	// The caller owns its size limit and lifetime; a write failure stops execution.
	OutputSink io.Writer
}

type LocalExecutor struct {
	sandbox                    *sandbox.Executor
	windowsACL                 bool
	shell, cwd                 string
	workspaceIdentity          os.FileInfo
	timeout, maxTimeout, grace time.Duration
	maxOutputBytes             int
	baseEnv                    []string
	outputSink                 io.Writer
}

func NewLocalExecutor(options LocalOptions) (*LocalExecutor, error) {
	windowsACL := runtime.GOOS == "windows" && options.Sandbox != nil && options.Sandbox.Backend == sandbox.BackendWindowsACL
	if !platformSupported() && !windowsACL {
		return nil, errors.New("shell: process-group ownership is unsupported on this platform")
	}
	if !filepath.IsAbs(options.Shell) || !filepath.IsAbs(options.CWD) {
		return nil, errors.New("shell: explicit absolute executable and workspace directory required")
	}
	shell, err := filepath.EvalSymlinks(options.Shell)
	if err != nil {
		return nil, fmt.Errorf("shell: executable: %w", err)
	}
	info, err := os.Stat(shell)
	if err != nil || !info.Mode().IsRegular() || (runtime.GOOS != "windows" && info.Mode().Perm()&0111 == 0) {
		return nil, errors.New("shell: executable must be a regular executable file")
	}
	cwd, err := filepath.EvalSymlinks(options.CWD)
	if err != nil {
		return nil, fmt.Errorf("shell: workspace: %w", err)
	}
	info, err = os.Stat(cwd)
	if err != nil || !info.IsDir() {
		return nil, errors.New("shell: workspace must be a directory")
	}
	if options.Timeout == 0 {
		options.Timeout = defaultTimeout
	}
	if options.MaxTimeout == 0 {
		options.MaxTimeout = maximumTimeout
	}
	if options.MaxOutputBytes == 0 {
		options.MaxOutputBytes = maximumOutputBytes
	}
	if options.Grace == 0 {
		options.Grace = defaultGrace
	}
	if options.Timeout < 0 || options.MaxTimeout <= 0 || options.MaxTimeout > absoluteMaxTimeout || options.Timeout > options.MaxTimeout || options.MaxOutputBytes < 1 || options.MaxOutputBytes > maximumOutputBytes || options.Grace < 0 || options.Grace > time.Second {
		return nil, errors.New("shell: limits exceed supported bounds")
	}
	env, err := explicitEnvironment(options.BaseEnv)
	if options.TrustedBaseEnvironment {
		env, err = trustedEnvironment(options.BaseEnv)
	}
	if err != nil {
		return nil, err
	}
	var confined *sandbox.Executor
	if options.Sandbox != nil {
		confined, err = sandbox.New(*options.Sandbox, cwd)
		if err != nil {
			return nil, err
		}
	}
	return &LocalExecutor{sandbox: confined, windowsACL: windowsACL, shell: shell, cwd: cwd, workspaceIdentity: info, timeout: options.Timeout, maxTimeout: options.MaxTimeout, maxOutputBytes: options.MaxOutputBytes, grace: options.Grace, baseEnv: env, outputSink: options.OutputSink}, nil
}

func explicitEnvironment(entries []string) ([]string, error) {
	values := map[string]string{"PATH": "/usr/bin:/bin", "NO_COLOR": "1", "TERM": "dumb", "PAGER": "cat", "GIT_PAGER": "cat"}
	for _, entry := range entries {
		name, value, ok := strings.Cut(entry, "=")
		if !ok || strings.ContainsRune(value, 0) {
			return nil, errors.New("shell: invalid explicit environment")
		}
		switch name {
		case "PATH", "LANG", "LC_ALL", "TZ":
			values[name] = value
		default:
			return nil, errors.New("shell: environment variable is not allowlisted")
		}
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make([]string, 0, len(names))
	for _, name := range names {
		result = append(result, name+"="+values[name])
	}
	return result, nil
}

func trustedEnvironment(entries []string) ([]string, error) {
	values := map[string]string{"PATH": "/usr/bin:/bin", "NO_COLOR": "1", "TERM": "dumb", "PAGER": "cat", "GIT_PAGER": "cat"}
	for _, entry := range entries {
		name, value, ok := strings.Cut(entry, "=")
		if !ok || name == "" || strings.ContainsRune(value, 0) {
			return nil, errors.New("shell: invalid trusted environment binding")
		}
		for i, r := range name {
			if !(r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || i > 0 && r >= '0' && r <= '9') {
				return nil, errors.New("shell: invalid trusted environment name")
			}
		}
		values[name] = value
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make([]string, 0, len(names))
	for _, name := range names {
		result = append(result, name+"="+values[name])
	}
	return result, nil
}

// verifyWorkspace rejects replacement of the trusted workspace pathname between
// operations. The final check/start interval is not an OS isolation boundary.
func (e *LocalExecutor) verifyWorkspace() error {
	if e == nil || e.workspaceIdentity == nil {
		return errors.New("shell: workspace identity is unavailable")
	}
	current, err := os.Lstat(e.cwd)
	if err != nil || !current.IsDir() || !os.SameFile(e.workspaceIdentity, current) {
		return errors.New("shell: configured workspace directory was replaced or removed")
	}
	return nil
}

func (e *LocalExecutor) Resolve(request ExecRequest) (ExecSpec, error) {
	if e == nil {
		return ExecSpec{}, errors.New("shell: local executor is nil")
	}
	if err := e.verifyWorkspace(); err != nil {
		return ExecSpec{}, err
	}
	if strings.TrimSpace(request.Command) == "" || len(request.Command) > 16*1024 || strings.ContainsRune(request.Command, 0) {
		return ExecSpec{}, errors.New("shell: command must be non-empty and at most 16 KiB")
	}
	workdir := request.Workdir
	if workdir == "" {
		workdir = e.cwd
	} else if !filepath.IsAbs(workdir) {
		workdir = filepath.Join(e.cwd, workdir)
	}
	workdir, err := filepath.EvalSymlinks(workdir)
	if err != nil {
		return ExecSpec{}, fmt.Errorf("shell: workdir: %w", err)
	}
	rel, err := filepath.Rel(e.cwd, workdir)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ExecSpec{}, errors.New("shell: launch directory is outside configured workspace")
	}
	info, err := os.Stat(workdir)
	if err != nil || !info.IsDir() {
		return ExecSpec{}, errors.New("shell: workdir is not a directory")
	}
	timeout := request.Timeout
	if timeout == 0 {
		timeout = e.timeout
	}
	if timeout <= 0 || timeout > e.maxTimeout {
		return ExecSpec{}, errors.New("shell: timeout exceeds configured bounds")
	}
	limit := request.StdoutMaxBytes
	if limit == 0 {
		limit = e.maxOutputBytes
	}
	if limit < 1 || limit > e.maxOutputBytes {
		return ExecSpec{}, errors.New("shell: output limit exceeds configured bounds")
	}
	return ExecSpec{Command: request.Command, Workdir: workdir, Timeout: timeout, StdoutMaxBytes: limit}, nil
}

// Run adapts the source foreground lifecycle. Cancellation owns the process
// group until forced cleanup completes, even when Bash exits before descendants.
func (e *LocalExecutor) Run(ctx context.Context, spec ExecSpec) (RunResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	resolved, err := e.Resolve(ExecRequest(spec))
	if err != nil {
		return RunResult{}, err
	}
	spec = resolved
	result := RunResult{Timeout: spec.Timeout}
	if err := ctx.Err(); err != nil {
		result.Aborted = true
		return result, err
	}
	executionCtx, cancel := context.WithCancelCause(context.Background())
	stopCaller := context.AfterFunc(ctx, func() { cancel(ctx.Err()) })
	timer := time.AfterFunc(spec.Timeout, func() { cancel(ErrTimeout) })
	defer func() { stopCaller(); timer.Stop(); cancel(nil) }()
	argv := shellCommand(e.shell, spec.Command, runtime.GOOS)
	env := append([]string(nil), e.baseEnv...)
	if e.sandbox != nil {
		confined, err := e.sandbox.Confine(argv)
		if err != nil {
			return result, err
		}
		argv = confined.Argv
		result.Enforcement = confined.Enforcement
		result.ReadIsolated, result.NetworkIsolated = confined.ReadIsolated, confined.NetworkIsolated
		env = e.sandbox.Environment()
	}
	command := exec.Command(argv[0], argv[1:]...)
	command.Dir, command.Env = spec.Workdir, env
	// The Windows runner owns ACL rollback. EOF requests cooperative Job Object
	// termination, unlike Process.Kill which bypasses the runner's defers.
	var controlRead, controlWrite *os.File
	if e.windowsACL {
		controlRead, controlWrite, err = os.Pipe()
		if err != nil {
			return result, fmt.Errorf("shell: runner control pipe: %w", err)
		}
		defer controlRead.Close()
		defer controlWrite.Close()
		command.Stdin = controlRead
	}
	stdout, stderr := newTailWriter(spec.StdoutMaxBytes), newTailWriter(e.maxOutputBytes)
	command.Stdout, command.Stderr = stdout, stderr
	if e.outputSink != nil {
		sink := &foregroundOutputSink{writer: e.outputSink, cancel: cancel}
		command.Stdout, command.Stderr = io.MultiWriter(stdout, sink), io.MultiWriter(stderr, sink)
	}
	command.WaitDelay = e.grace
	configureProcess(command)
	if err := e.verifyWorkspace(); err != nil {
		return result, err
	}
	if cause := context.Cause(executionCtx); cause != nil {
		result.TimedOut = errors.Is(cause, ErrTimeout)
		result.Aborted = !result.TimedOut
		return result, cause
	}
	if err := command.Start(); err != nil {
		return result, fmt.Errorf("shell: start command: %w", err)
	}
	if controlRead != nil {
		_ = controlRead.Close()
	}
	done, killerDone := make(chan struct{}), make(chan struct{})
	cleanupUncertain := false
	go func() {
		defer close(killerDone)
		select {
		case <-executionCtx.Done():
			if controlWrite == nil {
				terminateProcess(command.Process, e.grace)
				return
			}
			_ = controlWrite.Close()
			cleanup := time.NewTimer(5 * time.Second)
			defer cleanup.Stop()
			select {
			case <-done:
			case <-cleanup.C:
				cleanupUncertain = true
				_ = command.Process.Kill()
			}
		case <-done:
			killProcessGroup(command.Process)
		}
	}()
	waitErr := command.Wait()
	close(done)
	<-killerDone
	result.Stdout, result.Stderr = stdout.Output(), stderr.Output()
	result.CleanupUncertain = cleanupUncertain
	cause := context.Cause(executionCtx)
	result.TimedOut = errors.Is(cause, ErrTimeout)
	result.Aborted = cause != nil && !result.TimedOut
	result.Signal = processSignal(command.ProcessState)
	if command.ProcessState != nil {
		if code := command.ProcessState.ExitCode(); code >= 0 {
			result.ExitCode = &code
		}
	}
	if e.windowsACL && strings.Contains(result.Stderr.Text, "windows-acl-run:") && (result.ExitCode == nil || *result.ExitCode == 127) {
		if cause != nil {
			cause = errors.Join(cause, errors.New("shell: Windows sandbox runner failed; inspect cleanup diagnostics"))
		} else {
			return result, errors.New("shell: Windows sandbox runner failed; inspect cleanup diagnostics")
		}
	}
	if cause != nil {
		if cleanupUncertain {
			cause = errors.Join(cause, errors.New("shell: forced Windows runner termination; ACL cleanup uncertain"))
		}
		return result, cause
	}
	if waitErr != nil {
		var exitError *exec.ExitError
		if !errors.As(waitErr, &exitError) {
			return result, fmt.Errorf("shell: wait for command: %w", waitErr)
		}
	}
	return result, nil
}

// CheckConfinement validates the immutable strict configuration and probes only
// a fixed trusted runtime command. It never executes the proposed shell body.
// This is admission evidence, not a claim that a future child already exists;
// Run revalidates and must fail closed before launching every candidate command.
func (e *LocalExecutor) CheckConfinement(ctx context.Context) error {
	if ctx == nil {
		return errors.New("shell: confinement check requires context")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if e == nil || e.sandbox == nil {
		return errors.New("shell: strict confinement is not configured")
	}
	if e.windowsACL {
		return errors.New("shell: partial Windows ACL cannot attest strict read/network confinement")
	}
	if err := e.verifyWorkspace(); err != nil {
		return err
	}
	if _, err := e.sandbox.Confine([]string{"/usr/bin/true"}); err != nil {
		return err
	}
	return ctx.Err()
}

// Startup arguments are fixed; a tool request only supplies the command body.
func shellCommand(executable, command, platform string) []string {
	if platform == "windows" {
		return []string{executable, "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command}
	}
	return []string{executable, "--noprofile", "--norc", "-c", command}
}

// CheckCWD validates the exact launch workspace, including its original identity.
// Windows shell-only composition uses this in place of unsupported file tools.
func (e *LocalExecutor) CheckCWD(cwd string) error {
	if err := e.verifyWorkspace(); err != nil {
		return err
	}
	if !filepath.IsAbs(cwd) {
		return errors.New("shell: session cwd must be absolute")
	}
	resolved, err := filepath.EvalSymlinks(cwd)
	if err != nil {
		return fmt.Errorf("shell: session cwd: %w", err)
	}
	rel, err := filepath.Rel(e.cwd, resolved)
	if err != nil || rel != "." {
		return errors.New("shell: session cwd differs from configured workspace")
	}
	return nil
}
