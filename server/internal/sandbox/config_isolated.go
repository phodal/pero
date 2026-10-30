package sandbox

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/artifacts/s3"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
	"github.com/phodal/pero/server/internal/runtimeauth"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"github.com/phodal/pero/server/internal/runtimegateway"
	"github.com/phodal/pero/server/internal/store"
)

// ConfiguredProfile is composition-root wiring, not workload data. No member is
// serialized into a Binding or passed to an Agent. Storage credentials belong
// exclusively to the trusted control-plane process.
type ConfiguredProfile struct {
	Runtime  *Runtime
	Gateway  *runtimegateway.Gateway
	Reviewer *runtimeauth.Reviewer
	Objects  *s3.Store
}
type IsolatedFileConfig struct {
	Provider struct {
		Endpoint   string                        `json:"endpoint"`
		Model      string                        `json:"model"`
		APIKeyFile string                        `json:"api_key_file"`
		Budget     runtimechannel.ProviderBudget `json:"budget"`
	} `json:"provider"`
	Artifacts artifacts.Policy `json:"artifacts"`
	Storage   struct {
		Endpoint      string `json:"endpoint"`
		Bucket        string `json:"bucket"`
		Region        string `json:"region"`
		AccessKeyFile string `json:"access_key_file"`
		SecretKeyFile string `json:"secret_key_file"`
	} `json:"storage"`
}

func readSecret(path string, limit int) (string, error) {
	if path == "" {
		return "", fmt.Errorf("explicit credential file required")
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > int64(limit) {
		return "", fmt.Errorf("credential file unavailable")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("credential file unavailable")
	}
	value := strings.TrimSpace(string(data))
	if value == "" || len(value) > limit || strings.ContainsAny(value, "\r\n") {
		return "", fmt.Errorf("invalid credential file")
	}
	return value, nil
}
func loadIsolated(ctx context.Context, db *store.Store, c FileConfig, client *http.Client) (*ConfiguredProfile, error) {
	if c.Isolated == nil {
		return nil, fmt.Errorf("isolated profile requires provider and durable artifact configuration")
	}
	in := c.Isolated
	if in.Provider.Model != c.Runtime.Model {
		return nil, fmt.Errorf("fixed provider model differs from sandbox recipe")
	}
	key, err := readSecret(in.Provider.APIKeyFile, 1024)
	if err != nil {
		return nil, err
	}
	access, err := readSecret(in.Storage.AccessKeyFile, 128)
	if err != nil {
		return nil, err
	}
	secret, err := readSecret(in.Storage.SecretKeyFile, 512)
	if err != nil {
		return nil, err
	}
	objects, err := s3.New(s3.Config{Endpoint: in.Storage.Endpoint, Bucket: in.Storage.Bucket, Region: in.Storage.Region, AccessKey: access, SecretKey: secret})
	if err != nil {
		return nil, err
	}
	reviewer, err := runtimeauth.New(c.APIURL, client)
	if err != nil {
		return nil, err
	}
	gateway, err := runtimegateway.New(db, reviewer, runtimegateway.ProviderConfig{Endpoint: in.Provider.Endpoint, Model: in.Provider.Model, APIKey: key, Budget: in.Provider.Budget})
	if err != nil {
		return nil, err
	}
	cold, err := kubernetes.NewColdOwner(c.APIURL, client, IsolatedConfig(c.Runtime), time.Now)
	if err != nil {
		return nil, err
	}
	runtime, err := NewIsolated(ctx, db, cold, c.Runtime, in.Artifacts)
	if err != nil {
		return nil, err
	}
	return &ConfiguredProfile{Runtime: runtime, Gateway: gateway, Reviewer: reviewer, Objects: objects}, nil
}
