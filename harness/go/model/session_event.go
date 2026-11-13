package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"unicode/utf8"
)

// Fixed alpha.3 vocabulary (2fbf4359b82fb94c03dcce0b831660d87f12ea5c).
// Never derive compatibility classification from installed plugins.
var sourceSessionEventTypes = [...]string{
	"agent-preset/selected",
	"agent/inbox/spliced",
	"approval/asked",
	"approval/decided",
	"approval/policy",
	"assistant/attempt",
	"assistant/message",
	"command/done",
	"command/run",
	"compaction/end",
	"compaction/prune",
	"compaction/start",
	"compaction/summary",
	"deliverables/presented",
	"developer/message",
	"feedback/message-delete",
	"feedback/message-put",
	"feedback/record",
	"goal/change",
	"hook/invoked",
	"hook/result",
	"image/offload",
	"job/registered",
	"job/settled",
	"llm/retry",
	"llm/retry-started",
	"model/selection",
	"permission/preset",
	"plan/mode",
	"request/context",
	"request/header",
	"sandbox/mode",
	"schedule/change",
	"session-log-deepseek/delivery-accepted",
	"session/end-seed",
	"session/title",
	"session/title-llm-request",
	"step/end",
	"step/start",
	"subagent/catalog",
	"subagent/descriptor",
	"subagent/model-selection-policy",
	"system/message",
	"team/member",
	"team/message/delivered",
	"team/message/queued",
	"team/task",
	"todo/write",
	"tool-workflow/agent-end",
	"tool-workflow/agent-start",
	"tool-workflow/run-end",
	"tool-workflow/run-start",
	"tool/call",
	"tool/ptc-dispatch",
	"tool/ptc-dispatch-start",
	"tool/result",
	"turn/end",
	"turn/start",
	"user/message",
	"web/deepseek-search-llm-request",
	"working-directory/change",
	"workspace/changes",
}

// Additional semantic records understood by this native build.
var nativeSessionEventTypes = [...]string{
	"science/cell",
	"agent/inbox/guarded",
	"agent/inbox/moved",
	"assistant/chunk",
	"goal/round",
	"harness/update",
	"request/context-plan",
	"session/acp-controller",
	"session/harness",
	"session/model-selected",
	"tool/code-dispatch",
	"tool/code-dispatch-start",
}

func IsKnownSessionEventType(kind string) bool {
	for _, value := range sourceSessionEventTypes {
		if value == kind {
			return true
		}
	}
	for _, value := range nativeSessionEventTypes {
		if value == kind {
			return true
		}
	}
	return false
}

// IsOpaque reports only fixed-vocabulary unknown, explicitly ignorable records.
func (e Event) IsOpaque() bool { return e.Ignorable && !IsKnownSessionEventType(e.Type) }

// ValidateMetadata preserves the native typed provenance API. Opaque metadata
// never enters that API, even when its JSON happens to be an integer array.
func (e Event) ValidateMetadata() error {
	if e.OpaqueSourceEventSeqs != nil && (!e.IsOpaque() || e.SourceEventSeqs != nil) {
		return errors.New("model: opaque event provenance requires an unknown ignorable record and no typed provenance")
	}
	if e.IsOpaque() {
		if e.Type == "" || !utf8.ValidString(e.Type) || e.Seq > 1<<53-1 || e.SourceEventSeqs != nil {
			return errors.New("model: invalid opaque event identity or typed provenance")
		}
		for _, raw := range []json.RawMessage{e.Data, e.SurfaceOp, e.OpaqueSourceEventSeqs} {
			if raw != nil && (!json.Valid(raw) || !utf8.Valid(raw)) {
				return errors.New("model: invalid opaque event JSON")
			}
		}
		if e.Data == nil {
			return errors.New("model: opaque event requires data")
		}
	}
	return nil
}

func (e Event) Clone() Event {
	e.Data = append(json.RawMessage(nil), e.Data...)
	e.SurfaceOp = append(json.RawMessage(nil), e.SurfaceOp...)
	if e.SourceEventSeqs != nil {
		e.SourceEventSeqs = append([]uint64{}, e.SourceEventSeqs...)
	}
	e.OpaqueSourceEventSeqs = append(json.RawMessage(nil), e.OpaqueSourceEventSeqs...)
	return e
}

func (e Event) MarshalJSON() ([]byte, error) {
	if err := e.ValidateMetadata(); err != nil {
		return nil, err
	}
	// Preserve established native field order and omitted typed empty provenance.
	type base Event
	raw, err := json.Marshal(base(e))
	if err != nil {
		return nil, err
	}
	if !e.Ignorable && e.OpaqueSourceEventSeqs == nil {
		return raw, nil
	}
	raw = raw[:len(raw)-1]
	if e.Ignorable {
		raw = append(raw, []byte(`,"ignorable":true`)...)
	}
	if e.OpaqueSourceEventSeqs != nil {
		raw = append(raw, []byte(`,"sourceEventSeqs":`)...)
		raw = append(raw, e.OpaqueSourceEventSeqs...)
	}
	return append(raw, '}'), nil
}

