package harness

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
)

// ManagedCompactionDefaults is the stable DSH realm binding. Only Agents with
// no explicit Compaction override sample it. Policy and admission belong to
// the exact replaceable compaction-basic owner, never to the Agent root.
type ManagedCompactionDefaults struct {
	mu       sync.RWMutex
	current  *managedCompactionOwner
	closed   bool
	registry *ProfileOwnerRegistry
	instance *point.Instance
}
type managedCompactionOwner struct {
	root   *ManagedCompactionDefaults
	lease  *ProfileOwnerLease
	config resolvedBasicCompactionConfig
}

// MountManagedDSHCompaction installs the source-owned default backend in an
// already composed Coding profile realm. Generic default contributions and
// explicit per-Agent options retain their detached Point behavior.
func MountManagedDSHCompaction(ctx context.Context, h *Harness) (*ManagedCompactionDefaults, error) {
	if h == nil || h.ProfileOwners() == nil {
		return nil, errors.New("harness: managed compaction requires profile owner composition")
	}
	root := &ManagedCompactionDefaults{registry: h.ProfileOwners()}
	// Install the stable binding before publishing a registry row. A conflicting
	// default contribution must leave no poisoned native registration behind.
	instance, err := mountBasicCompactionDefaults(ctx, h, basicCompactionDefaults{headroomTokens: 65536, managed: root})
	if err != nil {
		return nil, err
	}
	root.instance = instance
	err = root.registry.Register(ctx, ProfileOwnerRegistration{
		Row:      ProfileOwnerRow{ID: "compaction-basic", Name: "@deepseek-ai/dsh-compaction-basic", Config: json.RawMessage(`{}`)},
		Validate: func(raw json.RawMessage) error { _, err := DecodeDSHBasicCompactionConfig(raw); return err },
		Mount: func(_ context.Context, raw json.RawMessage, lease *ProfileOwnerLease) (ProfileOwner, error) {
			config, err := DecodeDSHBasicCompactionConfig(raw)
			if err != nil {
				return nil, err
			}
			config.dshPressureWarnings = &compactionPressureWarnings{}
			resolved, err := resolveBasicCompactionConfig(config)
			if err != nil {
				return nil, err
			}
			owner := &managedCompactionOwner{root: root, lease: lease, config: resolved}
			root.mu.Lock()
			defer root.mu.Unlock()
			if root.closed {
				return nil, ErrProfileOwnerUnavailable
			}
			if root.current != nil {
				return nil, errors.New("harness: managed compaction owner is still mounted")
			}
			root.current = owner
			return owner, nil
		},
		Reserve: func(owner ProfileOwner) (ProfileOwnerIdleReservation, error) {
			current, ok := owner.(*managedCompactionOwner)
			if !ok || current.root != root {
				return nil, errors.New("harness: foreign compaction owner")
			}
			token, err := current.lease.TryReserveIdle()
			if err != nil {
				return nil, err
			}
			return &managedCompactionReservation{owner: current, token: token}, nil
		},
	})
	if err != nil {
		return nil, errors.Join(err, root.Dispose(context.Background()))
	}
	return root, nil
}
func (r *ManagedCompactionDefaults) snapshot() *managedCompactionOwner {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	if r.closed {
		return nil
	}
	return r.current
}
func (r *ManagedCompactionDefaults) available() bool {
	owner := r.snapshot()
	return owner != nil && owner.lease.Active()
}
func (r *ManagedCompactionDefaults) acquire(ctx context.Context) (context.Context, *managedCompactionOwner, func(), error) {
	owner := r.snapshot()
	if owner == nil {
		return ctx, nil, nil, ErrProfileOwnerUnavailable
	}
	ctx, release, err := owner.lease.BeginOperation(ctx)
	if err != nil {
		return ctx, nil, nil, err
	}
	return ctx, owner, release, nil
}
func (r *ManagedCompactionDefaults) Dispose(ctx context.Context) error {
	if r == nil {
		return nil
	}
	if ctx != nil && ctx.Value(profileOwnerCallContextKey{}) == r.registry {
		return ErrProfileOwnerReentrant
	}
	r.mu.Lock()
	r.closed = true
	owner := r.current
	r.mu.Unlock()
	var err error
	if owner != nil {
		err = owner.Dispose(ctx)
	}
	if err == nil && r.instance != nil {
		err = r.instance.Dispose(ctx)
	}
	return err
}
func (o *managedCompactionOwner) Dispose(ctx context.Context) error {
	if err := o.lease.DrainOperations(ctx); err != nil {
		return err
	}
	o.root.mu.Lock()
	if o.root.current == o {
		o.root.current = nil
	}
	o.root.mu.Unlock()
	return nil
}

type managedCompactionReservation struct {
	owner   *managedCompactionOwner
	token   *ProfileOwnerIdleLease
	retired bool
}

func (r *managedCompactionReservation) Release() (func(), error) { return nil, r.token.Release() }
func (r *managedCompactionReservation) Retire(ctx context.Context) error {
	if err := r.token.Retire(); err != nil {
		return err
	}
	if err := r.owner.Dispose(ctx); err != nil {
		return err
	}
	r.retired = true
	return nil
}
func (r *managedCompactionReservation) Offer(owner ProfileOwner) error {
	candidate, ok := owner.(*managedCompactionOwner)
	if !ok || candidate.root != r.owner.root || candidate == r.owner || !r.retired || candidate.lease.Active() {
		return errors.New("harness: foreign or admitted compaction candidate")
	}
	// Durable pruning, summaries and surface replacement are Session effects,
	// not replayable owner state. Fresh generations start fresh warning/retry state.
	return nil
}

