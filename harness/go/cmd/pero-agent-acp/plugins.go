package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"time"

	"github.com/phodal/pero/harness/go/plugins"
)

// Plugin inspection is dispatched before provider flags and credentials are
// touched. It is a local configuration command, separate from ACP transport.
func runPlugins(args []string, output io.Writer) error {
	if len(args) > 0 && args[0] == "fetch" {
		if len(args) != 3 && len(args) != 4 {
			return errors.New("usage: pero-agent-acp plugins fetch GIT_SOURCE CACHE_DIRECTORY [REF]")
		}
		ref := ""
		if len(args) == 4 {
			ref = args[3]
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		receipt, err := plugins.Fetch(ctx, args[1], args[2], ref)
		if err != nil {
			return err
		}
		return json.NewEncoder(output).Encode(receipt)
	}

	if len(args) != 2 || (args[0] != "inspect" && args[0] != "validate") {
		return errors.New("usage: pero-agent-acp plugins <inspect|validate> DIRECTORY")
	}
	report, err := plugins.Inspect(context.Background(), args[1])
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(struct {
		plugins.Report
		Valid bool `json:"valid"`
	}{Report: report, Valid: report.Valid()}); err != nil {
		return err
	}
	if args[0] == "validate" && !report.Valid() {
		return errors.New("plugins: configuration validation failed; see JSON diagnostics")
	}
	return nil
}
