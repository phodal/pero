package openai

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func TestDeepSeekMessagesSharesAttemptBudgetAndDoesNotFollowRedirects(t *testing.T) {
	var diverted, audited, requests atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		diverted.Add(1)
	}))
	defer other.Close()
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		http.Redirect(w, r, other.URL, http.StatusTemporaryRedirect)
	}))
	defer provider.Close()
	a, err := New(Config{
		APIFormat: DeepSeekMessages, Endpoint: provider.URL + "/v1/messages", APIKey: "synthetic",
		ProviderName: "fixture-provider", Models: []ModelConfig{{ID: "fixture", MaxTokens: 128}},
		MaxRequests: 1, BeforeHTTPAttempt: func() error { audited.Add(1); return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	r := harness.GenerateRequest{Provider: "other-provider", Model: "fixture", Messages: []harness.Message{{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "do not redirect"}}}}}
	if _, err := a.Generate(t.Context(), r, nil); err == nil || requests.Load() != 0 {
		t.Fatalf("unconfigured route reached provider: err=%v count=%d", err, requests.Load())
	}
	r.Provider = "fixture-provider"
	if _, err := a.Generate(t.Context(), r, nil); err == nil || diverted.Load() != 0 || requests.Load() != 1 || audited.Load() != 1 {
		t.Fatalf("redirect/audit: error=%v diverted=%d requests=%d audited=%d", err, diverted.Load(), requests.Load(), audited.Load())
	}
	if _, err := a.Generate(t.Context(), r, nil); err == nil || requests.Load() != 1 || audited.Load() != 1 {
		t.Fatalf("budget was exceeded: err=%v requests=%d audited=%d", err, requests.Load(), audited.Load())
	}
}

func TestDeepSeekSignedReplayScope(t *testing.T) {
	base := Config{
		APIFormat: DeepSeekMessages, Endpoint: "https://fixture.example/anthropic",
		APIKey: "synthetic-key", ProviderName: "fixture-provider",
		Models: []ModelConfig{{ID: "fixture", MaxTokens: 128}},
	}
	config := base
	config.MessagesReplayKey = make([]byte, 32)
	a, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name                string
		change              func(*Config)
		wantSame, wantError bool
	}{
		{"equivalent-path", func(c *Config) { c.Endpoint += "/v1/messages" }, true, false},
		{"different-endpoint", func(c *Config) { c.Endpoint += "-other" }, false, false},
		{"different-provider", func(c *Config) { c.ProviderName += "-other" }, false, false},
		{"different-credential", func(c *Config) { c.APIKey += "-other" }, false, false},
		{"different-replay-key", func(c *Config) { c.MessagesReplayKey = append([]byte{1}, c.MessagesReplayKey[1:]...) }, false, false},
		{"disabled", func(c *Config) { c.DisableThinking = true }, false, true},
		{"different-protocol", func(c *Config) { c.APIFormat = ChatCompletions }, false, true},
		{"short-key", func(c *Config) { c.MessagesReplayKey = c.MessagesReplayKey[:31] }, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			next := config
			tc.change(&next)
			b, err := New(next)
			if tc.wantError {
				if err == nil {
					t.Fatal("expected configuration to be rejected")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if b.messagesReplayScope == "" || (a.messagesReplayScope == b.messagesReplayScope) != tc.wantSame {
				t.Fatal("signed replay did not follow effective scope")
			}
		})
	}
	plain, err := New(base)
	if err != nil || plain.messagesReplayScope != "" {
		t.Fatalf("signed mode was not explicit: %v", err)
	}
}

