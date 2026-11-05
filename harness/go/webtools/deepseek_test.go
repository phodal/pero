package webtools

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const searchResponse = `{"results":[{"url":"https://docs.example.com/a","title":"Verified source","snippet":"short","summary":"verified summary","date":null},{"url":"https://example.com.evil.test/a","title":"wrong host","snippet":"short","summary":"excluded summary","date":null}]}`

func TestDeepSeekAttemptsAndProtocol(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		if r.Method != "POST" || r.Header.Get("Authorization") != "Bearer fixture-placeholder" || r.Header.Get("Content-Type") != "application/json" {
			t.Error("wrong provider request protocol")
		}
		switch r.URL.Path {
		case "/v1/tools/search":
			var body struct {
				Query string
				Count int
				Need  bool `json:"need_content"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body.Query != "latest requirements site:example.com" || body.Count != MaxSources || body.Need {
				t.Errorf("invalid search body: %+v", body)
			}
			fmt.Fprint(w, searchResponse)
		case "/v1/tools/fetch":
			var body struct{ URL string }
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body.URL != "https://example.com/a" {
				t.Errorf("wrong fetch target: %s", body.URL)
			}
			fmt.Fprint(w, `{"title":"Article","content":"# Retrieved content"}`)
		default:
			t.Error("unexpected provider endpoint")
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	provider, err := NewDeepSeek(DeepSeekOptions{Endpoint: server.URL + "/v1/tools", APIKey: "fixture-placeholder", MaxRequests: 2})
	if err != nil {
		t.Fatal(err)
	}
	defer provider.Close()
	query, _ := NewSearchQuery("latest requirements", []string{"example.com"}, nil)
	cancelled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := provider.Search(cancelled, query); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	result, err := provider.Search(t.Context(), query)
	if err != nil || len(result.Sources) != 1 || result.Filtered != 1 {
		t.Fatalf("%+v %v", result, err)
	}
	target, _ := NewPageURL("https://example.com/a")
	page, err := provider.Fetch(t.Context(), target)
	if err != nil || page.Markdown != "# Retrieved content" {
		t.Fatalf("%+v %v", page, err)
	}
	if _, err := provider.Search(t.Context(), query); !errors.Is(err, ErrRequestBudget) || attempts.Load() != 2 {
		t.Fatalf("attempts=%d error=%v", attempts.Load(), err)
	}
}

func TestDeepSeekFailuresDoNotRetryRedirectOrLeak(t *testing.T) {
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1); fmt.Fprint(w, searchResponse) }))
	defer target.Close()
	for _, test := range []struct {
		name     string
		status   int
		body     string
		redirect bool
	}{
		{"redirect", 302, "response-secret", true}, {"server failure", 503, "response-secret", false}, {"invalid JSON", 200, "response-secret", false}, {"missing typed fields", 200, `{"results":[{"url":"response-secret"}]}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var attempts atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				attempts.Add(1)
				if test.redirect {
					w.Header().Set("Location", target.URL)
				}
				w.WriteHeader(test.status)
				fmt.Fprint(w, test.body)
			}))
			defer server.Close()
			provider, err := NewDeepSeek(DeepSeekOptions{Endpoint: server.URL, APIKey: "credential-secret", MaxRequests: 4})
			if err != nil {
				t.Fatal(err)
			}
			defer provider.Close()
			query, _ := NewSearchQuery("details", nil, nil)
			_, err = provider.Search(t.Context(), query)
			if err == nil || strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), server.URL) || attempts.Load() != 1 || redirected.Load() != 0 {
				t.Fatalf("attempts=%d redirect=%d error=%v", attempts.Load(), redirected.Load(), err)
			}
		})
	}
}

func TestDeepSeekConcurrentBudgetAndCancellation(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { attempts.Add(1); fmt.Fprint(w, searchResponse) }))
	defer server.Close()
	provider, err := NewDeepSeek(DeepSeekOptions{Endpoint: server.URL, APIKey: "fixture-placeholder", MaxRequests: 3})
	if err != nil {
		t.Fatal(err)
	}
	defer provider.Close()
	query, _ := NewSearchQuery("details", nil, nil)
	var successes atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := provider.Search(t.Context(), query)
			if err == nil {
				successes.Add(1)
			} else if !errors.Is(err, ErrRequestBudget) {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if successes.Load() != 3 || attempts.Load() != 3 {
		t.Fatalf("successes=%d attempts=%d", successes.Load(), attempts.Load())
	}
	entered, aborted, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
	blocking := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.Copy(io.Discard, r.Body)
		_ = r.Body.Close()
		fmt.Fprint(w, `{"results":`)
		w.(http.Flusher).Flush()
		close(entered)
		select {
		case <-r.Context().Done():
		case <-release:
		}
		close(aborted)
	}))
	defer blocking.Close()
	defer close(release)
	other, err := NewDeepSeek(DeepSeekOptions{Endpoint: blocking.URL, APIKey: "fixture-placeholder", MaxRequests: 1})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	bound, stop := context.WithTimeout(t.Context(), 5*time.Second)
	defer stop()
	done := make(chan error, 1)
	go func() { _, err := other.Search(ctx, query); done <- err }()
	select {
	case <-entered:
	case <-bound.Done():
		t.Fatal(bound.Err())
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatal(err)
		}
	case <-bound.Done():
		t.Fatal(bound.Err())
	}
	select {
	case <-aborted:
	case <-bound.Done():
		t.Fatal(bound.Err())
	}
}
