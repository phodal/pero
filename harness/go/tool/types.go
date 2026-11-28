package tool

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"

	harnessmodel "github.com/phodal/pero/harness/go/model"
)

type ExecutionMode string

const (
	ExecutionParallel ExecutionMode = "parallel"
	ExecutionSerial   ExecutionMode = "serial"
)

type Result struct {
	// presentation is immutable framework provenance, never serialized.
	presentation *presentationBaseline
	// Value is an execution-local canonical JSON value. Nil means absent;
	// the literal JSON null is a present value. It is never inferred from Content.
	Value              json.RawMessage                `json:"-"`
	Content            []harnessmodel.ContentBlock    `json:"content"`
	IsError            bool                           `json:"isError,omitempty"`
	Meta               json.RawMessage                `json:"meta,omitempty"`
	AdditionalContexts []harnessmodel.DeferredContext `json:"additionalContexts,omitempty"`
	ConcludesTurn      bool                           `json:"concludesTurn,omitempty"`
	// FinalReply allows one final model step without advertising or executing
	// tools, then ends this same turn. An explicit batch interruption wins.
	FinalReply bool `json:"-"`
}

// Restriction is a scoped mask over inherited tools. Allow keeps only named
// inherited tools; Deny removes named inherited tools.
type Restriction struct {
	Allow []string `json:"allow,omitempty"`
	Deny  []string `json:"deny,omitempty"`
}

func (restriction Restriction) MarshalJSON() ([]byte, error) {
	fields := make(map[string][]string, 2)
	if restriction.Allow != nil {
		fields["allow"] = restriction.Allow
	}
	if restriction.Deny != nil {
		fields["deny"] = restriction.Deny
	}
	return json.Marshal(fields)
}

func (restriction *Restriction) UnmarshalJSON(raw []byte) error {
	if restriction == nil {
		return errors.New("harness: decode tool restriction into nil receiver")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return errors.New("harness: tool restriction must be an object")
	}
	for key := range fields {
		if key != "allow" && key != "deny" {
			return fmt.Errorf("harness: tool restriction has unknown field %q", key)
		}
	}
	*restriction = Restriction{}
	for key, target := range map[string]*[]string{"allow": &restriction.Allow, "deny": &restriction.Deny} {
		value, exists := fields[key]
		if !exists {
			continue
		}
		if bytes.Equal(bytes.TrimSpace(value), []byte("null")) || json.Unmarshal(value, target) != nil {
			return fmt.Errorf("harness: tool restriction %s must be an array of strings", key)
		}
	}
	return nil
}
