package main

import (
	"flag"
	"os"
	"strings"
	"testing"
)

func TestWebConfigurationIsExplicitAndRemovesCredentials(t *testing.T) {
	flags := flag.NewFlagSet("web-config", flag.ContinueOnError)
	options := bindWebOptions(flags)
	t.Setenv("PERO_EXPLICIT_WEB_TEST_KEY", "fixture-placeholder")
	options.APIKeyEnv = "PERO_EXPLICIT_WEB_TEST_KEY"
	provider, err := configuredWeb(*options, "different-key", "")
	if err != nil || provider != nil || options.enabled() || os.Getenv(options.APIKeyEnv) == "" {
		t.Fatalf("disabled web read credentials: %v", err)
	}
	options.Provider = "deepseek-api"
	provider, err = configuredWeb(*options, "different-key", "")
	if err != nil {
		t.Fatal(err)
	}
	defer provider.Close()
	if os.Getenv(options.APIKeyEnv) != "" {
		t.Fatal("web credential remains available to child processes")
	}
	options.APIKeyEnv = "already-removed-primary-key"
	shared, err := configuredWeb(*options, options.APIKeyEnv, "shared-fixture-placeholder")
	if err != nil {
		t.Fatal(err)
	}
	defer shared.Close()
	options.Provider = "unknown"
	if _, err := configuredWeb(*options, "primary", ""); err == nil {
		t.Fatal("unknown provider accepted")
	}
	options.Provider = "deepseek-api"
	options.Endpoint = "http://example.com/secret-endpoint"
	if _, err := configuredWeb(*options, options.APIKeyEnv, "secret-credential"); err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatalf("endpoint failure exposed configured values: %v", err)
	}
}
