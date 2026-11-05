package main

import (
	"flag"
	"os"
	"path/filepath"
	"testing"
)

func TestExplicitModelProfile(t *testing.T) {
	for _, row := range []struct {
		name, raw string
		args      []string
		failed    bool
		tokens    int
		thinking  bool
	}{
		{"profile defaults", `{"version":1,"id":"trial","model":"declared","settings":{"max_output_tokens":8192,"disable_thinking":true,"context_window":64000}}`, nil, false, 8192, true},
		{"explicit zero and false", `{"version":1,"id":"trial","model":"declared","settings":{"max_output_tokens":8192,"disable_thinking":true}}`, []string{"--max-tokens=0", "--disable-thinking=false"}, false, 0, false},
		{"model mismatch", `{"version":1,"id":"trial","model":"other"}`, []string{"--model=declared"}, true, 0, false},
		{"unknown field", `{"version":1,"id":"trial","model":"declared","api_key":"forbidden"}`, nil, true, 0, false},
		{"trailing object", `{"version":1,"id":"trial","model":"declared"} {}`, nil, true, 0, false},
		{"unknown version", `{"version":2,"id":"trial","model":"declared"}`, nil, true, 0, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "profile.json")
			if err := os.WriteFile(path, []byte(row.raw), 0600); err != nil {
				t.Fatal(err)
			}
			f := flag.NewFlagSet("test", flag.ContinueOnError)
			model := f.String("model", "", "")
			f.String("tool-format", "auto", "")
			budget := bindProviderBudget(f)
			compact := bindCompaction(f)
			if err := f.Parse(row.args); err != nil {
				t.Fatal(err)
			}
			identity, err := loadModelProfile(path, f)
			if (err != nil) != row.failed {
				t.Fatalf("identity=%+v error=%v", identity, err)
			}
			if row.failed {
				return
			}
			provider, err := configuredProvider("https://example.invalid", *model, "", *budget)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = configuredCompaction(&provider, *compact); err != nil {
				t.Fatal(err)
			}
			if identity.ID != "trial" || len(identity.SHA256) != 64 || *model != "declared" || provider.MaxOutputTokens != row.tokens || provider.DisableThinking != row.thinking {
				t.Fatalf("identity=%+v provider=%+v", identity, provider)
			}
		})
	}
}
