package lsp

import (
	"context"
	"encoding/json"
	"errors"
)

// Diagnostic is evidence from a selected server, not an instruction or an edit.
type Diagnostic struct {
	Range    Range  `json:"range"`
	Severity int    `json:"severity,omitempty"`
	Source   string `json:"source,omitempty"`
	Message  string `json:"message"`
}

// DiagnosticReport distinguishes a published empty set from no publication.
type DiagnosticReport struct {
	URI       string
	Version   int
	Items     []Diagnostic
	Truncated bool
}

// One document is open at a time on an instance's serialized connection. Only
// that document may contribute evidence to its query. Reopening uses a new
// version so delayed versioned notifications cannot attach to a later query.
type documentDiagnostics struct {
	uri     string
	version int
	report  *DiagnosticReport
	ready   chan struct{}
}

func (document *documentDiagnostics) publish(raw json.RawMessage) {
	var wire struct {
		URI     string `json:"uri"`
		Version *int   `json:"version"`
		Items   []struct {
			Range    *Range `json:"range"`
			Severity int    `json:"severity"`
			Source   string `json:"source"`
			Message  string `json:"message"`
		} `json:"diagnostics"`
	}
	if json.Unmarshal(raw, &wire) != nil || wire.URI != document.uri || wire.Items == nil || (wire.Version != nil && *wire.Version != document.version) {
		return
	}
	report := &DiagnosticReport{URI: document.uri, Version: document.version, Items: []Diagnostic{}}
	characters := 0
	for _, item := range wire.Items {
		if item.Range == nil || !validRange(*item.Range) || item.Severity < 0 || item.Severity > 4 || item.Message == "" {
			return // Do not partially apply a malformed replacement.
		}
		characters += len([]rune(item.Message)) + len([]rune(item.Source))
		if len(report.Items) < 100 && characters <= 16000 {
			report.Items = append(report.Items, Diagnostic{Range: *item.Range, Severity: item.Severity, Source: item.Source, Message: item.Message})
		} else {
			report.Truncated = true
		}
	}
	if document.report == nil && document.ready != nil {
		close(document.ready)
	}
	document.report = report // A publication replaces the previous set, even empty.
}

func (c *connection) openDiagnostics(uri string, version int) {
	c.mu.Lock()
	c.diagnostics = &documentDiagnostics{uri: uri, version: version, ready: make(chan struct{})}
	c.mu.Unlock()
}

func (c *connection) takeDiagnostics() *DiagnosticReport {
	c.mu.Lock()
	defer c.mu.Unlock()
	var report *DiagnosticReport
	if c.diagnostics != nil {
		report = c.diagnostics.report
		c.diagnostics = nil
	}
	return report
}

func (c *connection) awaitDiagnostics(ctx context.Context) error {
	c.mu.Lock()
	ready := c.diagnostics.ready
	c.mu.Unlock()
	select {
	case <-ready:
		return nil
	case <-c.closed:
		return errors.New("lsp: language server exited before publishing diagnostics")
	case <-ctx.Done():
		return ctx.Err()
	}
}