// UnmarshalJSON keeps ordinary native records on encoding/json's established
// struct path. Only an unknown type explicitly opting into opaque compatibility
// receives the strict envelope decoder below. Classify with the same field
// matching and last-wins semantics, including a reused receiver's existing Type.
func (e *Event) UnmarshalJSON(data []byte) error {
	probe := struct {
		Type string `json:"type"`
	}{Type: e.Type}
	if err := json.Unmarshal(data, &probe); err == nil && !IsKnownSessionEventType(probe.Type) && hasOpaqueEventOptIn(data) {
		return e.unmarshalOpaqueJSON(data)
	}
	// Decode directly so partial updates and error-time mutations retain the
	// original struct decoder's behavior. Opaque-only state cannot leak from a
	// prior value into an ordinary, unmarked or known semantic record.
	type nativeEvent Event
	e.Ignorable = false
	e.OpaqueSourceEventSeqs = nil
	return json.Unmarshal(data, (*nativeEvent)(e))
}

// Any exact lowercase true opts in, so a duplicate true-then-false marker cannot
// downgrade an attempted opaque envelope to the permissive legacy decoder.
func hasOpaqueEventOptIn(data []byte) bool {
	decoder := json.NewDecoder(bytes.NewReader(data))
	first, err := decoder.Token()
	if err != nil || first != json.Delim('{') {
		return false
	}
	for decoder.More() {
		key, err := decoder.Token()
		if err != nil {
			return false
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return false
		}
		if key == "ignorable" && bytes.Equal(bytes.TrimSpace(value), []byte("true")) {
			return true
		}
	}
	return false
}

func (e *Event) unmarshalOpaqueJSON(data []byte) error {
	if !utf8.Valid(data) {
		return errors.New("model: invalid event UTF-8")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return errors.New("model: invalid event envelope")
	}
	fields := map[string]json.RawMessage{}
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return err
		}
		key, ok := token.(string)
		if !ok {
			return errors.New("model: invalid event key")
		}
		switch key {
		case "seq", "time", "type", "data", "surfaceOp", "sourceEventSeqs", "ignorable":
		default:
			return fmt.Errorf("model: unknown event envelope field %q", key)
		}
		if _, exists := fields[key]; exists {
			return fmt.Errorf("model: duplicate event field %q", key)
		}
		var value json.RawMessage
		if err = decoder.Decode(&value); err != nil {
			return err
		}
		fields[key] = value
	}
	if _, err = decoder.Token(); err != nil {
		return err
	}
	if _, err = decoder.Token(); err != io.EOF {
		return errors.New("model: trailing event JSON")
	}
	for _, key := range []string{"seq", "time", "type", "data"} {
		if fields[key] == nil {
			return fmt.Errorf("model: event missing %s", key)
		}
	}
	var next Event
	if err = json.Unmarshal(fields["seq"], &next.Seq); err != nil || bytes.Equal(bytes.TrimSpace(fields["seq"]), []byte("null")) {
		return errors.New("model: invalid event sequence")
	}
	if err = json.Unmarshal(fields["time"], &next.Time); err != nil || bytes.Equal(bytes.TrimSpace(fields["time"]), []byte("null")) {
		return errors.New("model: invalid event time")
	}
	if err = representableJSONString(fields["type"]); err != nil {
		return err
	}
	if err = json.Unmarshal(fields["type"], &next.Type); err != nil || next.Type == "" {
		return errors.New("model: invalid event type")
	}
	if marker, exists := fields["ignorable"]; exists {
		if !bytes.Equal(bytes.TrimSpace(marker), []byte("true")) {
			return errors.New("model: ignorable must be exactly true")
		}
		next.Ignorable = true
	}
	next.Data = fields["data"]
	next.SurfaceOp = fields["surfaceOp"]
	if next.IsOpaque() {
		next.OpaqueSourceEventSeqs = fields["sourceEventSeqs"]
	} else if value, ok := fields["sourceEventSeqs"]; ok {
		if err = json.Unmarshal(value, &next.SourceEventSeqs); err != nil {
			return fmt.Errorf("model: invalid typed event provenance: %w", err)
		}
	}
	if !next.IsOpaque() {
		return errors.New("model: opaque envelope requires an unknown explicitly ignorable type")
	}
	if err = next.ValidateMetadata(); err != nil {
		return err
	}
	*e = next
	return nil
}
