package remoteacp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestProtocolBoundary(t *testing.T) {
	cases := []struct {
		name, line string
		agent, ok  bool
	}{
		{"new", `{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/host/private","mcpServers":[]}}`, false, true},
		{"host-mcp", `{"method":"session/new","params":{"cwd":"/host","mcpServers":[{"name":"host","command":"/bin/sh"}]}}`, false, false},
		{"resume", `{"method":"session/load","params":{}}`, false, false},
		{"permission", `{"id":2,"method":"session/request_permission","params":{}}`, true, true},
		{"file", `{"id":2,"method":"fs/read_text_file","params":{"path":"/etc/passwd"}}`, true, false},
		{"terminal", `{"id":2,"method":"terminal/create","params":{}}`, true, false},
		{"update", `{"method":"session/update","params":{}}`, true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var out []byte
			var err error
			if c.agent {
				out, err = agentMessage([]byte(c.line))
			} else {
				out, err = workerMessage([]byte(c.line), "/workspace/repo")
			}
			if (err == nil) != c.ok {
				t.Fatalf("accepted=%v error=%v", err == nil, err)
			}
			if c.name == "new" {
				var value map[string]any
				json.Unmarshal(out, &value)
				if value["params"].(map[string]any)["cwd"] != "/workspace/repo" {
					t.Fatal("host cwd crossed channel")
				}
			}
		})
	}
	for _, line := range []string{`{"id":1}`, strings.Repeat("x", MaxLine+1) + "\n", "not-json\n"} {
		var out bytes.Buffer
		var budget atomic.Int64
		if copyLines(&out, strings.NewReader(line), &budget, nil) == nil || out.Len() != 0 {
			t.Fatal("invalid/truncated line was forwarded")
		}
	}
	var out bytes.Buffer
	var budget atomic.Int64
	budget.Store(MaxBytes - 2)
	if copyLines(&out, strings.NewReader("{}\n"), &budget, nil) == nil || out.Len() != 0 {
		t.Fatal("shared stream limit bypassed")
	}
}

func TestBridgeAttachesOnceRewritesCWDAndRejectsHostCallbacks(t *testing.T) {
	var attachments atomic.Int32
	observed := make(chan map[string]any, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attachments.Add(1)
		if r.URL.Path != "/api/runtime/v1/runs/run/channel/worker" || r.URL.Query().Get("session_id") != "run" || r.Header.Get("Authorization") != "Bearer run."+strings.Repeat("a", 64) {
			t.Error("scoped channel identity mismatch")
		}
		http.NewResponseController(w).EnableFullDuplex()
		w.WriteHeader(200)
		http.NewResponseController(w).Flush()
		var msg map[string]any
		if json.NewDecoder(r.Body).Decode(&msg) != nil {
			return
		}
		observed <- msg
		io.WriteString(w, "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"fs/read_text_file\",\"params\":{\"path\":\"/host/secret\"}}\n")
		http.NewResponseController(w).Flush()
		io.Copy(io.Discard, r.Body)
	}))
	defer server.Close()
	input, send := io.Pipe()
	defer input.Close()
	defer send.Close()
	var output bytes.Buffer
	done := make(chan error, 1)
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	go func() {
		done <- Bridge(ctx, Channel{ControlURL: server.URL, RunID: "run", SessionID: "run"}, strings.Repeat("a", 64), "/workspace/repo", input, &output)
	}()
	io.WriteString(send, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"session/new\",\"params\":{\"cwd\":\"/host/private\",\"mcpServers\":[]}}\n")
	select {
	case msg := <-observed:
		if msg["params"].(map[string]any)["cwd"] != "/workspace/repo" {
			t.Fatal("cwd not rewritten")
		}
	case <-ctx.Done():
		t.Fatal("bridge did not send request")
	}
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("host callback accepted")
		}
	case <-ctx.Done():
		t.Fatal("bridge did not stop")
	}
	if attachments.Load() != 1 || output.Len() != 0 {
		t.Fatal("channel replay or host callback reached SDK")
	}
}

func TestProviderProxyUsesFreshScopedTokenAndFixedRoute(t *testing.T) {
	token := filepath.Join(t.TempDir(), "projected-token")
	os.WriteFile(token, []byte("first"), 0600)
	tokens := make(chan string, 2)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/runtime/v1/runs/run/provider/v1/chat/completions" || r.URL.Query().Get("session_id") != "run" || r.Header.Get("X-Host-Secret") != "" {
			t.Error("provider route/header boundary changed")
		}
		tokens <- r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer upstream.Close()
	c := AgentConfig{Channel: Channel{ControlURL: upstream.URL, RunID: "run", SessionID: "run"}, TokenFile: token}
	client, err := c.Channel.client()
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	handler := providerProxy(c, client)
	for _, value := range []string{"first", "rotated"} {
		os.WriteFile(token, []byte(value), 0600)
		request := httptest.NewRequest("POST", "http://localhost/v1/chat/completions", strings.NewReader(`{"model":"fixture"}`))
		request.Header.Set("Authorization", "Bearer arbitrary-local-value")
		request.Header.Set("X-Host-Secret", "must-not-forward")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != 200 || <-tokens != "Bearer "+value {
			t.Fatal("provider token was cached or request failed")
		}
	}
	for _, path := range []string{"/v1/models", "/v1/chat/completions?target=https://evil.invalid"} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest("POST", path, nil))
		if response.Code != 404 {
			t.Fatal("arbitrary provider route accepted")
		}
	}
}
