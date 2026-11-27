package harness

import (
	"context"
	"errors"
	"sync"
)

// ErrOwnedFollowupRetired rejects admission through an old owner incarnation.
var ErrOwnedFollowupRetired = errors.New("harness: owned followup owner is retired")

type ownedFollowupState uint8

const (
	ownedFollowupPreparing ownedFollowupState = iota
	ownedFollowupQueued
	ownedFollowupClaimed
	ownedFollowupWithdrawing
	ownedFollowupSettled
)

// OwnedFollowupOwner is a native, process-local domain for exact automatic
// inputs. It deliberately has no running-turn cancellation authority. All
// claimed work, including pure automatic work, makes selected retirement busy.
// Session writes and the Agent's ordinary batching semantics remain unchanged.
type OwnedFollowupOwner struct {
	mu          sync.Mutex
	id          string
	sealed      bool
	receipts    map[*OwnedFollowupReceipt]struct{}
	changed     chan struct{}
	reservation *OwnedFollowupReservation
	retirement  *OwnedFollowupRetirement
	cleanupErr  error
}

func NewOwnedFollowupOwner(ownerID string) *OwnedFollowupOwner {
	return &OwnedFollowupOwner{id: ownerID, receipts: make(map[*OwnedFollowupReceipt]struct{}), changed: make(chan struct{})}
}

// OwnedFollowupReceipt cannot be reconstructed from a message ID, source label,
// Session history, or a replacement Agent. Its outcome belongs to one exact
// accepted request, through worker finalization and result/status publication.
type OwnedFollowupReceipt struct {
	owner     *OwnedFollowupOwner
	agent     *Agent
	session   *Session
	message   Message
	digest    string
	admission *followupAdmissionReceipt
	state     ownedFollowupState // guarded by owner.mu
	done      chan struct{}
	outcome   TurnOutcome // immutable after done closes
}

// TryFollowupOwned uses the existing guarded admission/CAS path. The Agent
// replaces any caller-supplied ID with a fresh identity and registers ownership
// before preparation, guard facts, or synchronous insertion notifications.
// A nonnil receipt is returned even when later preparation/enqueue fails.
func (a *Agent) TryFollowupOwned(message Message, admission FollowupAdmission, owner *OwnedFollowupOwner) (*OwnedFollowupReceipt, bool, error) {
	return a.TryFollowupOwnedContext(context.Background(), message, admission, owner)
}

// TryFollowupOwnedContext binds a native follow-up's exact execution to ctx.
// Cancelling it does not cancel unrelated turns.
func (a *Agent) TryFollowupOwnedContext(ctx context.Context, message Message, admission FollowupAdmission, owner *OwnedFollowupOwner) (*OwnedFollowupReceipt, bool, error) {
	if owner == nil || a == nil || ctx == nil {
		return nil, false, errors.New("harness: owned followup requires an Agent and owner")
	}
	if admission.Producer == "" || admission.Lifetime == nil || admission.Check == nil || admission.Commit == nil {
		return nil, false, errors.New("harness: incomplete native followup admission")
	}
	id, err := newMessageID()
	if err != nil {
		return nil, false, err
	}
	message.ID = id
	owner.mu.Lock()
	if owner.sealed {
		owner.mu.Unlock()
		return nil, false, ErrOwnedFollowupRetired
	}
	if owner.reservation != nil {
		owner.mu.Unlock()
		return nil, false, &ProfileOwnerBusyError{OwnerID: owner.id, Reserved: true}
	}
	receipt := &OwnedFollowupReceipt{owner: owner, agent: a, session: a.session, state: ownedFollowupPreparing, done: make(chan struct{})}
	owner.receipts[receipt] = struct{}{}
	owner.notifyLocked()
	owner.mu.Unlock()
	accepted, err := a.tryFollowupOwned(ctx, message, &admission, receipt)
	if !accepted {
		receipt.settle(TurnOutcome{Err: err})
	}
	return receipt, accepted, err
}

func (o *OwnedFollowupOwner) notifyLocked() {
	close(o.changed)
	o.changed = make(chan struct{})
}

// OwnedFollowupReservation reversibly fences this domain's queued requests.
// No Agent locks are held while the transaction evaluates other owners.
type OwnedFollowupReservation struct {
	owner    *OwnedFollowupOwner
	released bool // guarded by owner.mu
	retired  bool
}

