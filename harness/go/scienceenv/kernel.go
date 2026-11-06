// Package scienceenv runs persistent Python, R, and repl kernels.
//
// python and repl are separate Python processes. Only repl installs the host
// module, and host.mcp calls the handler for that cell. R is a third process.
// A killed kernel discards its state; the next cell starts a fresh process.
package scienceenv

import (
	"bufio"
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

//go:embed worker_python.py worker_r.R
var workers embed.FS

// Language selects the persistent process a cell runs in.
type Language string

const (
	Python Language = "python"
	R      Language = "r"
	Repl   Language = "repl"
)

const (
	defaultOutputLimit = 256 << 10
	maxFrameBytes      = 2 << 20
	maxMCPCalls        = 64
	maxCodeBytes       = 1 << 20
)

// MCPCall is one host.mcp request from the repl kernel.
type MCPCall struct {
	Server    string          `json:"server"`
	Tool      string          `json:"tool"`
	Arguments json.RawMessage `json:"arguments"`
}

// Output is the cell's captured streams. Error is a language exception, not a
// dead process. A dead process returns from Exec as an error and discards state.
type Output struct {
	Stdout string `json:"stdout"`
	Stderr string `json:"stderr"`
	Error  string `json:"error,omitempty"`
}

// MCPHandler answers one repl host.mcp call. Nil refuses the call.
type MCPHandler func(context.Context, MCPCall) (json.RawMessage, error)

// Host is the cell's view of the supervisor. Python has email and artifact
// lookup. Only repl has MCP.
type Host struct {
	MCP          MCPHandler
	Email        func() (string, error)
	ArtifactPath func(versionID string) (string, error)
}

// Config is the interpreter and directory for one kernel process.
type Config struct {
	Language    Language
	Interpreter string
	Workspace   string
	OutputLimit int
	Env         []string
}

// Kernel evaluates one cell at a time in a persistent process.
type Kernel struct {
	mu       sync.Mutex
	cfg      Config
	cmd      *exec.Cmd
	stdin    *bufio.Writer
	stdinRaw io.WriteCloser
	stdout   *bufio.Reader
	stderr   *limitedBuffer
	exited   chan error
	dir      string
	closed   bool
	dead     bool
	proc     *os.Process
}

// Start launches the interpreter. The process stays up across Exec calls.
func Start(cfg Config) (*Kernel, error) {
	if cfg.Language != Python && cfg.Language != R && cfg.Language != Repl {
		return nil, errors.New("science kernel language must be python, r, or repl")
	}
	if cfg.Interpreter == "" {
		return nil, errors.New("science kernel requires an interpreter")
	}
	workspace, err := filepath.Abs(cfg.Workspace)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(workspace)
	if err != nil || !info.IsDir() {
		return nil, fmt.Errorf("science kernel workspace must be a directory")
	}
	cfg.Workspace = workspace
	if cfg.OutputLimit <= 0 {
		cfg.OutputLimit = defaultOutputLimit
	}
	if cfg.OutputLimit > maxFrameBytes/2 {
		return nil, errors.New("science kernel output limit is too large")
	}
	kernel := &Kernel{cfg: cfg}
	if err := kernel.start(); err != nil {
		return nil, err
	}
	return kernel, nil
}

func (k *Kernel) start() error {
	k.stopProcess()
	dir, err := os.MkdirTemp("", "pero-science-")
	if err != nil {
		return err
	}
	script := "worker_python.py"
	args := []string{"-X", "utf8"}
	if k.cfg.Language == R {
		script = "worker_r.R"
		args = []string{"--vanilla"}
	}
	body, err := workers.ReadFile(script)
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	path := filepath.Join(dir, script)
	if err := os.WriteFile(path, body, 0o700); err != nil {
		os.RemoveAll(dir)
		return err
	}
	args = append(args, path)
	cmd := exec.Command(k.cfg.Interpreter, args...)
	cmd.Dir = k.cfg.Workspace
	cmd.Env = kernelEnv(k.cfg.Env, k.cfg.Language == Repl, k.cfg.OutputLimit)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		os.RemoveAll(dir)
		return err
	}
	if err := cmd.Start(); err != nil {
		os.RemoveAll(dir)
		return err
	}
	k.cmd = cmd
	k.proc = cmd.Process
	k.stdinRaw = stdin
	k.stdin = bufio.NewWriter(stdin)
	k.stdout = bufio.NewReader(stdout)
	stderrBuf := &limitedBuffer{max: 8 << 10}
	k.stderr = stderrBuf
	k.dir = dir
	k.dead = false
	k.exited = make(chan error, 1)
	go func() { _, _ = io.Copy(stderrBuf, stderr) }()
	go func() { k.exited <- cmd.Wait() }()
	return nil
}

