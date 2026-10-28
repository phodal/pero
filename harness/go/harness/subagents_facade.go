package harness

import (
	"context"
	"errors"
	"sync"
)

// SubagentFacade is one runtime service generation over the shared Host
// registry. Its configuration, pools, admission and drain are independent of
// other profiles and of direct native registry callers. It grants no parent
// authority: every operation still passes the Registry's exact Agent checks.
type SubagentFacade struct {
	closedParents map[*Agent]struct{}
	registry      *SubagentRegistry
	config        SubagentRuntimeConfig
	pools         map[*Agent]*subagentActivationPool
	preparations  map[*subagentPreparation]struct{}
	activations   map[*subagentActivationState]struct{}
	closing       bool
	changed       chan struct{}
	done          chan struct{}
	err           error
	closeOnce     sync.Once
}

type subagentFacadeContextKey struct{}

var ErrSubagentFacadeDraining = &subagentActivationError{"subagents are draining; the operation was not admitted", "DRAINING"}
var ErrSubagentFacadeDisposalPending = &subagentActivationError{"harness: subagent facade disposal is pending", "SUBAGENT_FACADE_DISPOSAL_PENDING"}

func (r *SubagentRegistry) NewFacade(config SubagentRuntimeConfig) (*SubagentFacade, error) {
	if err := config.Validate(); err != nil {
		return nil, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.disposed {
		return nil, ErrSubagentFacadeDraining
	}
	return &SubagentFacade{registry: r, config: config, pools: make(map[*Agent]*subagentActivationPool), preparations: make(map[*subagentPreparation]struct{}), activations: make(map[*subagentActivationState]struct{}), changed: make(chan struct{}), done: make(chan struct{})}, nil
}

func (f *SubagentFacade) Config() SubagentRuntimeConfig {
	f.registry.mu.RLock()
	defer f.registry.mu.RUnlock()
	return f.config
}
func (f *SubagentFacade) ReplaceConfig(config SubagentRuntimeConfig) error {
	if err := config.Validate(); err != nil {
		return err
	}
	f.registry.mu.Lock()
	defer f.registry.mu.Unlock()
	if f.closing || f.registry.disposed {
		return ErrSubagentFacadeDraining
	}
	f.config = config
	return nil
}

// BeginOperation pins a call to one generation before any await or callback.
func (f *SubagentFacade) BeginOperation(ctx context.Context) (context.Context, func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	r := f.registry
	r.mu.Lock()
	if f.closing || r.disposed {
		r.mu.Unlock()
		return nil, nil, ErrSubagentFacadeDraining
	}
	operation, cancel := context.WithCancelCause(ctx)
	token := &subagentPreparation{cancel: cancel, facade: f}
	f.preparations[token] = struct{}{}
	f.signalLocked()
	r.mu.Unlock()
	var once sync.Once
	return context.WithValue(operation, subagentFacadeContextKey{}, f), func() {
		once.Do(func() {
			cancel(nil)
			r.mu.Lock()
			delete(f.preparations, token)
			f.signalLocked()
			r.mu.Unlock()
		})
	}, nil
}

func (f *SubagentFacade) StartActivation(ctx context.Context, provider string, request SubagentRequest, delivery string) (SubagentActivation, error) {
	admitted, release, err := f.BeginOperation(ctx)
	if err != nil {
		return SubagentActivation{}, err
	}
	defer release()
	return f.registry.StartActivation(admitted, provider, request, delivery)
}
func (f *SubagentFacade) SendMessage(ctx context.Context, sender *Agent, target SessionID, content []ContentBlock) (string, error) {
	admitted, release, err := f.BeginOperation(ctx)
	if err != nil {
		return "", err
	}
	defer release()
	return f.registry.SendMessage(admitted, sender, target, content)
}

func (f *SubagentFacade) signalLocked() { close(f.changed); f.changed = make(chan struct{}) }

// RequestDispose closes admission synchronously, cancels the exact admitted
// preparations and starts owned teardown. It never waits on a foreign callback.
func (f *SubagentFacade) RequestDispose() error {
	f.closeOnce.Do(func() {
		r := f.registry
		r.mu.Lock()
		f.closing = true
		cancels := make([]context.CancelCauseFunc, 0, len(f.preparations))
		for token := range f.preparations {
			cancels = append(cancels, token.cancel)
		}
		records := make([]*subagentRecord, 0, len(f.activations))
		for state := range f.activations {
			records = append(records, state.record)
		}
		f.signalLocked()
		r.mu.Unlock()
		for _, cancel := range cancels {
			cancel(ErrSubagentFacadeDraining)
		}
		for _, record := range records {
			if record != nil {
				r.beginActivationCleanup(record)
			}
		}
		go func() {
			for {
				r.mu.Lock()
				pending := len(f.preparations) != 0 || len(f.activations) != 0
				changed := f.changed
				if !pending {
					close(f.done)
					r.mu.Unlock()
					return
				}
				r.mu.Unlock()
				<-changed
			}
		}()
	})
	select {
	case <-f.done:
		return f.Wait(context.Background())
	default:
		return ErrSubagentFacadeDisposalPending
	}
}

// disposalAgentsLocked follows retained exact records, including withdrawn
// managed descendants. Durable ids and parent-header links are never authority.
func (f *SubagentFacade) disposalAgentsLocked() map[*Agent]struct{} {
	agents := make(map[*Agent]struct{})
	seen := make(map[*subagentRecord]struct{})
	var pending []*subagentRecord
	for state := range f.activations {
		pending = append(pending, state.record)
	}
	for len(pending) != 0 {
		record := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if record == nil {
			continue
		}
		if _, ok := seen[record]; ok {
			continue
		}
		seen[record] = struct{}{}
		if record.child != nil {
			agents[record.child] = struct{}{}
			for child := range f.registry.parentRecords[record.child] {
				pending = append(pending, child)
			}
		}
		if record.activation != nil {
			for child := range record.activation.owned {
				pending = append(pending, child)
			}
		}
	}
	return agents
}

// DisposalDependsOn is a read-only trusted-host query for self-wait avoidance.
// It does not grant control over an Agent or change direct-parent authority.
func (f *SubagentFacade) DisposalDependsOn(agent *Agent) bool {
	if agent == nil {
		return false
	}
	f.registry.mu.RLock()
	defer f.registry.mu.RUnlock()
	_, owned := f.disposalAgentsLocked()[agent]
	return owned
}

func (f *SubagentFacade) Dispose(ctx context.Context) error {
	// Probe before initiating teardown, so ordinary callers do not mistake the
	// callbacks started by their own disposal request for pre-existing reentry.
	pending := f.registry.callbacks.Load() != 0
	f.registry.mu.RLock()
	agents := f.disposalAgentsLocked()
	f.registry.mu.RUnlock()
	for agent := range agents {
		pending = pending || agentCallbackMaySelfWait(agent)
	}
	if err := f.RequestDispose(); !errors.Is(err, ErrSubagentFacadeDisposalPending) {
		return err
	}
	// A callback may synchronously dispose its service using a fresh context.
	// Returning pending releases that stack; a later external waiter joins Wait.
	if pending {
		return ErrSubagentFacadeDisposalPending
	}
	return f.Wait(ctx)
}
func (f *SubagentFacade) Wait(ctx context.Context) error {
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-f.done:
	case <-ctx.Done():
		return ctx.Err()
	}
	f.registry.mu.RLock()
	defer f.registry.mu.RUnlock()
	return f.err
}

func subagentRecordFacade(record *subagentRecord) *SubagentFacade {
	if record == nil || record.activation == nil {
		return nil
	}
	return record.activation.facade
}