func TestDeepSeekMessagesVisionWire(t *testing.T) {
	png := ownedPNG(t, 4, 4)
	image := harness.ContentBlock{Type: harness.BlockImage, MIMEType: "image/png", Data: png}
	for _, tc := range []struct {
		name                  string
		vision, tool, invalid bool
	}{
		{name: "image-enabled tool result", vision: true, tool: true},
		{name: "text-only route rejects user image"},
		{name: "vision route rejects an image URL", vision: true, invalid: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var requests atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				var body struct {
					Messages []struct {
						Content []struct {
							Type      string
							ToolUseID string `json:"tool_use_id"`
							Content   []struct {
								Type   string
								Source struct {
									Type  string
									Media string `json:"media_type"`
									Data  []byte
								}
							}
						}
					}
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Messages) != 3 {
					t.Errorf("malformed Messages wire: %v", err)
				} else {
					parts := body.Messages[2].Content
					if len(parts) != 1 || parts[0].Type != "tool_result" || parts[0].ToolUseID != "picture" || len(parts[0].Content) != 1 {
						t.Error("image must remain nested in its matching tool result")
					} else if part := parts[0].Content[0]; part.Type != "image" || part.Source.Type != "base64" || part.Source.Media != "image/png" || len(part.Source.Data) == 0 {
						t.Error("tool-result pixels were not encoded as an inline raster")
					}
				}
				w.WriteHeader(http.StatusBadRequest)
			}))
			defer s.Close()
			model := ModelConfig{ID: "fixture", MaxTokens: 128}
			if tc.vision {
				model.InputModalities = []string{"text", "image"}
			}
			a, err := New(Config{Endpoint: s.URL + "/v1/messages", APIKey: "synthetic", APIFormat: DeepSeekMessages, ProviderName: "fixture", Models: []ModelConfig{model}})
			if err != nil {
				t.Fatal(err)
			}
			block := image
			if tc.invalid {
				block.Data = []byte("https://example.invalid/image.png")
			}
			r := harness.GenerateRequest{Provider: "fixture", Model: "fixture", Messages: []harness.Message{{Role: harness.RoleUser, Content: []harness.ContentBlock{block}}}}
			wantRequests := int32(0)
			if tc.tool {
				wantRequests = 1
				r.Messages = []harness.Message{
					{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "open fixture"}}},
					{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, ToolCallID: "picture", Name: "read_image", Arguments: json.RawMessage(`{}`)}}},
					{Role: harness.RoleTool, Content: []harness.ContentBlock{{Type: harness.BlockToolResult, ToolCallID: "picture", Content: []harness.ContentBlock{block}}}},
				}
			}
			if _, err := a.Generate(t.Context(), r, nil); err == nil || requests.Load() != wantRequests {
				t.Fatalf("unexpected HTTP admission: count=%d err=%v", requests.Load(), err)
			}
		})
	}
}

func TestDeepSeekFilesRespectsRequestBudgetAndRedirectBoundary(t *testing.T) {
	for _, budget := range []int{1, 2} {
		t.Run(fmt.Sprint(budget), func(t *testing.T) {
			var uploads, models, redirected, audits atomic.Int32
			destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Add(1) }))
			defer destination.Close()
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/files" {
					uploads.Add(1)
					http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
					return
				}
				models.Add(1)
				var body struct {
					Messages []struct {
						Content []struct {
							Source struct {
								Type string
								Data []byte
							}
						}
					}
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body.Messages) != 1 ||
					len(body.Messages[0].Content) != 1 || body.Messages[0].Content[0].Source.Type != "base64" ||
					len(body.Messages[0].Content[0].Source.Data) == 0 || r.Header.Get("Anthropic-Beta") != "" {
					t.Error("expected inline fallback without the Files beta header")
				}
				w.WriteHeader(http.StatusBadRequest)
			}))
			defer provider.Close()
			a, err := New(Config{
				APIFormat: DeepSeekMessages, Endpoint: provider.URL + "/v1/messages", APIKey: "synthetic", ProviderName: "fixture",
				Models:      []ModelConfig{{ID: "vision", MaxTokens: 128, InputModalities: []string{"text", "image"}}},
				MaxRequests: budget, MessagesFilesDirectory: t.TempDir(), MessagesFilesKey: make([]byte, 32),
				BeforeHTTPAttempt: func() error { audits.Add(1); return nil },
			})
			if err != nil {
				t.Fatal(err)
			}
			info, err := a.ResolveModelInfo(t.Context(), "fixture", "vision")
			if err != nil || !slices.Contains(info.InputModalities, "image") {
				t.Fatalf("vision route metadata: %+v err=%v", info, err)
			}
			req := harness.GenerateRequest{Provider: "fixture", Model: "vision", Messages: []harness.Message{{Role: harness.RoleUser, Content: []harness.ContentBlock{
				{Type: harness.BlockImage, MIMEType: "image/png", Data: ownedPNG(t, 4, 4)},
			}}}}
			_, _ = a.Generate(t.Context(), req, nil)
			if _, err := a.Generate(t.Context(), req, nil); harness.ProviderFailureFromError(err).Code != harness.RequestBudgetExhaustedCode {
				t.Fatalf("second inference must fail before HTTP: %v", err)
			}
			if got := []int32{uploads.Load(), models.Load(), redirected.Load(), audits.Load()}; !slices.Equal(got, []int32{int32(budget - 1), 1, 0, int32(budget)}) {
				t.Fatalf("uploads/models/redirects/audits = %v", got)
			}
		})
	}
}

