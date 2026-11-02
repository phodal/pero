package lsp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

const maxMessageBytes = 16 << 20

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}
type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}
type rpcReply struct {
	value json.RawMessage
	err   error
}
type rpcWrite struct {
	frame []byte
	done  chan error
}
type connection struct {
	command      *exec.Cmd
	stdin        io.WriteCloser
	mu           sync.Mutex
	sequence     uint64
	pending      map[string]chan rpcReply
	closed       chan struct{}
	exited       chan struct{}
	writes       chan rpcWrite
	err          error
	once         sync.Once
	closeOnce    sync.Once
	settings     JSONValue
	workspaceURI string
	workers      sync.WaitGroup
}

func startConnection(command *exec.Cmd, settings JSONValue, workspaceURI string) (*connection, error) {
	if !processSupported() {
		return nil, errors.New("lsp: managed stdio language servers are unsupported on this platform")
	}
	input, err := command.StdinPipe()
	if err != nil {
		return nil, errors.New("lsp: could not create server input")
	}
	output, err := command.StdoutPipe()
	if err != nil {
		input.Close()
		return nil, errors.New("lsp: could not create server output")
	}
	command.Stderr = io.Discard
	command.WaitDelay = 250 * time.Millisecond
	configureProcess(command)
	if err := command.Start(); err != nil {
		input.Close()
		output.Close()
		return nil, errors.New("lsp: selected language server could not be started")
	}
	c := &connection{command: command, stdin: input, pending: map[string]chan rpcReply{}, closed: make(chan struct{}), exited: make(chan struct{}), writes: make(chan rpcWrite), settings: settings, workspaceURI: workspaceURI}
	go func() {
		_ = command.Wait()
		cleanupProcess(command)
		c.abort(errors.New("lsp: language server exited"))
		close(c.exited)
	}()
	c.workers.Add(2)
	go func() { defer c.workers.Done(); c.writeLoop() }()
	go func() { defer c.workers.Done(); c.readLoop(bufio.NewReader(output)) }()
	return c, nil
}

func (c *connection) abort(reason error) {
	c.once.Do(func() {
		c.mu.Lock()
		c.err = reason
		for id, pending := range c.pending {
			pending <- rpcReply{err: reason}
			delete(c.pending, id)
		}
		close(c.closed)
		c.mu.Unlock()
		_ = c.stdin.Close()
		killProcess(c.command)
	})
}
func (c *connection) live() bool {
	select {
	case <-c.closed:
		return false
	default:
		return true
	}
}

func (c *connection) writeLoop() {
	for {
		select {
		case <-c.closed:
			return
		case item := <-c.writes:
			_, err := c.stdin.Write(item.frame)
			item.done <- err
			if err != nil {
				c.abort(errors.New("lsp: language server input failed"))
				return
			}
		}
	}
}
func (c *connection) send(ctx context.Context, message rpcMessage) error {
	raw, err := json.Marshal(message)
	if err != nil {
		return errors.New("lsp: could not encode protocol message")
	}
	if len(raw) > maxMessageBytes {
		return errors.New("lsp: outgoing protocol message exceeds the supported size")
	}
	item := rpcWrite{frame: append([]byte(fmt.Sprintf("Content-Length: %d\r\n\r\n", len(raw))), raw...), done: make(chan error, 1)}
	select {
	case <-c.closed:
		return errors.New("lsp: language server connection is closed")
	case <-ctx.Done():
		return ctx.Err()
	case c.writes <- item:
	}
	select {
	case err := <-item.done:
		if err != nil {
			return errors.New("lsp: language server input failed")
		}
		return nil
	case <-c.closed:
		return errors.New("lsp: language server connection is closed")
	case <-ctx.Done():
		c.abort(errors.New("lsp: protocol write was cancelled"))
		return ctx.Err()
	}
}

func (c *connection) notify(ctx context.Context, method string, value any) error {
	params, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return c.send(ctx, rpcMessage{JSONRPC: "2.0", Method: method, Params: params})
}
func (c *connection) request(ctx context.Context, method string, value any) (json.RawMessage, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	params, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if c.err != nil {
		err = c.err
		c.mu.Unlock()
		return nil, err
	}
	c.sequence++
	id := strconv.FormatUint(c.sequence, 10)
	reply := make(chan rpcReply, 1)
	c.pending[id] = reply
	c.mu.Unlock()
	defer func() { c.mu.Lock(); delete(c.pending, id); c.mu.Unlock() }()
	if err := c.send(ctx, rpcMessage{JSONRPC: "2.0", ID: json.RawMessage(id), Method: method, Params: params}); err != nil {
		return nil, err
	}
	select {
	case result := <-reply:
		return result.value, result.err
	case <-ctx.Done():
		if method == "shutdown" {
			c.abort(errors.New("lsp: graceful shutdown timed out"))
			<-c.exited
			return nil, ctx.Err()
		}
		cancelled, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
		defer cancel()
		_ = c.notify(cancelled, "$/cancelRequest", struct {
			ID json.RawMessage `json:"id"`
		}{json.RawMessage(id)})
		select {
		case <-reply:
		case <-c.closed:
		case <-cancelled.Done():
			c.abort(errors.New("lsp: server did not acknowledge request cancellation"))
		}
		if !c.live() {
			<-c.exited
		}
		return nil, ctx.Err()
	}
}

