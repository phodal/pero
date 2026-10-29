// Test-only loopback bridge for disposable kind acceptance, not production.
// No credentials are read and no public listener is created inside the Pod.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"
)

func gateway(target, listen string) error {
	u, err := url.Parse(target)
	if err != nil || u.Scheme != "http" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || net.ParseIP(u.Hostname()) == nil || u.Port() == "" {
		return fmt.Errorf("test gateway requires an explicit HTTP IP:port target")
	}
	proxy := httputil.NewSingleHostReverseProxy(u)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
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
	go func() { errors <- gateway(*cloud, "127.0.0.1:8787") }()
	go func() { errors <- gateway(*provider, "127.0.0.1:8788") }()
	log.Fatal(<-errors)
}