// Observe exact bodies, attempts and persisted cache state across adapters.
func TestDeepSeekFilesRecoversOnlyConfirmedStaleID(t *testing.T) {
	for _, tc := range []struct {
		name, rejection           string
		budget, wantFirstAttempts int
		stale, truncated          bool
	}{
		{"named rejection", "file ID file-old expired", 0, 2, true, false},
		{"unnamed rejection", "a file ID expired", 0, 1, false, false},
		{"other ID", "file ID file-old-other expired", 0, 1, false, false},
		{"invalid image", "file ID file-old contains an invalid image", 0, 1, false, false},
		{"budget exhausted", "file ID file-old expired", 2, 1, true, false},
		{"began SSE", "", 0, 1, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var uploads, attempts, audits atomic.Int32
			var wiresMu sync.Mutex
			var wires [][]byte
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/v1/files" {
					n := uploads.Add(1)
					part, err := r.MultipartReader()
					if err != nil {
						t.Errorf("upload: %v", err)
						w.WriteHeader(400)
						return
					}
					file, err := part.NextPart()
					if err != nil {
						t.Errorf("upload part: %v", err)
						w.WriteHeader(400)
						return
					}
					data, err := io.ReadAll(file)
					if err != nil {
						t.Errorf("image bytes: %v", err)
						w.WriteHeader(400)
						return
					}
					id := "file-new"
					if n == 1 {
						id = "file-old"
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"type": "file", "id": id, "created_at": time.Now(), "mime_type": file.Header.Get("Content-Type"), "size_bytes": len(data)})
					return
				}
				n := attempts.Add(1)
				raw, _ := io.ReadAll(r.Body)
				wiresMu.Lock()
				wires = append(wires, raw)
				wiresMu.Unlock()
				if n == 1 || (tc.stale && tc.budget == 0 && n == 2) {
					wantFile := n == 1
					if (r.Header.Get("Anthropic-Beta") == messagesFilesBeta) != wantFile ||
						bytes.Contains(raw, []byte(`"file_id":"file-old"`)) != wantFile ||
						bytes.Contains(raw, []byte(`"type":"base64"`)) == wantFile {
						t.Error("request did not switch all images from Files to inline")
					}
				}
				if n == 1 && !tc.truncated {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusBadRequest)
					_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"type": "invalid_request_error", "message": tc.rejection}})
					return
				}
				if n == 1 && tc.truncated {
					w.Header().Set("Content-Type", "text/event-stream")
					event(w, `{"type":"message_start","message":{"id":"x","type":"message","role":"assistant","model":"vision","content":[]}}`)
					return
				}
				w.WriteHeader(http.StatusBadRequest) // the number of attempts, not model output, is asserted here
			}))
			defer s.Close()
			cfg := Config{APIFormat: DeepSeekMessages, Endpoint: s.URL + "/v1/messages", APIKey: "synthetic",
				ProviderName: "fixture", Models: []ModelConfig{{ID: "vision", MaxTokens: 128, InputModalities: []string{"text", "image"}}},
				MessagesFilesDirectory: t.TempDir(), MessagesFilesKey: make([]byte, 32), MaxRequests: tc.budget,
				BeforeHTTPAttempt: func() error { audits.Add(1); return nil },
			}
			a, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			h, err := harness.Boot(t.Context(), harness.Options{Adapter: a})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
			agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{CWD: t.TempDir(), Provider: "fixture", Model: "vision"})
			if err != nil {
				t.Fatal(err)
			}
			req := harness.GenerateRequest{Agent: agent, Provider: "fixture", Model: "vision", Messages: []harness.Message{{Role: harness.RoleUser, Content: []harness.ContentBlock{
				{Type: harness.BlockImage, MIMEType: "image/png", Data: ownedPNG(t, 4, 4)},
			}}}}
			_, _ = a.Generate(t.Context(), req, nil)
			if int(attempts.Load()) != tc.wantFirstAttempts || int(audits.Load()) != tc.wantFirstAttempts+1 {
				t.Fatalf("attempts=%d uploads=%d audits=%d", attempts.Load(), uploads.Load(), audits.Load())
			}
			wiresMu.Lock()
			observed := append([][]byte(nil), wires...)
			wiresMu.Unlock()
			var receipts []string
			for _, entry := range agent.Session().Events() {
				if entry.Type != "request/wire-size" {
					continue
				}
				var metric struct {
					SHA string `json:"payload_sha256"`
				}
				if err := json.Unmarshal(entry.Data, &metric); err != nil {
					t.Fatal(err)
				}
				receipts = append(receipts, metric.SHA)
			}
			var want []string
			for _, raw := range observed {
				digest := sha256.Sum256(raw)
				want = append(want, hex.EncodeToString(digest[:]))
			}
			if !slices.Equal(receipts, want) {
				t.Fatalf("wire receipts=%v want %v", receipts, want)
			}
			cfg.MaxRequests = 0
			restored, err := New(cfg)
			if err != nil {
				t.Fatal(err)
			}
			req.Agent = nil
			_, _ = restored.Generate(t.Context(), req, nil)
			wantUploads := int32(1)
			if tc.stale {
				wantUploads++
			}
			if uploads.Load() != wantUploads {
				t.Fatalf("cache reuse after new adapter: uploads=%d want=%d", uploads.Load(), wantUploads)
			}
		})
	}
}

