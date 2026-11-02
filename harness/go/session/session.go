package session

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	harnessmodel "github.com/phodal/pero/harness/go/model"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// ErrSessionDurabilityAttached means another lifecycle owner already installed
// the live Session's durability checkpoint. Host transports may borrow that
// checkpoint, but must not detach it.
var ErrSessionDurabilityAttached = errors.New("harness: session already has a durability checkpoint")

// ErrSessionChanged reports an append CAS miss. Callers may rebuild their
// derived fact from a fresh detached log and retry.
var ErrSessionChanged = errors.New("harness: session changed before append")

const SessionFormatVersion = 0

var nextSessionID atomic.Uint64

type Session struct {
	header    SessionHeader
	published bool
	logger    *slog.Logger
	// firstLiveSeq is the first one-based event sequence created by this
	// process identity. Restored/fork seed prefixes precede this boundary.
	firstLiveSeq uint64
	// restored distinguishes an empty resume materialization from a newly
	// created empty Session. It is process-local provenance and never changes
	// event sequence, persistence format, or model-visible state.
	restored atomic.Bool

	// persistenceAttachMu serializes ownership publication for this exact live identity.
	persistenceAttachMu sync.Mutex
	compactionMu        sync.Mutex
	durabilityMu        sync.RWMutex
	durability          *sessionDurabilityCheckpoint
	mu                  sync.RWMutex
	notifyMu            sync.Mutex
	events              []Event
	surface             []uint64
	subscribers         map[uint64]func(Event)
	nextSubID           uint64
}

type sessionDurabilityCheckpoint struct {
	flush func(context.Context) error
}

func NewSession(id SessionID, cwd string) *Session {
	if id == "" {
		id = SessionID(fmt.Sprintf("session-%d", nextSessionID.Add(1)))
	}
	return &Session{
		header: SessionHeader{Version: SessionFormatVersion, ID: id, CreatedAt: time.Now().UTC(), CWD: cwd}, logger: slog.Default(),
		firstLiveSeq: 1, subscribers: make(map[uint64]func(Event)),
	}
}

// RestoreSession rebuilds a detached Session from an authoritative header and
// raw event log while revalidating sequence, dispatch, surface, and compaction
// invariants. The returned Session is marked restored for this process.
func RestoreSession(header SessionHeader, events []Event) (*Session, error) {
	if header.ID == "" || header.Version != SessionFormatVersion {
		return nil, errors.New("harness: invalid restored session header")
	}
	if header.InboxSeedLength > header.SeedLength || header.InboxSeedLength > maxJSONSafeInteger {
		return nil, errors.New("harness: invalid executable inbox seed boundary")
	}
	if boundary := executableInboxSeedLength(header); boundary != 0 {
		if boundary >= uint64(len(events)) || events[boundary].Type != "session/end-seed" {
			return nil, errors.New("harness: executable inbox seed boundary lacks its inherited marker")
		}
	}
	restored := &Session{header: header, logger: slog.Default(), subscribers: make(map[uint64]func(Event))}
	dispatch := newCodeDispatchIndex()
	for _, source := range events {
		if source.Seq != uint64(len(restored.events)+1) {
			return nil, fmt.Errorf("harness: non-contiguous restored event for %q", header.ID)
		}
		event := source.Clone()
		if err := event.ValidateMetadata(); err != nil {
			return nil, err
		}
		if err := validateContextPlanEvent(restored.events, restored.surface, event); err != nil {
			return nil, err
		}
		dispatchData, isDispatch, err := decodeCodeDispatchEvent(event)
		if err == nil && isDispatch {
			err = dispatch.check(event, dispatchData)
		}
		if err != nil {
			return nil, fmt.Errorf("harness: validate restored dispatch log for %q: %w", header.ID, err)
		}
		if err := restored.applySurfaceEventWithPromptValidationLocked(event, validateSystemPromptEvent); err != nil {
			return nil, fmt.Errorf("harness: rebuild restored surface for %q: %w", header.ID, err)
		}
		restored.events = append(restored.events, event)
		dispatch.record(event, dispatchData, isDispatch)
	}
	if _, err := inspectCompactionLog(restored.events); err != nil {
		return nil, fmt.Errorf("harness: validate restored compaction log for %q: %w", header.ID, err)
	}
	restored.firstLiveSeq = uint64(len(restored.events) + 1)
	restored.restored.Store(true)
	return restored, nil
}

