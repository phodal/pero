package harness

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
)

// MountBasicCompaction installs one agent-local, effect-owned compaction
// backend. Automatic pressure checks run before each model step and never turn
// a compaction failure into a turn failure.
func MountBasicCompaction(run *point.Run, agent *Agent, config BasicCompactionConfig) error {
	if run == nil || !run.Active() {
		return point.ErrInactiveRun
	}
	if agent == nil {
		return errors.New("harness: compaction requires an agent")
	}
	if config.managed != nil {
		return mountManagedAgentCompaction(run, agent, config.managed)
	}
	resolved, err := resolveBasicCompactionConfig(config)
	if err != nil {
		return err
	}
	pricing, _ := agent.adapter.(ImageRequestPricingResolver)
	engine := &BasicCompactor{config: resolved, meter: TokenMeter{ImagePricing: pricing, Attachments: agent.attachments}}
	clearEngine := func() {
		agent.compactionMu.Lock()
		if agent.compaction == engine {
			agent.compaction = nil
		}
		agent.compactionMu.Unlock()
	}
	agent.compactionMu.Lock()
	if agent.compaction != nil {
		agent.compactionMu.Unlock()
		return errors.New("harness: compaction is already mounted for this agent")
	}
	agent.compaction = engine
	agent.compactionMu.Unlock()
	if err := run.Defer("compaction:clear", func(context.Context) error {
		clearEngine()
		return nil
	}); err != nil {
		clearEngine()
		return err
	}
	if !resolved.auto {
		return nil
	}
	_, err = agent.hooks.PreStep.Use(run, func(ctx context.Context, input StepInput, next point.Next[StepInput]) (StepInput, error) {
		if input.Agent != agent || ctx.Err() != nil {
			return next(input)
		}
		engine.resetOverflowRetries()
		if _, compactErr := agent.CompactIfNeeded(ctx, CompactionPressure); compactErr != nil && ctx.Err() == nil && engine.shouldWarnPressure(compactErr) {
			run.Logger().Warn("step compaction failed; continuing turn", "session.id", agent.ID(), "error", compactErr)
		}
		return next(input)
	}, point.ListenerOptions{Prepend: true})
	if err != nil {
		return err
	}
	_, err = agent.hooks.RequestError.Use(run, func(ctx context.Context, input RequestErrorInput, next point.Next[RequestErrorInput]) (RequestErrorInput, error) {
		if input.Agent != agent || input.Failure.Code != ContextWindowExceededCode || ctx.Err() != nil || !engine.canRetryOverflow(agent) {
			return next(input)
		}
		before := agent.session.SurfaceSeqs()
		_, compactErr := agent.CompactIfNeeded(ctx, CompactionContextOverflow)
		if err := contextFailure(ctx); err != nil {
			return input, err
		}
		progressed := !reflect.DeepEqual(before, agent.session.SurfaceSeqs())
		if progressed {
			engine.recordOverflowRetry()
			input.Retry = true
			if compactErr != nil {
				run.Logger().Warn("context-overflow compaction failed after durable surface progress; retrying", "session.id", agent.ID(), "error", compactErr)
			}
			return input, nil
		}
		if compactErr != nil {
			run.Logger().Warn("context-overflow compaction failed; preserving provider error", "session.id", agent.ID(), "error", compactErr)
		}
		return next(input)
	}, point.ListenerOptions{Prepend: true})
	return err
}

func (b *BasicCompactor) resetOverflowRetries() {
	b.overflowMu.Lock()
	b.overflowRetries = 0
	b.overflowMu.Unlock()
}

func (b *BasicCompactor) canRetryOverflow(agent *Agent) bool {
	policy, _, found, err := b.routedPolicy(agent)
	if err != nil || !found {
		return false
	}
	b.overflowMu.Lock()
	allowed := b.overflowRetries < policy.maxOverflowRetries
	b.overflowMu.Unlock()
	return allowed
}

func (b *BasicCompactor) recordOverflowRetry() {
	b.overflowMu.Lock()
	b.overflowRetries++
	b.overflowMu.Unlock()
}

