package runtimegateway

import (
	"context"
	"fmt"
	"github.com/phodal/pero/server/internal/runtimeauth"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestLostTransportCannotUsePersistedProviderGrant(t *testing.T) {
	var reviews atomic.Int64
	review := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reviews.Add(1); w.WriteHeader(500) }))
	defer review.Close()
	auth, err := runtimeauth.New(review.URL, review.Client())
	if err != nil {
		t.Fatal(err)
	}
	p := &pair{done: make(chan struct{}), count: 2}
	close(p.done)
	g := &Gateway{reviewer: auth, pairs: map[string]*pair{"run1": p}, ingress: make(chan struct{}, 8), provider: ProviderConfig{Budget: runtimechannel.ProviderBudget{TimeoutSeconds: 1}}}
	request := httptest.NewRequest("POST", "/api/runtime/v1/runs/run1/provider/v1/chat/completions?session_id=run1", strings.NewReader(`{}`))
	request.Header.Set("Authorization", "Bearer synthetic")
	response := httptest.NewRecorder()
	g.Handler().ServeHTTP(deadlineRecorder{response}, request)
	if response.Code != 403 || reviews.Load() != 0 {
		t.Fatalf("closed transport reached external authority: %d %d", response.Code, reviews.Load())
	}
	// Store is deliberately unavailable/nil: immediate local revocation does not
	// depend on a successful DB close receipt after transport loss.
}
func TestProviderIngressCapacityBeforeBodyRead(t *testing.T) {
	g := &Gateway{ingress: make(chan struct{}, 1), provider: ProviderConfig{Budget: runtimechannel.ProviderBudget{TimeoutSeconds: 1}}}
	g.ingress <- struct{}{}
	response := httptest.NewRecorder()
	g.Handler().ServeHTTP(deadlineRecorder{response}, httptest.NewRequest("POST", "/api/runtime/v1/runs/run1/provider/v1/chat/completions", nil))
	if response.Code != 429 {
		t.Fatal(response.Code)
	}
}
func TestJSONLineLimit(t *testing.T) {
	for _, body := range []string{"{}", strings.Repeat("x", runtimechannel.MaxLineBytes) + "\n", "not-json\n"} {
		var out strings.Builder
		var budget atomic.Int64
		if e := copyJSONLines(&out, strings.NewReader(body), &budget); e == nil || out.Len() != 0 {
			t.Fatal("invalid line forwarded")
		}
	}
}

type deadlineRecorder struct{ *httptest.ResponseRecorder }

func (deadlineRecorder) SetReadDeadline(time.Time) error  { return nil }
func (deadlineRecorder) SetWriteDeadline(time.Time) error { return nil }
func TestMissingDeadlineSupportFailsClosed(t *testing.T) {
	g := &Gateway{provider: ProviderConfig{Budget: runtimechannel.ProviderBudget{TimeoutSeconds: 1}}}
	for _, path := range []string{"/api/runtime/v1/runs/r/channel/agent", "/api/runtime/v1/runs/r/provider/v1/chat/completions"} {
		w := httptest.NewRecorder()
		g.Handler().ServeHTTP(w, httptest.NewRequest("POST", path, nil))
		if w.Code != 500 {
			t.Fatal(path, w.Code)
		}
	}
}
func TestHTTPDeadlinesBoundStalledTransport(t *testing.T) {
	for _, mode := range []string{"read", "write"} {
		t.Run(mode, func(t *testing.T) {
			done := make(chan error, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				rc := http.NewResponseController(w)
				if e := rc.EnableFullDuplex(); e != nil {
					done <- e
					return
				}
				if mode == "read" {
					if e := rc.SetReadDeadline(time.Now().Add(200 * time.Millisecond)); e != nil {
						done <- e
						return
					}
					_, e := io.ReadAll(r.Body)
					done <- e
				} else {
					if e := rc.SetWriteDeadline(time.Now().Add(200 * time.Millisecond)); e != nil {
						done <- e
						return
					}
					chunk := make([]byte, 1<<20)
					for {
						if _, e := w.Write(chunk); e != nil {
							done <- e
							return
						}
						if e := rc.Flush(); e != nil {
							done <- e
							return
						}
					}
				}
			}))
			defer server.Close()
			conn, e := net.Dial("tcp", strings.TrimPrefix(server.URL, "http://"))
			if e != nil {
				t.Fatal(e)
			}
			defer conn.Close()
			fmt.Fprintf(conn, "POST / HTTP/1.1\r\nHost: fixture\r\nContent-Length: 10\r\n\r\n")
			ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
			defer cancel()
			select {
			case e := <-done:
				if e == nil {
					t.Fatal("stalled transport unexpectedly completed")
				}
			case <-ctx.Done():
				t.Fatal("transport deadline did not interrupt I/O")
			}
		})
	}
}

