package session

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"

	"github.com/phodal/pero/harness/go/model"
)

// ContextPlanKind is deliberately distinct from Point policy receipts.
const ContextPlanKind = "pero.context.plan.v1"

// MemoryTokenBudget is zero: this core does not impose product memory policy.
const MemoryTokenBudget = 0

type ContextNode struct {
	Seq     uint64  `json:"seq"`
	Message Message `json:"message"`
	Tokens  int     `json:"tokens"`
	Reason  string  `json:"reason,omitempty"`
}

// ContextPlan is a derived model-input projection. It never rewrites the audit surface.
type ContextPlan struct {
	Kind         string        `json:"kind"`
	Nodes        []ContextNode `json:"nodes"`
	Omitted      []uint64      `json:"omitted,omitempty"`
	MemoryTokens int           `json:"memoryTokens"`
	MemoryBudget int           `json:"memoryBudget"`
}

// Receipt version and integrity fields are owned by their exact canonical keys.
// Case aliases remain non-authoritative metadata and cannot select an older
// projection, shadow a digest, or supply an absent/null numeric field.
type contextPlanReceipt struct {
	Kind         string
	Digest       string
	MemoryTokens int
	MemoryBudget int
}

func decodeContextPlanReceipt(data json.RawMessage) (contextPlanReceipt, error) {
	var fields map[string]json.RawMessage
	var receipt contextPlanReceipt
	invalid := func() (contextPlanReceipt, error) {
		return contextPlanReceipt{}, fmt.Errorf("harness: invalid context plan receipt")
	}
	if err := json.Unmarshal(data, &fields); err != nil || fields == nil {
		return invalid()
	}
	for _, field := range []struct {
		key    string
		target any
	}{
		{"kind", &receipt.Kind}, {"digest", &receipt.Digest},
		{"memoryTokens", &receipt.MemoryTokens}, {"memoryBudget", &receipt.MemoryBudget},
	} {
		raw, present := fields[field.key]
		if !present || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
			return invalid()
		}
		if err := json.Unmarshal(raw, field.target); err != nil {
			return invalid()
		}
	}
	if receipt.Kind != ContextPlanKind {
		return invalid()
	}
	return receipt, nil
}

func validateContextPlanEvent(events []Event, surface []uint64, event Event) error {
	if event.Type != "request/context-plan" {
		return nil
	}
	receipt, err := decodeContextPlanReceipt(event.Data)
	if err != nil {
		return fmt.Errorf("session: context plan mismatch at seq %d: %w", event.Seq, err)
	}
	plan, err := BuildContextPlan(events, surface)
	if err != nil {
		return err
	}
	if receipt.Digest != plan.Digest() || receipt.MemoryTokens != plan.MemoryTokens || receipt.MemoryBudget != plan.MemoryBudget {
		return fmt.Errorf("session: context plan mismatch at seq %d", event.Seq)
	}
	return nil
}

func (p ContextPlan) Messages() []Message {
	messages := make([]Message, 0, len(p.Nodes))
	for _, n := range p.Nodes {
		if (n.Message.Role == model.RoleAssistant || n.Message.Role == model.RoleSystem) && len(n.Message.Content) == 0 {
			continue
		}
		messages = append(messages, cloneMessage(n.Message))
	}
	return messages
}

func (p ContextPlan) Digest() string {
	raw, _ := json.Marshal(p)
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:])
}

func (s *Session) ContextPlan() (ContextPlan, error) {
	return s.ContextPlanWithMessages(nil)
}