func (b *BasicCompactor) CompactIfNeeded(ctx context.Context, agent *Agent, trigger CompactionTrigger) (*CompactionResult, error) {
	if agent == nil || agent.session == nil {
		return nil, errors.New("harness: compaction requires an agent session")
	}
	if trigger != CompactionPressure && trigger != CompactionContextOverflow {
		return nil, fmt.Errorf("harness: unsupported compaction trigger %q", trigger)
	}
	policy, target, requestMaxTokens, found, err := b.routedPolicySnapshot(agent)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, nil
	}
	if trigger == CompactionContextOverflow {
		if _, err := agent.pruneToolResults(); err != nil {
			return nil, err
		}
		measurement, err := b.meter.Measure(agent.session)
		if err != nil {
			return nil, err
		}
		selection := selectCompactionRange(measurement, 0)
		if selection == nil {
			return nil, nil
		}
		turn := agent.currentTurn()
		return b.compactRange(ctx, agent, measurement, *selection, &turn, nil, "", policy)
	}
	contextWindow := target.ContextWindow
	if b.config.dshSourcePolicy {
		// Source pressure always requires the routed adapter capacity; neither
		// a stale request header nor Point's legacy fallback is an authority.
		contextWindow = 0
	}
	reservedCompletionTokens := 0
	if policy.headroomTokens != nil {
		// Capacity and the fallback output reservation belong to one routed
		// metadata snapshot. Do not combine a stale request/context window with
		// a freshly resolved default, or prepare a provider call just to price it.
		if agent.modelInfo != nil {
			info, infoErr := agent.modelInfo.ResolveModelInfo(ctx, target.Provider, target.Model)
			if infoErr != nil {
				return nil, infoErr
			}
			if info.Provider != target.Provider || info.Model != target.Model {
				return nil, errors.New("harness: compaction model metadata changed the routed target")
			}
			contextWindow = info.ContextWindow
			reservedCompletionTokens = info.DefaultMaxTokens
		}
		if requestMaxTokens != 0 {
			reservedCompletionTokens = requestMaxTokens
		}
	}
	if contextWindow == 0 && !b.config.dshSourcePolicy {
		contextWindow = b.config.contextWindow
	}
	if b.config.dshSourcePolicy && contextWindow <= 0 {
		return nil, newTargetPressureError(target, fmt.Errorf("harness: no context capacity for %s/%s; configure the adapter model context window", target.Provider, target.Model))
	}
	spec, err := resolveCompactSpecForRequest(policy, contextWindow, reservedCompletionTokens)
	if err != nil {
		if b.config.dshSourcePolicy {
			err = newTargetPressureError(target, err)
		}
		return nil, err
	}
	measurement, err := b.meter.Measure(agent.session)
	if err != nil {
		return nil, err
	}
	if measurement.TotalTokens < spec.thresholdTokens {
		return nil, nil
	}
	if _, err := agent.pruneToolResults(); err != nil {
		return nil, err
	}
	measurement, err = b.meter.Measure(agent.session)
	if err != nil {
		return nil, err
	}
	if measurement.TotalTokens < spec.thresholdTokens {
		return nil, nil
	}
	var result *CompactionResult
	for attempt := 0; attempt <= spec.compactionRetries; attempt++ {
		selection := selectCompactionRange(measurement, spec.concreteRetain)
		if selection == nil {
			return result, nil
		}
		turn := agent.currentTurn()
		result, err = b.compactRange(ctx, agent, measurement, *selection, &turn, nil, "", policy)
		if err != nil {
			return nil, err
		}
		measurement, err = b.meter.Measure(agent.session)
		if err != nil {
			return nil, err
		}
		if measurement.TotalTokens < spec.thresholdTokens {
			return result, nil
		}
	}
	return nil, fmt.Errorf("harness: compaction remains above threshold after %d attempts (%d >= %d)",
		spec.compactionRetries+1, measurement.TotalTokens, spec.thresholdTokens)
}

func (b *BasicCompactor) CompactNow(ctx context.Context, agent *Agent, sourceCommandID *CommandID, instructions string) (*CompactionResult, error) {
	if agent == nil || agent.session == nil {
		return nil, errors.New("harness: compaction requires an agent session")
	}
	measurement, err := b.meter.Measure(agent.session)
	if err != nil {
		return nil, err
	}
	selection := selectCompactionRange(measurement, 0)
	if selection == nil {
		return nil, nil
	}
	policy, _, found, err := b.routedPolicy(agent)
	if err != nil {
		return nil, err
	}
	if !found {
		policy = b.config.defaults
		policy.provider, policy.model = agent.provider, agent.model
	}
	return b.compactRange(ctx, agent, measurement, *selection, nil, sourceCommandID, instructions, policy)
}

