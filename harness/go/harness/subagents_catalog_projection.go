package harness

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// SubagentChildCatalogEntry is a parent-owned discovery fact. It is a durable
// browsing address, never authority to control an Agent incarnation.
type SubagentChildCatalogEntry struct {
	ID        SessionID `json:"id"`
	CreatedAt int64     `json:"createdAt"`
	Mode      string    `json:"mode"`
	Label     *string   `json:"label,omitempty"`
}

// SubagentCatalogFact retains the current official payload generations: v0
// local, v1 local/unknown, and v2 external. None are upgraded during replay.
type SubagentCatalogFact struct {
	Version        int       `json:"version"`
	ChildID        SessionID `json:"childId"`
	ChildCreatedAt int64     `json:"childCreatedAt"`
	Mode           string    `json:"mode"`
	Label          *string   `json:"label,omitempty"`
}

func strictCatalogJSON(raw []byte, target any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("subagent catalog: trailing JSON")
	}
	return nil
}

func (f *SubagentCatalogFact) UnmarshalJSON(raw []byte) error {
	type wire SubagentCatalogFact
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	for _, key := range []string{"version", "childId", "childCreatedAt", "mode"} {
		value, ok := fields[key]
		if !ok || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return fmt.Errorf("subagent catalog: missing %s", key)
		}
	}
	if raw, ok := fields["label"]; ok && bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return errors.New("subagent catalog: null label")
	}
	var value wire
	if err := strictCatalogJSON(raw, &value); err != nil {
		return err
	}
	*f = SubagentCatalogFact(value)
	return f.validate()
}

func (f SubagentCatalogFact) validate() error {
	valid := (f.Version == 0 || f.Version == 1) && (f.Mode == "one-shot" || f.Mode == "continuable") || f.Version == 1 && f.Mode == "unknown" || f.Version == 2 && f.Mode == "external"
	if !valid || f.ChildCreatedAt < 0 || f.Mode == "continuable" && f.Label == nil {
		return errors.New("subagent catalog: invalid version, mode, creation time, or label")
	}
	return nil
}

type subagentCatalogChunk struct {
	Values   []SubagentCatalogFact `json:"values"`
	Previous *subagentCatalogChunk `json:"previous,omitempty"`
}

func (c *subagentCatalogChunk) UnmarshalJSON(raw []byte) error {
	type wire subagentCatalogChunk
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return err
	}
	if previous, ok := fields["previous"]; ok && bytes.Equal(bytes.TrimSpace(previous), []byte("null")) {
		return errors.New("subagent catalog: null previous chunk")
	}
	var value wire
	if err := strictCatalogJSON(raw, &value); err != nil {
		return err
	}
	*c = subagentCatalogChunk(value)
	if len(c.Values) < 1 || len(c.Values) > 64 {
		return errors.New("subagent catalog: invalid chunk size")
	}
	return nil
}

type subagentCatalogState struct {
	InheritedEventCount uint64                `json:"inheritedEventCount"`
	Head                *subagentCatalogChunk `json:"head,omitempty"`
}

func (s *subagentCatalogState) validate() error {
	if s == nil {
		return errors.New("subagent catalog: missing state")
	}
	for head := s.Head; head != nil; head = head.Previous {
		if len(head.Values) < 1 || len(head.Values) > 64 {
			return errors.New("subagent catalog: invalid chunk size")
		}
		for _, fact := range head.Values {
			if err := fact.validate(); err != nil {
				return err
			}
		}
	}
	return nil
}

func catalogEntries(s *subagentCatalogState) []SubagentChildCatalogEntry {
	chunks := []*subagentCatalogChunk{}
	for head := s.Head; head != nil; head = head.Previous {
		chunks = append(chunks, head)
	}
	entries := make([]SubagentChildCatalogEntry, 0)
	for i := len(chunks) - 1; i >= 0; i-- {
		for _, fact := range chunks[i].Values {
			entry := SubagentChildCatalogEntry{ID: fact.ChildID, CreatedAt: fact.ChildCreatedAt, Mode: fact.Mode}
			if fact.Label != nil {
				label := *fact.Label
				entry.Label = &label
			}
			entries = append(entries, entry)
		}
	}
	return entries
}

