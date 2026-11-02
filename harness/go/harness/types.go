package harness

import (
	"context"
	"encoding/json"

	harnessmodel "github.com/phodal/pero/harness/go/model"
)

// These aliases preserve the original root-package API while model owns the
// dependency-light value types. New domain packages should import model
// directly; applications may continue to use harness.Message and friends.
type SessionID = harnessmodel.SessionID
type ToolCallID = harnessmodel.ToolCallID
type Role = harnessmodel.Role

const (
	RoleSystem    = harnessmodel.RoleSystem
	RoleDeveloper = harnessmodel.RoleDeveloper
	RoleUser      = harnessmodel.RoleUser
	RoleAssistant = harnessmodel.RoleAssistant
	RoleTool      = harnessmodel.RoleTool
)

type BlockType = harnessmodel.BlockType

const (
	BlockText         = harnessmodel.BlockText
	BlockToolAddition = harnessmodel.BlockToolAddition
	BlockToolRemoval  = harnessmodel.BlockToolRemoval
	BlockReasoning    = harnessmodel.BlockReasoning
	BlockImage        = harnessmodel.BlockImage
	BlockFile         = harnessmodel.BlockFile
	BlockToolCall     = harnessmodel.BlockToolCall
	BlockToolResult   = harnessmodel.BlockToolResult
)

type ContentBlock = harnessmodel.ContentBlock
type ImageAttachmentRef = harnessmodel.ImageAttachmentRef
type FileAttachmentRef = harnessmodel.FileAttachmentRef
type ImageDimensions = harnessmodel.ImageDimensions
type DeferredContext = harnessmodel.DeferredContext
type Message = harnessmodel.Message
type FinishKind = harnessmodel.FinishKind

const (
	FinishStop      = harnessmodel.FinishStop
	FinishToolCalls = harnessmodel.FinishToolCalls
	FinishMaxTokens = harnessmodel.FinishMaxTokens
	FinishRefusal   = harnessmodel.FinishRefusal
	FinishAborted   = harnessmodel.FinishAborted
	FinishError     = harnessmodel.FinishError
)

type TokenUsage = harnessmodel.TokenUsage
type StreamChunk = harnessmodel.StreamChunk
type Completion = harnessmodel.Completion
type ToolSchema = harnessmodel.ToolSchema
type ToolHistory = harnessmodel.ToolHistory
type ReasoningEffort = harnessmodel.ReasoningEffort

type RuntimeContextSnapshot = harnessmodel.RuntimeContextSnapshot
type RuntimeContextSection = harnessmodel.RuntimeContextSection

type GenerateRequest struct {
	// RuntimeContext is an admitted dynamic snapshot, separate from immutable
	// system instructions. Nil means this request supplies no snapshot.
	RuntimeContext *RuntimeContextSnapshot `json:"-"`
	// Only trusted adapter dispatch code may mark an already projected boundary.
	// This provenance is process-local and cannot be supplied over JSON.
	toolHistoryProjected bool
	Provider             string `json:"provider,omitempty"`
	Model                string `json:"model,omitempty"`
	// TransientModel records the dispatched route without replacing the
	// conversation's durable model selection, for example a turn-local skill.
	TransientModel  bool            `json:"-"`
	ReasoningEffort ReasoningEffort `json:"reasoningEffort,omitempty"`
	Temperature     *float64        `json:"temperature,omitempty"`
	System          string          `json:"system,omitempty"`
	Messages        []Message       `json:"messages"`
	Tools           []ToolSchema    `json:"tools,omitempty"`
	ToolHistory     *ToolHistory    `json:"toolHistory,omitempty"`
	MaxTokens       int             `json:"maxTokens,omitempty"`
	Stop            []string        `json:"stop,omitempty"`
	Purpose         string          `json:"purpose,omitempty"`
	// Turn and Step are operation-local coordinates for request lifecycle
	// middleware. They are not part of the provider payload.
	Turn int `json:"-"`
	Step int `json:"-"`
	// Agent is operation-local identity for scoped request extensions. It is
	// never serialized into a provider payload.
	Agent *Agent `json:"-"`
	// PrepareExtensions sees the exact base provider body and returns detached
	// top-level fields plus the post-2xx acceptance transaction.
	PrepareExtensions RequestExtensionPreparer `json:"-"`
	// Attachments resolves immutable image references for this exact request.
	// It is operation-local and never serialized into provider payloads.
	Attachments AttachmentStore `json:"-"`
}

type PreparedRequestExtensions struct {
	Fields  map[string]json.RawMessage
	Accept  func(context.Context) error
	Release func()
}

type RequestExtensionPreparer func(context.Context, json.RawMessage) (*PreparedRequestExtensions, error)

type Event = harnessmodel.Event
type SurfaceRange = harnessmodel.SurfaceRange
type SessionHeader = harnessmodel.SessionHeader

// WithProjectedToolHistory marks a request received from an adapter boundary
// that already applied the exact prepared tool capability. Bridge decoders set
// this after decoding; caller JSON cannot supply or preserve the private bit.
func WithProjectedToolHistory(request GenerateRequest) GenerateRequest {
	request.toolHistoryProjected = true
	return request
}
