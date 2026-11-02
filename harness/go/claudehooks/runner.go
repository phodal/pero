package claudehooks

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const maxOutputBytes = 64 << 10

var ErrOutputLimit = errors.New("claudehooks: hook output exceeds 64 KiB")

type Runner struct {
	Shell       string
	Environment []string
}

// Run executes one explicitly authorized foreground command hook. It never
// inherits the process environment or starts detached async work.
func (runner Runner) Run(ctx context.Context, hook Hook, input Input) (Decision, error) {
	if ctx == nil {
		return Decision{}, errors.New("claudehooks: execution context is required")
	}
	if err := ctx.Err(); err != nil {
		return Decision{}, err
	}
	if !hookProcessSupported() {
		return Decision{}, errors.New("claudehooks: process-tree ownership is unsupported on this platform")
	}
	if hook.Async {
		return Decision{}, errors.New("claudehooks: asynchronous hooks are not supported by the foreground runner")
	}
	if hook.Event == "" || (input.Event != "" && input.Event != hook.Event) {
		return Decision{}, errors.New("claudehooks: hook event and input must match")
	}
	input.Event = hook.Event
	if !filepath.IsAbs(input.CWD) {
		return Decision{}, errors.New("claudehooks: an explicit absolute working directory is required")
	}
	if strings.TrimSpace(hook.Command) == "" {
		return Decision{}, errors.New("claudehooks: command is required")
	}
	for _, entry := range runner.Environment {
		name, value, valid := strings.Cut(entry, "=")
		if !valid || name == "" || strings.ContainsAny(name+value, "\x00") {
			return Decision{}, errors.New("claudehooks: invalid explicit environment binding")
		}
	}
	timeout := hook.Timeout
	if timeout == 0 {
		timeout = 600 * time.Second
		if hook.Event == "UserPromptSubmit" || hook.Event == "PreModelSwitch" {
			timeout = 30 * time.Second
		} else if hook.Event == "SessionEnd" {
			timeout = 1500 * time.Millisecond
		}
	}
	if timeout < 0 {
		return Decision{}, errors.New("claudehooks: timeout must be positive")
	}
	deadline, cancelDeadline := context.WithTimeout(ctx, timeout)
	defer cancelDeadline()
	execution, cancelExecution := context.WithCancelCause(deadline)
	defer cancelExecution(nil)
	program, args := hook.Command, hook.Args
	if !hook.ExecForm {
		if len(hook.Args) > 0 {
			return Decision{}, errors.New("claudehooks: hook args require executable form")
		}
		if !filepath.IsAbs(runner.Shell) {
			return Decision{}, errors.New("claudehooks: shell form requires an explicit absolute shell executable")
		}
		program, args = runner.Shell, []string{"-c", hook.Command}
		if filepath.Base(program) == "bash" {
			args = []string{"--noprofile", "--norc", "-c", hook.Command}
		}
	}
	program, err := runner.executable(program, input.CWD)
	if err != nil {
		return Decision{}, err
	}
	payload, err := json.Marshal(input)
	if err != nil {
		return Decision{}, fmt.Errorf("claudehooks: invalid hook input: %w", err)
	}
	command := exec.CommandContext(execution, program, args...)
	command.Dir = input.CWD
	command.Env = append([]string{}, runner.Environment...)
	command.Stdin = bytes.NewReader(append(payload, '\n'))
	stdout := &limitedOutput{cancel: cancelExecution}
	stderr := &limitedOutput{cancel: cancelExecution}
	command.Stdout, command.Stderr = stdout, stderr
	command.WaitDelay = 250 * time.Millisecond
	configureHookProcess(command)
	defer cleanupHookProcess(command)
	if err := command.Run(); err != nil {
		if cause := context.Cause(execution); cause != nil {
			return Decision{}, cause
		}
		var exitError *exec.ExitError
		if !errors.As(err, &exitError) {
			return Decision{}, fmt.Errorf("claudehooks: hook process failed: %w", err)
		}
		return ParseDecision(hook.Event, stdout.Bytes(), stderr.Bytes(), exitError.ExitCode())
	}
	if cause := context.Cause(execution); cause != nil {
		return Decision{}, cause
	}
	return ParseDecision(hook.Event, stdout.Bytes(), stderr.Bytes(), 0)
}

func (runner Runner) executable(program, cwd string) (string, error) {
	if filepath.IsAbs(program) {
		return program, nil
	}
	if strings.ContainsRune(program, filepath.Separator) {
		return filepath.Join(cwd, program), nil
	}
	var pathValue string
	for _, entry := range runner.Environment {
		if value, found := strings.CutPrefix(entry, "PATH="); found {
			pathValue = value
		}
	}
	for _, directory := range filepath.SplitList(pathValue) {
		if !filepath.IsAbs(directory) {
			continue
		}
		candidate := filepath.Join(directory, program)
		info, err := os.Stat(candidate)
		if err == nil && info.Mode().IsRegular() && info.Mode().Perm()&0111 != 0 {
			return candidate, nil
		}
		if err != nil && !errors.Is(err, fs.ErrNotExist) && !errors.Is(err, fs.ErrPermission) {
			return "", fmt.Errorf("claudehooks: inspect explicit executable path: %w", err)
		}
	}
	return "", errors.New("claudehooks: executable was not found in the explicit PATH")
}

type limitedOutput struct {
	buffer bytes.Buffer
	cancel context.CancelCauseFunc
}

func (output *limitedOutput) Bytes() []byte { return output.buffer.Bytes() }

func (output *limitedOutput) Write(data []byte) (int, error) {
	size := len(data)
	remaining := maxOutputBytes - output.buffer.Len()
	if len(data) > remaining {
		_, _ = output.buffer.Write(data[:remaining])
		output.cancel(ErrOutputLimit)
	} else {
		_, _ = output.buffer.Write(data)
	}
	return size, nil
}
