package session

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
)

type InboxTarget string

const (
	InboxNextTurn InboxTarget = "next-turn"
	InboxNextStep InboxTarget = "next-step"
)

type InboxSpliceEvent struct {
	Target       InboxTarget `json:"target"`
	Start        int         `json:"start"`
	RemovedCount int         `json:"removedCount,omitempty"`
	Inserted     []Message   `json:"inserted"`
	Outcome      string      `json:"outcome,omitempty"`
}

type InboxMutation struct {
	Removed  []Message
	Inserted []Message
}

// DurableInbox is the replayed projection of agent/inbox/spliced events in
// one Session's executable durable log. Public forks inherit pending input;
// delegated forks inherit only conversation context, not their parent's queue.
// Mutations append before changing the live projection, matching DSH's crash
// boundary and observer ordering.
type DurableInbox struct {
	session *Session
	mu      sync.Mutex
	state   map[InboxTarget][]Message
	seen    map[string]Message
}

func NewDurableInbox(session *Session) (*DurableInbox, error) {
	if session == nil {
		return nil, errors.New("harness: durable inbox requires a session")
	}
	inbox := &DurableInbox{session: session, state: map[InboxTarget][]Message{
		InboxNextTurn: {}, InboxNextStep: {},
	}, seen: make(map[string]Message)}
	seedLength := executableInboxSeedLength(session.Header())
	events := session.Events()
	for _, event := range events {
		if event.Seq <= seedLength {
			continue
		}
		if event.Type == "user/message" {
			var message Message
			if json.Unmarshal(event.Data, &message) == nil && message.ID != "" {
				if _, err := validateDurableMessage(message); err != nil {
					return nil, fmt.Errorf("harness: invalid durable user message at seq %d: %w", event.Seq, err)
				}
				if prior, exists := inbox.seen[message.ID]; exists {
					if !messagesEqual(prior, message) {
						return nil, fmt.Errorf("harness: durable message %q changed content at seq %d", message.ID, event.Seq)
					}
				} else {
					inbox.seen[message.ID] = cloneMessage(message)
				}
			}
			continue
		}
		if event.Type == "agent/inbox/moved" {
			var move struct {
				ID     string      `json:"id"`
				Target InboxTarget `json:"target"`
			}
			if err := json.Unmarshal(event.Data, &move); err != nil {
				return nil, err
			}
			if err := inbox.applyMoveLocked(move.ID, move.Target); err != nil {
				return nil, err
			}
			continue
		}
		if event.Type != "agent/inbox/spliced" {
			continue
		}
		var splice InboxSpliceEvent
		if err := json.Unmarshal(event.Data, &splice); err != nil {
			return nil, fmt.Errorf("harness: decode persisted inbox splice at seq %d: %w", event.Seq, err)
		}
		if err := inbox.validateLocked(splice); err != nil {
			return nil, fmt.Errorf("harness: invalid persisted inbox splice at seq %d: %w", event.Seq, err)
		}
		inbox.applyLocked(splice)
	}
	return inbox, nil
}

// Delegation keeps the inherited transcript intact but starts its own input
// queue. Origin remains immutable on reopen-as-root, so only the parent prefix
// is excluded; the child's durable suffix always survives a cold resume. An
// ordinary fork carries this execution boundary without inheriting Origin.
func executableInboxSeedLength(header SessionHeader) uint64 {
	if header.Origin == "subagent" {
		return header.SeedLength
	}
	return header.InboxSeedLength
}

