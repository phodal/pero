// Package remoteacp carries one admitted ACP session, not an execution authority.
// It never holds a Worker token or creates/retries a Run.
package remoteacp

import (
	"bufio"
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/phodal/pero/server/internal/runtimechannel"
)

const MaxLine = runtimechannel.MaxLineBytes
const MaxBytes = runtimechannel.MaxStreamBytes
const Lifetime = runtimechannel.MaxDuration

var ErrClosed = errors.New("remote ACP channel closed; original execution requires reconciliation")
var key = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
var secretPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

// Channel names the server-owned execution and an explicit trust root, not a URL
// selected by an Agent. The session ID is public; credentials are supplied apart.
type Channel struct{ ControlURL, RunID, SessionID, CAFile string }

func (c Channel) client() (*http.Client, error) {
	u, err := url.Parse(c.ControlURL)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" || !key.MatchString(c.RunID) || !key.MatchString(c.SessionID) {
		return nil, errors.New("invalid fixed remote channel")
	}
	loopback := u.Hostname() == "localhost"
	if ip := net.ParseIP(u.Hostname()); ip != nil {
		loopback = ip.IsLoopback()
	}
	if u.Scheme != "https" && (u.Scheme != "http" || !loopback) {
		return nil, errors.New("remote channel requires HTTPS or loopback fixture HTTP")
	}
	config := &tls.Config{MinVersion: tls.VersionTLS12}
	if c.CAFile != "" {
		data, err := os.ReadFile(c.CAFile)
		if err != nil {
			return nil, errors.New("remote channel CA unavailable")
		}
		config.RootCAs = x509.NewCertPool()
		if !config.RootCAs.AppendCertsFromPEM(data) {
			return nil, errors.New("invalid remote channel CA")
		}
	}
	return &http.Client{Transport: &http.Transport{TLSClientConfig: config, TLSHandshakeTimeout: 10 * time.Second, DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext, ForceAttemptHTTP2: true, ResponseHeaderTimeout: 30 * time.Second, IdleConnTimeout: 30 * time.Second}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, nil
}
func (c Channel) endpoint(suffix string) string {
	return strings.TrimSuffix(c.ControlURL, "/") + "/api/runtime/v1/runs/" + c.RunID + suffix + "?session_id=" + url.QueryEscape(c.SessionID)
}
func (c Channel) attach(ctx context.Context, client *http.Client, role, token string) (*http.Response, *io.PipeWriter, error) {
	if token == "" || len(token) > 16384 || strings.ContainsAny(token, "\r\n") {
		return nil, nil, errors.New("invalid scoped channel credential")
	}
	reader, writer := io.Pipe()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint("/channel/"+role), reader)
	if err != nil {
		reader.Close()
		writer.Close()
		return nil, nil, err
	}
	// A channel is single-use, including a rejected pre-admission attempt.
	// Do not let HTTP/1 reuse a connection with an unfinished duplex body.
	req.Close = true
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/x-ndjson")
	// HTTP/1 RoundTrip may wait for its body writer after an early peer EOF.
	// ResponseHeaderTimeout alone starts only after the streaming body is sent.
	stopCancel := context.AfterFunc(ctx, func() { reader.CloseWithError(ctx.Err()) })
	defer stopCancel()
	admissionDeadline := time.AfterFunc(30*time.Second, func() { reader.CloseWithError(ErrClosed) })
	defer admissionDeadline.Stop()
	response, err := client.Do(req)
	if err != nil {
		reader.Close()
		writer.Close()
		return nil, nil, errors.New("remote channel connection uncertain; no reconnect")
	}
	return response, writer, nil
}

