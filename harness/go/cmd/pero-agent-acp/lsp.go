package main

import (
	"context"
	"errors"
	"flag"
	"io"
	"os"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/lsp"
	"github.com/phodal/pero/harness/go/plugins"
)

type lspOptions struct {
	Files                []string
	DisablePluginServers bool
}

func bindLSPOptions(flags *flag.FlagSet) *lspOptions {
	options := &lspOptions{}
	flags.BoolVar(&options.DisablePluginServers, "disable-plugin-lsp", false, "disable language-server executables declared by selected plugins; operator --lsp-config remains explicit")
	flags.Func("lsp-config", "explicit JSON server-name map for local stdio LSP servers (repeatable; later same-name definitions replace earlier)", func(value string) error {
		if strings.TrimSpace(value) == "" || len(options.Files) >= 16 {
			return errors.New("lsp-config requires an explicit path (maximum 16)")
		}
		options.Files = append(options.Files, value)
		return nil
	})
	return options
}

// Both operator files and bundled declarations are explicit execution grants.
// No configuration contents or process environment are included in diagnostics.
func mountLSP(ctx context.Context, h *harness.Harness, workspace string, packages []plugins.Package, environment []string, options lspOptions) (*lsp.App, error) {
	selections := []lsp.Selection{}
	if !options.DisablePluginServers {
		for _, pkg := range packages {
			for _, server := range pkg.LSP {
				server.Name = "plugin:" + pkg.Definition.Name + ":" + server.Name
				selections = append(selections, lsp.Selection{Server: server, PluginRoot: pkg.Root})
			}
		}
	}
	if len(options.Files) == 0 && len(selections) == 0 {
		return nil, nil
	}
	if workspace == "" {
		return nil, errors.New("selected LSP execution requires --workspace")
	}
	positions := map[string]int{}
	for _, path := range options.Files {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() || info.Size() > 1<<20 {
			return nil, errors.New("selected LSP configuration must be an available regular file of at most 1 MiB")
		}
		file, err := os.Open(path)
		if err != nil {
			return nil, errors.New("selected LSP configuration file is unavailable")
		}
		opened, err := file.Stat()
		if err != nil || !opened.Mode().IsRegular() || opened.Size() > 1<<20 {
			_ = file.Close()
			return nil, errors.New("selected LSP configuration must be a regular file of at most 1 MiB")
		}
		raw, readErr := io.ReadAll(io.LimitReader(file, 1<<20+1))
		_ = file.Close()
		if readErr != nil || len(raw) > 1<<20 {
			return nil, errors.New("selected LSP configuration exceeds the supported 1 MiB bound or cannot be read")
		}
		servers, err := lsp.DecodeServers(raw)
		if err != nil {
			return nil, err
		}
		for _, server := range servers {
			server.Name = "operator:" + server.Name
			selection := lsp.Selection{Server: server}
			if index, found := positions[server.Name]; found {
				selections[index] = selection
			} else {
				positions[server.Name] = len(selections)
				selections = append(selections, selection)
			}
		}
	}
	return lsp.Mount(ctx, h, lsp.Options{Workspace: workspace, Servers: selections, Environment: environment})
}
