// Test-only loopback bridge for disposable kind acceptance, not production.
// No credentials are read and no public listener is created inside the Pod.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
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

func gateway(target, listen, role string) error {
	u, err := url.Parse(target)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || net.ParseIP(u.Hostname()) == nil || u.Port() == "" {
		return fmt.Errorf("test gateway requires an explicit HTTP IP:port target")
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	proxy.ErrorLog = log.New(proxyErrorLog{role}, "", 0)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, err error) {
		log.Printf("fixture_proxy role=%s event=transport_error category=%s status=502", role, proxyFailure(err))
		http.Error(w, "fixture upstream unavailable", http.StatusBadGateway)
	}
	server := &http.Server{Addr: listen, Handler: proxy, ReadHeaderTimeout: 5 * time.Second}
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