func TestActualProviderRouteBoundsStalledBody(t *testing.T) {
	review := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"status":{"authenticated":true,"audiences":["pero-runtime"],"user":{"username":"system:serviceaccount:fixture:agent","uid":"sa1","extra":{"authentication.kubernetes.io/pod-uid":["pod1"]}}}}`)
	}))
	defer review.Close()
	auth, e := runtimeauth.New(review.URL, review.Client())
	if e != nil {
		t.Fatal(e)
	}
	p := &pair{done: make(chan struct{}), count: 2}
	g := &Gateway{reviewer: auth, pairs: map[string]*pair{"run1": p}, ingress: make(chan struct{}, 8), provider: ProviderConfig{Budget: runtimechannel.ProviderBudget{TimeoutSeconds: 10, MaxRequestBytes: 1024}}}
	finished := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { g.Handler().ServeHTTP(w, r); close(finished) }))
	defer server.Close()
	conn, e := net.Dial("tcp", strings.TrimPrefix(server.URL, "http://"))
	if e != nil {
		t.Fatal(e)
	}
	defer conn.Close()
	fmt.Fprintf(conn, "POST /api/runtime/v1/runs/run1/provider/v1/chat/completions?session_id=run1 HTTP/1.1\r\nHost: fixture\r\nAuthorization: Bearer fixture\r\nContent-Length: 100\r\n\r\n{")
	ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
	defer cancel()
	select {
	case <-finished:
		if len(g.ingress) != 0 {
			t.Fatal("stalled ingress slot leaked")
		}
	case <-ctx.Done():
		conn.Close()
		t.Fatal("actual provider route did not bound stalled body")
	}
}

func TestProviderRejectionFlushesBeforeNormalContextClose(t *testing.T) {
	review := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"status":{"authenticated":true,"audiences":["pero-runtime"],"user":{"username":"system:serviceaccount:fixture:agent","uid":"sa1","extra":{"authentication.kubernetes.io/pod-uid":["pod1"]}}}}`)
	}))
	defer review.Close()
	auth, e := runtimeauth.New(review.URL, review.Client())
	if e != nil {
		t.Fatal(e)
	}
	g := &Gateway{reviewer: auth, pairs: map[string]*pair{"run1": {done: make(chan struct{}), count: 2}}, ingress: make(chan struct{}, 8), provider: ProviderConfig{Model: "fixed", Budget: runtimechannel.ProviderBudget{TimeoutSeconds: 5, MaxRequestBytes: 1024, MaxOutputTokens: 32}}}
	server := httptest.NewServer(g.Handler())
	defer server.Close()
	for range 20 {
		req, _ := http.NewRequest("POST", server.URL+"/api/runtime/v1/runs/run1/provider/v1/chat/completions?session_id=run1", strings.NewReader(`{"model":"wrong","messages":[{"role":"user","content":"hello"}]}`))
		req.Header.Set("Authorization", "Bearer fixture")
		response, e := server.Client().Do(req)
		if e != nil {
			t.Fatal("normal rejection lost reply", e)
		}
		_, e = io.ReadAll(response.Body)
		response.Body.Close()
		if e != nil || response.StatusCode != 400 {
			t.Fatal(response.StatusCode, e)
		}
	}
}