// SubagentCatalogProjectionDefinition exposes the current catalog state/version
// and detached wire views. Go's event seq starts at 1, so own events have seq
// greater than the inherited event count (the upstream equivalent is >= at 0).
func SubagentCatalogProjectionDefinition() ProjectionDefinition {
	d := DefineProjection(ProjectionSpec[*subagentCatalogState, []SubagentChildCatalogEntry]{
		Key: "subagentCatalog", StateVersion: 6,
		Init: func(header SessionHeader) *subagentCatalogState {
			return &subagentCatalogState{InheritedEventCount: header.SeedLength}
		},
		Apply:         func(state *subagentCatalogState, _ Event) *subagentCatalogState { return state },
		ValidateState: func(state *subagentCatalogState) error { return state.validate() },
		View:          catalogEntries,
	})
	d.Apply = func(raw any, event Event) (any, error) {
		state, ok := raw.(*subagentCatalogState)
		if !ok || state == nil {
			return nil, errors.New("subagent catalog: invalid state")
		}
		if event.Type != "subagent/catalog" || event.Seq <= state.InheritedEventCount {
			return state, nil
		}
		var fact SubagentCatalogFact
		if err := json.Unmarshal(event.Data, &fact); err != nil {
			return nil, fmt.Errorf("subagent catalog at seq %d: %w", event.Seq, err)
		}
		head := &subagentCatalogChunk{Values: []SubagentCatalogFact{fact}, Previous: state.Head}
		if state.Head != nil && len(state.Head.Values) < 64 {
			head.Values = append(append([]SubagentCatalogFact(nil), state.Head.Values...), fact)
			head.Previous = state.Head.Previous
		}
		return &subagentCatalogState{InheritedEventCount: state.InheritedEventCount, Head: head}, nil
	}
	d.DecodeState = func(raw json.RawMessage) (any, error) {
		var state subagentCatalogState
		if err := strictCatalogJSON(raw, &state); err != nil {
			return nil, err
		}
		var fields map[string]json.RawMessage
		if err := json.Unmarshal(raw, &fields); err != nil {
			return nil, err
		}
		if head, ok := fields["head"]; ok && bytes.Equal(bytes.TrimSpace(head), []byte("null")) {
			return nil, errors.New("subagent catalog: null head")
		}
		if inherited, ok := fields["inheritedEventCount"]; !ok || bytes.Equal(bytes.TrimSpace(inherited), []byte("null")) {
			return nil, errors.New("subagent catalog: missing inheritedEventCount")
		}
		if err := state.validate(); err != nil {
			return nil, err
		}
		return &state, nil
	}
	return d
}

// establishSubagentCatalogChild commits only current managed creations. Local
// callers are cataloged for both delivery modes; external caller-only runs are
// intentionally private to their activation holder, matching the public service.
func establishSubagentCatalogChild(record *subagentRecord) error {
	if record == nil || record.activation == nil {
		return nil
	}
	if record.child == nil && record.activation.delivery != "parent" {
		return nil
	}
	fact := SubagentCatalogFact{Version: 2, ChildID: record.snapshot.ID, ChildCreatedAt: record.snapshot.StartedAt.UnixMilli(), Mode: "external"}
	label := record.snapshot.Label
	fact.Label = &label
	if record.child != nil {
		fact.Version = 0
		fact.Mode = "one-shot"
		if record.snapshot.Continuable {
			fact.Mode = "continuable"
		}
		fact.ChildCreatedAt = record.child.Session().Header().CreatedAt.UnixMilli()
	}
	if err := fact.validate(); err != nil {
		return err
	}
	_, err := record.parent.Session().Append("subagent/catalog", fact)
	return err
}