// The Agent keeps this dispatcher, not a policy snapshot. Its cached engine is
// detached and bound to one owner, so old callbacks cannot mutate a new engine.
type managedAgentCompactor struct {
	root   *ManagedCompactionDefaults
	mu     sync.Mutex
	owner  *managedCompactionOwner
	engine *BasicCompactor
}

func (m *managedAgentCompactor) acquire(ctx context.Context, a *Agent) (context.Context, *BasicCompactor, func(), error) {
	ctx, owner, release, err := m.root.acquire(ctx)
	if err != nil {
		return ctx, nil, nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.owner != owner {
		pricing, _ := a.adapter.(ImageRequestPricingResolver)
		m.owner = owner
		m.engine = &BasicCompactor{config: owner.config, meter: TokenMeter{ImagePricing: pricing, Attachments: a.attachments}}
	}
	return ctx, m.engine, release, nil
}
func (m *managedAgentCompactor) CompactIfNeeded(ctx context.Context, a *Agent, t CompactionTrigger) (*CompactionResult, error) {
	ctx, engine, release, err := m.acquire(ctx, a)
	if err != nil {
		return nil, err
	}
	defer release()
	return engine.CompactIfNeeded(ctx, a, t)
}
func (m *managedAgentCompactor) CompactNow(ctx context.Context, a *Agent, id *CommandID, instructions string) (*CompactionResult, error) {
	ctx, engine, release, err := m.acquire(ctx, a)
	if err != nil {
		return nil, err
	}
	defer release()
	return engine.CompactNow(ctx, a, id, instructions)
}
func (m *managedAgentCompactor) CompactRegion(ctx context.Context, a *Agent, start, end uint64) (*CompactionResult, error) {
	ctx, engine, release, err := m.acquire(ctx, a)
	if err != nil {
		return nil, err
	}
	defer release()
	return engine.CompactRegion(ctx, a, start, end)
}
func mountManagedAgentCompaction(run *point.Run, a *Agent, root *ManagedCompactionDefaults) error {
	engine := &managedAgentCompactor{root: root}
	a.compactionMu.Lock()
	if a.compaction != nil {
		a.compactionMu.Unlock()
		return errors.New("harness: compaction is already mounted for this agent")
	}
	a.compaction = engine
	a.compactionMu.Unlock()
	if err := run.Defer("managed-compaction:clear", func(context.Context) error {
		a.compactionMu.Lock()
		if a.compaction == engine {
			a.compaction = nil
		}
		a.compactionMu.Unlock()
		return nil
	}); err != nil {
		a.compactionMu.Lock()
		if a.compaction == engine {
			a.compaction = nil
		}
		a.compactionMu.Unlock()
		return err
	}
	_, err := a.hooks.PreStep.Use(run, func(ctx context.Context, input StepInput, next point.Next[StepInput]) (StepInput, error) {
		if input.Agent == a && ctx.Err() == nil {
			owned, basic, release, err := engine.acquire(ctx, a)
			if err == nil {
				func() {
					defer release()
					if !basic.config.auto {
						return
					}
					basic.resetOverflowRetries()
					if _, err := basic.CompactIfNeeded(owned, a, CompactionPressure); err != nil && ctx.Err() == nil && basic.shouldWarnPressure(err) {
						run.Logger().Warn("step compaction failed; continuing turn", "session.id", a.ID(), "error", err)
					}
				}()
			}
		}
		// Never hold an owner borrow across downstream callbacks.
		return next(input)
	}, point.ListenerOptions{Prepend: true})
	if err != nil {
		return err
	}
	_, err = a.hooks.RequestError.Use(run, func(ctx context.Context, input RequestErrorInput, next point.Next[RequestErrorInput]) (RequestErrorInput, error) {
		if input.Agent != a || input.Failure.Code != ContextWindowExceededCode || ctx.Err() != nil {
			return next(input)
		}
		owned, basic, release, err := engine.acquire(ctx, a)
		if err != nil {
			return next(input)
		}
		retry, compactErr := func() (bool, error) {
			defer release()
			if !basic.config.auto || !basic.canRetryOverflow(a) {
				return false, nil
			}
			before := a.session.SurfaceSeqs()
			_, compactErr := basic.CompactIfNeeded(owned, a, CompactionContextOverflow)
			if err := contextFailure(ctx); err != nil {
				return false, err
			}
			if !reflect.DeepEqual(before, a.session.SurfaceSeqs()) {
				basic.recordOverflowRetry()
				if compactErr != nil {
					run.Logger().Warn("context-overflow compaction failed after durable surface progress; retrying", "session.id", a.ID(), "error", compactErr)
				}
				return true, nil
			}
			if compactErr != nil {
				run.Logger().Warn("context-overflow compaction failed; preserving provider error", "session.id", a.ID(), "error", compactErr)
			}
			return false, nil
		}()
		if compactErr != nil {
			return input, compactErr
		}
		if retry {
			input.Retry = true
			return input, nil
		}
		return next(input)
	}, point.ListenerOptions{Prepend: true})
	return err
}
