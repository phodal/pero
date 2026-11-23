package harness

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
)

// MainRequestInput is a short-lived, internally minted dispatch receipt. Its
// zero value and JSON-decoded values are inactive; retaining it does not permit
// a later title generation to treat an old dispatch as a new request.
type MainRequestInput struct {
	agent           *Agent
	provider, model string
	turn, step      int
	observedSeq     uint64
	active          *atomic.Bool
}

func (i MainRequestInput) Active() bool            { return i.active != nil && i.active.Load() }
func (i MainRequestInput) Agent() *Agent           { return i.agent }
func (i MainRequestInput) Route() (string, string) { return i.provider, i.model }
func (i MainRequestInput) Boundary() (int, int)    { return i.turn, i.step }
func (i MainRequestInput) ObservedSeq() uint64     { return i.observedSeq }

// mainRequestAdmissionError distinguishes a callback-triggered withdrawal from
// a provider failure. The loop preserves its exact cause through cancellation.
type mainRequestAdmissionError struct{ cause error }

func (e *mainRequestAdmissionError) Error() string { return e.cause.Error() }
func (e *mainRequestAdmissionError) Unwrap() error { return e.cause }

// generateMainRequest runs at the same boundary as official marked llm/stream:
// after the durable request fold, before calling the prepared adapter. Auxiliary
// title/compaction requests do not pass through this loop-owned operation. A
// listener error follows the normal failed-attempt/retry path, like a throwing
// official llm/stream interceptor, without entering the underlying adapter.
func (a *Agent) generateMainRequest(ctx context.Context, prepared PreparedAdapterCall, request GenerateRequest, emit func(StreamChunk) error) (Completion, error) {
	var active atomic.Bool
	active.Store(true)
	events := a.session.Events()
	var seq uint64
	if len(events) > 0 {
		seq = events[len(events)-1].Seq
	}
	if request.promptReceipt != nil {
		// Anchor to the exact prepared Session prefix exposed to observers.
		// An observer may append a later event without altering the request.
		request.promptReceipt.AfterSeq = seq
		request.promptReceipt.owner = a
	}
	input := MainRequestInput{agent: a, provider: request.Provider, model: request.Model, turn: request.Turn, step: request.Step, observedSeq: seq, active: &active}
	err := func() error { defer active.Store(false); return a.hooks.MainRequest.Emit(ctx, input) }()
	if err != nil {
		return Completion{}, err
	}
	// Observers may synchronously cancel or retire this exact generation. The
	// callback receipt is already expired; recheck before entering any provider
	// code, including adapters which do not themselves inspect ctx.
	var cancelled error
	if ctx.Err() != nil {
		cancelled = errors.Join(ctx.Err(), context.Cause(ctx))
	}
	if admission := errors.Join(cancelled, a.mutationAdmissionError()); admission != nil {
		return Completion{}, &mainRequestAdmissionError{cause: admission}
	}
	// Adapters own no callback lifetime beyond this exact Generate call. Serialize
	// callbacks with retirement so a retained emitter cannot append to a later
	// attempt/turn, or race the interrupted-prefix assembly after return.
	var streamMu sync.Mutex
	streamOpen := true
	defer func() { streamMu.Lock(); streamOpen = false; streamMu.Unlock() }()
	return prepared.Generate(ctx, request, func(chunk StreamChunk) error {
		streamMu.Lock()
		defer streamMu.Unlock()
		if !streamOpen {
			return errors.New("harness: provider stream is closed")
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		return emit(chunk)
	})
}
