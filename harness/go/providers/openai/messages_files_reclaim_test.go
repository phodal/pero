package openai

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/providers/messages"
)

func TestDeepSeekFilesReclaimsOnlyExactOwnedNearExpiryReceipt(t *testing.T) {
	for _, tc := range []struct {
		name, failure      string
		enabled, malformed bool
		budget             int
		want               string
	}{
		{"owned", "storage_quota_exceeded", true, false, 5, "POST,GET,DELETE,POST,file"},
		{"rate limit", "rate_limit_error", true, false, 5, "POST,base64"},
		{"authentication", "authentication_error", true, false, 5, "POST,base64"},
		{"persistent quota", "file_count_limit_exceeded", true, false, 5, "POST,GET,DELETE,POST,base64"},
		{"off by default", "storage_quota_exceeded", false, false, 5, "POST,base64"},
		{"malformed shared listing", "storage_quota_exceeded", true, true, 5, "POST,GET,base64"},
		{"insufficient recovery budget", "storage_quota_exceeded", true, false, 4, "POST,base64"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			type file struct {
				ID       string    `json:"id"`
				Type     string    `json:"type"`
				Filename string    `json:"filename"`
				MIME     string    `json:"mime_type"`
				Bytes    int       `json:"size_bytes"`
				Created  time.Time `json:"created_at"`
			}
			var mu sync.Mutex
			var events []string
			var audits atomic.Int32
			bootstrapping := true
			shared := []file{
				{ID: "file-legacy", Type: "file", Filename: "image.png"},
				{ID: "file-document", Type: "file", Filename: "paper.pdf"},
			}
			deleted := false
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				defer mu.Unlock()
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/v1/messages" {
					var wire struct {
						Messages []struct {
							Content []struct{ Source struct{ Type string } }
						}
					}
					if err := json.NewDecoder(r.Body).Decode(&wire); err != nil || len(wire.Messages) != 1 || len(wire.Messages[0].Content) != 1 {
						t.Errorf("unexpected inference body: %v", err)
						w.WriteHeader(400)
						return
					}
					events = append(events, wire.Messages[0].Content[0].Source.Type)
					w.WriteHeader(400)
					return
				}
				if r.Header.Get("Anthropic-Beta") != messagesFilesBeta {
					t.Error("missing Files API negotiation")
				}
				key := r.Header.Get("X-API-Key")
				if !bootstrapping {
					events = append(events, r.Method)
					if key != "a" {
						t.Errorf("unexpected reclaim key %q", key)
					}
				}
				switch r.Method {
				case http.MethodPost:
					if !bootstrapping && (!deleted || tc.name == "persistent quota") {
						status := http.StatusTooManyRequests
						if tc.name == "authentication" {
							status = http.StatusForbidden
						}
						w.WriteHeader(status)
						_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": tc.failure}})
						return
					}
					reader, err := r.MultipartReader()
					if err != nil {
						t.Error(err)
						w.WriteHeader(400)
						return
					}
					part, err := reader.NextPart()
					if err != nil {
						t.Error(err)
						w.WriteHeader(400)
						return
					}
					raw, _ := io.ReadAll(part)
					row := file{ID: fmt.Sprintf("file-%s-%d", key, len(shared)), Type: "file", Filename: part.FileName(), MIME: part.Header.Get("Content-Type"), Bytes: len(raw), Created: time.Now()}
					shared = append(shared, row)
					_ = json.NewEncoder(w).Encode(row)
				case http.MethodGet:
					if tc.malformed {
						_, _ = io.WriteString(w, `{"data":[{"id":"broken"}]}`)
						return
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"data": shared})
				case http.MethodDelete:
					if r.URL.Path != "/v1/files/file-a-3" || deleted {
						t.Errorf("unexpected delete %s", r.URL.Path)
						w.WriteHeader(400)
						return
					}
					deleted = true
					_, _ = io.WriteString(w, `{"id":"file-a-3","type":"file_deleted"}`)
				default:
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
					w.WriteHeader(400)
				}
			}))
			defer server.Close()
			dir := t.TempDir()
			newAdapter := func(key string, reclaim bool, budget int) *Adapter {
				a, err := New(Config{APIFormat: DeepSeekMessages, Endpoint: server.URL + "/v1/messages", APIKey: key, ProviderName: "fixture",
					Models: []ModelConfig{{ID: "vision", MaxTokens: 128, InputModalities: []string{"text", "image"}}}, MaxRequests: budget,
					MessagesFilesDirectory: dir, MessagesFilesKey: make([]byte, 32), MessagesFilesReclaim: reclaim,
					BeforeHTTPAttempt: func() error { audits.Add(1); return nil }})
				if err != nil {
					t.Fatal(err)
				}
				return a
			}
			// B is visible in the same account listing and older in the fixture.
			// Both uploads use the actual tagging/echo path, not fabricated IDs.
			for _, key := range []string{"b", "a", "a"} {
				a := newAdapter(key, true, 0)
				source := messages.ImageSource{MediaType: "image/png", Data: ownedPNG(t, 4, 4)}
				record, err := a.messagesFiles.upload(t.Context(), key, source, time.Now())
				if err != nil {
					t.Fatal(err)
				}
				path := a.messagesFiles.ownedReceipt(record.ID)
				receipt := readMessagesFileRecord(path)
				if receipt.ID != record.ID || !strings.HasPrefix(receipt.Filename, "pero-") {
					t.Fatalf("missing exact upload receipt: %+v", receipt)
				}
				if receipt.ID != "file-a-4" {
					receipt.Expires = time.Now().Add(30 * time.Minute)
					writeMessagesFileRecord(path, receipt)
				}
			}
			mu.Lock()
			bootstrapping = false
			mu.Unlock()
			audits.Store(0)
			a := newAdapter("a", tc.enabled, tc.budget)
			_, _ = a.Generate(t.Context(), harness.GenerateRequest{Provider: "fixture", Model: "vision", Messages: []harness.Message{{Role: harness.RoleUser,
				Content: []harness.ContentBlock{{Type: harness.BlockImage, MIMEType: "image/png", Data: ownedPNG(t, 5, 5)}}}}}, nil)
			mu.Lock()
			got := strings.Join(events, ",")
			count := len(events)
			mu.Unlock()
			if got != tc.want || audits.Load() != int32(count) || a.requests.Load() != int64(count) {
				t.Fatalf("requests=%q audits=%d reserved=%d; want %q with one audit and debit each", got, audits.Load(), a.requests.Load(), tc.want)
			}
		})
	}
}
