package sandbox

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/store"
)

// FileConfig is control-plane-only configuration. Credentials are never put in
// a Binding, Claim, Worker Pod, event, result, or Agent environment.
type FileConfig struct {
	Runtime   runtimebinding.Config `json:"runtime"`
	APIURL    string                `json:"api_url"`
	TokenFile string                `json:"token_file"`
	CAFile    string                `json:"ca_file"`
	Isolated  *IsolatedFileConfig   `json:"isolated,omitempty"`
}

type bearerTransport struct {
	tokenFile string
	base      http.RoundTripper
}

func (t bearerTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	value, err := readSecret(t.tokenFile, 16*1024)
	if err != nil {
		return nil, err
	}
	copy := req.Clone(req.Context())
	copy.Header = req.Header.Clone()
	copy.Header.Set("Authorization", "Bearer "+value)
	return t.base.RoundTrip(copy)
}

func FromFile(ctx context.Context, db *store.Store, path string) (*Runtime, error) {
	profile, err := LoadProfile(ctx, db, path)
	if err != nil {
		return nil, err
	}
	return profile.Runtime, nil
}
func LoadProfile(ctx context.Context, db *store.Store, path string) (*ConfiguredProfile, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("sandbox configuration is unavailable")
	}
	defer file.Close()
	decoder := json.NewDecoder(io.LimitReader(file, 64*1024))
	decoder.DisallowUnknownFields()
	var config FileConfig
	if err = decoder.Decode(&config); err != nil {
		return nil, fmt.Errorf("invalid sandbox configuration")
	}
	if err = decoder.Decode(new(any)); err != io.EOF || config.Runtime.Validate() != nil || config.TokenFile == "" {
		return nil, runtimebinding.ErrInvalid
	}
	if _, err = readSecret(config.TokenFile, 16*1024); err != nil {
		return nil, err
	}
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if config.CAFile != "" {
		data, err := os.ReadFile(config.CAFile)
		if err != nil {
			return nil, fmt.Errorf("sandbox API CA file is unavailable")
		}
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM(data) {
			return nil, fmt.Errorf("invalid sandbox API CA")
		}
		tlsConfig.RootCAs = roots
	}
	// Do not inherit HTTP_PROXY or ambient kubeconfig/service-account credentials.
	transport := &http.Transport{TLSClientConfig: tlsConfig, ResponseHeaderTimeout: 3 * time.Second, IdleConnTimeout: 30 * time.Second}
	client := &http.Client{Transport: bearerTransport{config.TokenFile, transport}, Timeout: 4 * time.Second}
	if config.Runtime.IsIsolated() {
		return loadIsolated(ctx, db, config, client)
	}
	if config.Isolated != nil {
		return nil, runtimebinding.ErrInvalid
	}
	reader, err := kubernetes.NewHTTPReader(config.APIURL, client)
	if err != nil {
		return nil, err
	}
	writer, err := kubernetes.NewHTTPWriter(config.APIURL, client)
	if err != nil {
		return nil, err
	}
	owner, err := kubernetes.NewOwner(config.Runtime.ClusterID, []string{config.Runtime.Namespace}, reader, time.Now)
	if err != nil {
		return nil, err
	}
	claims, err := kubernetes.NewClaimOwner(owner, writer, kubernetes.ClaimConfig{Namespace: config.Runtime.Namespace, WarmPool: config.Runtime.WarmPool, TTL: time.Duration(config.Runtime.TTLSeconds) * time.Second, ShutdownPolicy: "DeleteForeground", Recipe: config.Runtime.Recipe()})
	if err != nil {
		return nil, err
	}
	runtime, err := New(ctx, db, claims, config.Runtime)
	if err != nil {
		return nil, err
	}
	return &ConfiguredProfile{Runtime: runtime}, nil
}