// copyLines enforces a shared byte budget and whole JSONL messages. Transform is
// the only protocol projection, at the boundary before bytes reach the SDK/Agent.
func copyLines(dst io.Writer, src io.Reader, budget *atomic.Int64, transform func([]byte) ([]byte, error)) error {
	scanner := bufio.NewScanner(src)
	scanner.Buffer(make([]byte, 4096), MaxLine+2)
	scanner.Split(func(data []byte, atEOF bool) (int, []byte, error) {
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			return i + 1, data[:i], nil
		}
		if atEOF && len(data) > 0 {
			return 0, nil, ErrClosed
		}
		return 0, nil, nil
	})
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) > MaxLine || budget.Add(int64(len(line)+1)) > MaxBytes {
			return errors.New("remote ACP byte limit exceeded")
		}
		var err error
		if transform != nil {
			line, err = transform(line)
			if err != nil {
				return err
			}
		} else if !json.Valid(line) {
			return errors.New("invalid ACP JSONL")
		}
		if len(line) > MaxLine {
			return errors.New("rewritten ACP message exceeds limit")
		}
		if _, err = dst.Write(append(append([]byte(nil), line...), '\n')); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		return errors.New("invalid or oversized ACP JSONL")
	}
	return ErrClosed
}

// Bridge joins once using an exact-Run grant. Any EOF or uncertain transport
// outcome stops this process; the Worker journal and control plane reconcile it.
func Bridge(ctx context.Context, c Channel, secret, cwd string, input io.Reader, output io.Writer) error {
	if !secretPattern.MatchString(secret) || cwd != "/workspace/repo" {
		return errors.New("invalid remote execution grant")
	}
	client, err := c.client()
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(ctx, Lifetime)
	defer cancel()
	response, writer, err := c.attach(ctx, client, "worker", c.SessionID+"."+secret)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	defer writer.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("remote worker channel rejected: HTTP %d", response.StatusCode)
	}
	var budget atomic.Int64
	done := make(chan error, 2)
	go func() {
		done <- copyLines(writer, input, &budget, func(line []byte) ([]byte, error) { return workerMessage(line, cwd) })
	}()
	go func() { done <- copyLines(output, response.Body, &budget, agentMessage) }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ErrClosed
	}
}

func workerMessage(line []byte, cwd string) ([]byte, error) {
	var msg map[string]json.RawMessage
	if json.Unmarshal(line, &msg) != nil || msg == nil {
		return nil, errors.New("invalid worker ACP message")
	}
	var method string
	if raw, ok := msg["method"]; ok {
		if json.Unmarshal(raw, &method) != nil {
			return nil, errors.New("invalid ACP method")
		}
	}
	if method == "session/new" {
		var params map[string]json.RawMessage
		if json.Unmarshal(msg["params"], &params) != nil || params == nil {
			return nil, errors.New("invalid session parameters")
		}
		if raw, ok := params["mcpServers"]; ok {
			var servers []json.RawMessage
			if json.Unmarshal(raw, &servers) != nil || len(servers) != 0 {
				return nil, errors.New("remote sessions cannot use host MCP servers")
			}
		}
		params["cwd"], _ = json.Marshal(cwd)
		msg["params"], _ = json.Marshal(params)
		return json.Marshal(msg)
	}
	// Authentication, session loading and host-resource attachments are not part
	// of this one-turn channel. Permission responses have no method.
	switch method {
	case "", "initialize", "session/prompt", "session/cancel", "session/set_mode", "session/set_config_option":
		return line, nil
	default:
		return nil, errors.New("unsupported remote ACP client method")
	}
}
func agentMessage(line []byte) ([]byte, error) {
	var msg *struct {
		Method string `json:"method"`
	}
	if json.Unmarshal(line, &msg) != nil || msg == nil {
		return nil, errors.New("invalid agent ACP message")
	}
	switch msg.Method {
	case "", "session/update", "session/request_permission":
		return line, nil
	default:
		return nil, errors.New("remote Agent attempted a host callback")
	}
}
func tokenFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", errors.New("projected runtime token unavailable")
	}
	token := strings.TrimSpace(string(data))
	if token == "" || len(token) > 16384 || strings.ContainsAny(token, "\r\n") {
		return "", errors.New("invalid projected runtime token")
	}
	return token, nil
}
func retryDelay(response *http.Response) time.Duration {
	n, err := strconv.Atoi(response.Header.Get("Retry-After"))
	if err != nil || n < 1 || n > 2 {
		n = 1
	}
	return time.Duration(n) * time.Second
}
