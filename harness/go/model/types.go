// Package model contains the dependency-light value types shared by Harness
// domains. It deliberately contains no runtime services, registries, adapters,
// or service keys.
package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type SessionID string
type ToolCallID string

type Role string

const (
	RoleSystem    Role = "system"
	RoleDeveloper Role = "developer"
	RoleUser      Role = "user"
	RoleAssistant Role = "assistant"
	RoleTool      Role = "tool"
)

type BlockType string

const (
	BlockText         BlockType = "text"
	BlockReasoning    BlockType = "reasoning"
	BlockImage        BlockType = "image"
	BlockFile         BlockType = "file"
	BlockToolCall     BlockType = "tool-call"
	BlockToolResult   BlockType = "tool-result"
	BlockToolAddition BlockType = "tool-addition"
	BlockToolRemoval  BlockType = "tool-removal"
)

type ContentBlock struct {
	// Extensions retains literal fields not interpreted by this exact kind.
	Extensions map[string]json.RawMessage `json:"-"`
	// typeAbsent preserves an absent canonical discriminator on decoded data.
	typeAbsent           bool
	attachmentExtensions *contentAttachmentExtensions

	Type       BlockType           `json:"type"`
	ToolName   string              `json:"toolName,omitempty"`
	Text       string              `json:"text,omitempty"`
	Data       []byte              `json:"data,omitempty"`
	MIMEType   string              `json:"mimeType,omitempty"`
	Attachment *ImageAttachmentRef `json:"attachment,omitempty"`
	// FileAttachment shares the discriminated wire attachment slot with images.
	FileAttachment *FileAttachmentRef `json:"-"`
	ToolCallID     ToolCallID         `json:"toolCallId,omitempty"`
	Name           string             `json:"name,omitempty"`
	Arguments      json.RawMessage    `json:"arguments,omitempty"`
	// ArgumentsDelta carries one streaming tool-argument fragment. Arguments is
	// reserved for the assembled JSON value on the final assistant message.
	ArgumentsDelta string         `json:"argumentsDelta,omitempty"`
	Content        []ContentBlock `json:"content,omitempty"`
	IsError        bool           `json:"isError,omitempty"`
	// Offloaded is a derived request mark. The durable user or tool event keeps
	// the original image; an image/offload decision sets this when messages are
	// projected for a later request.
	Offloaded bool            `json:"offloaded,omitempty"`
	Meta      json.RawMessage `json:"meta,omitempty"`
}

// ImageAttachmentRef is the durable, content-addressed identity of an image.
// The bytes remain owned by an AttachmentStore outside this value package.
type ImageAttachmentRef struct {
	AttachmentID       string           `json:"attachmentId"`
	MediaType          string           `json:"mediaType"`
	Bytes              int64            `json:"bytes"`
	Width              int              `json:"width"`
	Height             int              `json:"height"`
	Name               string           `json:"name,omitempty"`
	OriginalDimensions *ImageDimensions `json:"originalDimensions,omitempty"`
}

// FileAttachmentRef identifies an immutable verbatim file, never a caller path.
type FileAttachmentRef struct {
	AttachmentID string `json:"attachmentId"`
	Name         string `json:"name"`
	Bytes        int64  `json:"bytes"`
}

// ImageDimensions records the orientation-applied dimensions of a source image
// before attachment normalization reduced it.
type ImageDimensions struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// DeferredContext is a DSH-compatible plugin-sourced user message. ID and
// Source remain durable even though provider adapters consume only Role and
// Content.
type DeferredContext struct {
	ID      string          `json:"id,omitempty"`
	Role    Role            `json:"role"`
	Content []ContentBlock  `json:"content"`
	Source  json.RawMessage `json:"source,omitempty"`
}

type Message struct {
	ID      string          `json:"id,omitempty"`
	Role    Role            `json:"role"`
	Content []ContentBlock  `json:"content"`
	Source  json.RawMessage `json:"source,omitempty"`
}

type FinishKind string

const (
	FinishStop      FinishKind = "stop"
	FinishToolCalls FinishKind = "tool-calls"
	FinishMaxTokens FinishKind = "max-tokens"
	FinishRefusal   FinishKind = "refusal"
	FinishAborted   FinishKind = "aborted"
	FinishError     FinishKind = "error"
)

type TokenUsage struct {
	InputTokens      int `json:"inputTokens"`
	OutputTokens     int `json:"outputTokens"`
	TotalTokens      int `json:"totalTokens,omitempty"`
	CacheReadTokens  int `json:"cacheReadTokens,omitempty"`
	CacheWriteTokens int `json:"cacheWriteTokens,omitempty"`
	ReasoningTokens  int `json:"reasoningTokens,omitempty"`
}

type StreamChunk struct {
	Content []ContentBlock `json:"content,omitempty"`
	Usage   *TokenUsage    `json:"usage,omitempty"`
}

