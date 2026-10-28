package harness

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
)

const SubagentDescriptorVersion = 5

// Version 6 represents an explicitly empty managed continuable label. Only
// that case emits v6; existing descriptors and nonempty labels stay at v5.
// Older binaries fail closed on v6 and cannot resume these children.
const subagentExplicitLabelDescriptorVersion = 6

type SubagentDescriptorMode string

const (
	SubagentDescriptorOneShot     SubagentDescriptorMode = "one-shot"
	SubagentDescriptorContinuable SubagentDescriptorMode = "continuable"
)

// SubagentDescriptor is the model-hidden, durable identity and composition
// snapshot for a session-backed child. Output schemas and per-turn budgets are
// deliberately absent because they belong to one activation only.
type SubagentDescriptor struct {
	Version                  int                    `json:"version"`
	Mode                     SubagentDescriptorMode `json:"mode"`
	Provider                 string                 `json:"provider"`
	Label                    string                 `json:"label,omitempty"`
	AgentProvider            string                 `json:"agentProvider,omitempty"`
	AgentModel               string                 `json:"agentModel,omitempty"`
	AgentReasoningEffort     ReasoningEffort        `json:"agentReasoningEffort,omitempty"`
	Persona                  string                 `json:"persona,omitempty"`
	ToolFilter               *ToolRestriction       `json:"toolFilter,omitempty"`
	SuppressParentSettlement bool                   `json:"suppressParentSettlement,omitempty"`
}

// MarshalJSON retains legacy descriptor bytes while keeping v6's explicit
// empty label present. The outer field intentionally overrides the embedded
// alias field, producing one label key rather than conflicting duplicates.
func (descriptor SubagentDescriptor) MarshalJSON() ([]byte, error) {
	type plain SubagentDescriptor
	if descriptor.Version != subagentExplicitLabelDescriptorVersion {
		return json.Marshal(plain(descriptor))
	}
	return json.Marshal(struct {
		plain
		Label string `json:"label"`
	}{plain: plain(descriptor), Label: descriptor.Label})
}

func SnapshotSubagentDescriptor(provider string, request SubagentRequest, continuable bool) (SubagentDescriptor, error) {
	if provider == "" {
		return SubagentDescriptor{}, errors.New("harness: subagent descriptor provider must not be empty")
	}
	mode := SubagentDescriptorOneShot
	if continuable {
		mode = SubagentDescriptorContinuable
		if request.Label == "" && request.activation == nil {
			return SubagentDescriptor{}, errors.New("harness: continuable subagent descriptor label must not be empty")
		}
	}
	if (request.Provider == "") != (request.Model == "") {
		return SubagentDescriptor{}, errors.New("harness: subagent descriptor agent provider and model must be supplied together")
	}
	descriptor := SubagentDescriptor{Version: SubagentDescriptorVersion, Mode: mode, Provider: provider, Label: request.Label}
	if continuable && request.activation != nil && request.Label == "" {
		descriptor.Version = subagentExplicitLabelDescriptorVersion
	}
	if continuable {
		descriptor.AgentProvider = request.Provider
		descriptor.AgentModel = request.Model
		descriptor.AgentReasoningEffort = request.ReasoningEffort
		descriptor.Persona = request.Persona
		descriptor.ToolFilter = cloneToolRestriction(request.ToolFilter)
		descriptor.SuppressParentSettlement = request.SuppressParentSettlement
	}
	encoded, err := json.Marshal(descriptor)
	if err != nil {
		return SubagentDescriptor{}, fmt.Errorf("harness: snapshot subagent descriptor: %w", err)
	}
	var detached SubagentDescriptor
	if err := json.Unmarshal(encoded, &detached); err != nil {
		return SubagentDescriptor{}, fmt.Errorf("harness: detach subagent descriptor: %w", err)
	}
	return detached, nil
}

// FoldSubagentDescriptor returns the first descriptor in a child log. Unknown
// versions are unsupported rather than guessed; malformed current-version
// records fail closed.
func FoldSubagentDescriptor(session *Session) (SubagentDescriptor, bool, error) {
	if session == nil {
		return SubagentDescriptor{}, false, errors.New("harness: fold subagent descriptor requires a session")
	}
	header := session.Header()
	for _, event := range session.Events() {
		if event.Seq <= header.SeedLength {
			continue
		}
		if event.Type != "subagent/descriptor" {
			continue
		}
		return parseSubagentDescriptor(event.Data)
	}
	return SubagentDescriptor{}, false, nil
}

