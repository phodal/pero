package nativetools

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/phodal/pero/harness/go/harness"
)

func mountToolOutputReadback(ctx context.Context, h *harness.Harness, store *harness.LocalSpillStore) error {
	_, err := h.RegisterTool(ctx, "native/tool-output-readback", harness.Tool{
		Schema: harness.ToolSchema{Name: "ReadToolOutput", Description: "Read a bounded UTF-8 byte page from an exact saved tool-output locator owned by this Session. offset starts at 0; continue with next_offset. If deferred, discover this exact tool name first. This does not read arbitrary workspace files.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"required":["locator"],"properties":{"locator":{"type":"string","minLength":1},"offset":{"type":"integer","minimum":0},"limit":{"type":"integer","minimum":4,"maximum":16384}}}`)},
		ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			var input struct {
				Locator string
				Offset  int64
				Limit   int
			}
			if err := json.Unmarshal(request.Arguments, &input); err != nil {
				return harness.ToolResult{}, err
			}
			if request.Agent == nil {
				return harness.ToolResult{}, errors.New("readback requires a Session")
			}
			if input.Limit == 0 {
				input.Limit = 8192
			}
			if input.Offset < 0 || input.Limit < 4 || input.Limit > 16384 {
				return harness.ToolResult{}, errors.New("invalid readback range")
			}
			lookup, err := store.ReadTextPage(ctx, harness.SpillOwner{SessionID: request.Agent.ID()}, input.Locator, input.Offset, input.Limit)
			if err != nil {
				return harness.ToolResult{}, err
			}
			if !lookup.Recognized || lookup.Read == nil {
				return harness.ToolResult{}, errors.New("saved output is unavailable or belongs to another Session")
			}
			var next *int64
			if lookup.Read.Truncated {
				value := input.Offset + int64(len(lookup.Read.Text))
				next = &value
			}
			return renderResult(struct {
				Text       string `json:"text"`
				Truncated  bool   `json:"truncated"`
				NextOffset *int64 `json:"next_offset,omitempty"`
			}{lookup.Read.Text, lookup.Read.Truncated, next}, nil)
		},
	})
	return err
}