type Completion struct {
	Message Message     `json:"message"`
	Finish  FinishKind  `json:"finish"`
	Usage   *TokenUsage `json:"usage,omitempty"`
}

type ToolSchema struct {
	Catalog      *CatalogText    `json:"-"`
	DeferLoading bool            `json:"deferLoading,omitempty"`
	Name         string          `json:"name"`
	Description  string          `json:"description,omitempty"`
	InputSchema  json.RawMessage `json:"inputSchema"`
	// OutputSchema opts a tool into canonical JSON output validation. It is
	// capability metadata, not an additional model argument declaration.
	OutputSchema json.RawMessage `json:"-"`
	// OutputProjection is an explicit trusted presentation contract for an
	// external runtime. Bridges must reject unknown contracts, not infer them
	// from a tool name or from rendered content.
	OutputProjection string `json:"-"`
	// OutputProjectionConfig snapshots trusted renderer options such as output
	// caps. The external adapter validates the selected projection's config.
	OutputProjectionConfig json.RawMessage `json:"-"`
}

// ReasoningEffort is an adapter-owned model reasoning selection. Harness keeps
// the identifier provider-neutral and only requires a non-empty value when it
// is explicitly selected.
type ReasoningEffort string

// CallConfigAdapterDefaults records which controls the exact adapter generation
// supplied implicitly. Values are provenance, not user model-selection intent.
type CallConfigAdapterDefaults struct {
	ReasoningEffort bool `json:"reasoningEffort,omitempty"`
	MaxTokens       bool `json:"maxTokens,omitempty"`
}

type Event struct {
	Seq             uint64          `json:"seq"`
	Time            time.Time       `json:"time"`
	Type            string          `json:"type"`
	Data            json.RawMessage `json:"data"`
	SurfaceOp       json.RawMessage `json:"surfaceOp,omitempty"`
	SourceEventSeqs []uint64        `json:"sourceEventSeqs,omitempty"`
	// Ignorable is a compatibility marker, not permission to bypass a known
	// event interpreter. Only unknown marked records carry opaque metadata.
	Ignorable bool `json:"-"`
	// OpaqueSourceEventSeqs preserves unknown metadata without granting typed
	// provenance. Nil is absent; JSON null and empty values retain presence.
	OpaqueSourceEventSeqs json.RawMessage `json:"-"`
}

type SurfaceRange struct {
	Start uint64 `json:"start"`
	End   uint64 `json:"end"`
}

type SessionHeader struct {
	Version   int       `json:"version"`
	ID        SessionID `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	CWD       string    `json:"cwd,omitempty"`
	// AgentPreset is the creation-time composition; later selections remain log facts.
	AgentPreset string `json:"agentPreset,omitempty"`
	// ManagedCWD is Host-owned execution storage, not a user workspace.
	ManagedCWD      bool      `json:"managedCwd,omitempty"`
	ParentSession   SessionID `json:"parentSession,omitempty"`
	Origin          string    `json:"origin,omitempty"`
	DelegationDepth int       `json:"delegationDepth,omitempty"`
	SeedLength      uint64    `json:"seedLength,omitempty"`
	// InboxSeedLength excludes ancestor input from execution without rewriting
	// history. Ordinary forks retain this boundary and inherit only the source's
	// own pending input; delegated forks exclude their complete inherited prefix.
	InboxSeedLength uint64 `json:"inboxSeedLength,omitempty"`
}

// UnmarshalJSON keeps the executable-inbox boundary unambiguous. In particular,
// encoding/json's case-insensitive field matching must not accept an alias, a
// duplicate or null for the new persisted boundary. Other header fields retain
// their existing compatibility decoding.
func (h *SessionHeader) UnmarshalJSON(data []byte) error {
	type plainHeader SessionHeader
	var decoded plainHeader
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return fmt.Errorf("harness: invalid session header object")
	}
	seen := false
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		key, ok := token.(string)
		if !ok {
			return fmt.Errorf("harness: invalid session header field")
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return err
		}
		if strings.EqualFold(key, "inboxSeedLength") {
			if key != "inboxSeedLength" || seen || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				return fmt.Errorf("harness: invalid executable inbox seed boundary field")
			}
			seen = true
		}
	}
	if decoded.InboxSeedLength > decoded.SeedLength {
		return fmt.Errorf("harness: executable inbox seed boundary exceeds inherited prefix")
	}
	*h = SessionHeader(decoded)
	return nil
}

// RuntimeContextSnapshot carries dynamic context separately from system instructions.
type RuntimeContextSnapshot struct {
	Text     string                  `json:"text"`
	Sections []RuntimeContextSection `json:"sections,omitempty"`
}
type RuntimeContextSection struct {
	Name string `json:"name"`
	Text string `json:"text"`
}
