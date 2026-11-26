package openai

import (
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
