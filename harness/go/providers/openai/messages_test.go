package openai

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

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
