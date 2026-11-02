package tasks

import (
	"bytes"
	"encoding/json"
	"errors"
	"sort"
)

// JSONValue stores immutable validated JSON. Its zero value represents null.
type JSONValue struct{ value string }

func NewJSONValue(raw []byte) (JSONValue, error) {
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return JSONValue{}, errors.New("tasks: metadata values must be JSON")
	}
	return JSONValue{value: compact.String()}, nil
}
func (v JSONValue) MarshalJSON() ([]byte, error) {
	if v.value == "" {
		return []byte("null"), nil
	}
	return []byte(v.value), nil
}
func (v *JSONValue) UnmarshalJSON(raw []byte) error {
	value, err := NewJSONValue(raw)
	if err == nil {
		*v = value
	}
	return err
}
func (v JSONValue) IsNull() bool { return v.value == "" || v.value == "null" }

type TaskMetadata struct {
	Name  string
	Value JSONValue
}
type Metadata []TaskMetadata

// Object maps exist only at this external JSON boundary; the domain receives
// typed entries with immutable values and owns merge/removal in one place.
func (m *Metadata) UnmarshalJSON(raw []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return errors.New("tasks: metadata must be a JSON object")
	}
	names := make([]string, 0, len(fields))
	for name := range fields {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make(Metadata, 0, len(names))
	for _, name := range names {
		value, err := NewJSONValue(fields[name])
		if err != nil {
			return err
		}
		result = append(result, TaskMetadata{Name: name, Value: value})
	}
	*m = result
	return nil
}
func (m Metadata) MarshalJSON() ([]byte, error) {
	var output bytes.Buffer
	output.WriteByte('{')
	for i, entry := range m {
		if i > 0 {
			output.WriteByte(',')
		}
		name, _ := json.Marshal(entry.Name)
		value, _ := entry.Value.MarshalJSON()
		output.Write(name)
		output.WriteByte(':')
		output.Write(value)
	}
	output.WriteByte('}')
	return output.Bytes(), nil
}
func mergeMetadata(previous, patch Metadata) (Metadata, error) {
	values := make(map[string]JSONValue, len(previous)+len(patch))
	for _, entry := range previous {
		values[entry.Name] = entry.Value
	}
	for _, entry := range patch {
		if entry.Value.IsNull() {
			delete(values, entry.Name)
		} else {
			values[entry.Name] = entry.Value
		}
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	result := make(Metadata, 0, len(names))
	for _, name := range names {
		result = append(result, TaskMetadata{Name: name, Value: values[name]})
	}
	raw, _ := json.Marshal(result)
	if len(raw) > 8192 {
		return nil, errors.New("tasks: merged metadata must not exceed 8192 bytes")
	}
	return result, nil
}
