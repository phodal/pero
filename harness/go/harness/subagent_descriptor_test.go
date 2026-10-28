package harness

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestSubagentDescriptorSnapshotsCompositionAndFoldsFirstEvent(t *testing.T) {
	filter := &ToolRestriction{Allow: []string{"read"}, Deny: []string{}}
	descriptor, err := SnapshotSubagentDescriptor("spawn", SubagentRequest{
		Label: "inspect project", Provider: "deepseek", Model: "deepseek-chat", ReasoningEffort: "high", Persona: "reviewer", ToolFilter: filter,
		SuppressParentSettlement: true,
	}, true)
	if err != nil {
		t.Fatal(err)
	}
	filter.Allow[0] = "mutated"
	if descriptor.Version != SubagentDescriptorVersion || descriptor.Mode != SubagentDescriptorContinuable || descriptor.AgentReasoningEffort != "high" || descriptor.ToolFilter.Allow[0] != "read" || !descriptor.SuppressParentSettlement {
		t.Fatalf("descriptor=%+v", descriptor)
	}
	session := NewSession("descriptor-child", "/workspace")
	if _, err := session.Append("subagent/descriptor", descriptor); err != nil {
		t.Fatal(err)
	}
	if _, err := session.Append("subagent/descriptor", SubagentDescriptor{
		Version: SubagentDescriptorVersion, Mode: SubagentDescriptorContinuable, Provider: "replacement", Label: "must not win",
	}); err != nil {
		t.Fatal(err)
	}
	folded, ok, err := FoldSubagentDescriptor(session)
	if err != nil || !ok || folded.Provider != "spawn" || folded.AgentProvider != "deepseek" || folded.AgentModel != "deepseek-chat" || folded.AgentReasoningEffort != "high" || folded.Persona != "reviewer" || !folded.SuppressParentSettlement {
		t.Fatalf("folded=%+v ok=%v error=%v", folded, ok, err)
	}
	folded.ToolFilter.Allow[0] = "caller mutation"
	again, ok, err := FoldSubagentDescriptor(session)
	if err != nil || !ok || again.ToolFilter.Allow[0] != "read" {
		t.Fatalf("descriptor fold was not detached: %+v error=%v", again, err)
	}
}

func TestSubagentDescriptorReadsVersionThreeWithoutReasoningEffort(t *testing.T) {
	session := NewSession("descriptor-v3", "")
	if _, err := session.Append("subagent/descriptor", json.RawMessage(`{"version":3,"mode":"continuable","provider":"spawn","label":"old","agentProvider":"deepseek","agentModel":"deepseek-chat"}`)); err != nil {
		t.Fatal(err)
	}
	descriptor, found, err := FoldSubagentDescriptor(session)
	if err != nil || !found || descriptor.Version != 3 || descriptor.AgentReasoningEffort != "" {
		t.Fatalf("v3 descriptor=%+v found=%v error=%v", descriptor, found, err)
	}
}

func TestSubagentDescriptorRejectsMalformedCurrentVersionAndIgnoresFutureVersion(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		part string
	}{
		{"unknown-field", `{"version":3,"mode":"continuable","provider":"spawn","label":"x","future":true}`, "unknown field"},
		{"missing-label", `{"version":3,"mode":"continuable","provider":"spawn"}`, "label"},
		{"empty-filter", `{"version":3,"mode":"continuable","provider":"spawn","label":"x","toolFilter":{}}`, "filter is empty"},
		{"one-shot-composition", `{"version":3,"mode":"one-shot","provider":"spawn","agentProvider":"deepseek"}`, "continuable composition"},
	}
	for _, fixture := range tests {
		t.Run(fixture.name, func(t *testing.T) {
			session := NewSession(SessionID("descriptor-"+fixture.name), "")
			if _, err := session.Append("subagent/descriptor", json.RawMessage(fixture.raw)); err != nil {
				t.Fatal(err)
			}
			_, _, err := FoldSubagentDescriptor(session)
			if err == nil || !strings.Contains(err.Error(), fixture.part) {
				t.Fatalf("error=%v want %q", err, fixture.part)
			}
		})
	}
	future := NewSession("descriptor-future", "")
	if _, err := future.Append("subagent/descriptor", json.RawMessage(`{"version":7,"mode":"continuable","provider":"spawn","label":"x","future":true}`)); err != nil {
		t.Fatal(err)
	}
	if descriptor, ok, err := FoldSubagentDescriptor(future); err != nil || ok || descriptor.Version != 0 {
		t.Fatalf("future descriptor=%+v ok=%v error=%v", descriptor, ok, err)
	}
}