func kernelEnv(base []string, repl bool, limit int) []string {
	if base == nil {
		base = os.Environ()
	}
	env := make([]string, 0, len(base)+3)
	for _, item := range base {
		if strings.HasPrefix(item, "PERO_SCIENCE_REPL=") || strings.HasPrefix(item, "PERO_SCIENCE_OUTPUT_BYTES=") {
			continue
		}
		env = append(env, item)
	}
	env = append(env, "PYTHONUNBUFFERED=1", "PYTHONIOENCODING=utf-8", "PERO_SCIENCE_OUTPUT_BYTES="+strconv.Itoa(limit))
	if repl {
		env = append(env, "PERO_SCIENCE_REPL=1")
	}
	return env
}

// Exec runs one cell. Canceling ctx kills the process.
func (k *Kernel) Exec(ctx context.Context, code string, host Host) (Output, error) {
	return k.roundTrip(ctx, "EXEC", code, host)
}

// Load executes a skill sidecar whose top level is only functions, imports,
// and constants. It uses the same persistent process as Exec.
func (k *Kernel) Load(ctx context.Context, source string, host Host) (Output, error) {
	if k.cfg.Language == R {
		return Output{}, errors.New("science skills load into the python kernel")
	}
	return k.roundTrip(ctx, "LOAD", source, host)
}

func (k *Kernel) roundTrip(ctx context.Context, op, body string, host Host) (Output, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.closed {
		return Output{}, errors.New("science kernel is closed")
	}
	if len(body) == 0 || len(body) > maxCodeBytes {
		return Output{}, errors.New("science kernel cell must be 1 byte to 1 MiB")
	}
	if k.dead || k.cmd == nil {
		if err := k.start(); err != nil {
			return Output{}, err
		}
	}
	proc := k.proc
	watch, stop := context.WithCancel(context.Background())
	defer stop()
	go func() {
		select {
		case <-ctx.Done():
			if proc != nil {
				_ = proc.Kill()
			}
		case <-watch.Done():
		}
	}()
	if err := writeFrame(k.stdin, op, []byte(body)); err != nil {
		k.halt()
		return Output{}, k.down(err)
	}
	calls := 0
	for {
		kind, payload, err := readFrame(k.stdout, maxFrameBytes)
		if err != nil {
			k.halt()
			if ctx.Err() != nil {
				return Output{}, k.down(ctx.Err())
			}
			return Output{}, k.down(err)
		}
		switch kind {
		case "MCP", "HOST":
			calls++
			if err := writeFrame(k.stdin, "MCPRESULT", hostResult(ctx, host, calls, payload)); err != nil {
				k.halt()
				return Output{}, k.down(err)
			}
		case "RESULT":
			var out Output
			if err := json.Unmarshal(payload, &out); err != nil {
				k.halt()
				return Output{}, k.down(err)
			}
			return out, nil
		default:
			k.halt()
			return Output{}, k.down(fmt.Errorf("unexpected frame %s", kind))
		}
	}
}

