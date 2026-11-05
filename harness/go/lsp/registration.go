package lsp

import (
	"bytes"
	"encoding/json"
	"errors"
	"path"
	"path/filepath"
	"strings"
)

type dynamicRegistrationSupport struct {
	Dynamic bool `json:"dynamicRegistration"`
}
type dynamicDocumentCapabilities struct {
	Definition     dynamicRegistrationSupport `json:"definition"`
	References     dynamicRegistrationSupport `json:"references"`
	Implementation dynamicRegistrationSupport `json:"implementation"`
	Hover          dynamicRegistrationSupport `json:"hover"`
	DocumentSymbol dynamicRegistrationSupport `json:"documentSymbol"`
	CallHierarchy  dynamicRegistrationSupport `json:"callHierarchy"`
}
type documentFilter struct{ Language, Scheme, Pattern string }

func (filter *documentFilter) UnmarshalJSON(raw []byte) error {
	type wireFilter documentFilter
	var value wireFilter
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	if value.Language == "" && value.Scheme == "" && value.Pattern == "" {
		return errors.New("lsp: empty or unsupported document selector")
	}
	*filter = documentFilter(value)
	return nil
}

type capabilityRegistration struct {
	id, method string
	selector   []documentFilter
}

func registrationMethod(operation Operation) string {
	switch operation {
	case Definition:
		return "textDocument/definition"
	case References:
		return "textDocument/references"
	case Implementation:
		return "textDocument/implementation"
	case Hover:
		return "textDocument/hover"
	case DocumentSymbol:
		return "textDocument/documentSymbol"
	case WorkspaceSymbol:
		return "workspace/symbol"
	case PrepareCallHierarchy, IncomingCalls, OutgoingCalls:
		return "textDocument/prepareCallHierarchy"
	}
	return ""
}
func supportedRegistration(method string) bool {
	for _, operation := range operations {
		if registrationMethod(operation) == method {
			return true
		}
	}
	return false
}

// Registrations are replaced atomically after decoding, and live only for the
// owning server connection. They never grant file access or apply server edits.
func (c *connection) registerCapabilities(raw json.RawMessage) error {
	var params struct {
		Registrations []struct {
			ID      string `json:"id"`
			Method  string `json:"method"`
			Options struct {
				Selector []documentFilter `json:"documentSelector"`
			} `json:"registerOptions"`
		} `json:"registrations"`
	}
	if json.Unmarshal(raw, &params) != nil || params.Registrations == nil || len(params.Registrations) > 128 {
		return errors.New("lsp: invalid capability registrations")
	}
	values := make([]capabilityRegistration, 0, len(params.Registrations))
	seen := map[string]bool{}
	for _, wire := range params.Registrations {
		if wire.ID == "" || seen[wire.ID] || !supportedRegistration(wire.Method) || len(wire.Options.Selector) > 64 {
			return errors.New("lsp: unsupported or duplicate capability registration")
		}
		seen[wire.ID] = true
		for _, filter := range wire.Options.Selector {
			if strings.ContainsAny(filter.Pattern, "{}") || len(filter.Pattern) > 4096 {
				return errors.New("lsp: unsupported document selector pattern")
			}
			if _, err := path.Match(filter.Pattern, ""); err != nil {
				return errors.New("lsp: invalid document selector pattern")
			}
		}
		values = append(values, capabilityRegistration{wire.ID, wire.Method, wire.Options.Selector})
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.registrations)+len(values) > 128 {
		return errors.New("lsp: capability registration limit reached")
	}
	for _, value := range values {
		for _, existing := range c.registrations {
			if existing.id == value.id {
				return errors.New("lsp: capability id is already registered")
			}
		}
	}
	c.registrations = append(c.registrations, values...)
	return nil
}
func (c *connection) unregisterCapabilities(raw json.RawMessage) error {
	// The misspelling is the field specified by LSP 3.17.
	var params struct {
		Entries []struct{ ID, Method string } `json:"unregisterations"`
	}
	if json.Unmarshal(raw, &params) != nil || params.Entries == nil || len(params.Entries) > 128 {
		return errors.New("lsp: invalid capability unregistrations")
	}
	for _, value := range params.Entries {
		if value.ID == "" || value.Method == "" {
			return errors.New("lsp: invalid capability identity")
		}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	kept := c.registrations[:0]
	for _, existing := range c.registrations {
		remove := false
		for _, value := range params.Entries {
			if existing.id == value.ID && existing.method == value.Method {
				remove = true
				break
			}
		}
		if !remove {
			kept = append(kept, existing)
		}
	}
	c.registrations = kept
	return nil
}
func (c *connection) dynamicallySupports(operation Operation, file, language string) bool {
	method := registrationMethod(operation)
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, registration := range c.registrations {
		if registration.method != method {
			continue
		}
		if registration.selector == nil {
			return true
		}
		for _, filter := range registration.selector {
			if filter.Language != "" && filter.Language != language || filter.Scheme != "" && filter.Scheme != "file" {
				continue
			}
			if filter.Pattern == "" || selectorGlob(filter.Pattern, filepath.ToSlash(file)) {
				return true
			}
		}
	}
	return false
}

// Match path segments with LSP's recursive **; path.Match owns character classes
// and escaping. Brace alternatives are rejected at the protocol boundary.
func selectorGlob(pattern, file string) bool {
	parts, segments := strings.Split(pattern, "/"), strings.Split(file, "/")
	previous := make([]bool, len(segments)+1)
	previous[0] = true
	for _, part := range parts {
		current := make([]bool, len(segments)+1)
		if part == "**" {
			current[0] = previous[0]
		}
		for i, segment := range segments {
			if part == "**" {
				current[i+1] = previous[i+1] || current[i]
			} else {
				matched, _ := path.Match(part, segment)
				current[i+1] = previous[i] && matched
			}
		}
		previous = current
	}
	return previous[len(segments)]
}
