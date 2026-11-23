package model

import (
	"encoding/json"
	"slices"
)

const AppUseContextMetaKey = "pero.appUseContext"

// AppUseContextOrigin identifies how the Host included its App Use workflow.
type AppUseContextOrigin string

const (
	AppUseContextSelected  AppUseContextOrigin = "selected"
	AppUseContextAutomatic AppUseContextOrigin = "automatic"
)

func DecodeAppUseContextOrigin(raw json.RawMessage) AppUseContextOrigin {
	var origin AppUseContextOrigin
	if len(raw) == 0 || json.Unmarshal(raw, &origin) != nil {
		return ""
	}
	if origin == AppUseContextSelected || origin == AppUseContextAutomatic {
		return origin
	}
	return ""
}

func (o AppUseContextOrigin) Metadata() json.RawMessage {
	if o == "" {
		return nil
	}
	metadata, _ := json.Marshal(map[string]AppUseContextOrigin{AppUseContextMetaKey: o})
	return metadata
}

func (b ContentBlock) hasAppUseContext() bool {
	if b.Type != BlockText || len(b.Meta) == 0 {
		return false
	}
	var metadata map[string]json.RawMessage
	return json.Unmarshal(b.Meta, &metadata) == nil && DecodeAppUseContextOrigin(metadata[AppUseContextMetaKey]) != ""
}

// ProjectAppUseContext keeps the newest marked user text block in model input.
// Messages and content slices remain untouched for durable history and replay.
func ProjectAppUseContext(messages []Message) []Message {
	remaining := 0
	for _, message := range messages {
		if message.Role != RoleUser {
			continue
		}
		for _, block := range message.Content {
			if block.hasAppUseContext() {
				remaining++
			}
		}
	}
	if remaining < 2 {
		return messages
	}

	projected := make([]Message, 0, len(messages))
	for _, message := range messages {
		if message.Role == RoleUser && remaining > 1 && slices.ContainsFunc(message.Content, ContentBlock.hasAppUseContext) {
			kept := make([]ContentBlock, 0, len(message.Content)-1)
			for _, block := range message.Content {
				if remaining > 1 && block.hasAppUseContext() {
					remaining--
					continue
				}
				kept = append(kept, block)
			}
			if len(kept) == 0 {
				continue
			}
			message.Content = kept
		}
		projected = append(projected, message)
	}
	return projected
}