// Observe actual local multipart attempts and inline/file inference fallback.
func TestDeepSeekFilesBacksOffOnlyUploadTimeouts(t *testing.T) {
	type observation struct {
		uploads, audits int32
		source          string
	}
	var uploads, audits atomic.Int32
	var shouldTimeout, inferenceInline atomic.Bool
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/files" {
			n := uploads.Add(1)
			reader, err := r.MultipartReader()
			if err != nil {
				t.Errorf("multipart: %v", err)
				w.WriteHeader(400)
				return
			}
			part, err := reader.NextPart()
			if err != nil {
				t.Errorf("read file part: %v", err)
				w.WriteHeader(400)
				return
			}
			raw, err := io.ReadAll(part)
			if err != nil {
				t.Errorf("read file bytes: %v", err)
				w.WriteHeader(400)
				return
			}
			_, _ = io.Copy(io.Discard, r.Body)
			w.Header().Set("Content-Type", "application/json")
			if shouldTimeout.Load() {
				<-r.Context().Done()
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": fmt.Sprintf("file-%d", n), "type": "file",
				"mime_type": part.Header.Get("Content-Type"), "size_bytes": len(raw), "created_at": time.Now().UTC()})
			return
		}
		var request struct {
			Messages []struct {
				Content []struct{ Source struct{ Type string } }
			}
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || len(request.Messages) != 1 || len(request.Messages[0].Content) != 1 {
			t.Errorf("invalid inference: %v", err)
		} else {
			source := request.Messages[0].Content[0].Source.Type
			if source != "file" && source != "base64" {
				t.Errorf("unexpected image encoding %q", source)
			}
			inferenceInline.Store(source == "base64")
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer provider.Close()
	dir := t.TempDir()
	adapter := func(credential string) *Adapter {
		t.Helper()
		a, err := New(Config{APIFormat: DeepSeekMessages, Endpoint: provider.URL + "/v1/messages", APIKey: credential, ProviderName: "fixture",
			Models:                 []ModelConfig{{ID: "vision", MaxTokens: 128, InputModalities: []string{"text", "image"}}},
			MessagesFilesDirectory: dir, MessagesFilesKey: make([]byte, 32), BeforeHTTPAttempt: func() error { audits.Add(1); return nil }})
		if err != nil {
			t.Fatal(err)
		}
		a.messagesFiles.client.Timeout = 200 * time.Millisecond
		return a
	}
	a, other := adapter("key-a"), adapter("key-b")
	check := func(phase string, use *Adapter, dimension int, timeout bool, want observation) {
		t.Helper()
		shouldTimeout.Store(timeout)
		req := harness.GenerateRequest{Provider: "fixture", Model: "vision", Messages: []harness.Message{{Role: harness.RoleUser,
			Content: []harness.ContentBlock{{Type: harness.BlockImage, MIMEType: "image/png", Data: ownedPNG(t, dimension, dimension)}}}}}
		startUploads, startAudits := uploads.Load(), audits.Load()
		_, _ = use.Generate(t.Context(), req, nil)
		source := "file"
		if inferenceInline.Load() {
			source = "base64"
		}
		if got := (observation{uploads.Load() - startUploads, audits.Load() - startAudits, source}); got != want {
			t.Fatalf("%s: got %+v, want %+v", phase, got, want)
		}
	}
	file := observation{1, 2, "file"}
	cached := observation{0, 1, "file"}
	timedOut := observation{1, 2, "base64"}
	skipped := observation{0, 1, "base64"}
	check("warm cache", a, 4, false, file)
	check("first timeout", a, 5, true, timedOut)
	check("cached image bypasses cooldown", a, 4, false, cached)
	check("credential scoped", other, 5, false, file)
	check("skip one miss", a, 5, false, skipped)
	check("second timeout", a, 5, true, timedOut)
	check("skip two misses (1)", a, 5, false, skipped)
	check("skip two misses (2)", a, 5, false, skipped)
	check("successful probe clears backoff", a, 5, false, file)
	check("timeout restarts at one", a, 6, true, timedOut)
	check("skip once", a, 6, false, skipped)
	check("probe after reset", a, 6, false, file)
}
