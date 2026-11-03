package shell

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Terminal owns one PTY process and a bounded, cursor-addressed output tail.
// Process handles are live-only: historical receipts never recreate a process.
type Terminal struct {
	mu          sync.Mutex
	input       sync.Mutex
	master      *os.File
	command     *exec.Cmd
	cancel      context.CancelCauseFunc
	done        chan struct{}
	changed     chan struct{}
	output      []byte
	total       int64
	capacity    int
	result      *RunResult
	failure     string
	inputClosed bool
}

type TerminalRead struct {
	Output        string     `json:"output"`
	Offset        int64      `json:"offset"`
	NextOffset    int64      `json:"next_offset"`
	AvailableFrom int64      `json:"available_from"`
	TotalBytes    int64      `json:"total_bytes"`
	Truncated     bool       `json:"truncated"`
	Running       bool       `json:"running"`
	InputClosed   bool       `json:"input_closed"`
	Result        *RunResult `json:"result,omitempty"`
	Error         string     `json:"error,omitempty"`
}

func (e *LocalExecutor) SupportsTerminal() bool {
	return e != nil && terminalSupported() && e.sandbox == nil && !e.windowsACL
}

// StartTerminal reuses Resolve, the configured executable/environment and the
// process-group termination contract. Sandbox profiles require separate PTY
// device admission and are deliberately not exposed through this method.
func (e *LocalExecutor) StartTerminal(ctx context.Context, request ExecRequest, rows, columns int) (*Terminal, error) {
	if !e.SupportsTerminal() {
		return nil, errors.New("shell: PTY unavailable for this platform or configured sandbox")
	}
	if ctx == nil {
		return nil, errors.New("shell: terminal requires an owning context")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	spec, err := e.Resolve(request)
	if err != nil {
		return nil, err
	}
	if spec.OnExpiry != ExpiryKill {
		return nil, errors.New("shell: terminals require a bounded lifetime")
	}
	master, slave, err := openTerminal(rows, columns)
	if err != nil {
		return nil, fmt.Errorf("shell: open PTY: %w", err)
	}
	argv := shellCommand(e.shell, spec.Command, "unix")
	command := exec.Command(argv[0], argv[1:]...)
	command.Dir, command.Env = spec.Workdir, append([]string(nil), e.baseEnv...)
	command.Stdin, command.Stdout, command.Stderr = slave, slave, slave
	configureTerminalProcess(command)
	if err := e.verifyWorkspace(); err != nil {
		master.Close()
		slave.Close()
		return nil, err
	}
	if err := command.Start(); err != nil {
		master.Close()
		slave.Close()
		return nil, fmt.Errorf("shell: start PTY: %w", err)
	}
	slave.Close()
	owner, cancel := context.WithCancelCause(ctx)
	terminal := &Terminal{master: master, command: command, cancel: cancel, done: make(chan struct{}), changed: make(chan struct{}), capacity: spec.StdoutMaxBytes}
	timer := time.AfterFunc(spec.Timeout, func() { cancel(ErrTimeout) })
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		buffer := make([]byte, 4096)
		for {
			count, err := master.Read(buffer)
			if count > 0 {
				terminal.append(buffer[:count])
			}
			if err != nil {
				return
			}
		}
	}()
	go func() {
		waitDone := make(chan error, 1)
		go func() { waitDone <- command.Wait() }()
		var waitErr error
		select {
		case waitErr = <-waitDone:
			killProcessGroup(command.Process)
		case <-owner.Done():
			terminateProcess(command.Process, e.grace)
			waitErr = <-waitDone
		}
		timer.Stop()
		// Collect queued output before closing the master. The finite grace also
		// bounds an escaped descriptor holder, matching foreground WaitDelay.
		readTimer := time.NewTimer(e.grace)
		select {
		case <-readDone:
		case <-readTimer.C:
			master.Close()
			<-readDone
		}
		readTimer.Stop()
		master.Close()
		result := RunResult{Timeout: spec.Timeout, Signal: processSignal(command.ProcessState)}
		if command.ProcessState != nil {
			if code := command.ProcessState.ExitCode(); code >= 0 {
				result.ExitCode = &code
			}
		}
		cause := context.Cause(owner)
		result.TimedOut, result.Aborted = errors.Is(cause, ErrTimeout), cause != nil && !errors.Is(cause, ErrTimeout)
		failure := ""
		var exitError *exec.ExitError
		if waitErr != nil && !errors.As(waitErr, &exitError) {
			failure = waitErr.Error()
		}
		if cause != nil {
			failure = cause.Error()
		}
		terminal.mu.Lock()
		terminal.result, terminal.failure = &result, failure
		terminal.notifyLocked()
		terminal.mu.Unlock()
		close(terminal.done)
		cancel(nil)
	}()
	return terminal, nil
}

