package harness

import (
	"context"
	"errors"
	"fmt"
	"sync"
)

// SubagentMaxSafeInteger is the largest exact DSH delegation/configuration value.
const SubagentMaxSafeInteger = 9007199254740991

// SubagentRuntimeConfig is the live host configuration. Limits are sampled at
// admission; decreasing capacity never evicts an already admitted activation.
type SubagentRuntimeConfig struct {
	MaxDepth           int `json:"maxDepth"`
	MaxActiveSubagents int `json:"maxActiveSubagents"`
}

// SubagentRuntimeConfigUpdate leaves omitted fields unchanged. ReplaceConfig
// is available to callers reconciling a complete composition snapshot.
type SubagentRuntimeConfigUpdate struct {
	MaxDepth           *int `json:"maxDepth,omitempty"`
	MaxActiveSubagents *int `json:"maxActiveSubagents,omitempty"`
}

func DefaultSubagentRuntimeConfig() SubagentRuntimeConfig {
	return SubagentRuntimeConfig{MaxDepth: 1, MaxActiveSubagents: 8}
}

func (c SubagentRuntimeConfig) Validate() error {
	if c.MaxDepth < 0 || int64(c.MaxDepth) > SubagentMaxSafeInteger {
		return errors.New("subagent maxDepth must be a non-negative safe integer")
	}
	if c.MaxActiveSubagents < 1 || int64(c.MaxActiveSubagents) > SubagentMaxSafeInteger {
		return errors.New("subagent maxActiveSubagents must be a positive safe integer")
	}
	return nil
}

// Config returns a detached current snapshot; it conveys no activation authority.
func (r *SubagentRegistry) Config() SubagentRuntimeConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.config
}

func (r *SubagentRegistry) ReplaceConfig(config SubagentRuntimeConfig) error {
	if err := config.Validate(); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.disposed {
		return errors.New("harness: subagent registry is disposed")
	}
	r.config = config
	return nil
}

func (r *SubagentRegistry) UpdateConfig(update SubagentRuntimeConfigUpdate) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.disposed {
		return errors.New("harness: subagent registry is disposed")
	}
	next := r.config
	if update.MaxDepth != nil {
		next.MaxDepth = *update.MaxDepth
	}
	if update.MaxActiveSubagents != nil {
		next.MaxActiveSubagents = *update.MaxActiveSubagents
	}
	if err := next.Validate(); err != nil {
		return err
	}
	r.config = next
	return nil
}

// ResolveMaxDepth follows the service's policy resolver: explicit values pass
// through, provider-managed means no cap, and omission reads the live default.
// Request admission independently validates any explicit numeric cap.
func (r *SubagentRegistry) ResolveMaxDepth(configured *int, providerManaged bool) (*int, error) {
	if providerManaged {
		return nil, nil
	}
	if configured != nil {
		depth := *configured
		return &depth, nil
	}
	depth := r.Config().MaxDepth
	if depth < 0 || int64(depth) > SubagentMaxSafeInteger {
		return nil, errors.New("subagent maxDepth must be a non-negative safe integer")
	}
	return &depth, nil
}

// The map is keyed by exact live root identity, never by a durable SessionID.
// Only an uninterrupted managed parent link inherits a pool. An ordinary
// descendant Agent is an independent root, even if its header has a parent id.
type subagentActivationPool struct {
	root   *Agent
	active int
	facade *SubagentFacade
}

type subagentCapacityLease struct {
	pool    *subagentActivationPool
	once    sync.Once
	release func()
}

func (l *subagentCapacityLease) close() {
	if l != nil {
		l.once.Do(l.release)
	}
}

// reserveActivationCapacity is called after the exact parent preparation claim
// and before any provider materialization. The preparation token owns rollback;
// a bound activation owns the slot through its exact cleanup barrier instead.
func (r *SubagentRegistry) reserveActivationCapacity(ctx context.Context, parent *Agent) (func(), error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	token, _ := ctx.Value(subagentPreparationContextKey{}).(*subagentPreparation)
	if token == nil || token.receipt == nil {
		return nil, errors.New("harness: activation capacity requires an exact protected preparation")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.disposed || !r.liveParentLocked(parent) {
		return nil, errors.New("harness: subagent parent is not current")
	}
	if token.capacity != nil {
		return token.capacity.close, nil
	}
	facade := token.facade
	if facade != nil && facade.closing {
		return nil, ErrSubagentFacadeDraining
	}
	var pool *subagentActivationPool
	if owner := r.activationParents[parent]; owner != nil && owner.facade == facade {
		if owner.closing.Load() {
			return nil, errors.New("harness: parent activation is closing")
		}
		if owner.capacity != nil {
			pool = owner.capacity.pool
		}
	}
	pools := r.activationPools
	capacity := r.config.MaxActiveSubagents
	if facade != nil {
		pools = facade.pools
		capacity = facade.config.MaxActiveSubagents
	}
	if pool == nil {
		if pools == nil {
			pools = make(map[*Agent]*subagentActivationPool)
			if facade == nil {
				r.activationPools = pools
			} else {
				facade.pools = pools
			}
		}
		pool = pools[parent]
		if pool == nil {
			pool = &subagentActivationPool{root: parent, facade: facade}
			pools[parent] = pool
		}
	}
	if pool.active >= capacity {
		return nil, &subagentActivationError{fmt.Sprintf("subagent limit reached (active child limit: %d); wait for an existing child to finish or complete this work with the current agents", capacity), "ACTIVATION_LIMIT_REACHED"}
	}
	pool.active++
	lease := &subagentCapacityLease{pool: pool}
	lease.release = func() {
		r.mu.Lock()
		defer r.mu.Unlock()
		pool.active--
		if pool.active == 0 && pools[pool.root] == pool {
			delete(pools, pool.root)
		}
	}
	token.capacity = lease
	token.receipt.capacity = lease
	return lease.close, nil
}

func (r *SubagentRegistry) resolveSubagentChildDepth(request SubagentRequest) (int, error) {
	if !request.ProviderManagedDepth && (request.MaxDepth < 0 || int64(request.MaxDepth) > SubagentMaxSafeInteger) {
		return 0, errors.New("subagent maxDepth must be a non-negative safe integer")
	}
	parentDepth := r.Depth(request.Parent)
	if int64(parentDepth) >= SubagentMaxSafeInteger {
		return 0, errors.New("subagent child depth exceeds the safe-integer range")
	}
	childDepth := parentDepth + 1
	if !request.ProviderManagedDepth && childDepth > request.MaxDepth {
		return 0, &SubagentDepthError{AttemptedDepth: childDepth, MaxDepth: request.MaxDepth}
	}
	return childDepth, nil
}

// SubagentDepthError preserves the current DSH depth failure and both values.
type SubagentDepthError struct{ AttemptedDepth, MaxDepth int }

func (e *SubagentDepthError) Error() string {
	return fmt.Sprintf("subagent depth %d exceeds maxDepth %d", e.AttemptedDepth, e.MaxDepth)
}