// ConfigureManagedCWD must run before publication and the first event.
func (s *Session) ConfigureManagedCWD() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.published || len(s.events) != 0 {
		return errors.New("harness: execution context must be configured before publication")
	}
	s.header.ManagedCWD = true
	return nil
}

// ConfigureDelegation records immutable delegated-session provenance before
// the Session begins accepting events.
func (s *Session) ConfigureDelegation(parent SessionID, depth int) error {
	if s == nil || parent == "" {
		return errors.New("harness: delegated session requires a parent")
	}
	if depth <= 0 {
		depth = 1
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.published || len(s.events) != 0 {
		return errors.New("harness: delegated session provenance must be configured before events")
	}
	s.header.ParentSession = parent
	s.header.Origin = "subagent"
	s.header.DelegationDepth = depth
	return nil
}

// MarkRestored preserves resume provenance for an already validated Session.
func (s *Session) MarkRestored() {
	if s != nil {
		s.restored.Store(true)
	}
}

func (s *Session) Header() SessionHeader {
	s.mu.RLock()
	defer s.mu.RUnlock()
	header := s.header
	return header
}

// ExecutionEnvironment returns the immutable ordinary variables frozen by the Host
// at Session creation. Historical replay restores configuration without rerunning scripts.
func (s *Session) ExecutionEnvironment() (map[string]string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, event := range s.events {
		if event.Type != "execution-environment" {
			continue
		}
		var payload struct {
			Variables map[string]string `json:"variables"`
		}
		if err := json.Unmarshal(event.Data, &payload); err != nil {
			return nil, err
		}
		return payload.Variables, nil
	}
	return nil, nil
}

// WorkingDirectory is the Session's current execution directory. The latest
// well-formed working-directory/change wins. With no such event, the original
// project path on the header is the directory. The header itself stays put.
func (s *Session) WorkingDirectory() string {
	if s == nil {
		return ""
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for index := len(s.events) - 1; index >= 0; index-- {
		event := s.events[index]
		if event.Type != "working-directory/change" {
			continue
		}
		var payload struct {
			CWD string `json:"cwd"`
		}
		if json.Unmarshal(event.Data, &payload) != nil || strings.TrimSpace(payload.CWD) == "" {
			continue
		}
		return payload.CWD
	}
	return s.header.CWD
}

// FirstLiveSeq is the process-local telemetry/replay boundary. New Sessions
// start at 1; restored and seeded Sessions start after their materialized log.
func (s *Session) FirstLiveSeq() uint64 {
	if s == nil {
		return 1
	}
	s.mu.RLock()
	value := s.firstLiveSeq
	if value == 0 {
		value = uint64(len(s.events) + 1)
	}
	s.mu.RUnlock()
	return value
}

// Restored reports whether this Session was materialized for resume in this
// process. In particular, it preserves provenance for an empty stored log
// whose first live sequence is still correctly 1.
func (s *Session) Restored() bool {
	return s != nil && s.restored.Load()
}

func (s *Session) Append(eventType string, value any) (Event, error) {
	return s.append(eventType, value, nil, nil, nil)
}

// AppendSurface appends one model-visible event with explicit provenance.
// Use AppendReplacement when the event shadows an existing surface range.
func (s *Session) AppendSurface(eventType string, value any, sourceEventSeqs []uint64) (Event, error) {
	return s.append(eventType, value, json.RawMessage(`"append"`), sourceEventSeqs, nil)
}

// AppendIfLastSeq atomically appends only when expectedLastSeq is still the
// current raw-log tail (zero for an empty Session).
func (s *Session) AppendIfLastSeq(expectedLastSeq uint64, eventType string, value any) (Event, error) {
	return s.append(eventType, value, nil, nil, &expectedLastSeq)
}

// AppendReplacement appends one new surface event that replaces an inclusive
// positional range while retaining every shadowed raw event in the log.
func (s *Session) AppendReplacement(eventType string, value any, replaced SurfaceRange, sourceEventSeqs []uint64) (Event, error) {
	operation, err := json.Marshal(struct {
		Op    string `json:"op"`
		Start uint64 `json:"start"`
		End   uint64 `json:"end"`
	}{Op: "replace", Start: replaced.Start, End: replaced.End})
	if err != nil {
		return Event{}, err
	}
	return s.append(eventType, value, operation, sourceEventSeqs, nil)
}

// appendPrunedToolResult atomically commits the shadow-price fact immediately
// before its replacement. The pair shares one commit and notification lane so
// concurrent appenders cannot appear between the two durable events.
func (s *Session) AppendPrunedToolResult(originalSeq uint64, replacement json.RawMessage, shadowedTokens int) (Event, error) {
	if originalSeq == 0 || shadowedTokens <= 0 || !json.Valid(replacement) {
		return Event{}, errors.New("harness: invalid tool-result prune transaction")
	}
	priceData, err := json.Marshal(struct {
		ShadowedRange      SurfaceRange `json:"shadowedRange"`
		ShadowedSeqs       []uint64     `json:"shadowedSeqs"`
		ShadowedTokenCount int          `json:"shadowedTokenCount"`
	}{SurfaceRange{Start: originalSeq, End: originalSeq}, []uint64{originalSeq}, shadowedTokens})
	if err != nil {
		return Event{}, err
	}
	operation, err := json.Marshal(struct {
		Op    string `json:"op"`
		Start uint64 `json:"start"`
		End   uint64 `json:"end"`
	}{Op: "replace", Start: originalSeq, End: originalSeq})
	if err != nil {
		return Event{}, err
	}

	// Admit the mutation through the notification lane before taking the log
	// lock. Subscribers may safely read a detached log snapshot while another
	// appender waits; sequence and notification order remain identical.
	s.notifyMu.Lock()
	defer s.notifyMu.Unlock()
	s.mu.Lock()
	openTurn, err := inspectOpenTurn(s.events)
	if err != nil || openTurn == nil {
		s.mu.Unlock()
		if err != nil {
			return Event{}, err
		}
		return Event{}, errors.New("harness: tool-result pruning requires an open turn")
	}
	originalIndex := int(originalSeq - 1)
	if originalIndex < 0 || originalIndex >= len(s.events) || s.events[originalIndex].Type != "tool/result" {
		s.mu.Unlock()
		return Event{}, fmt.Errorf("harness: prune source seq %d is not a tool result", originalSeq)
	}
	visible := false
	for _, seq := range s.surface {
		if seq == originalSeq {
			visible = true
			break
		}
	}
	if !visible {
		s.mu.Unlock()
		return Event{}, fmt.Errorf("harness: prune source seq %d is no longer on the surface", originalSeq)
	}
	now := time.Now().UTC()
	priceEvent := Event{Seq: uint64(len(s.events) + 1), Time: now, Type: "compaction/prune", Data: priceData}
	replacementEvent := Event{
		Seq: uint64(len(s.events) + 2), Time: now, Type: "tool/result", Data: append(json.RawMessage(nil), replacement...),
		SurfaceOp: operation, SourceEventSeqs: []uint64{originalSeq},
	}
	candidate := make([]Event, 0, len(s.events)+2)
	candidate = append(candidate, s.events...)
	candidate = append(candidate, priceEvent, replacementEvent)
	if _, err := inspectCompactionLog(candidate); err != nil {
		s.mu.Unlock()
		return Event{}, err
	}
	if err := s.applySurfaceEventLocked(replacementEvent); err != nil {
		s.mu.Unlock()
		return Event{}, err
	}
	s.events = append(s.events, priceEvent, replacementEvent)
	subscribers := make([]func(Event), 0, len(s.subscribers))
	ids := make([]uint64, 0, len(s.subscribers))
	for id := range s.subscribers {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(left, right int) bool { return ids[left] < ids[right] })
	for _, id := range ids {
		subscribers = append(subscribers, s.subscribers[id])
	}
	s.mu.Unlock()
	for _, event := range []Event{priceEvent, replacementEvent} {
		for _, subscriber := range subscribers {
			s.notifySubscriber(subscriber, event)
		}
	}
	return replacementEvent, nil
}

// TryLockCompaction serializes compaction transactions for this Session. The
// returned release function must be called exactly once when acquired is true.
func (s *Session) TryLockCompaction() (release func(), acquired bool) {
	if s == nil || !s.compactionMu.TryLock() {
		return func() {}, false
	}
	var once sync.Once
	return func() { once.Do(s.compactionMu.Unlock) }, true
}

func (s *Session) append(eventType string, value any, surfaceOp json.RawMessage, sourceEventSeqs []uint64, expectedLastSeq *uint64) (Event, error) {
	return s.appendAtTime(eventType, value, surfaceOp, sourceEventSeqs, expectedLastSeq, nil)
}

func (s *Session) appendAtTime(eventType string, value any, surfaceOp json.RawMessage, sourceEventSeqs []uint64, expectedLastSeq *uint64, at *time.Time) (Event, error) {
	return s.appendAtTimeWithPublication(eventType, value, surfaceOp, sourceEventSeqs, expectedLastSeq, at, nil)
}

func (s *Session) appendAtTimeWithPublication(eventType string, value any, surfaceOp json.RawMessage, sourceEventSeqs []uint64, expectedLastSeq *uint64, at *time.Time, publish func() error) (Event, error) {
	return s.appendAtTimeWithStore(eventType, value, surfaceOp, sourceEventSeqs, expectedLastSeq, at, publish, nil, nil, nil)
}

func (s *Session) appendAtTimeWithStore(eventType string, value any, surfaceOp json.RawMessage, sourceEventSeqs []uint64, expectedLastSeq *uint64, at *time.Time, publish func() error, store *SessionStore, admissionContext context.Context, admit func() (func(), error)) (Event, error) {
	if eventType == "" {
		return Event{}, errors.New("harness: event type must not be empty")
	}
	if isSurfaceEventType(eventType) && len(surfaceOp) == 0 {
		surfaceOp = json.RawMessage(`"append"`)
	} else if !isSurfaceEventType(eventType) && len(surfaceOp) != 0 {
		return Event{}, fmt.Errorf("harness: log-only event %q cannot mutate the surface", eventType)
	}
	data, err := json.Marshal(value)
	if err != nil {
		return Event{}, fmt.Errorf("harness: encode event %q: %w", eventType, err)
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, data); err != nil {
		return Event{}, fmt.Errorf("harness: normalize event %q: %w", eventType, err)
	}

	// Acquire the delivery lane first. This prevents a later appender from
	// holding the log lock while waiting for an earlier subscriber, so a
	// projection callback can safely call Events().
	s.notifyMu.Lock()
	defer s.notifyMu.Unlock()
	// The framework guard linearizes owner withdrawal with this bounded commit.
	// It must not run user callbacks or take the Session notification lane.
	var releaseAdmission func()
	if admit != nil {
		releaseAdmission, err = admit()
		if err != nil {
			if releaseAdmission != nil {
				releaseAdmission()
			}
			return Event{}, err
		}
		if releaseAdmission == nil {
			return Event{}, errors.New("harness: commit admission omitted release")
		}
		defer func() {
			if releaseAdmission != nil {
				releaseAdmission()
			}
		}()
	}
	// Membership is held only across the bounded in-memory log commit. Never
	// invoke observers or publication while holding the store lock.
	storeHeld := false
	if store != nil {
		store.mu.RLock()
		storeHeld = true
		defer func() {
			if storeHeld {
				store.mu.RUnlock()
			}
		}()
		if store.sessions[s.header.ID] != s {
			return Event{}, ErrSessionNotCurrent
		}
	}
	if admissionContext != nil {
		if err := admissionContext.Err(); err != nil {
			return Event{}, err
		}
	}
	s.mu.Lock()
	if expectedLastSeq != nil && uint64(len(s.events)) != *expectedLastSeq {
		s.mu.Unlock()
		return Event{}, ErrSessionChanged
	}
	event := Event{
		Seq: uint64(len(s.events) + 1), Time: time.Now().UTC(), Type: eventType, Data: compact.Bytes(),
		SurfaceOp: append(json.RawMessage(nil), surfaceOp...), SourceEventSeqs: append([]uint64(nil), sourceEventSeqs...),
	}
	if at != nil {
		event.Time = *at
	}
	if err := validateContextPlanEvent(s.events, s.surface, event); err != nil {
		s.mu.Unlock()
		return Event{}, err
	}
	if len(event.SourceEventSeqs) != 0 {
		seen := make(map[uint64]struct{}, len(event.SourceEventSeqs))
		for _, source := range event.SourceEventSeqs {
			if source == 0 || source >= event.Seq {
				s.mu.Unlock()
				return Event{}, fmt.Errorf("harness: event at seq %d has invalid source seq %d", event.Seq, source)
			}
			if _, duplicate := seen[source]; duplicate {
				s.mu.Unlock()
				return Event{}, fmt.Errorf("harness: event at seq %d repeats source seq %d", event.Seq, source)
			}
			seen[source] = struct{}{}
		}
	}
	if event.Type == "request/context" {
		var requestContext RequestContext
		if err := json.Unmarshal(event.Data, &requestContext); err != nil || requestContext.Provider == "" ||
			requestContext.Model == "" || requestContext.ContextWindow < 0 {
			s.mu.Unlock()
			return Event{}, errors.New("harness: invalid request/context")
		}
		openTurn, err := inspectOpenTurn(s.events)
		if err != nil {
			s.mu.Unlock()
			return Event{}, err
		}
		if openTurn == nil {
			s.mu.Unlock()
			return Event{}, errors.New("harness: request/context requires an open turn")
		}
	}
	if err := validateCodeDispatchEvent(s.events, event); err != nil {
		s.mu.Unlock()
		return Event{}, err
	}
	if event.Type == imageOffloadEventType {
		candidate := make([]Event, len(s.events)+1)
		copy(candidate, s.events)
		candidate[len(s.events)] = event
		if _, err := projectedSurfaceMessages(candidate, s.surface); err != nil {
			s.mu.Unlock()
			return Event{}, err
		}
	}
	if isCompactionEventType(event.Type) || (len(event.SurfaceOp) != 0 && string(event.SurfaceOp) != `"append"`) {
		candidate := make([]Event, len(s.events)+1)
		copy(candidate, s.events)
		candidate[len(s.events)] = event
		if _, err := inspectCompactionLog(candidate); err != nil {
			s.mu.Unlock()
			return Event{}, err
		}
	}
	if err := s.applySurfaceEventLocked(event); err != nil {
		s.mu.Unlock()
		return Event{}, err
	}
	s.events = append(s.events, event)
	subscribers := make([]func(Event), 0, len(s.subscribers))
	ids := make([]uint64, 0, len(s.subscribers))
	for id := range s.subscribers {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(left, right int) bool { return ids[left] < ids[right] })
	for _, id := range ids {
		subscribers = append(subscribers, s.subscribers[id])
	}
	s.mu.Unlock()
	if storeHeld {
		store.mu.RUnlock()
		storeHeld = false
	}

	if releaseAdmission != nil {
		releaseAdmission()
		releaseAdmission = nil
	}

	if publish != nil {
		if err := publish(); err != nil {
			return event, err
		}
	}
	for _, subscriber := range subscribers {
		s.notifySubscriber(subscriber, event)
	}
	return event, nil
}

func (s *Session) notifySubscriber(subscriber func(Event), event Event) {
	defer func() {
		if recovered := recover(); recovered != nil {
			logger := s.logger
			if logger == nil {
				logger = slog.Default()
			}
			logger.Warn("session subscriber panicked after event commit", "type", event.Type, "seq", event.Seq, "panic", recovered)
		}
	}()
	subscriber(event.Clone())
}

func (s *Session) Events() []Event {
	events, _ := s.EventsAfter(0)
	return events
}

// EventsAfter copies only the events with Seq greater than after. Durable
// sequences are contiguous from 1, so it reports false when after is beyond the
// log rather than returning an empty suffix that would hide a diverged cache.
func (s *Session) EventsAfter(after uint64) ([]Event, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if after > uint64(len(s.events)) {
		return nil, false
	}
	suffix := s.events[after:]
	events := make([]Event, len(suffix))
	for index, event := range suffix {
		events[index] = event.Clone()
	}
	return events, true
}

func (s *Session) LastTurn() (int, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	last := 0
	for _, event := range s.events {
		if event.IsOpaque() {
			continue
		}
		var payload map[string]json.RawMessage
		if err := json.Unmarshal(event.Data, &payload); err != nil {
			continue
		}
		raw, exists := payload["turn"]
		if !exists || bytes.Equal(raw, []byte("null")) {
			continue
		}
		var turn int
		if err := json.Unmarshal(raw, &turn); err != nil || turn <= 0 {
			return 0, fmt.Errorf("harness: invalid turn at event seq %d", event.Seq)
		}
		if turn > last {
			last = turn
		}
	}
	return last, nil
}

// SurfaceSeqs returns the current ordered model-visible event identities.
func (s *Session) SurfaceSeqs() []uint64 {
	s.mu.RLock()
	result := append([]uint64(nil), s.surface...)
	s.mu.RUnlock()
	return result
}

// Subscribe delivers observers synchronously. An observer must not join a
// lifecycle whose completion includes that observer's return. For managed App
// retirement, request BeginRetire here and let an outer lifecycle Drain the
// receipt after the callback returns; a Background context does not avoid a
// self-join. Existing synchronous Dispose callers must explicitly migrate.
func (s *Session) Subscribe(listener func(Event)) func() {
	if listener == nil {
		return func() {}
	}
	s.mu.Lock()
	s.nextSubID++
	id := s.nextSubID
	s.subscribers[id] = listener
	s.mu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			s.mu.Lock()
			delete(s.subscribers, id)
			s.mu.Unlock()
		})
	}
}

