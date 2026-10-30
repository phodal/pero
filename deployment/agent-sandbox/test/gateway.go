// Test-only loopback bridge for disposable kind acceptance, not production.
// No credentials are read and no public listener is created inside the Pod.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"sync/atomic"
	"time"
)

// ReverseProxy otherwise logs raw transport errors (which can contain URLs).
type proxyErrorLog struct{ role string }

func (l proxyErrorLog) Write(p []byte) (int, error) {
	log.Printf("fixture_proxy role=%s event=copy_or_upgrade_error", l.role)
	return len(p), nil
}
func proxyFailure(err error) string {
	if errors.Is(err, context.Canceled) {
		return "cancelled"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "deadline"
	}
	return "transport"
}

// A trace observes only transport metadata. It never reads ahead or changes
// the ResponseWriter, so ReverseProxy keeps its native streaming/flush path.
type proxyTrace struct {
	role    string
	ordinal uint64
	bytes   atomic.Int64
}

func (t *proxyTrace) record(event, category string, status int, sse bool) {
	log.Printf("fixture_trace role=%s ordinal=%d at=%d event=%s category=%s status=%d sse=%t bytes=%d", t.role, t.ordinal, time.Now().UTC().UnixNano(), event, category, status, sse, t.bytes.Load())
}

type traceKey struct{}
type observedBody struct {
	io.ReadCloser
	trace *proxyTrace
}

func (b *observedBody) Read(p []byte) (int, error) {
	n, err := b.ReadCloser.Read(p)
	b.trace.bytes.Add(int64(n))
	if err != nil {
		category := proxyFailure(err)
		if errors.Is(err, io.EOF) {
			category = "eof"
		}
		b.trace.record("upstream_read_end", category, 0, false)
	}
	return n, err
}
func (b *observedBody) Close() error {
	err := b.ReadCloser.Close()
	category := "ok"
	if err != nil {
		category = proxyFailure(err)
	}
	b.trace.record("upstream_close", category, 0, false)
	return err
}
func proxyHandler(target, role string) (http.Handler, error) {
	u, err := url.Parse(target)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || net.ParseIP(u.Hostname()) == nil || u.Port() == "" || (role != "cloud" && role != "provider") {
		return nil, fmt.Errorf("test gateway requires an explicit HTTP IP:port target and fixed role")
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	proxy.ErrorLog = log.New(proxyErrorLog{role}, "", 0)
	proxy.ModifyResponse = func(response *http.Response) error {
		if trace, ok := response.Request.Context().Value(traceKey{}).(*proxyTrace); ok {
			mediaType, _, _ := mime.ParseMediaType(response.Header.Get("Content-Type"))
			trace.record("upstream_headers", "ok", response.StatusCode, mediaType == "text/event-stream")
			response.Body = &observedBody{ReadCloser: response.Body, trace: trace}
		}
		return nil
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		if trace, ok := r.Context().Value(traceKey{}).(*proxyTrace); ok {
			trace.record("transport_error", proxyFailure(err), 502, false)
		}
		log.Printf("fixture_proxy role=%s event=transport_error category=%s status=502", role, proxyFailure(err))
		http.Error(w, "fixture upstream unavailable", http.StatusBadGateway)
	}
	var ordinal atomic.Uint64
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Only provider requests need detailed traces; cloud payloads stay opaque.
		if role != "provider" {
			proxy.ServeHTTP(w, r)
			return
		}
		trace := &proxyTrace{role: role, ordinal: ordinal.Add(1)}
		trace.record("started", "ok", 0, false)
		contextLogged := make(chan struct{})
		stop := context.AfterFunc(r.Context(), func() {
			defer close(contextLogged)
			trace.record("downstream_context_done", proxyFailure(r.Context().Err()), 0, false)
		})
		defer func() {
			if !stop() {
				<-contextLogged
			}
		}()
		defer func() {
			recovered := recover()
			category := "ok"
			if recovered != nil {
				category = "panic"
				if recovered == http.ErrAbortHandler {
					category = "abort"
				}
			}
			trace.record("handler_exit", category, 0, false)
			if recovered != nil {
				panic(recovered)
			}
		}()
		proxy.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), traceKey{}, trace)))
	}), nil
}
func gateway(target, listen, role string) error {
	handler, err := proxyHandler(target, role)
	if err != nil {
		return err
	}
	server := &http.Server{Addr: listen, Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	return server.ListenAndServe()
}

func main() {
	cloud := flag.String("cloud-target", "", "synthetic test control-plane HTTP IP:port origin")
	provider := flag.String("provider-target", "", "synthetic test provider HTTP IP:port origin")
	flag.Parse()
	if flag.NArg() != 0 {
		log.Fatal("positional arguments are not supported")
	}
	errors := make(chan error, 2)
	go func() { errors <- gateway(*cloud, "127.0.0.1:8787", "cloud") }()
	go func() { errors <- gateway(*provider, "127.0.0.1:8788", "provider") }()
	log.Fatal(<-errors)
}