func TestOneShotSubagentDescriptorOmitsContinuationComposition(t *testing.T) {
	descriptor, err := SnapshotSubagentDescriptor("spawn", SubagentRequest{
		Label: "one shot", Provider: "deepseek", Model: "deepseek-chat", Persona: "ignored",
		ToolFilter: &ToolRestriction{Deny: []string{"write"}},
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(descriptor)
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	if strings.Contains(text, "agentProvider") || strings.Contains(text, "agentModel") || strings.Contains(text, "persona") || strings.Contains(text, "toolFilter") || strings.Contains(text, "suppressParentSettlement") {
		t.Fatalf("one-shot descriptor leaked activation composition: %s", text)
	}
}

func TestSubagentDescriptorIgnoresForkSeedDescriptor(t *testing.T) {
	parent := NewSession("descriptor-parent", "")
	if _, err := parent.Append("subagent/descriptor", SubagentDescriptor{
		Version: SubagentDescriptorVersion, Mode: SubagentDescriptorContinuable, Provider: "parent-provider", Label: "parent",
	}); err != nil {
		t.Fatal(err)
	}
	child, err := parent.ForkCompletedTurnsForSubagent("descriptor-nested-child", 2)
	if err != nil && !errors.Is(err, ErrSessionForkUnavailable) {
		t.Fatal(err)
	}
	if errors.Is(err, ErrSessionForkUnavailable) {
		// The helper requires a completed turn. Build the equivalent inherited
		// prefix explicitly to keep this contract focused on descriptor folding.
		header := NewSession("descriptor-nested-child", "").Header()
		header.SeedLength = uint64(len(parent.Events()))
		child, err = RestoreSession(header, parent.Events())
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := child.Append("subagent/descriptor", SubagentDescriptor{
		Version: SubagentDescriptorVersion, Mode: SubagentDescriptorContinuable, Provider: "child-provider", Label: "child",
	}); err != nil {
		t.Fatal(err)
	}
	descriptor, found, err := FoldSubagentDescriptor(child)
	if err != nil || !found || descriptor.Provider != "child-provider" {
		t.Fatalf("descriptor=%+v found=%v error=%v", descriptor, found, err)
	}
}

func TestIndependentSubagentPresetRequiresOwnSelectionBeforeDescriptor(t *testing.T) {
	for _, fixture := range []struct {
		name      string
		inherited int
		types     []string
		want      bool
	}{
		{"fresh", 0, []string{"agent-preset/selected", "subagent/descriptor"}, true},
		{"inherited", 1, []string{"agent-preset/selected", "subagent/descriptor"}, false},
		{"historical-fork-selection", 0, []string{"subagent/descriptor", "agent-preset/selected"}, false},
		{"selected-over-seed", 1, []string{"agent-preset/selected", "agent-preset/selected", "subagent/descriptor"}, true},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			source := NewSession("preset-child", "")
			for index, kind := range fixture.types {
				if fixture.inherited > 0 && index == fixture.inherited {
					if _, err := source.Append("session/end-seed", map[string]bool{"inherited": true}); err != nil {
						t.Fatal(err)
					}
				}
				if _, err := source.Append(kind, map[string]string{"agentPreset": "reviewer"}); err != nil {
					t.Fatal(err)
				}
			}
			header := source.Header()
			header.Origin = "subagent"
			header.ParentSession = "parent"
			header.DelegationDepth = 1
			header.SeedLength = uint64(fixture.inherited)
			session, err := RestoreSession(header, source.Events())
			if err != nil {
				t.Fatal(err)
			}
			if got := HasIndependentSubagentPreset(session); got != fixture.want {
				t.Fatalf("independent=%v want=%v", got, fixture.want)
			}
		})
	}
}

func TestExplicitEmptyManagedLabelDescriptorVersionBoundary(t *testing.T) {
	for _, tc := range []struct {
		name, label          string
		managed, continuable bool
		version              int
		valid                bool
	}{
		{"ordinary-empty", "", false, true, 0, false},
		{"ordinary-one-shot", "", false, false, 5, true},
		{"ordinary-label", "label", false, true, 5, true},
		{"managed-label", "label", true, true, 5, true},
		{"managed-whitespace", " \t ", true, true, 5, true},
		{"managed-empty", "", true, true, 6, true},
		{"managed-one-shot", "", true, false, 5, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := SubagentRequest{Label: tc.label}
			if tc.managed {
				request.activation = newSubagentActivation("parent")
			}
			descriptor, err := SnapshotSubagentDescriptor("spawn", request, tc.continuable)
			if !tc.valid {
				if err == nil {
					t.Fatal("ordinary empty label accepted")
				}
				return
			}
			if err != nil || descriptor.Version != tc.version || descriptor.Label != tc.label {
				t.Fatalf("descriptor=%+v %v", descriptor, err)
			}
			raw, err := json.Marshal(descriptor)
			if err != nil {
				t.Fatal(err)
			}
			var fields map[string]json.RawMessage
			if err = json.Unmarshal(raw, &fields); err != nil {
				t.Fatal(err)
			}
			label, exists := fields["label"]
			if tc.version == 6 {
				if !exists || string(label) != `""` || strings.Count(string(raw), `"label":`) != 1 {
					t.Fatalf("v6 empty label omitted/collided: %s", raw)
				}
			} else if tc.label == "" {
				if exists || string(raw) != `{"version":5,"mode":"one-shot","provider":"spawn"}` {
					t.Fatalf("legacy bytes changed: %s", raw)
				}
			} else if tc.label == "label" && string(raw) != `{"version":5,"mode":"continuable","provider":"spawn","label":"label"}` {
				t.Fatalf("nonempty legacy bytes changed: %s", raw)
			}
			restored, supported, err := parseSubagentDescriptor(raw)
			if err != nil || !supported || restored.Label != tc.label || restored.Version != tc.version {
				t.Fatalf("roundtrip=%+v %v", restored, err)
			}
		})
	}
	for _, version := range []string{"3", "4", "5", "6"} {
		for _, label := range []string{"", `,"label":null`, `,"label":7`, `,"label":{}`, `,"label":""`, `,"label":"kept"`} {
			raw := json.RawMessage(`{"version":` + version + `,"mode":"continuable","provider":"spawn"` + label + `}`)
			_, supported, err := parseSubagentDescriptor(raw)
			valid := label == `,"label":"kept"` || (version == "6" && label == `,"label":""`)
			if valid != (supported && err == nil) {
				t.Fatalf("versioned label acceptance %s supported=%v err=%v", raw, supported, err)
			}
		}
	}
	for _, raw := range []string{
		`{"version":6,"mode":"one-shot","provider":"spawn","label":""}`,
		`{"version":6,"mode":"continuable","provider":"","label":""}`,
		`{"version":6,"mode":"continuable","provider":"spawn","label":"","agentProvider":"unpaired"}`,
		`{"version":6,"mode":"continuable","provider":"spawn","label":"","toolFilter":{}}`,
		`{"version":6,"mode":"continuable","provider":"spawn","label":"","extra":true}`,
		`{"version":6,"mode":"continuable","provider":"spawn","label":"","Label":"collision"}`,
		`{"version":6,"Version":5,"mode":"continuable","provider":"spawn","label":""}`,
		`{"version":6,"mode":"continuable","Mode":"one-shot","provider":"spawn","label":""}`,
	} {
		if _, supported, err := parseSubagentDescriptor(json.RawMessage(raw)); supported || err == nil {
			t.Fatalf("v6 weakened composition validation: %s %v", raw, err)
		}
	}
	if _, supported, err := parseSubagentDescriptor(json.RawMessage(`{"version":7,"mode":"continuable","provider":"spawn","label":""}`)); supported || err != nil {
		t.Fatalf("unknown descriptor guessed: supported=%v %v", supported, err)
	}
	parsed, supported, err := parseSubagentDescriptor(json.RawMessage(`{"version":6,"mode":"continuable","provider":"spawn","label":""}`))
	if err != nil || !supported || parsed.SuppressParentSettlement {
		t.Fatalf("v6 synthesized settlement policy: %+v %v", parsed, err)
	}
	untrusted := SubagentRequest{Label: parsed.Label, Prompt: "work"}
	if untrusted.ManagedActivation() || untrusted.ManagedParentDelivery() {
		t.Fatal("descriptor label minted private activation authority")
	}
	if _, err := SnapshotSubagentDescriptor(parsed.Provider, untrusted, true); err == nil {
		t.Fatal("ordinary descriptor replay bypassed managed admission")
	}
	// Explicit v6 emission has one label key even when the embedded alias would
	// otherwise emit a nonempty label. Such values can be read but are not minted.
	raw, err := json.Marshal(SubagentDescriptor{Version: 6, Mode: SubagentDescriptorContinuable, Provider: "spawn", Label: "kept"})
	if err != nil || strings.Count(string(raw), `"label":`) != 1 {
		t.Fatalf("embedded label collision: %s %v", raw, err)
	}
}