// ContextPlanWithMessages previews admission without publishing pending user
// messages. Successful preparation records system then users; callers must
// separately retain accepted input on preparation failure. No synthetic identity
// escapes this preview.
func (s *Session) ContextPlanWithMessages(messages []Message) (ContextPlan, error) {
	// Only immutable committed messages are memoized. Surface replay, image
	// omissions and prompt validation still run for every plan. Keep the cache
	// local to this Session and bounded by its current committed surface.
	s.contextDecodeMu.Lock()
	defer s.contextDecodeMu.Unlock()
	s.mu.RLock()
	events := append([]Event(nil), s.events...)
	surface := append([]uint64(nil), s.surface...)
	s.mu.RUnlock()
	retained := make(map[uint64]bool, len(surface))
	for _, seq := range surface {
		retained[seq] = true
	}
	decoded := make(map[uint64]Message, len(surface))
	decode := func(event Event) (Message, error) {
		message, ok := s.contextMessages[event.Seq]
		var err error
		if !ok {
			message, err = decodeSurfaceMessage(event)
		}
		if err == nil && retained[event.Seq] {
			decoded[event.Seq] = message
		}
		return message, err
	}
	for _, message := range messages {
		if message.Role != model.RoleUser {
			continue
		}
		raw, err := json.Marshal(message)
		if err != nil {
			return ContextPlan{}, err
		}
		seq := uint64(len(events) + 1)
		events = append(events, Event{Seq: seq, Type: "user/message", Data: raw, SurfaceOp: json.RawMessage(`"append"`)})
		surface = append(surface, seq)
	}
	plan, err := buildContextPlanWithDecoder(events, surface, decode)
	if err == nil {
		s.contextMessages = decoded
	}
	return plan, err
}

// BuildContextPlan preserves the declared surface in order, including opaque
// message metadata. No plugin identity, tool name or sourceRules grant authority
// to omit data. Policy/authorization belongs to the caller, before admission.
func BuildContextPlan(events []Event, surface []uint64) (ContextPlan, error) {
	return buildContextPlanWithDecoder(events, surface, decodeSurfaceMessage)
}

func buildContextPlanWithDecoder(events []Event, surface []uint64, decode func(Event) (Message, error)) (ContextPlan, error) {
	plan := ContextPlan{Kind: ContextPlanKind}
	projected, err := projectedSurfaceMessagesWithDecoder(events, surface, decode)
	if err != nil {
		return plan, err
	}
	bySeq := make(map[uint64]Event, len(events))
	for _, event := range events {
		bySeq[event.Seq] = event
	}
	for _, seq := range surface {
		event, ok := bySeq[seq]
		if !ok || !isSurfaceEventType(event.Type) {
			return plan, fmt.Errorf("session: invalid context surface seq %d", seq)
		}
		if err := validateSystemPromptEventWithDecoder(event, decode); err != nil {
			return plan, err
		}
		message, ok := projected[seq]
		if !ok {
			return plan, fmt.Errorf("session: missing context message at seq %d", seq)
		}
		plan.Nodes = append(plan.Nodes, ContextNode{Seq: seq, Message: cloneMessage(message), Tokens: model.EstimateMessageTokens(message)})
	}
	return plan, nil
}

// LatestInputPlan reconstructs the exact last recorded provider input, excluding
// later assistant output. The published receipt proves its revision and digest.
func (s *Session) LatestInputPlan() (ContextPlan, uint64, error) {
	s.mu.RLock()
	events := append([]Event(nil), s.events...)
	s.mu.RUnlock()
	var at int = -1
	for i, e := range events {
		if e.Type == "request/context-plan" {
			at = i
		}
	}
	if at < 0 {
		return ContextPlan{}, 0, nil
	}
	receipt, err := decodeContextPlanReceipt(events[at].Data)
	if err != nil {
		return ContextPlan{}, 0, err
	}
	surface := []uint64{}
	for _, e := range events[:at] {
		if !IsSurfaceEventType(e.Type) {
			continue
		}
		surface, err = replaySurface(surface, e)
		if err != nil {
			return ContextPlan{}, 0, err
		}
	}
	plan, err := BuildContextPlan(events[:at], surface)
	if err != nil {
		return ContextPlan{}, 0, err
	}
	if plan.Digest() != receipt.Digest {
		return ContextPlan{}, 0, fmt.Errorf("input receipt digest mismatch")
	}
	return plan, events[at].Seq, nil
}
