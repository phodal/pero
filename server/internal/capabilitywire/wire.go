// Package capabilitywire parses the P0.1 capability documents.
// A successful parse is not a grant.
package capabilitywire

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"unicode/utf8"
)

var researchPattern = regexp.MustCompile(`^[a-f0-9]{64}$`)

type Admission string

const (
	Accepted         Admission = "accepted"
	MissingVersion   Admission = "missing_version"
	VersionMismatch  Admission = "version_mismatch"
	UnknownOperation Admission = "unknown_operation"
	InvalidInput     Admission = "invalid_input"
)

func decode(data []byte, dest any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dest); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("trailing json")
	}
	return nil
}

type researchID string

func (id *researchID) UnmarshalJSON(data []byte) error {
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	if !researchIDPattern(value) {
		return errors.New("research id")
	}
	*id = researchID(value)
	return nil
}

func researchIDPattern(value string) bool { return researchPattern.MatchString(value) }

// present distinguishes a missing field from JSON null. A pointer field would
// become nil for null without calling UnmarshalJSON.
type nullableUint32 struct {
	present bool
	value   *uint32
}

func (n *nullableUint32) UnmarshalJSON(data []byte) error {
	n.present = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		return nil
	}
	var value uint32
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	n.value = &value
	return nil
}

type absentString struct{ value *string }

func (s *absentString) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		return errors.New("null")
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	s.value = &value
	return nil
}

type boundedString struct{ value string }

func (s *boundedString) UnmarshalJSON(data []byte) error {
	var text absentString
	if err := text.UnmarshalJSON(data); err != nil {
		return err
	}
	if text.value == nil || *text.value == "" || utf8.RuneCountInString(*text.value) > 64 {
		return errors.New("bounded")
	}
	s.value = *text.value
	return nil
}