// Flush waits until every event admitted before the call is durable. An
// unattached in-memory session has no external durability work and succeeds.
func (s *Session) Flush(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	s.durabilityMu.RLock()
	checkpoint := s.durability
	s.durabilityMu.RUnlock()
	if checkpoint == nil {
		return nil
	}
	return checkpoint.flush(ctx)
}

// DurabilityAttached reports whether this live Session has an installed
// persistence checkpoint. Durable domain services use it as an admission
// gate so an in-memory Flush success cannot be mistaken for a checkpoint.
func (s *Session) DurabilityAttached() bool {
	if s == nil {
		return false
	}
	s.durabilityMu.RLock()
	attached := s.durability != nil
	s.durabilityMu.RUnlock()
	return attached
}

func (s *Session) InstallDurabilityCheckpoint(flush func(context.Context) error) (func(), error) {
	if flush == nil {
		return nil, errors.New("harness: durability checkpoint is nil")
	}
	checkpoint := &sessionDurabilityCheckpoint{flush: flush}
	s.durabilityMu.Lock()
	if s.durability != nil {
		s.durabilityMu.Unlock()
		return nil, ErrSessionDurabilityAttached
	}
	s.durability = checkpoint
	s.durabilityMu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			s.durabilityMu.Lock()
			if s.durability == checkpoint {
				s.durability = nil
			}
			s.durabilityMu.Unlock()
		})
	}, nil
}

