// Package plugins inspects explicitly selected Claude plugin configurations.
// Inspection never installs dependencies, mounts tools or executes plugin code.
package plugins

type Severity string

const (
	SeverityError   Severity = "error"
	SeverityWarning Severity = "warning"
)

type Diagnostic struct {
	Severity Severity `json:"severity"`
	Code     string   `json:"code"`
	Path     string   `json:"path"`
	Field    string   `json:"field,omitempty"`
	Message  string   `json:"message"`
}