func Parse(schema string, data []byte) error {
	switch schema {
	case "AgentStatusRequest":
		var value struct {
			Operation string `json:"operation"`
			Scope     struct {
				WorkspaceID string `json:"workspaceId"`
			} `json:"scope"`
			RunID string `json:"runId"`
		}
		if err := decode(data, &value); err != nil {
			return err
		}
		if value.Operation != "status" || !nestedHas(data, "scope", "workspaceId") || !nestedHas(data, "runId") {
			return errors.New("operation")
		}
		return nil
	case "AgentStatusCall":
		var value struct {
			Capability string `json:"capability"`
			Operation  string `json:"operation"`
			Input      struct {
				Scope struct {
					WorkspaceID string `json:"workspaceId"`
				} `json:"scope"`
				RunID string `json:"runId"`
			} `json:"input"`
		}
		if err := decode(data, &value); err != nil {
			return err
		}
		if value.Capability != "agent" || value.Operation != "status" || !nestedHas(data, "input", "scope", "workspaceId") || !nestedHas(data, "input", "runId") {
			return errors.New("agent status call")
		}
		return nil
	case "AgentStatusResponse":
		var value struct {
			ID        string `json:"id"`
			SessionID string `json:"sessionId"`
			Scope     struct {
				WorkspaceID string `json:"workspaceId"`
			} `json:"scope"`
			Status     string        `json:"status"`
			Attempt    uint32        `json:"attempt"`
			RequestID  string        `json:"requestId"`
			UpdatedAt  string        `json:"updatedAt"`
			Error      *absentString `json:"error,omitempty"`
			StopReason *absentString `json:"stopReason,omitempty"`
		}
		if err := decode(data, &value); err != nil {
			return err
		}
		for _, key := range []string{"id", "sessionId", "status", "attempt", "requestId", "updatedAt"} {
			if !nestedHas(data, key) || isNull(data, key) {
				return errors.New("status fields")
			}
		}
		if !nestedHas(data, "scope", "workspaceId") || isNull(data, "scope", "workspaceId") || isNull(data, "error") || isNull(data, "stopReason") {
			return errors.New("status fields")
		}
		switch value.Status {
		case "running", "needs_input", "cancelling", "completed", "failed", "cancelled", "interrupted":
		default:
			return errors.New("status")
		}
		return nil
	case "ResearchAssetsQueriesRequest":
		var value struct {
			Operation string      `json:"operation"`
			QueryID   *researchID `json:"queryId,omitempty"`
		}
		if err := decode(data, &value); err != nil {
			return err
		}
		if value.Operation != "queries" || isNull(data, "queryId") {
			return errors.New("operation")
		}
		return nil
	case "ResearchAssetsQueriesResponse":
		var value struct {
			ID      researchID      `json:"id"`
			Intent  json.RawMessage `json:"intent"`
			Receipt struct {
				QueryID        researchID        `json:"queryId"`
				Status         string            `json:"status"`
				Reason         string            `json:"reason"`
				Rows           []json.RawMessage `json:"rows"`
				RowCount       nullableUint32    `json:"rowCount"`
				Truncated      bool              `json:"truncated"`
				ElapsedSeconds *float64          `json:"elapsedSeconds,omitempty"`
				ResultID       *researchID       `json:"resultId,omitempty"`
			} `json:"receipt"`
			Snapshot   json.RawMessage `json:"snapshot"`
			Definition json.RawMessage `json:"definition"`
			Acceptance string          `json:"acceptance"`
		}
		if err := decode(data, &value); err != nil {
			return err
		}
		if value.Acceptance != "needs_review" || !value.Receipt.RowCount.present || !object(value.Intent) || !object(value.Snapshot) || isNull(data, "receipt", "resultId") {
			return errors.New("research response")
		}
		for _, key := range []string{"queryId", "status", "reason", "rows", "rowCount", "truncated"} {
			if !nestedHas(data, "receipt", key) {
				return errors.New("receipt fields")
			}
		}
		switch value.Receipt.Status {
		case "completed", "failed", "cancelled", "running", "interrupted":
		default:
			return errors.New("receipt status")
		}
		return definitionKeys(value.Definition)
	case "CapabilityError":
		var value struct {
			Code       string         `json:"code"`
			Message    string         `json:"message"`
			Capability *boundedString `json:"capability,omitempty"`
			Operation  *boundedString `json:"operation,omitempty"`
		}
		if err := decode(data, &value); err != nil {
			return err
		}
		switch value.Code {
		case "missing_version", "version_mismatch", "unknown_operation", "invalid_input", "unavailable", "denied", "failed":
			return nil
		default:
			return errors.New("error code")
		}
	case "CapabilityDescriptor":
		var value struct {
			ID              string `json:"id"`
			ProtocolVersion uint32 `json:"protocolVersion"`
			Operations      []struct {
				Name     string `json:"name"`
				Version  uint32 `json:"version"`
				Effect   string `json:"effect"`
				Exposure string `json:"exposure"`
			} `json:"operations"`
			Provider struct {
				ID          string `json:"id"`
				Incarnation string `json:"incarnation"`
			} `json:"provider"`
			Availability struct {
				ScopeKind string        `json:"scopeKind"`
				ScopeID   *absentString `json:"scopeId,omitempty"`
				State     string        `json:"state"`
			} `json:"availability"`
		}
		if err := decode(data, &value); err != nil {
			return err
		}
		for _, operation := range value.Operations {
			if operation.Version < 1 || !oneOf(operation.Effect, "read", "write", "control", "observe") || !oneOf(operation.Exposure, "local_only", "transport_neutral", "remotely_exposable", "privileged") {
				return errors.New("operation descriptor")
			}
		}
		if !oneOf(value.Availability.ScopeKind, "workspace", "project", "app", "device", "unscoped") || !oneOf(value.Availability.State, "advertised", "unavailable") {
			return errors.New("availability")
		}
		return nil
	case "CapabilityNegotiation":
		var value struct {
			ProtocolVersion uint32   `json:"protocolVersion"`
			Capability      string   `json:"capability"`
			Operation       string   `json:"operation"`
			DeclaredHost    []string `json:"declaredHost"`
			Advertised      bool     `json:"advertised"`
		}
		return decode(data, &value)
	case "CapabilityAdmission":
		var value struct {
			Outcome string `json:"outcome"`
			Grant   bool   `json:"grant"`
		}
		if err := decode(data, &value); err != nil {
			return err
		}
		if value.Outcome != "accepted" || value.Grant {
			return errors.New("admission")
		}
		return nil
	default:
		return fmt.Errorf("unknown schema %s", schema)
	}
}

