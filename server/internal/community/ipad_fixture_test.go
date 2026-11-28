package community

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/store"
)

// TestIPadTaskFixture supplies the identity and model seams for the installed
// Desktop and Safari acceptance. Tasks and Runs come from the real API.
func TestIPadTaskFixture(t *testing.T) {
	file := os.Getenv("PERO_IPAD_TASK_FIXTURE")
	if file == "" {
		t.Skip("iPad task acceptance fixture is opt-in")
	}
	f := communityHTTP(t)
	ctx := context.Background()
	if err := f.db.CommunityUpsertUser(ctx, 101, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := f.db.CommunityBindWorker(ctx, f.workerID, "alice"); err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("A", 43)
	challenge := sha256.Sum256([]byte(verifier))
	now := time.Now()
	code := random()
	if err := f.db.CreateDesktopGrant(ctx, code, store.DesktopGrant{UserID: 101, Challenge: base64.RawURLEncoding.EncodeToString(challenge[:]), ExpiresAt: now.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	token, err := f.db.ExchangeDesktopGrant(ctx, code, verifier, now)
	if err != nil {
		t.Fatal(err)
	}
	var modelCalls atomic.Int32
	finish := make(chan struct{})
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer ipad-fixture" {
			http.Error(w, "unexpected model request", http.StatusBadRequest)
			return
		}
		if modelCalls.Add(1) != 1 {
			http.Error(w, "duplicate model execution", http.StatusConflict)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, `data: {"id":"ipad","model":"fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"PERO_IPAD_RUNNING "},"finish_reason":null}]}`+"\n\n")
		if http.NewResponseController(w).Flush() != nil {
			return
		}
		select {
		case <-finish:
		case <-r.Context().Done():
			return
		}
		fmt.Fprint(w, `data: {"id":"ipad","model":"fixture","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"PERO_IPAD_COMPLETE"},"finish_reason":"stop"}]}`+"\n\ndata: [DONE]\n\n")
	}))
	t.Cleanup(provider.Close)
	t.Cleanup(provider.CloseClientConnections)
	metadata, err := json.Marshal(map[string]string{"url": f.app.URL, "client": token, "provider": provider.URL + "/v1"})
	if err == nil {
		err = os.WriteFile(file, metadata, 0600)
	}
	if err != nil {
		t.Fatal(err)
	}
	timer := time.NewTimer(15 * time.Minute)
	defer timer.Stop()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	finished := false
	for {
		select {
		case <-timer.C:
			t.Fatal("iPad task acceptance fixture timed out")
		case <-tick.C:
			if !finished {
				if _, err := os.Stat(file + ".finish"); err == nil {
					close(finish)
					finished = true
				}
			}
			if _, err := os.Stat(file + ".stop"); err == nil {
				if count := modelCalls.Load(); count != 1 {
					t.Errorf("observed %d model submissions, want exactly one", count)
				}
				return
			}
		}
	}
}
