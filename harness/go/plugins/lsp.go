package plugins

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/phodal/pero/harness/go/lsp"
)

// LSPDefinition is an inspection projection. Executable arguments, environment
// values and initialization/settings JSON remain private typed configuration.
type LSPDefinition struct {
	InspectionOnly bool               `json:"inspectionOnly"`
	Servers        []LSPServerSummary `json:"servers"`
}

type LSPServerSummary struct {
	Name                     string   `json:"name"`
	Path                     string   `json:"path"`
	Extensions               []string `json:"extensions"`
	EnvironmentNames         []string `json:"environmentNames"`
	HasInitializationOptions bool     `json:"hasInitializationOptions"`
	HasSettings              bool     `json:"hasSettings"`
}

type compiledLSP struct {
	servers []lsp.Server
	sources []string
}

func (p *Plugin) inspectLSP(root *os.Root, prefix string, explicit json.RawMessage, diagnostics *[]Diagnostic) {
	p.LSP = LSPDefinition{InspectionOnly: true, Servers: []LSPServerSummary{}}
	positions := make(map[string]int)
	loadIntegration(root, prefix, ".lsp.json", explicit, func(path string, raw []byte) {
		servers, err := lsp.DecodeServers(raw)
		if err != nil {
			*diagnostics = append(*diagnostics, Diagnostic{SeverityError, "INVALID_LSP_CONFIGURATION", path, "lspServers", err.Error()})
			return
		}
		local, err := filepath.Rel(filepath.FromSlash(prefix), filepath.FromSlash(path))
		if err != nil {
			*diagnostics = append(*diagnostics, readDiagnostic(path))
			return
		}
		p.lsp.sources = append(p.lsp.sources, filepath.ToSlash(local))
		for _, server := range servers {
			summary := LSPServerSummary{Name: server.Name, Path: path, Extensions: []string{}, EnvironmentNames: []string{}, HasInitializationOptions: string(server.Config.InitializationOptions.Bytes()) != "null", HasSettings: string(server.Config.Settings.Bytes()) != "null"}
			for _, mapping := range server.Config.ExtensionToLanguage {
				summary.Extensions = append(summary.Extensions, mapping.Extension)
			}
			for _, binding := range server.Config.Env {
				summary.EnvironmentNames = append(summary.EnvironmentNames, binding.Name)
			}
			if index, exists := positions[server.Name]; exists {
				p.lsp.servers[index], p.LSP.Servers[index] = server, summary
			} else {
				positions[server.Name] = len(p.lsp.servers)
				p.lsp.servers = append(p.lsp.servers, server)
				p.LSP.Servers = append(p.LSP.Servers, summary)
			}
		}
	}, diagnostics)
}