func isNull(data []byte, path ...string) bool {
	var current any
	if json.Unmarshal(data, &current) != nil {
		return false
	}
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return false
		}
		current, ok = object[key]
		if !ok {
			return false
		}
	}
	return current == nil
}

func nestedHas(data []byte, path ...string) bool {
	var current any
	if json.Unmarshal(data, &current) != nil {
		return false
	}
	for _, key := range path {
		object, ok := current.(map[string]any)
		if !ok {
			return false
		}
		current, ok = object[key]
		if !ok {
			return false
		}
	}
	return true
}

func object(data json.RawMessage) bool {
	var value map[string]json.RawMessage
	return json.Unmarshal(data, &value) == nil && len(bytes.TrimSpace(data)) > 0 && bytes.TrimSpace(data)[0] == '{'
}

func definitionKeys(data json.RawMessage) error {
	var value map[string]json.RawMessage
	if err := json.Unmarshal(data, &value); err != nil || bytes.TrimSpace(data)[0] != '{' {
		return errors.New("definition")
	}
	for _, key := range []string{"sql", "unit", "denominator"} {
		raw, ok := value[key]
		if !ok || len(raw) == 0 || raw[0] != '"' {
			return errors.New("definition " + key)
		}
	}
	return nil
}

func oneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}

func KnownOperations(inventory []byte) (map[[2]string]bool, error) {
	var document struct {
		Families []struct {
			ID         string `json:"id"`
			Operations []struct {
				Name string `json:"name"`
			} `json:"operations"`
		} `json:"families"`
	}
	if err := json.Unmarshal(inventory, &document); err != nil {
		return nil, err
	}
	known := map[[2]string]bool{}
	for _, family := range document.Families {
		for _, operation := range family.Operations {
			known[[2]string{family.ID, operation.Name}] = true
		}
	}
	return known, nil
}

// Admit is a reference fail-closed check for P0.2 and P0.3.
// No shell, Host, or SDK calls it. Accepted is not a grant.
func Admit(document []byte, known map[[2]string]bool) Admission {
	var raw map[string]json.RawMessage
	if json.Unmarshal(document, &raw) != nil {
		return InvalidInput
	}
	for key := range raw {
		switch key {
		case "protocolVersion", "capability", "operation", "declaredHost", "advertised":
		default:
			return InvalidInput
		}
	}
	version, ok := raw["protocolVersion"]
	if !ok {
		return MissingVersion
	}
	if !unsigned32(version) {
		return InvalidInput
	}
	var number uint32
	if err := json.Unmarshal(version, &number); err != nil {
		return InvalidInput
	}
	if number != 1 {
		return VersionMismatch
	}
	var capability, operation string
	if json.Unmarshal(raw["capability"], &capability) != nil || capability == "" || utf8.RuneCountInString(capability) > 64 {
		return InvalidInput
	}
	if json.Unmarshal(raw["operation"], &operation) != nil || operation == "" || utf8.RuneCountInString(operation) > 64 {
		return InvalidInput
	}
	host, ok := raw["declaredHost"]
	if !ok || len(bytes.TrimSpace(host)) == 0 || bytes.TrimSpace(host)[0] != '[' {
		return InvalidInput
	}
	var declared []json.RawMessage
	if json.Unmarshal(host, &declared) != nil {
		return InvalidInput
	}
	for _, item := range declared {
		if bytes.Equal(bytes.TrimSpace(item), []byte("null")) {
			return InvalidInput
		}
		var text string
		if json.Unmarshal(item, &text) != nil {
			return InvalidInput
		}
	}
	var advertised bool
	if json.Unmarshal(raw["advertised"], &advertised) != nil || !jsonBool(raw["advertised"]) {
		return InvalidInput
	}
	if !known[[2]string{capability, operation}] {
		return UnknownOperation
	}
	return Accepted
}

func unsigned32(data []byte) bool {
	if len(data) == 0 || data[0] == '-' || data[0] == '"' {
		return false
	}
	var number json.Number
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	if dec.Decode(&number) != nil {
		return false
	}
	value, err := number.Int64()
	return err == nil && value >= 0 && value <= int64(^uint32(0))
}

func jsonBool(data []byte) bool {
	return string(data) == "true" || string(data) == "false"
}
