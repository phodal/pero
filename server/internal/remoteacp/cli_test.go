//go:build unix

package remoteacp

import (
	"context"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/runtimegateway"
)

// Explicit process fixture: no real provider, Kubernetes token or network outside
// loopback. The normal unit suite does not build a second workspace module.
func TestAgentConnectCLIWithGoACP(t *testing.T) {
	agent, connector := os.Getenv("PERO_REMOTE_AGENT_BINARY"), os.Getenv("PERO_REMOTE_CONNECT_BINARY")
	if agent == "" || connector == "" {
		t.Skip("set both absolute process fixture binaries")
	}
	if !filepath.IsAbs(agent) || !filepath.IsAbs(connector) {
		t.Fatal("absolute fixture binaries required")
	}
	t.Run("default", func(t *testing.T) { checkGoACPProcess(t, agent, connector, false) })
	t.Run("browser", func(t *testing.T) { checkGoACPProcess(t, agent, connector, true) })
}

func checkGoACPProcess(t *testing.T, agent, connector string, browser bool) {
	t.Helper()
	dir := t.TempDir()
	token, ca := filepath.Join(dir, "token"), filepath.Join(dir, "ca.pem")
	os.WriteFile(token, []byte("synthetic-pod-token"), 0600)
	var attaches, providers, browserCalls atomic.Int32
	result := make(chan error, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer synthetic-pod-token" || r.URL.Query().Get("session_id") != "run" {
			t.Error("scoped identity missing")
		}
		if r.URL.Path == "/api/runtime/v1/runs/run/browser/call" {
			var request struct{ Action string }
			if !browser || json.NewDecoder(r.Body).Decode(&request) != nil || request.Action != "observe" {
				t.Error("unexpected browser operation", request.Action)
				http.Error(w, "bad browser call", http.StatusBadRequest)
				return
			}
			browserCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprint(w, `{"kind":"observation","title":"fixture-browser-marker"}`)
			return
		}
		if r.URL.Path == "/api/runtime/v1/runs/run/provider/v1/chat/completions" {
			attempt := providers.Add(1)
			body, err := io.ReadAll(r.Body)
			if err != nil {
				t.Error(err)
				http.Error(w, "bad", 400)
				return
			}
			if _, err = runtimegateway.ValidateProviderBody(body, "fixture", 64); err != nil {
				t.Errorf("actual Go ACP provider wire incompatible with fixed gateway: %s", body)
				http.Error(w, "bad", 400)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			var message struct {
				Tools    []struct{ Function struct{ Name string } }
				Messages []struct{ Role, Content string }
			}
			if err := json.Unmarshal(body, &message); err != nil {
				t.Error(err)
			}
			hasBrowser := false
			for _, tool := range message.Tools {
				hasBrowser = hasBrowser || tool.Function.Name == "browser_use"
			}
			if browser != hasBrowser {
				t.Error("unexpected Browser Use availability", hasBrowser)
			}
			if browser && attempt == 1 {
				fmt.Fprint(w, `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"observe-1","type":"function","function":{"name":"browser_use","arguments":"{\"action\":\"observe\"}"}}]},"finish_reason":"tool_calls"}]}`+"\n\ndata: [DONE]\n\n")
				return
			}
			if browser {
				seen := false
				for _, item := range message.Messages {
					seen = seen || item.Role == "tool" && strings.Contains(item.Content, "fixture-browser-marker")
				}
				if !seen {
					t.Error("the provider did not receive the browser tool result")
				}
			}
			fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"isolated fixture answer\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		if r.URL.Path != "/api/runtime/v1/runs/run/channel/agent" {
			t.Errorf("unexpected route %s", r.URL.Path)
			return
		}
		attaches.Add(1)
		rc := http.NewResponseController(w)
		rc.EnableFullDuplex()
		w.WriteHeader(200)
		rc.Flush()
		input := json.NewDecoder(r.Body)
		exchange := func(id int, method string, params any) (map[string]any, error) {
			if err := json.NewEncoder(w).Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
				return nil, err
			}
			rc.Flush()
			for {
				var message map[string]any
				if err := input.Decode(&message); err != nil {
					return nil, err
				}
				if message["id"] == float64(id) {
					if message["error"] != nil {
						return nil, fmt.Errorf("ACP error: %v", message["error"])
					}
					return message["result"].(map[string]any), nil
				}
			}
		}
		if _, err := exchange(1, "initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}}); err != nil {
			result <- err
			return
		}
		session, err := exchange(2, "session/new", map[string]any{"cwd": dir, "mcpServers": []any{}})
		if err != nil {
			result <- err
			return
		}
		turn, err := exchange(3, "session/prompt", map[string]any{"sessionId": session["sessionId"], "prompt": []any{map[string]any{"type": "text", "text": "Say fixture answer without tools."}}})
		if err == nil && turn["stopReason"] != "end_turn" {
			err = fmt.Errorf("unexpected stop: %v", turn)
		}
		result <- err
		// Accepted transport loss must end this CLI/child, not reconnect or replay.
	}))
	defer server.Close()
	os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, connector, "--control-url", server.URL, "--run-id", "run", "--session-id", "run", "--token-file", token, "--ca-file", ca, "--workspace", dir, "--agent", agent, "--model", "fixture", "--session-dir", filepath.Join(dir, "sessions"))
	command.Env = []string{"PATH=/usr/local/bin:/usr/bin:/bin", "PERO_WORKER_TOKEN=must-not-inherit", "AGENT_PROVIDER_API_KEY=must-not-inherit"}
	wantBrowserCalls := int32(0)
	if browser {
		wantBrowserCalls = 1
		command.Env = append(command.Env, "PERO_AGENT_BROWSER_USE=1")
	}
	command.Cancel = func() error { return command.Process.Signal(syscall.SIGTERM) }
	command.WaitDelay = 2 * time.Second
	command.Stdout = io.Discard
	stderr := &strings.Builder{}
	command.Stderr = stderr
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-result:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("CLI protocol did not finish")
	}
	if err := command.Wait(); err == nil {
		t.Fatal("accepted EOF incorrectly reported clean reusable transport")
	}
	if ctx.Err() != nil || attaches.Load() != 1 || providers.Load() != 1+wantBrowserCalls || browserCalls.Load() != wantBrowserCalls {
		t.Fatalf("Unexpected isolated calls: attaches=%d providers=%d browser=%d error=%s", attaches.Load(), providers.Load(), browserCalls.Load(), stderr.String())
	}
}
