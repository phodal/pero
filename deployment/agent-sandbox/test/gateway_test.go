package main

import (
	"bytes"
	"context"
	"errors"
	"log"
	"strings"
	"testing"
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