func (s *Session) DeriveMessages() ([]Message, error) {
	s.mu.RLock()
	events := make([]Event, len(s.events))
	copy(events, s.events)
	surface := append([]uint64(nil), s.surface...)
	s.mu.RUnlock()
	plan, err := BuildContextPlan(events, surface)
	return plan.Messages(), err
}

func decodeSurfaceMessage(event Event) (Message, error) {
	var message Message
	switch event.Type {
	case "user/message":
		if err := json.Unmarshal(event.Data, &message); err != nil {
			return Message{}, fmt.Errorf("harness: decode user/message at seq %d: %w", event.Seq, err)
		}
	case "system/message", "developer/message", "assistant/message":
		var payload struct {
			Message Message `json:"message"`
		}
		if err := json.Unmarshal(event.Data, &payload); err != nil {
			return Message{}, fmt.Errorf("harness: decode assistant/message at seq %d: %w", event.Seq, err)
		}
		message = payload.Message
	case "tool/result":
		var block ContentBlock
		if err := json.Unmarshal(event.Data, &block); err != nil {
			return Message{}, fmt.Errorf("harness: decode tool/result at seq %d: %w", event.Seq, err)
		}
		message = Message{Role: RoleTool, Content: []ContentBlock{block}}
	default:
		return Message{}, fmt.Errorf("harness: event %q at seq %d is not surface-visible", event.Type, event.Seq)
	}
	return message, nil
}

