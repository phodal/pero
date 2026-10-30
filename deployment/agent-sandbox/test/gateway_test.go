package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProxyDiagnosticsRedactTransportDetails(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want string
	}{
		{errors.New("http://synthetic.invalid/private?key=synthetic-secret"), "transport"},
		{errors.Join(context.Canceled, errors.New("synthetic-secret")), "cancelled"},
		{context.DeadlineExceeded, "deadline"},
	} {
		if got := proxyFailure(tc.err); got != tc.want {
			t.Fatalf("category=%q want=%q", got, tc.want)
		}
	}
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	raw := []byte("httputil: raw upstream URL and synthetic-secret")
	if n, err := (proxyErrorLog{role: "provider"}).Write(raw); err != nil || n != len(raw) {
		t.Fatalf("write: %d %v", n, err)
	}
	if strings.Contains(output.String(), "synthetic-secret") || !strings.Contains(output.String(), "fixture_proxy role=provider event=copy_or_upgrade_error") {
		t.Fatalf("unsafe diagnostic %q", output.String())
	}
}

func TestObservedBodyPreservesReadsAndErrors(t *testing.T) {
	wantErr := errors.New("synthetic-secret upstream failure")
	source := &traceTestBody{err: wantErr}
	body := &observedBody{ReadCloser: source, trace: &proxyTrace{role: "provider", ordinal: 1}}
	if source.reads != 0 {
		t.Fatal("read ahead")
	}
	buffer := make([]byte, 16)
	n, err := body.Read(buffer)
	if n != 3 || string(buffer[:n]) != "abc" || err != wantErr || source.reads != 1 || body.trace.bytes.Load() != 3 {
		t.Fatalf("read changed: n=%d err=%v", n, err)
	}
	if err := body.Close(); err != wantErr || source.closes != 1 {
		t.Fatal("close changed")
	}
}

type traceTestBody struct {
	reads, closes int
	err           error
}

func (b *traceTestBody) Read(p []byte) (int, error) { b.reads++; return copy(p, "abc"), b.err }
func (b *traceTestBody) Close() error               { b.closes++; return b.err }

func TestProxyTracePreservesStreamingAndCancellation(t *testing.T) {
	var output bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&output)
	defer log.SetOutput(previous)
	upstreamDone := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(upstreamDone)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: synthetic-secret\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer upstream.Close()
	handler, err := proxyHandler(upstream.URL, "provider")
	if err != nil {
		t.Fatal(err)
	}
	handlerDone := make(chan struct{})
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { defer close(handlerDone); handler.ServeHTTP(w, r) }))
	defer proxy.Close()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, proxy.URL+"/synthetic-secret?key=synthetic-secret", nil)
	response, err := proxy.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	want := "data: synthetic-secret\n\n"
	got := make([]byte, len(want))
	if _, err := io.ReadFull(response.Body, got); err != nil || string(got) != want {
		t.Fatalf("stream/flush changed: %q %v", got, err)
	}
	cancel()
	select {
	case <-upstreamDone:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream cancellation not propagated")
	}
	select {
	case <-handlerDone:
	case <-time.After(5 * time.Second):
		t.Fatal("proxy did not finish")
	}
	proxy.CloseClientConnections()
	proxy.Close()
	text := output.String()
	if strings.Contains(text, "synthetic-secret") || strings.Contains(text, upstream.URL) || !strings.Contains(text, "event=upstream_headers category=ok status=200 sse=true") || !strings.Contains(text, "event=handler_exit") {
		t.Fatalf("unsafe or incomplete metadata: %s", text)
	}
}
