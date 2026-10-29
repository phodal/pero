// The trusted collector receives only an exact export identity and a projected
// Pod-bound token. S3 credentials and object-store URLs remain in the server.
package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/artifacts/collector"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run() error {
	control := flag.String("control-url", "", "trusted HTTPS control-plane origin")
	id := flag.String("export-id", "", "original export operation ID")
	token := flag.String("token-file", "", "projected pero-export audience token file")
	root := flag.String("root", "/data", "exact retained volume read-only mount")
	ca := flag.String("ca-file", "", "optional control-plane CA certificate")
	loopback := flag.Bool("loopback-http", false, "allow literal loopback HTTP for tests only")
	flag.Parse()
	base, err := url.Parse(*control)
	if err != nil || base.Host == "" || base.User != nil || base.RawQuery != "" || base.Fragment != "" || (base.Path != "" && base.Path != "/") || !regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`).MatchString(*id) || *token == "" || flag.NArg() != 0 {
		return errors.New("invalid trusted collector configuration")
	}
	if base.Scheme != "https" {
		ip := net.ParseIP(base.Hostname())
		if base.Scheme != "http" || !*loopback || ip == nil || !ip.IsLoopback() {
			return errors.New("collector requires HTTPS")
		}
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.MaxResponseHeaderBytes = 32 << 10
	if *ca != "" {
		file, err := os.Open(*ca)
		if err != nil {
			return errors.New("collector CA unavailable")
		}
		pem, err := io.ReadAll(io.LimitReader(file, (1<<20)+1))
		_ = file.Close()
		if err != nil || len(pem) > 1<<20 {
			return errors.New("collector CA unavailable")
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return errors.New("collector CA invalid")
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}
	}
	c := &controlClient{origin: strings.TrimSuffix(*control, "/"), id: *id, tokenFile: *token, client: &http.Client{Transport: transport, Timeout: 2 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	ctx, cancel := context.WithTimeout(context.Background(), artifacts.MaxCollectionDuration)
	defer cancel()
	var e artifacts.Export
	if err = c.plan(ctx, &e); err != nil {
		return err
	}
	if e.ID != *id {
		return artifacts.ErrConflict
	}
	if e.Phase == artifacts.Committed && e.Manifest != nil {
		fmt.Println(e.Manifest.Digest)
		return nil
	}
	if e.Quiescence == nil {
		return artifacts.ErrNotReady
	}
	// The original quiescence timestamp is stable across collector restarts;
	// response loss cannot produce a second manifest solely due to wall time.
	m, err := collector.Collect(ctx, e, *root, c, e.Quiescence.ObservedAt)
	if err != nil {
		return err
	}
	body, err := json.Marshal(m)
	if err != nil {
		return err
	}
	var receipt artifacts.Export
	if err = c.request(ctx, http.MethodPost, "/commit", bytes.NewReader(body), int64(len(body)), "", &receipt); err != nil {
		return err
	}
	if receipt.Manifest == nil || receipt.Manifest.Digest != m.Digest || receipt.Source != e.Source {
		return artifacts.ErrConflict
	}
	fmt.Println(receipt.Manifest.Digest)
	return nil
}

type controlClient struct {
	origin, id, tokenFile string
	client                *http.Client
}

func (c *controlClient) Put(ctx context.Context, e artifacts.Entry, r io.Reader) error {
	var receipt artifacts.Entry
	if err := c.request(ctx, http.MethodPut, "/files/"+e.ID, r, e.Bytes, e.SHA256, &receipt); err != nil {
		return err
	}
	if receipt != e {
		return artifacts.ErrConflict
	}
	return nil
}

func (c *controlClient) request(ctx context.Context, method, suffix string, body io.Reader, size int64, digest string, result any) error {
	f, err := os.Open(c.tokenFile)
	if err != nil {
		return errors.New("collector identity unavailable")
	}
	token, err := io.ReadAll(io.LimitReader(f, (32<<10)+1))
	_ = f.Close()
	if err != nil || len(token) == 0 || len(token) > 32<<10 {
		return errors.New("collector identity invalid")
	}
	req, err := http.NewRequestWithContext(ctx, method, c.origin+"/api/artifact-export/v1/"+c.id+suffix, body)
	if err != nil {
		return errors.New("collector request invalid")
	}
	req.ContentLength = size
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(string(token)))
	if digest != "" {
		req.Header.Set("X-Artifact-Sha256", digest)
	}
	response, err := c.client.Do(req)
	if err != nil {
		return errors.New("collector control-plane request unconfirmed; original export retained")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return controlStatus(response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, artifacts.MaxManifestBytes+1))
	if err != nil || len(data) > artifacts.MaxManifestBytes {
		return errors.New("collector response exceeds contract")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(result); err != nil {
		return errors.New("collector response invalid")
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF {
		return errors.New("collector response exceeds contract")
	}
	return nil
}

type controlStatus int

func (s controlStatus) Error() string {
	return fmt.Sprintf("collector request status %d; original export retained", s)
}

// Initial registration alone may be pending while the controller persists the
// actual Job Pod UID. Other failures and all mutations are never blindly retried.
func (c *controlClient) plan(ctx context.Context, e *artifacts.Export) error {
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	for {
		err := c.request(ctx, http.MethodGet, "", nil, 0, "", e)
		if err != controlStatus(http.StatusTooEarly) {
			return err
		}
		timer := time.NewTimer(250 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}
