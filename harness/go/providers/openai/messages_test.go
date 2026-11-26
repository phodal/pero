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