func readFrame(reader *bufio.Reader) ([]byte, error) {
	length := -1
	for headers := 0; headers < 32; headers++ {
		line, err := reader.ReadSlice('\n')
		if err != nil {
			return nil, errors.New("lsp: invalid or closed protocol header")
		}
		text := strings.TrimSuffix(strings.TrimSuffix(string(line), "\n"), "\r")
		if text == "" {
			if length < 0 {
				return nil, errors.New("lsp: protocol message has no Content-Length")
			}
			body := make([]byte, length)
			if _, err := io.ReadFull(reader, body); err != nil {
				return nil, errors.New("lsp: incomplete protocol body")
			}
			return body, nil
		}
		name, value, ok := strings.Cut(text, ":")
		if !ok {
			return nil, errors.New("lsp: malformed protocol header")
		}
		if strings.EqualFold(name, "Content-Length") {
			if length >= 0 {
				return nil, errors.New("lsp: duplicate Content-Length")
			}
			length, err = strconv.Atoi(strings.TrimSpace(value))
			if err != nil || length < 1 || length > maxMessageBytes {
				return nil, errors.New("lsp: protocol message exceeds the supported size")
			}
		}
	}
	return nil, errors.New("lsp: protocol header limit exceeded")
}

func (c *connection) readLoop(reader *bufio.Reader) {
	for {
		body, err := readFrame(reader)
		if err != nil {
			c.abort(err)
			return
		}
		var message rpcMessage
		if json.Unmarshal(body, &message) != nil || message.JSONRPC != "2.0" {
			c.abort(errors.New("lsp: invalid JSON-RPC message"))
			return
		}
		if message.Method != "" {
			if len(message.ID) != 0 {
				if err := c.answer(message); err != nil {
					c.abort(err)
					return
				}
			}
			continue
		}
		if len(message.ID) == 0 {
			c.abort(errors.New("lsp: protocol response has no id"))
			return
		}
		key := string(message.ID)
		c.mu.Lock()
		pending := c.pending[key]
		delete(c.pending, key)
		c.mu.Unlock()
		if pending != nil {
			result := rpcReply{value: message.Result}
			if message.Error != nil {
				result.err = fmt.Errorf("lsp: server request failed (code %d)", message.Error.Code)
			}
			pending <- result
		}
	}
}

func (c *connection) answer(request rpcMessage) error {
	response := rpcMessage{JSONRPC: "2.0", ID: request.ID, Result: json.RawMessage("null")}
	switch request.Method {
	case "workspace/configuration":
		var params struct {
			Items []struct {
				Section string `json:"section"`
			} `json:"items"`
		}
		if json.Unmarshal(request.Params, &params) != nil {
			return errors.New("lsp: invalid configuration request")
		}
		values := make([]json.RawMessage, len(params.Items))
		for i, item := range params.Items {
			value := json.RawMessage(c.settings.Bytes())
			if item.Section != "" {
				for _, segment := range strings.Split(item.Section, ".") {
					var fields map[string]json.RawMessage
					if json.Unmarshal(value, &fields) != nil {
						value = nil
						break
					}
					value = fields[segment]
				}
			}
			if len(value) == 0 {
				value = json.RawMessage("null")
			}
			values[i] = value
		}
		response.Result, _ = json.Marshal(values)
	case "workspace/workspaceFolders":
		response.Result, _ = json.Marshal([]workspaceFolder{{URI: c.workspaceURI, Name: "workspace"}})
	case "window/workDoneProgress/create":
	case "workspace/applyEdit":
		response.Result = json.RawMessage(`{"applied":false,"failureReason":"This LSP host is read-only."}`)
	default:
		response.Result = nil
		response.Error = &rpcError{Code: -32601, Message: "Client method is not supported"}
	}
	return c.send(context.Background(), response)
}

func (c *connection) close(timeout time.Duration) {
	c.closeOnce.Do(func() {
		if c.live() {
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			_, _ = c.request(ctx, "shutdown", nil)
			_ = c.notify(ctx, "exit", nil)
			_ = c.stdin.Close()
			select {
			case <-c.exited:
			case <-ctx.Done():
				c.abort(errors.New("lsp: graceful shutdown timed out"))
			}
			cancel()
		}
		c.abort(errors.New("lsp: language server connection closed"))
		<-c.exited
		c.workers.Wait()
	})
}