// CompactRegion implements the DSH explicit-region capability inside the
// current open turn. It validates boundaries against surface order, not raw
// numeric sequence order.
func (b *BasicCompactor) CompactRegion(ctx context.Context, agent *Agent, start, end uint64) (*CompactionResult, error) {
	if agent == nil || agent.session == nil {
		return nil, errors.New("harness: compaction requires an agent session")
	}
	measurement, err := b.meter.Measure(agent.session)
	if err != nil {
		return nil, err
	}
	selection, err := selectExplicitCompactionRange(measurement, start, end)
	if err != nil {
		return nil, err
	}
	policy, _, found, err := b.routedPolicy(agent)
	if err != nil {
		return nil, err
	}
	if !found {
		policy = b.config.defaults
		policy.provider, policy.model = agent.provider, agent.model
	}
	turn := agent.currentTurn()
	return b.compactRange(ctx, agent, measurement, *selection, &turn, nil, "", policy)
}

func (b *BasicCompactor) routedPolicy(agent *Agent) (resolvedTargetCompactionPolicy, RequestContext, bool, error) {
	policy, target, _, found, err := b.routedPolicySnapshot(agent)
	return policy, target, found, err
}

// Headroom policies bind route, exact-target overrides, and output reservation
// to one durable request header. A previous model's request/context must never
// supply the capacity for a newer header imported or restored without context.
func (b *BasicCompactor) routedPolicySnapshot(agent *Agent) (resolvedTargetCompactionPolicy, RequestContext, int, bool, error) {
	headroomEnabled := b.config.defaults.headroomTokens != nil
	for _, policy := range b.config.modelPolicies {
		headroomEnabled = headroomEnabled || policy.HeadroomTokens != nil
	}
	if headroomEnabled {
		header, found, err := agent.session.RequestHeader()
		if err != nil {
			return resolvedTargetCompactionPolicy{}, RequestContext{}, 0, false, err
		}
		if !found || header.Provider == "" || header.Model == "" {
			return resolvedTargetCompactionPolicy{}, RequestContext{}, 0, false, nil
		}
		target := RequestContext{Provider: header.Provider, Model: header.Model}
		policy := b.targetPolicy(target)
		previous, found, err := agent.session.RequestContext()
		if err != nil {
			return resolvedTargetCompactionPolicy{}, RequestContext{}, 0, false, err
		}
		if found && previous.Provider == target.Provider && previous.Model == target.Model {
			target.ContextWindow = previous.ContextWindow
		}
		return policy, target, header.MaxTokens, true, nil
	}
	policy, target, found, err := b.legacyRoutedPolicy(agent)
	return policy, target, 0, found, err
}

func (b *BasicCompactor) legacyRoutedPolicy(agent *Agent) (resolvedTargetCompactionPolicy, RequestContext, bool, error) {
	requestContext, found, err := agent.session.RequestContext()
	if err != nil {
		return resolvedTargetCompactionPolicy{}, RequestContext{}, false, err
	}
	if !found {
		header, headerFound, headerErr := agent.session.RequestHeader()
		if headerErr != nil {
			return resolvedTargetCompactionPolicy{}, RequestContext{}, false, headerErr
		}
		if !headerFound || header.Provider == "" || header.Model == "" {
			return resolvedTargetCompactionPolicy{}, RequestContext{}, false, nil
		}
		requestContext = RequestContext{Provider: header.Provider, Model: header.Model}
	}
	return b.targetPolicy(requestContext), requestContext, true, nil
}

// targetPressureError identifies only route-specific configuration errors.
// Adapter/transient/model failures must continue to warn on each occurrence.
type compactionPressureWarnings struct {
	mu      sync.Mutex
	targets map[string]struct{}
}

type targetPressureError struct {
	targetKey string
	cause     error
}

func (e *targetPressureError) Error() string { return e.cause.Error() }
func (e *targetPressureError) Unwrap() error { return e.cause }
func newTargetPressureError(target RequestContext, cause error) error {
	return &targetPressureError{targetKey: target.Provider + "/" + target.Model, cause: cause}
}
func (b *BasicCompactor) shouldWarnPressure(err error) bool {
	var target *targetPressureError
	if !b.config.dshSourcePolicy || !errors.As(err, &target) {
		return true
	}
	warnings := &b.pressureWarnings
	if b.config.dshPressureWarnings != nil {
		warnings = b.config.dshPressureWarnings
	}
	warnings.mu.Lock()
	defer warnings.mu.Unlock()
	if _, seen := warnings.targets[target.targetKey]; seen {
		return false
	}
	if warnings.targets == nil {
		warnings.targets = make(map[string]struct{})
	}
	warnings.targets[target.targetKey] = struct{}{}
	return true
}