func DecodeSurfaceMessage(event Event) (Message, error) { return decodeSurfaceMessage(event) }

type RequestHeaderEvent struct {
	AdapterDefaults *harnessmodel.CallConfigAdapterDefaults `json:"adapterDefaults,omitempty"`
	Turn            int                                     `json:"turn"`
	Step            int                                     `json:"step"`
	Provider        string                                  `json:"provider,omitempty"`
	Model           string                                  `json:"model,omitempty"`
	TransientModel  bool                                    `json:"transientModel,omitempty"`
	ReasoningEffort ReasoningEffort                         `json:"reasoningEffort,omitempty"`
	Temperature     *float64                                `json:"temperature,omitempty"`
	MaxTokens       int                                     `json:"maxTokens,omitempty"`
	Stop            []string                                `json:"stop,omitempty"`
	System          string                                  `json:"system,omitempty"`
	Tools           []ToolSchema                            `json:"tools,omitempty"`
	Reason          string                                  `json:"reason,omitempty"`
	StartsSeries    bool                                    `json:"startsSeries,omitempty"`
}

// RequestContext is the latest durable routed provider/model and its
// adapter-advertised capacity. A zero ContextWindow means unknown capacity.
type RequestContext struct {
	SystemPromptUpdate string `json:"systemPromptUpdate,omitempty"`
	Provider           string `json:"provider"`
	Model              string `json:"model"`
	ContextWindow      int    `json:"contextWindow,omitempty"`
}

