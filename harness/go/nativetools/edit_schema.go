package nativetools

import (
	"encoding/json"
	"fmt"
)

// The two edit forms are exclusive at schema admission, including explicitly
// empty strings and false flags. Missing new text must not silently mean delete.
func editInputSchema(properties, required string, claude bool) json.RawMessage {
	old, next := "old_text", "new_text"
	if claude {
		old, next = "old_string", "new_string"
	}
	return json.RawMessage(fmt.Sprintf(`{"type":"object","additionalProperties":false,"properties":{%s},"required":[%s],"oneOf":[{"required":[%q,%q],"not":{"required":["edits"]}},{"required":["edits"],"not":{"anyOf":[{"required":[%q]},{"required":[%q]},{"required":["replace_all"]}]}}]}`, properties, required, old, next, old, next))
}
