package remoteacp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

// AgentConfig is operator image configuration. No Task can supply its executable,
// workspace, provider URL or model. The child receives no Worker/provider secret.
// The Pod-scoped token file is still accessible inside the hostile Pod; its
// restricted server audience/authorization, not process secrecy, is the boundary.
type AgentConfig struct {
	Channel                                             Channel
	TokenFile, Workspace, Executable, Model, SessionDir string
	Args                                                []string
}

func (c AgentConfig) validate() error {
	if !filepath.IsAbs(c.Workspace) {
		return errors.New("absolute remote workspace required")
	}
	if !filepath.IsAbs(c.Executable) || c.Model == "" || !filepath.IsAbs(c.SessionDir) || c.TokenFile == "" {
		return errors.New("explicit operator Agent configuration required")
	}
	for _, arg := range c.Args {
		for _, reserved := range []string{"--endpoint", "--api-key-env", "--workspace", "--model", "--session-dir", "--approval", "--enable-shell"} {
			if arg == reserved || strings.HasPrefix(arg, reserved+"=") {
				return errors.New("reserved Agent option cannot be overridden")
			}
		}
	}
	info, err := os.Stat(c.Workspace)
	if err != nil || !info.IsDir() {
		return errors.New("prepared remote workspace unavailable")
	}
	return nil
}

// Connect waits only on a known pre-admission 425. After an accepted connection,
// no network failure, process exit or EOF can cause another attach or prompt.
func Connect(ctx context.Context, c AgentConfig) error {
	if err := c.validate(); err != nil {
		return err
	}
	client, err := c.Channel.client()
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()
	ctx, cancel := context.WithTimeout(ctx, Lifetime)
	defer cancel()
	var response *http.Response
	var writer *io.PipeWriter
	for {
		token, err := tokenFile(c.TokenFile)
		if err != nil {
			return err
		}
		response, writer, err = c.Channel.attach(ctx, client, "agent", token)
		if err != nil {
			return err
		}
		if response.StatusCode == http.StatusOK {
			break
		}
		delay := retryDelay(response)
		writer.Close()
		response.Body.Close()
		if response.StatusCode != http.StatusTooEarly {
			return fmt.Errorf("remote agent channel rejected: HTTP %d", response.StatusCode)
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ErrClosed
		case <-timer.C:
		}
	}
	defer response.Body.Close()
	defer writer.Close()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	proxy := &http.Server{Handler: providerProxy(c, client), ReadHeaderTimeout: 5 * time.Second}
	go proxy.Serve(listener)
	defer proxy.Close()
	args := []string{"--endpoint", "http://" + listener.Addr().String() + "/v1", "--api-key-env", "PERO_ISOLATED_PROVIDER_KEY", "--workspace", c.Workspace, "--model", c.Model, "--session-dir", c.SessionDir, "--approval", "ask"}
	args = append(args, c.Args...)
	command := exec.Command(c.Executable, args...)
	command.Dir = c.Workspace
	command.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/tmp", "LANG=C.UTF-8", "PERO_ISOLATED_PROVIDER_KEY=local-nonsecret"}
	command.Stderr = io.Discard // Hostile stderr cannot expose credentials in supervisor logs.
	stop, err := isolateChild(command)
	if err != nil {
		return err
	}
	input, err := command.StdinPipe()
	if err != nil {
		return err
	}
	output, err := command.StdoutPipe()
	if err != nil {
		return err
	}
	if err = command.Start(); err != nil {
		return errors.New("unable to launch fixed remote Agent")
	}
	defer func() { stop(); command.Wait() }()
	var budget atomic.Int64
	done := make(chan error, 2)
	go func() { done <- copyLines(writer, output, &budget, agentMessage) }()
	go func() { done <- copyLines(input, response.Body, &budget, nil) }()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ErrClosed
	}
}

func providerProxy(c AgentConfig, client *http.Client) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" || r.URL.RawQuery != "" {
			http.Error(w, "unsupported provider route", http.StatusNotFound)
			return
		}
		token, err := tokenFile(c.TokenFile)
		if err != nil {
			http.Error(w, "runtime identity unavailable", http.StatusServiceUnavailable)
			return
		}
		body := http.MaxBytesReader(w, r.Body, 1<<20)
		request, err := http.NewRequestWithContext(r.Context(), http.MethodPost, c.Channel.endpoint("/provider/v1/chat/completions"), body)
		if err != nil {
			http.Error(w, "invalid provider request", http.StatusBadRequest)
			return
		}
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		response, err := client.Do(request)
		if err != nil {
			http.Error(w, "provider unavailable", http.StatusBadGateway)
			return
		}
		defer response.Body.Close()
		w.Header().Set("Content-Type", response.Header.Get("Content-Type"))
		w.WriteHeader(response.StatusCode)
		buffer := make([]byte, 32<<10)
		remaining := int64(MaxBytes)
		for remaining > 0 {
			n, err := response.Body.Read(buffer)
			if n > 0 {
				remaining -= int64(n)
				if remaining < 0 {
					return
				}
				if _, writeErr := w.Write(buffer[:n]); writeErr != nil {
					return
				}
				http.NewResponseController(w).Flush()
			}
			if err != nil {
				return
			}
		}
	})
}
