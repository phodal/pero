package shell

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// One stdio connection owns exactly one foreground process. Its logical ID
// is scoped to that connection. Output notifications precede process/closed.
type execServerMessage struct {
	ID     int
	Method string
	Result struct {
		ProcessID string
		SessionID string
	}
	Error  *struct{ Message string }
	Params struct {
		ProcessID string
		Stream    string
		Chunk     []byte
		ExitCode  *int
	}
}

type execServerStart struct {
	ProcessID string            `json:"processId"`
	Argv      []string          `json:"argv"`
	CWD       string            `json:"cwd"`
	Env       map[string]string `json:"env"`
	TTY       bool              `json:"tty"`
	// Codex requires all fields when a policy is supplied. Tool environment
	// comes exclusively from Pero's approved environment snapshot.
	EnvPolicy json.RawMessage `json:"envPolicy"`
}

// WithExecServer selects an operator-installed broker for foreground calls only.
// Reuse the validated workspace, limits and sandbox of the local executor.
func (e *LocalExecutor) WithExecServer(path string) (*LocalExecutor, error) {
	if !platformSupported() || !filepath.IsAbs(path) {
		return nil, errors.New("shell: exec-server requires Unix and an absolute Codex executable")
	}
	binary, err := filepath.EvalSymlinks(path)
	if err != nil {
		return nil, err
	}
	if _, err := exec.LookPath(binary); err != nil {
		return nil, err
	}
	rel, err := filepath.Rel(e.cwd, binary)
	if err != nil || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
		return nil, errors.New("shell: exec-server must be installed outside the workspace")
	}
	foreground := *e
	foreground.execServer = binary
	return &foreground, nil
}

func (e *LocalExecutor) runExecServer(ctx context.Context, cancel context.CancelCauseFunc, spec ExecSpec, argv, env []string, result RunResult) (receipt RunResult, err error) {
	// The broker starts outside the workspace with no provider credentials.
	// Only the prepared (possibly sandbox-wrapped) argv receives the tool env.
	broker := exec.Command(e.execServer, "exec-server", "--listen", "stdio")
	broker.Dir, broker.Env = "/", []string{"PATH=/usr/bin:/bin"}
	input, err := broker.StdinPipe()
	if err != nil {
		return result, err
	}
	defer input.Close()
	output, err := broker.StdoutPipe()
	if err != nil {
		return result, err
	}
	defer output.Close()
	if err := broker.Start(); err != nil {
		return result, err
	}
	done := make(chan struct{})
	drainExpired := false
	defer func() {
		close(done)
		input.Close()
		output.Close()
		timer := time.AfterFunc(2*time.Second, func() { _ = broker.Process.Kill() })
		waitErr := broker.Wait()
		timer.Stop()
		if waitErr != nil {
			err = errors.Join(err, fmt.Errorf("exec-server exit: %w", waitErr))
		} else if drainExpired {
			// Closing the owning stdio connection reaps the process group
			// even when process/terminate considers the leader already exited.
			receipt.CleanupUncertain = false
		}
	}()
	encoder := json.NewEncoder(input)
	send := func(id int, method string, params any) error {
		return encoder.Encode(struct {
			ID     int    `json:"id,omitempty"`
			Method string `json:"method"`
			Params any    `json:"params"`
		}{id, method, params})
	}
	events := make(chan execServerMessage)
	readErr := make(chan error, 1)
	go func() {
		reader := bufio.NewScanner(output)
		reader.Buffer(make([]byte, 4096), 1<<20)
		for reader.Scan() {
			var msg execServerMessage
			if err := json.Unmarshal(reader.Bytes(), &msg); err != nil {
				readErr <- err
				return
			}
			select {
			case events <- msg:
			case <-done:
				return
			}
		}
		readErr <- errors.Join(errors.New("exec-server closed before process receipt"), reader.Err())
	}()
	if err := send(1, "initialize", map[string]string{"clientName": "pero-harness"}); err != nil {
		return result, err
	}
	stdout, stderr := newTailWriter(spec.StdoutMaxBytes), newTailWriter(e.maxOutputBytes)
	sink := foregroundOutputSink{writer: e.outputSink, cancel: cancel}
	startSent, closed := false, false
	defer func() {
		receipt.Stdout, receipt.Stderr = stdout.Output(), stderr.Output()
		receipt.CleanupUncertain = startSent && !closed
		if cause := context.Cause(ctx); cause != nil {
			receipt.TimedOut = errors.Is(cause, ErrTimeout)
			receipt.Aborted = !receipt.TimedOut
			err = errors.Join(cause, err)
		}
	}()
	cancelled := ctx.Done()
	var deadline, drainDeadline <-chan time.Time
	for {
		select {
		case <-cancelled:
			if !startSent {
				return result, nil
			}
			if err := send(3, "process/terminate", map[string]string{"processId": "shell"}); err != nil {
				return result, err
			}
			cancelled = nil
			timer := time.NewTimer(time.Second)
			defer timer.Stop()
			deadline = timer.C
		case <-deadline:
			return result, errors.New("exec-server did not confirm termination")
		case <-drainDeadline:
			drainExpired = true
			// Match exec.Cmd: a nonzero exit remains the primary result.
			if *result.ExitCode == 0 && context.Cause(ctx) == nil {
				return result, fmt.Errorf("shell: wait for command: %w", exec.ErrWaitDelay)
			}
			return result, nil
		case err := <-readErr:
			return result, err
		case msg := <-events:
			if msg.Error != nil {
				return result, fmt.Errorf("exec-server request %d: %s", msg.ID, msg.Error.Message)
			}
			switch {
			case msg.ID == 1:
				if msg.Result.SessionID == "" {
					return result, errors.New("exec-server missing session ID")
				}
				if err := send(0, "initialized", struct{}{}); err != nil {
					return result, err
				}
				if ctx.Err() != nil {
					return result, nil
				}
				variables := make(map[string]string, len(env))
				for _, entry := range env {
					k, v, _ := strings.Cut(entry, "=")
					variables[k] = v
				}
				params := execServerStart{
					ProcessID: "shell", Argv: argv, Env: variables,
					CWD:       (&url.URL{Scheme: "file", Path: spec.Workdir}).String(),
					EnvPolicy: json.RawMessage(`{"inherit":"none","ignoreDefaultExcludes":false,"exclude":[],"set":{},"includeOnly":[]}`),
				}
				if err := send(2, "process/start", params); err != nil {
					return result, err
				}
				startSent = true
			case msg.ID == 2:
				if msg.Result.ProcessID != "shell" {
					return result, errors.New("exec-server process identity mismatch")
				}
				if e.processStarted != nil {
					e.processStarted()
				}
			case msg.Params.ProcessID == "shell":
				switch msg.Method {
				case "process/output":
					switch msg.Params.Stream {
					case "stdout":
						stdout.Write(msg.Params.Chunk)
					case "stderr":
						stderr.Write(msg.Params.Chunk)
					default:
						return result, errors.New("exec-server unexpected output stream")
					}
					if e.outputSink != nil {
						_, _ = sink.Write(msg.Params.Chunk)
					}
				case "process/exited":
					if msg.Params.ExitCode == nil {
						return result, errors.New("exec-server missing exit code")
					}
					result.ExitCode = msg.Params.ExitCode
					drain := time.NewTimer(e.grace)
					defer drain.Stop()
					drainDeadline = drain.C
				case "process/closed":
					if result.ExitCode == nil {
						return result, errors.New("exec-server missing exit receipt")
					}
					closed = true
					return result, nil
				}
			}
		}
	}
}
