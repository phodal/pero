//go:build unix

package remoteacp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"image"
	"image/png"
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
	t.Run("default", func(t *testing.T) { checkGoACPProcess(t, agent, connector, false, nil) })
	t.Run("browser", func(t *testing.T) { checkGoACPProcess(t, agent, connector, true, nil) })
	t.Run("browser_screenshot", func(t *testing.T) { checkGoACPProcess(t, agent, connector, true, browserScreenshotFixture(t)) })
}

func browserScreenshotFixture(t *testing.T) []byte {
	t.Helper()
	if path := os.Getenv("PERO_TEST_CLOUD_SCREENSHOT"); path != "" {
		raster, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		return raster
	}
	// A valid PNG above the ACP frame cap proves the raster stays on the
	// provider path while the ACP stream carries the text receipt.
	raster := image.NewRGBA(image.Rect(0, 0, 480, 320))
	var noise uint32 = 1
	for i := 0; i < len(raster.Pix); i += 4 {
		noise ^= noise << 13
		noise ^= noise >> 17
		noise ^= noise << 5
		raster.Pix[i], raster.Pix[i+1], raster.Pix[i+2], raster.Pix[i+3] = byte(noise), byte(noise>>8), byte(noise>>16), 255
	}
	var output bytes.Buffer
	if err := png.Encode(&output, raster); err != nil || output.Len() <= MaxLine {
		t.Fatalf("invalid large screenshot fixture: %d bytes, %v", output.Len(), err)
	}
	return output.Bytes()
}

func checkGoACPProcess(t *testing.T, agent, connector string, browser bool, screenshot []byte) {
	t.Helper()
	dir := t.TempDir()
	token, ca := filepath.Join(dir, "token"), filepath.Join(dir, "ca.pem")
	os.WriteFile(token, []byte("synthetic-pod-token"), 0600)
	action := "observe"
	sha := ""
	var dimensions image.Config
	if screenshot != nil {
		action = "screenshot"
		sha = fmt.Sprintf("%x", sha256.Sum256(screenshot))
		var err error
		dimensions, err = png.DecodeConfig(bytes.NewReader(screenshot))
		if err != nil {
			t.Fatal(err)
		}
	}
	var attaches, providers, browserCalls atomic.Int32
	result := make(chan error, 1)
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer synthetic-pod-token" || r.URL.Query().Get("session_id") != "run" {
			t.Error("scoped identity missing")
		}
		if r.URL.Path == "/api/runtime/v1/runs/run/browser/call" {
			var request struct {
				Action      string
				IncludeTree bool `json:"includeTree"`
			}
			if !browser || json.NewDecoder(r.Body).Decode(&request) != nil || request.Action != action ||
				request.IncludeTree != (action == "observe") {
				t.Error("unexpected browser operation", request.Action)
				http.Error(w, "bad browser call", http.StatusBadRequest)
				return
			}
			browserCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			if screenshot != nil {
				fmt.Fprintf(w, `{"kind":"screenshot","receipt":{"sha256":%q,"bytes":%d,"width":%d,"height":%d},"png":%q}`,
					sha, len(screenshot), dimensions.Width, dimensions.Height, base64.StdEncoding.EncodeToString(screenshot))
			} else {
				fmt.Fprint(w, `{"kind":"observation","title":"Cloud Browser fixture","tree":"- heading fixture-browser-marker"}`)
			}
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
			projected, err := runtimegateway.ValidateProviderBody(body, "fixture", 64, screenshot != nil)
			if err != nil {
				t.Errorf("actual Go ACP provider wire incompatible with fixed gateway: %v", err)
				http.Error(w, "bad", 400)
				return
			}
			w.Header().Set("Content-Type", "text/event-stream")
			var message struct {
				Tools    []struct{ Function struct{ Name string } }
				Messages []struct {
					Role    string
					Content json.RawMessage
				}
			}
			if err := json.Unmarshal(projected, &message); err != nil {
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
				arguments := fmt.Sprintf(`{"action":%q}`, action)
				if action == "observe" {
					arguments = `{"action":"observe","includeTree":true}`
				}
				fmt.Fprintf(w, `data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"browser-1","type":"function","function":{"name":"browser_use","arguments":%q}}]},"finish_reason":"tool_calls"}]}`+"\n\ndata: [DONE]\n\n", arguments)
				return
			}
			if browser {
				marker := "fixture-browser-marker"
				if screenshot != nil {
					marker = sha
				}
				seen, seenImage := false, false
				for _, item := range message.Messages {
					seen = seen || item.Role == "tool" && bytes.Contains(item.Content, []byte(marker))
					if screenshot != nil && item.Role == "user" {
						want := "data:image/png;base64," + base64.StdEncoding.EncodeToString(screenshot)
						seenImage = seenImage || bytes.Contains(item.Content, []byte(want))
					}
				}
				if !seen {
					t.Error("the provider did not receive the browser tool result")
				}
				if screenshot != nil && !seenImage {
					t.Error("the provider did not receive the exact browser PNG")
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
	if screenshot != nil {
		command.Env = append(command.Env, "PERO_AGENT_BROWSER_SCREENSHOTS=1")
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