func (o *OwnedFollowupOwner) TryReserveQueued() (*OwnedFollowupReservation, error) {
	if o == nil {
		return nil, ErrOwnedFollowupRetired
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.sealed {
		return nil, ErrOwnedFollowupRetired
	}
	if o.reservation != nil {
		return nil, &ProfileOwnerBusyError{OwnerID: o.id, Reserved: true}
	}
	active := 0
	for receipt := range o.receipts {
		if receipt.state != ownedFollowupQueued {
			active++
		}
	}
	if active != 0 {
		return nil, &ProfileOwnerBusyError{OwnerID: o.id, ActiveOperations: active}
	}
	reservation := &OwnedFollowupReservation{owner: o}
	o.reservation = reservation
	o.notifyLocked()
	return reservation, nil
}

func (r *OwnedFollowupReservation) Release() {
	if r == nil || r.owner == nil {
		return
	}
	o := r.owner
	o.mu.Lock()
	if !r.released && !r.retired && o.reservation == r {
		r.released = true
		o.reservation = nil
		o.notifyLocked()
	}
	o.mu.Unlock()
}

// Retire irreversibly seals this exact reserved generation, then joins it.
// Cancellation bounds this waiter only; the first caller's values and cleanup
// continue independently. Repeated calls join the same cached result.
func (r *OwnedFollowupReservation) Retire(ctx context.Context) error {
	if r == nil || r.owner == nil {
		return ErrOwnedFollowupRetired
	}
	o := r.owner
	o.mu.Lock()
	if r.released || (!r.retired && o.reservation != r) {
		o.mu.Unlock()
		return ErrOwnedFollowupRetired
	}
	r.retired = true
	o.sealed = true
	o.reservation = nil
	retirement := o.beginRetireLocked(ctx)
	o.notifyLocked()
	o.mu.Unlock()
	return retirement.Drain(ctx)
}

// OwnedFollowupRetirement is the stable nonwaiting seal receipt. Drain must be
// called outside synchronous admission/Session/status callbacks being joined.
type OwnedFollowupRetirement struct {
	owner   *OwnedFollowupOwner
	context context.Context
	done    chan struct{}
	err     error // immutable after done closes
}

func (o *OwnedFollowupOwner) BeginRetire(ctx context.Context) *OwnedFollowupRetirement {
	if o == nil {
		return nil
	}
	o.mu.Lock()
	o.sealed = true
	retirement := o.beginRetireLocked(ctx)
	o.notifyLocked()
	o.mu.Unlock()
	return retirement
}

func (o *OwnedFollowupOwner) beginRetireLocked(ctx context.Context) *OwnedFollowupRetirement {
	if o.retirement == nil {
		if ctx == nil {
			ctx = context.Background()
		}
		o.retirement = &OwnedFollowupRetirement{owner: o, context: context.WithoutCancel(ctx), done: make(chan struct{})}
		go o.retirement.run()
	}
	return o.retirement
}

func (r *OwnedFollowupRetirement) Drain(ctx context.Context) error {
	if r == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-r.done:
		return r.err
	default:
	}
	select {
	case <-r.done:
		return r.err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (r *OwnedFollowupRetirement) run() {
	o := r.owner
	for {
		o.mu.Lock()
		var queued []*OwnedFollowupReceipt
		if o.reservation == nil {
			for receipt := range o.receipts {
				if receipt.state == ownedFollowupQueued {
					receipt.state = ownedFollowupWithdrawing
					queued = append(queued, receipt)
				}
			}
			if len(o.receipts) == 0 {
				r.err = o.cleanupErr
				close(r.done)
				o.mu.Unlock()
				return
			}
		}
		changed := o.changed
		o.mu.Unlock()
		if len(queued) == 0 {
			<-changed
			continue
		}
		for _, receipt := range queued {
			receipt.withdraw(r.context)
		}
	}
}

type ownedFollowupExecutionKey struct{}

// OwnsExecution reports whether the current worker is executing a live receipt
// from this owner for the exact Agent. Restored input and other turns never match.
func (o *OwnedFollowupOwner) OwnsExecution(ctx context.Context, agent *Agent) bool {
	if o == nil || ctx == nil || agent == nil {
		return false
	}
	receipt, ok := ctx.Value(ownedFollowupExecutionKey{}).(*OwnedFollowupReceipt)
	return ok && receipt.owner == o && receipt.agent == agent && ctx.Err() == nil && receipt.ownsContext(ctx)
}

// Owned guarded input is valid only in the exact worker that selected its
// original request. Copying observable message bytes into Inject/another queue
// cannot transplant admission authority while the original remains queued.
func (r *OwnedFollowupReceipt) ownsContext(ctx context.Context) bool {
	if r == nil {
		return true
	}
	if ctx.Value(ownedFollowupExecutionKey{}) != r {
		return false
	}
	r.owner.mu.Lock()
	claimed := r.state == ownedFollowupClaimed
	r.owner.mu.Unlock()
	return claimed
}

func (r *OwnedFollowupReceipt) publishQueued() {
	if r == nil {
		return
	}
	r.owner.mu.Lock()
	r.state = ownedFollowupQueued
	r.owner.notifyLocked()
	r.owner.mu.Unlock()
}

// claim executes only bounded memory transitions under the owner fence. The
// worker must release all Agent locks before waiting on the returned barrier.
func (r *OwnedFollowupReceipt) claim() <-chan struct{} {
	if r == nil {
		return nil
	}
	o := r.owner
	o.mu.Lock()
	defer o.mu.Unlock()
	if r.state == ownedFollowupSettled || r.state == ownedFollowupClaimed {
		return nil
	}
	if o.reservation != nil || o.sealed || r.state != ownedFollowupQueued {
		return o.changed
	}
	r.state = ownedFollowupClaimed
	o.notifyLocked()
	return nil
}

// finalizing transfers queued failure cleanup to the existing Agent operation.
// Broad explicit user cancellation/disposal retains its original authority.
func (r *OwnedFollowupReceipt) finalizing() {
	if r == nil {
		return
	}
	r.owner.mu.Lock()
	if r.state != ownedFollowupSettled {
		r.state = ownedFollowupClaimed
		r.owner.notifyLocked()
	}
	r.owner.mu.Unlock()
}

func (r *OwnedFollowupReceipt) settle(outcome TurnOutcome) {
	if r == nil {
		return
	}
	o := r.owner
	o.mu.Lock()
	if r.state != ownedFollowupSettled {
		r.state = ownedFollowupSettled
		r.outcome = cloneOwnedOutcome(outcome)
		delete(o.receipts, r)
		close(r.done)
		o.notifyLocked()
	}
	o.mu.Unlock()
}

func (r *OwnedFollowupReceipt) recordCleanup(err error) {
	if r == nil || err == nil {
		return
	}
	r.owner.mu.Lock()
	r.owner.cleanupErr = errors.Join(r.owner.cleanupErr, err)
	r.owner.mu.Unlock()
}

func cloneOwnedOutcome(outcome TurnOutcome) TurnOutcome {
	if outcome.Turn.Usage != nil {
		usage := *outcome.Turn.Usage
		outcome.Turn.Usage = &usage
	}
	return outcome
}

// Wait returns a detached copy of the exact cached TurnOutcome. Its second
// result is only a wait error; an execution error remains in TurnOutcome.Err.
func (r *OwnedFollowupReceipt) Wait(ctx context.Context) (TurnOutcome, error) {
	if r == nil {
		return TurnOutcome{}, errors.New("harness: nil owned followup receipt")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-r.done:
		return cloneOwnedOutcome(r.outcome), nil
	default:
	}
	select {
	case <-r.done:
		return cloneOwnedOutcome(r.outcome), nil
	case <-ctx.Done():
		return TurnOutcome{}, ctx.Err()
	}
}

func (r *OwnedFollowupReceipt) withdraw(ctx context.Context) {
	r.withdrawWithRemoval(ctx, r.agent.durableInbox.RemoveExact)
}

// The private operation argument keeps error settlement testable without a
// public mutation hook; production always uses this exact inbox's RemoveExact.
func (r *OwnedFollowupReceipt) withdrawWithRemoval(ctx context.Context, remove func(Message) (InboxMutation, bool, error)) {
	a := r.agent
	a.admissionMu.Lock()
	a.inboxClaimMu.Lock()
	r.owner.mu.Lock()
	withdrawing := r.state == ownedFollowupWithdrawing
	r.owner.mu.Unlock()
	if !withdrawing {
		a.inboxClaimMu.Unlock()
		a.admissionMu.Unlock()
		return
	}
	request, pending := a.pendingRequests[r.message.ID]
	if !pending || request.owned != r || a.session != r.session {
		a.inboxClaimMu.Unlock()
		a.admissionMu.Unlock()
		r.settle(TurnOutcome{Err: context.Canceled})
		return
	}
	mutation, _, err := remove(r.message)
	if err != nil {
		// No worker claimed this receipt. Revoke its live guard and settle
		// this exact pending request even if a failed splice leaves durable
		// intent behind. That leftover fails closed on replay/claim. Cleanup
		// must not wait for a parked Agent or wake foreign quiet input.
		a.abandonFollowupAdmission(r.message)
	}
	delete(a.pendingRequests, r.message.ID)
	a.pendingPrompts.Add(-1)
	a.inboxClaimMu.Unlock()
	a.admissionMu.Unlock()
	if len(mutation.Removed) != 0 {
		a.publishInboxDiscarded(r.message, request.userAuthored)
	} else {
		// An exact replacement/removal by another owner is never removed here.
		a.abandonFollowupAdmission(r.message)
	}
	if a.session.DurabilityAttached() {
		err = errors.Join(err, a.session.Flush(ctx))
	}
	// Match the worker's status finalization without looking up/canceling an
	// active turn. Queued-only removal cannot affect a later independent turn.
	a.admissionMu.Lock()
	a.mu.Lock()
	becameIdle := a.pendingPrompts.Load() == 0 && a.activityCtx == nil && !a.maintenance && a.status != AgentIdle
	if becameIdle {
		a.status = AgentIdle
		close(a.idle)
	}
	a.mu.Unlock()
	a.admissionMu.Unlock()
	if becameIdle {
		a.publishStatus(AgentIdle)
	}
	request.result <- promptResult{err: context.Canceled}
	r.recordCleanup(err)
	r.settle(TurnOutcome{Err: context.Canceled})
}