func hostResult(ctx context.Context, host Host, calls int, payload []byte) []byte {
	fail := func(message string) []byte {
		encoded, _ := json.Marshal(struct {
			OK    bool   `json:"ok"`
			Error string `json:"error"`
		}{false, message})
		return encoded
	}
	if calls > maxMCPCalls {
		return fail("too many host calls in one cell")
	}
	var request struct {
		Method    string          `json:"method"`
		Server    string          `json:"server"`
		Tool      string          `json:"tool"`
		Arguments json.RawMessage `json:"arguments"`
		VersionID string          `json:"version_id"`
	}
	if json.Unmarshal(payload, &request) != nil {
		return fail("host call was not JSON")
	}
	if request.Method == "" {
		request.Method = "mcp"
	}
	var value json.RawMessage
	var err error
	switch request.Method {
	case "mcp":
		if host.MCP == nil {
			return fail("host.mcp is available only in the repl kernel")
		}
		if strings.TrimSpace(request.Server) == "" || strings.TrimSpace(request.Tool) == "" {
			return fail("host.mcp requires a server and a tool")
		}
		if len(request.Arguments) == 0 {
			request.Arguments = json.RawMessage(`{}`)
		}
		value, err = host.MCP(ctx, MCPCall{Server: request.Server, Tool: request.Tool, Arguments: request.Arguments})
	case "get_user_email":
		email := ""
		if host.Email != nil {
			email, err = host.Email()
		}
		if err == nil {
			if strings.TrimSpace(email) == "" {
				value = json.RawMessage("null")
			} else {
				value, err = json.Marshal(email)
			}
		}
	case "artifact_path":
		if host.ArtifactPath == nil {
			return fail("artifacts are not available")
		}
		var path string
		path, err = host.ArtifactPath(request.VersionID)
		if err == nil {
			value, err = json.Marshal(path)
		}
	default:
		return fail("unknown host method " + request.Method)
	}
	if err != nil {
		return fail(err.Error())
	}
	if len(value) == 0 {
		value = json.RawMessage("null")
	}
	if !json.Valid(value) {
		return fail("host result was not JSON")
	}
	encoded, err := json.Marshal(struct {
		OK    bool            `json:"ok"`
		Value json.RawMessage `json:"value"`
	}{true, value})
	if err != nil {
		return fail("host result could not be encoded")
	}
	return encoded
}

func (k *Kernel) down(err error) error {
	tail := strings.TrimSpace(k.stderr.String())
	if tail == "" {
		return fmt.Errorf("%s kernel stopped: %w; its state was discarded", k.cfg.Language, err)
	}
	if len(tail) > 500 {
		tail = tail[len(tail)-500:]
	}
	return fmt.Errorf("%s kernel stopped: %w; its state was discarded (%s)", k.cfg.Language, err, tail)
}

func (k *Kernel) halt() {
	k.dead = true
	if k.proc != nil {
		_ = k.proc.Kill()
	}
}

func (k *Kernel) stopProcess() {
	if k.stdinRaw != nil {
		_ = k.stdinRaw.Close()
		k.stdinRaw = nil
		k.stdin = nil
	}
	if k.proc != nil {
		_ = k.proc.Kill()
		k.proc = nil
	}
	if k.exited != nil {
		<-k.exited
		k.exited = nil
	}
	k.cmd = nil
	k.stdout = nil
	if k.dir != "" {
		_ = os.RemoveAll(k.dir)
		k.dir = ""
	}
}

// Close kills the process and refuses later cells.
func (k *Kernel) Close() error {
	if k == nil {
		return nil
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	k.closed = true
	k.dead = true
	k.stopProcess()
	return nil
}

func writeFrame(w *bufio.Writer, kind string, payload []byte) error {
	if w == nil {
		return errors.New("science kernel is not running")
	}
	if _, err := fmt.Fprintf(w, "%s %d\n", kind, len(payload)); err != nil {
		return err
	}
	if _, err := w.Write(payload); err != nil {
		return err
	}
	return w.Flush()
}

func readFrame(r *bufio.Reader, max int) (string, []byte, error) {
	if r == nil {
		return "", nil, errors.New("science kernel is not running")
	}
	line, err := r.ReadString('\n')
	if err != nil {
		return "", nil, err
	}
	line = strings.TrimRight(line, "\r\n")
	kind, rest, ok := strings.Cut(line, " ")
	if !ok || kind == "" {
		return "", nil, errors.New("science kernel sent a malformed frame")
	}
	n, err := strconv.Atoi(rest)
	if err != nil || n < 0 || n > max {
		return "", nil, fmt.Errorf("science kernel sent frame %s with an invalid length", kind)
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return "", nil, err
	}
	return kind, buf, nil
}

type limitedBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
	max int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.buf.Len() >= b.max {
		return len(p), nil
	}
	room := b.max - b.buf.Len()
	if len(p) > room {
		p = p[:room]
	}
	_, _ = b.buf.Write(p)
	return len(p), nil
}

func (b *limitedBuffer) String() string {
	if b == nil {
		return ""
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}