func (s *Session) RequestContext() (RequestContext, bool, error) {
	events := s.Events()
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Type != "request/context" {
			continue
		}
		var requestContext RequestContext
		if err := json.Unmarshal(events[index].Data, &requestContext); err != nil {
			return RequestContext{}, false, fmt.Errorf("harness: decode request/context at seq %d: %w", events[index].Seq, err)
		}
		if requestContext.Provider == "" || requestContext.Model == "" || requestContext.ContextWindow < 0 {
			return RequestContext{}, false, fmt.Errorf("harness: invalid request/context at seq %d", events[index].Seq)
		}
		return requestContext, true, nil
	}
	return RequestContext{}, false, nil
}

func (s *Session) RequestHeader() (RequestHeaderEvent, bool, error) {
	// Every model step asks for the latest header: find it in place and copy
	// only that event, not the whole log.
	s.mu.RLock()
	var seq uint64
	var data json.RawMessage
	for index := len(s.events) - 1; index >= 0; index-- {
		if s.events[index].Type == "request/header" {
			seq, data = s.events[index].Seq, append(json.RawMessage(nil), s.events[index].Data...)
			break
		}
	}
	s.mu.RUnlock()
	if seq == 0 {
		return RequestHeaderEvent{}, false, nil
	}
	var header RequestHeaderEvent
	if err := json.Unmarshal(data, &header); err != nil {
		return RequestHeaderEvent{}, false, fmt.Errorf("harness: decode request/header at seq %d: %w", seq, err)
	}
	return header, true, nil
}

