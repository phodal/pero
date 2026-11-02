package plugins

// Report describes configuration validity, never permission or runtime support.
// Paths are relative to the explicit inspection root. Sensitive process and
// connection configuration is reduced to summaries at the decoding boundary.
type Report struct {
	SchemaVersion  int          `json:"schemaVersion"`
	InspectionOnly bool         `json:"inspectionOnly"`
	Plugins        []Plugin     `json:"plugins"`
	Diagnostics    []Diagnostic `json:"diagnostics"`
}

func (r Report) Valid() bool {
	for _, d := range r.Diagnostics {
		if d.Severity == SeverityError {
			return false
		}
	}
	return true
}

type Plugin struct {
	Name               string          `json:"name"`
	InstallName        string          `json:"installName,omitempty"`
	Version            string          `json:"version,omitempty"`
	MarketplaceVersion string          `json:"marketplaceVersion,omitempty"`
	Path               string          `json:"path"`
	ManifestPresent    bool            `json:"manifestPresent"`
	Components         []Component     `json:"components"`
	Hooks              HooksDefinition `json:"hooks"`
	MCP                MCPDefinition   `json:"mcp"`
	LSP                LSPDefinition   `json:"lsp"`
	lsp                compiledLSP
}