func parseSubagentDescriptor(raw json.RawMessage) (SubagentDescriptor, bool, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return SubagentDescriptor{}, false, errors.New("harness: persisted subagent descriptor payload must be an object")
	}
	var version int
	versionRaw, hasVersion := fields["version"]
	if !hasVersion || json.Unmarshal(versionRaw, &version) != nil {
		return SubagentDescriptor{}, false, errors.New("harness: persisted subagent descriptor version must be an integer")
	}
	if version != 3 && version != 4 && version != SubagentDescriptorVersion && version != subagentExplicitLabelDescriptorVersion {
		return SubagentDescriptor{}, false, nil
	}
	if version == subagentExplicitLabelDescriptorVersion {
		// Go's struct decoder accepts case-insensitive aliases. Keep v6's
		// durable presence fields exact so an alias cannot overwrite them.
		for key := range fields {
			switch key {
			case "version", "mode", "provider", "label", "agentProvider", "agentModel", "agentReasoningEffort", "persona", "toolFilter", "suppressParentSettlement":
			default:
				return SubagentDescriptor{}, false, fmt.Errorf("harness: invalid persisted v6 descriptor field %q", key)
			}
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var descriptor SubagentDescriptor
	if err := decoder.Decode(&descriptor); err != nil {
		return SubagentDescriptor{}, false, fmt.Errorf("harness: invalid persisted subagent descriptor: %w", err)
	}
	if version == 3 {
		if _, present := fields["agentReasoningEffort"]; present {
			return SubagentDescriptor{}, false, errors.New("harness: persisted v3 subagent descriptor carries v4 reasoning effort")
		}
	}
	if version < 5 {
		if _, present := fields["suppressParentSettlement"]; present {
			return SubagentDescriptor{}, false, errors.New("harness: persisted pre-v5 subagent descriptor carries v5 settlement policy")
		}
	}
	if descriptor.Mode != SubagentDescriptorOneShot && descriptor.Mode != SubagentDescriptorContinuable {
		return SubagentDescriptor{}, false, errors.New("harness: persisted subagent descriptor mode must be one-shot or continuable")
	}
	if descriptor.Provider == "" {
		return SubagentDescriptor{}, false, errors.New("harness: persisted subagent descriptor provider must not be empty")
	}
	if version == subagentExplicitLabelDescriptorVersion {
		var label *string
		if descriptor.Mode != SubagentDescriptorContinuable || json.Unmarshal(fields["label"], &label) != nil || label == nil {
			return SubagentDescriptor{}, false, errors.New("harness: persisted v6 descriptor requires continuable mode and a present string label")
		}
	}
	if descriptor.Mode == SubagentDescriptorOneShot {
		for _, key := range []string{"agentProvider", "agentModel", "agentReasoningEffort", "persona", "toolFilter", "suppressParentSettlement"} {
			if _, present := fields[key]; present {
				return SubagentDescriptor{}, false, errors.New("harness: persisted one-shot subagent descriptor carries continuable composition")
			}
		}
		if descriptor.AgentProvider != "" || descriptor.AgentModel != "" || descriptor.AgentReasoningEffort != "" || descriptor.Persona != "" || descriptor.ToolFilter != nil || descriptor.SuppressParentSettlement {
			return SubagentDescriptor{}, false, errors.New("harness: persisted one-shot subagent descriptor carries continuable composition")
		}
	} else if descriptor.Label == "" && version != subagentExplicitLabelDescriptorVersion {
		return SubagentDescriptor{}, false, errors.New("harness: persisted continuable subagent descriptor label must not be empty")
	}
	if (descriptor.AgentProvider == "") != (descriptor.AgentModel == "") {
		return SubagentDescriptor{}, false, errors.New("harness: persisted subagent descriptor agent route is incomplete")
	}
	if _, present := fields["toolFilter"]; present {
		if descriptor.ToolFilter == nil || descriptor.ToolFilter.Allow == nil && descriptor.ToolFilter.Deny == nil {
			return SubagentDescriptor{}, false, errors.New("harness: persisted subagent descriptor tool filter is empty")
		}
	}
	descriptor.ToolFilter = cloneToolRestriction(descriptor.ToolFilter)
	return descriptor, true, nil
}

func cloneToolRestriction(filter *ToolRestriction) *ToolRestriction {
	if filter == nil {
		return nil
	}
	clone := &ToolRestriction{}
	if filter.Allow != nil {
		clone.Allow = append([]string{}, filter.Allow...)
	}
	if filter.Deny != nil {
		clone.Deny = append([]string{}, filter.Deny...)
	}
	return clone
}

// HasIndependentSubagentPreset identifies creation-time selection in the child's
// own log. Inherited selections and historical fork selections made after the
// descriptor do not change its composition lineage.
func HasIndependentSubagentPreset(session *Session) bool {
	if session == nil || session.Header().Origin != "subagent" {
		return false
	}
	for _, event := range session.Events() {
		if event.Seq <= session.Header().SeedLength {
			continue
		}
		if event.Type == "subagent/descriptor" {
			return false
		}
		if event.Type == "agent-preset/selected" {
			return true
		}
	}
	return false
}