func isSurfaceEventType(eventType string) bool {
	return eventType == "developer/message" || eventType == "system/message" || eventType == "user/message" || eventType == "assistant/message" || eventType == "tool/result"
}

func IsSurfaceEventType(eventType string) bool { return isSurfaceEventType(eventType) }

func (s *Session) applySurfaceEventLocked(event Event) error {
	return s.applySurfaceEventWithPromptValidationLocked(event, validateSystemPromptEvent)
}

func (s *Session) applySurfaceEventWithPromptValidationLocked(event Event, validatePrompt func(Event) error) error {
	if err := event.ValidateMetadata(); err != nil {
		return err
	}
	if event.IsOpaque() {
		return nil
	}
	if err := validateDeveloperMessageEvent(s.events, event); err != nil {
		return err
	}
	if err := validatePrompt(event); err != nil {
		return err
	}
	if !isSurfaceEventType(event.Type) {
		if len(event.SurfaceOp) != 0 {
			return fmt.Errorf("harness: log-only event %q at seq %d has a surface operation", event.Type, event.Seq)
		}
		return nil
	}
	if len(event.SurfaceOp) == 0 || string(event.SurfaceOp) == `"append"` {
		s.surface = append(s.surface, event.Seq)
		return nil
	}
	var operation struct {
		Op    string `json:"op"`
		Start uint64 `json:"start"`
		End   uint64 `json:"end"`
	}
	if err := json.Unmarshal(event.SurfaceOp, &operation); err != nil || operation.Op != "replace" {
		return fmt.Errorf("harness: invalid surface operation at seq %d", event.Seq)
	}
	startIndex, endIndex := -1, -1
	for index, seq := range s.surface {
		if seq == operation.Start && startIndex < 0 {
			startIndex = index
		}
		if seq == operation.End {
			endIndex = index
		}
	}
	if startIndex < 0 || endIndex < startIndex {
		return fmt.Errorf("harness: replacement at seq %d names a missing or reversed surface range %d-%d", event.Seq, operation.Start, operation.End)
	}
	// Preserve the first canonical prompt even on resumed legacy logs where it
	// was appended after existing history. Never compact or erase this anchor.
	for index, seq := range s.surface {
		if seq == 0 || seq > uint64(len(s.events)) || s.events[seq-1].Type != "system/message" {
			continue
		}
		if startIndex <= index && index <= endIndex && (event.Type != "system/message" || startIndex != endIndex) {
			return fmt.Errorf("harness: system prompt head may only be replaced by one system/message")
		}
		break
	}
	sources := make(map[uint64]struct{}, len(event.SourceEventSeqs))
	for _, seq := range event.SourceEventSeqs {
		if seq == 0 || seq >= event.Seq {
			return fmt.Errorf("harness: replacement at seq %d has invalid source seq %d", event.Seq, seq)
		}
		sources[seq] = struct{}{}
	}
	for _, shadowed := range s.surface[startIndex : endIndex+1] {
		if _, ok := sources[shadowed]; !ok {
			return fmt.Errorf("harness: replacement at seq %d does not cite shadowed seq %d", event.Seq, shadowed)
		}
	}
	next := make([]uint64, 0, len(s.surface)-(endIndex-startIndex)+1)
	next = append(next, s.surface[:startIndex]...)
	next = append(next, event.Seq)
	next = append(next, s.surface[endIndex+1:]...)
	s.surface = next
	return nil
}