func (t *Terminal) notifyLocked() { close(t.changed); t.changed = make(chan struct{}) }
func (t *Terminal) append(data []byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.total += int64(len(data))
	if len(data) >= t.capacity {
		t.output = append(t.output[:0], data[len(data)-t.capacity:]...)
	} else {
		if excess := len(t.output) + len(data) - t.capacity; excess > 0 {
			t.output = t.output[excess:]
		}
		t.output = append(t.output, data...)
	}
	t.notifyLocked()
}

// Read waits for an observable output/exit transition, never a timed poll.
func (t *Terminal) Read(ctx context.Context, offset int64, limit int, wait time.Duration) (TerminalRead, error) {
	if offset < 0 || limit < 1 || limit > 16<<10 || wait < 0 || wait > time.Second {
		return TerminalRead{}, errors.New("shell: invalid terminal read window")
	}
	t.mu.Lock()
	if offset > t.total {
		t.mu.Unlock()
		return TerminalRead{}, errors.New("shell: terminal offset exceeds collected output")
	}
	if wait > 0 && offset == t.total && t.result == nil {
		changed := t.changed
		t.mu.Unlock()
		timer := time.NewTimer(wait)
		select {
		case <-changed:
		case <-ctx.Done():
			timer.Stop()
			return TerminalRead{}, ctx.Err()
		case <-timer.C:
		}
		timer.Stop()
		t.mu.Lock()
	}
	defer t.mu.Unlock()
	first := t.total - int64(len(t.output))
	truncated := offset < first
	if offset < first {
		offset = first
	}
	end := min(t.total, offset+int64(limit))
	value := TerminalRead{Output: strings.ToValidUTF8(string(t.output[offset-first:end-first]), "�"), Offset: offset, NextOffset: end, AvailableFrom: first, TotalBytes: t.total, Truncated: truncated, Running: t.result == nil, InputClosed: t.inputClosed, Error: t.failure}
	if t.result != nil {
		copy := *t.result
		value.Result = &copy
	}
	return value, nil
}

func (t *Terminal) Write(ctx context.Context, data string, eof bool) (int, error) {
	if len(data) > 16<<10 || strings.ContainsRune(data, 0) {
		return 0, errors.New("shell: terminal input must be NUL-free and at most 16 KiB")
	}
	t.input.Lock()
	defer t.input.Unlock()
	t.mu.Lock()
	closed := t.inputClosed || t.result != nil
	t.mu.Unlock()
	if closed {
		return 0, errors.New("shell: terminal input is closed or process exited")
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	if err := t.master.SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
		return 0, err
	}
	payload := []byte(data)
	if eof {
		payload = append(payload, 4, 4)
	} // canonical EOF, including a partial line
	count, err := t.master.Write(payload)
	if eof && err == nil {
		t.mu.Lock()
		t.inputClosed = true
		t.mu.Unlock()
	}
	return min(count, len(data)), err
}
func (t *Terminal) Resize(rows, columns int) error { return resizeTerminal(t.master, rows, columns) }
func (t *Terminal) Stop(ctx context.Context) error {
	t.cancel(context.Canceled)
	select {
	case <-t.done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (t *Terminal) Done() <-chan struct{} { return t.done }
