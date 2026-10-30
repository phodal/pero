//go:build unix

package remoteacp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// Invoked as a separate fixed process; it cannot inherit the test's control env.
func TestRemoteAgentProcess(t *testing.T) {
	marker := ""
	for i, arg := range os.Args {
		if arg == "--fixture-marker" && i+1 < len(os.Args) {
			marker = os.Args[i+1]
		}
	}
	if marker == "" {
		return
	}
	if os.Getenv("PERO_WORKER_TOKEN") != "" || os.Getenv("PERO_AGENT_TOKEN_FILE") != "" || os.Getenv("AGENT_PROVIDER_API_KEY") != "" {
		os.Exit(4)
	}
	os.WriteFile(marker, []byte(strconv.Itoa(os.Getpid())), 0600)
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var msg map[string]any
		if json.Unmarshal(scanner.Bytes(), &msg) != nil {
			os.Exit(3)
		}
		if msg["method"] == "initialize" {
			fmt.Printf("{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"protocolVersion\":1}}\n")
		}
	}
	os.Exit(0)
}

func TestAgentRetriesOnlyKnown425RotatesTokenThenKillsChildOnEOF(t *testing.T) {
	dir := t.TempDir()
	token := filepath.Join(dir, "token")
	marker := filepath.Join(dir, "child-pid")
	os.WriteFile(token, []byte("first"), 0600)
	executable, _ := os.Executable()
	wrapper := filepath.Join(dir, "agent.sh")
	// Arguments are operator-created fixture inputs, not any remote Task data.
	os.WriteFile(wrapper, []byte("#!/bin/sh\nexec '"+strings.ReplaceAll(executable, "'", "'\\''")+"' -test.run=TestRemoteAgentProcess -- \"$@\"\n"), 0700)
	var attached atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NewResponseController(w).EnableFullDuplex()
		attempt := attached.Add(1)
		if attempt == 1 {
			if r.Header.Get("Authorization") != "Bearer first" {
				t.Error("first token wrong")
			}
			if _, err := os.Stat(marker); !os.IsNotExist(err) {
				t.Error("Agent started before admission")
			}
			os.WriteFile(token, []byte("rotated"), 0600)
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(425)
			http.NewResponseController(w).Flush()
			return
		}
		if attempt != 2 || r.Header.Get("Authorization") != "Bearer rotated" {
			t.Error("attach replay or stale projected token")
		}
		w.WriteHeader(200)
		io.WriteString(w, "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n")
		http.NewResponseController(w).Flush()
		var reply map[string]any
		if err := json.NewDecoder(r.Body).Decode(&reply); err != nil {
			t.Errorf("real Agent response: %v", err)
		}
		// Closing this accepted channel must kill the child, never start another.
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	err := Connect(ctx, AgentConfig{Channel: Channel{ControlURL: server.URL, RunID: "run", SessionID: "run"}, TokenFile: token, Workspace: dir, Executable: wrapper, Model: "fixture", SessionDir: filepath.Join(dir, "sessions"), Args: []string{"--fixture-marker", marker}})
	if err == nil || attached.Load() != 2 {
		t.Fatalf("unexpected reconnect/admission outcome: %v %d", err, attached.Load())
	}
	raw, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal("Agent was not started after admission")
	}
	pid, _ := strconv.Atoi(string(raw))
	if syscall.Kill(pid, 0) != syscall.ESRCH {
		t.Fatal("Agent survived accepted channel loss")
	}
}

func TestAgentDoesNotRetryRejectedOrUncertainAdmission(t *testing.T) {
	for _, status := range []int{http.StatusConflict, http.StatusServiceUnavailable, 0} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			dir := t.TempDir()
			token := filepath.Join(dir, "token")
			os.WriteFile(token, []byte("synthetic"), 0600)
			var attempts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts.Add(1)
				http.NewResponseController(w).EnableFullDuplex()
				if status == 0 {
					connection, _, err := w.(http.Hijacker).Hijack()
					if err != nil {
						t.Error(err)
						return
					}
					connection.Close()
					return
				}
				w.WriteHeader(status)
				http.NewResponseController(w).Flush()
			}))
			defer server.Close()
			ctx, cancel := context.WithTimeout(t.Context(), 2*time.Second)
			defer cancel()
			err := Connect(ctx, AgentConfig{Channel: Channel{ControlURL: server.URL, RunID: "run", SessionID: "run"}, TokenFile: token, Workspace: dir, Executable: "/nonexistent-fixed-agent", Model: "fixture", SessionDir: filepath.Join(dir, "sessions")})
			if err == nil || attempts.Load() != 1 || (status != 0 && ctx.Err() != nil) {
				t.Fatalf("unexpected retry: attempts=%d error=%v", attempts.Load(), err)
			}
		})
	}
}