// Append durably extends one pending list. Repeating the same pending identity
// with byte-equivalent content is idempotent; identity reuse with different
// content fails closed.
func (i *DurableInbox) Append(target InboxTarget, message Message) (bool, error) {
	message, err := validateDurableMessage(message)
	if err != nil {
		return false, err
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	if current, ok := i.seen[message.ID]; ok {
		if messagesEqual(current, message) {
			return false, nil
		}
		return false, fmt.Errorf("harness: durable inbox message %q is already pending with different content", message.ID)
	}
	splice := InboxSpliceEvent{Target: target, Start: len(i.state[target]), Inserted: []Message{cloneMessage(message)}}
	if err := i.validateLocked(splice); err != nil {
		return false, err
	}
	event, err := i.session.Append("agent/inbox/spliced", splice)
	if err != nil {
		return false, err
	}
	var committed InboxSpliceEvent
	if err := json.Unmarshal(event.Data, &committed); err != nil {
		return false, fmt.Errorf("harness: decode committed inbox splice: %w", err)
	}
	i.applyLocked(committed)
	i.seen[message.ID] = cloneMessage(message)
	return true, nil
}

// Splice applies standard inbox splice coordinates and records a canceled
// outcome for removed messages. It mirrors DSH's public Inbox mutation:
// commit first, then update the live projection, then let the Agent publish
// discarded-before-inserted notifications.
func (i *DurableInbox) Splice(target InboxTarget, start, deleteCount int, inserted []Message) (InboxMutation, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.spliceLocked(target, start, deleteCount, inserted)
}

// SpliceAdmitted guards one exact published Session's commit without holding
// the owner guard while subscribers run. It is an internal runtime seam.
func (i *DurableInbox) SpliceAdmitted(ctx context.Context, store *SessionStore, target InboxTarget, start int, inserted []Message, admit func() (func(), error)) (InboxMutation, error) {
	if store == nil || admit == nil {
		return InboxMutation{}, ErrSessionNotCurrent
	}
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.spliceLockedAdmitted(target, start, 0, inserted, ctx, store, admit)
}

func (i *DurableInbox) spliceLocked(target InboxTarget, start, deleteCount int, inserted []Message) (InboxMutation, error) {
	return i.spliceLockedAdmitted(target, start, deleteCount, inserted, nil, nil, nil)
}

func (i *DurableInbox) spliceLockedAdmitted(target InboxTarget, start, deleteCount int, inserted []Message, ctx context.Context, store *SessionStore, admit func() (func(), error)) (InboxMutation, error) {
	list, ok := i.state[target]
	if !ok {
		return InboxMutation{}, fmt.Errorf("harness: invalid durable inbox target %q", target)
	}
	actualStart := start
	if actualStart < 0 {
		actualStart = len(list) + actualStart
		if actualStart < 0 {
			actualStart = 0
		}
	} else if actualStart > len(list) {
		actualStart = len(list)
	}
	if deleteCount < 0 {
		deleteCount = 0
	}
	if deleteCount > len(list)-actualStart {
		deleteCount = len(list) - actualStart
	}
	if deleteCount == 0 && len(inserted) == 0 {
		return InboxMutation{}, nil
	}
	canonicalInserted := cloneMessages(inserted)
	for index, message := range canonicalInserted {
		validated, err := validateDurableMessage(message)
		if err != nil {
			return InboxMutation{}, fmt.Errorf("harness: invalid inserted inbox message %d: %w", index, err)
		}
		canonicalInserted[index] = validated
	}
	splice := InboxSpliceEvent{
		Target: target, Start: actualStart, RemovedCount: deleteCount, Inserted: canonicalInserted,
	}
	if deleteCount > 0 {
		splice.Outcome = "canceled"
	}
	if err := i.validateLocked(splice); err != nil {
		return InboxMutation{}, err
	}
	removed := cloneMessages(list[actualStart : actualStart+deleteCount])
	var event Event
	var err error
	if store != nil {
		event, err = store.AppendLogExactAdmitted(ctx, i.session, "agent/inbox/spliced", splice, admit)
	} else {
		event, err = i.session.Append("agent/inbox/spliced", splice)
	}
	if err != nil {
		return InboxMutation{}, err
	}
	var committed InboxSpliceEvent
	if err := json.Unmarshal(event.Data, &committed); err != nil {
		return InboxMutation{}, fmt.Errorf("harness: decode committed inbox splice: %w", err)
	}
	i.applyLocked(committed)
	return InboxMutation{Removed: removed, Inserted: cloneMessages(committed.Inserted)}, nil
}

func (i *DurableInbox) Replace(id string, message Message) (InboxMutation, bool, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	target, index, found := i.locationLocked(id)
	if !found {
		return InboxMutation{}, false, nil
	}
	mutation, err := i.spliceLocked(target, index, 1, []Message{message})
	return mutation, err == nil, err
}

func (i *DurableInbox) Remove(id string) (InboxMutation, bool, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	target, index, found := i.locationLocked(id)
	if !found {
		return InboxMutation{}, false, nil
	}
	mutation, err := i.spliceLocked(target, index, 1, nil)
	return mutation, err == nil, err
}

// RemoveExact compares immutable message bytes and removes only that queued
// item under the same inbox mutation lock. An ID alone never grants ownership
// of a replacement. Other targets, order, history and wake semantics are intact.
func (i *DurableInbox) RemoveExact(message Message) (InboxMutation, bool, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	target, index, found := i.locationLocked(message.ID)
	if !found || !messagesEqual(i.state[target][index], message) {
		return InboxMutation{}, false, nil
	}
	mutation, err := i.spliceLocked(target, index, 1, nil)
	return mutation, err == nil, err
}

func (i *DurableInbox) Clear() ([]InboxMutation, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	mutations := make([]InboxMutation, 0, 2)
	for _, target := range []InboxTarget{InboxNextStep, InboxNextTurn} {
		mutation, err := i.spliceLocked(target, 0, len(i.state[target]), nil)
		if err != nil {
			return mutations, err
		}
		if len(mutation.Removed) != 0 {
			mutations = append(mutations, mutation)
		}
	}
	return mutations, nil
}

// Claim removes the complete next-step batch and optionally the first queued
// next-turn message. Each deletion commits before the returned message becomes
// model-visible.
func (i *DurableInbox) Claim(target InboxTarget) ([]Message, error) {
	i.mu.Lock()
	defer i.mu.Unlock()
	if target != InboxNextStep && target != InboxNextTurn {
		return nil, fmt.Errorf("harness: invalid durable inbox claim target %q", target)
	}
	claimed := make([]Message, 0, len(i.state[InboxNextStep])+1)
	if len(i.state[InboxNextStep]) != 0 {
		removed, err := i.deleteLocked(InboxNextStep, len(i.state[InboxNextStep]))
		if err != nil {
			return nil, err
		}
		claimed = append(claimed, removed...)
	}
	if target == InboxNextTurn && len(i.state[InboxNextTurn]) != 0 {
		removed, err := i.deleteLocked(InboxNextTurn, 1)
		if err != nil {
			return nil, err
		}
		claimed = append(claimed, removed...)
	}
	return claimed, nil
}

func (i *DurableInbox) HasNextTurn() bool {
	i.mu.Lock()
	has := len(i.state[InboxNextTurn]) != 0
	i.mu.Unlock()
	return has
}

func (i *DurableInbox) HasNextStep() bool {
	i.mu.Lock()
	has := len(i.state[InboxNextStep]) != 0
	i.mu.Unlock()
	return has
}

func (i *DurableInbox) Pending(target InboxTarget) []Message {
	i.mu.Lock()
	result := cloneMessages(i.state[target])
	i.mu.Unlock()
	return result
}

// Accepted returns the first durable message recorded under id, whether it is
// still pending or has already crossed into user/message history. Callers use
// this during crash reconciliation without mutating the inbox projection.
func (i *DurableInbox) Accepted(id string) (Message, bool) {
	if i == nil || id == "" {
		return Message{}, false
	}
	i.mu.Lock()
	message, ok := i.seen[id]
	i.mu.Unlock()
	return cloneMessage(message), ok
}

func (i *DurableInbox) deleteLocked(target InboxTarget, count int) ([]Message, error) {
	removed := cloneMessages(i.state[target][:count])
	splice := InboxSpliceEvent{Target: target, Start: 0, RemovedCount: count, Inserted: []Message{}}
	event, err := i.session.Append("agent/inbox/spliced", splice)
	if err != nil {
		return nil, err
	}
	var committed InboxSpliceEvent
	if err := json.Unmarshal(event.Data, &committed); err != nil {
		return nil, fmt.Errorf("harness: decode committed inbox claim: %w", err)
	}
	i.applyLocked(committed)
	return removed, nil
}

func (i *DurableInbox) locateLocked(id string) (Message, bool) {
	for _, target := range []InboxTarget{InboxNextTurn, InboxNextStep} {
		for _, message := range i.state[target] {
			if message.ID == id {
				return message, true
			}
		}
	}
	return Message{}, false
}

func (i *DurableInbox) locationLocked(id string) (InboxTarget, int, bool) {
	for _, target := range []InboxTarget{InboxNextTurn, InboxNextStep} {
		for index, message := range i.state[target] {
			if message.ID == id {
				return target, index, true
			}
		}
	}
	return "", 0, false
}

func (i *DurableInbox) validateLocked(splice InboxSpliceEvent) error {
	list, ok := i.state[splice.Target]
	if !ok || splice.Start < 0 || splice.Start > len(list) || splice.RemovedCount < 0 || splice.Start+splice.RemovedCount > len(list) {
		return errors.New("harness: invalid inbox splice coordinates")
	}
	if splice.Outcome != "" && splice.Outcome != "canceled" {
		return errors.New("harness: invalid inbox splice outcome")
	}
	candidate := append([]Message(nil), list[:splice.Start]...)
	candidate = append(candidate, cloneMessages(splice.Inserted)...)
	candidate = append(candidate, list[splice.Start+splice.RemovedCount:]...)
	seen := make(map[string]struct{}, len(candidate)+len(i.state[otherInboxTarget(splice.Target)]))
	for _, message := range append(candidate, i.state[otherInboxTarget(splice.Target)]...) {
		if _, err := validateDurableMessage(message); err != nil {
			return err
		}
		if _, duplicate := seen[message.ID]; duplicate {
			return fmt.Errorf("harness: durable inbox message %q is already pending", message.ID)
		}
		seen[message.ID] = struct{}{}
	}
	return nil
}

func (i *DurableInbox) applyLocked(splice InboxSpliceEvent) {
	list := i.state[splice.Target]
	next := append([]Message(nil), list[:splice.Start]...)
	next = append(next, cloneMessages(splice.Inserted)...)
	next = append(next, list[splice.Start+splice.RemovedCount:]...)
	i.state[splice.Target] = next
	for _, message := range splice.Inserted {
		i.seen[message.ID] = cloneMessage(message)
	}
}

func ValidateDurableMessage(message Message) (Message, error) {
	if message.ID == "" || message.Role != RoleUser || len(message.Content) == 0 || len(message.Source) == 0 || !json.Valid(message.Source) {
		return Message{}, errors.New("harness: durable inbox message requires id, user role, content, and JSON source")
	}
	var source map[string]json.RawMessage
	if json.Unmarshal(message.Source, &source) != nil || len(source) == 0 || bytes.Equal(bytes.TrimSpace(message.Source), []byte("null")) {
		return Message{}, errors.New("harness: durable inbox message source must be a non-empty object")
	}
	return cloneMessage(message), nil
}

func validateDurableMessage(message Message) (Message, error) { return ValidateDurableMessage(message) }

func otherInboxTarget(target InboxTarget) InboxTarget {
	if target == InboxNextTurn {
		return InboxNextStep
	}
	return InboxNextTurn
}

func MessagesEqual(left, right Message) bool {
	a, errA := json.Marshal(left)
	b, errB := json.Marshal(right)
	return errA == nil && errB == nil && bytes.Equal(a, b)
}

func messagesEqual(left, right Message) bool { return MessagesEqual(left, right) }

// Move changes placement with one durable event, so a crash cannot lose or
// duplicate the message between the two queues.
func (i *DurableInbox) Move(id string, target InboxTarget) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	from, _, found := i.locationLocked(id)
	if !found {
		return errors.New("pending message not found")
	}
	if target != InboxNextStep && target != InboxNextTurn {
		return errors.New("invalid inbox target")
	}
	if from == target {
		return nil
	}
	if _, err := i.session.Append("agent/inbox/moved", struct {
		ID     string      `json:"id"`
		Target InboxTarget `json:"target"`
	}{id, target}); err != nil {
		return err
	}
	return i.applyMoveLocked(id, target)
}
func (i *DurableInbox) applyMoveLocked(id string, target InboxTarget) error {
	from, index, found := i.locationLocked(id)
	if !found || (target != InboxNextStep && target != InboxNextTurn) {
		return errors.New("invalid persisted inbox move")
	}
	if from == target {
		return nil
	}
	message := i.state[from][index]
	i.state[from] = append(i.state[from][:index], i.state[from][index+1:]...)
	i.state[target] = append(i.state[target], message)
	return nil
}
