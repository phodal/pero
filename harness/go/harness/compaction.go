package harness

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sync"
)

const (
	CompactionPressure        CompactionTrigger = "pressure"
	CompactionContextOverflow CompactionTrigger = "context-overflow"
)

type CompactionTrigger string

type CompactionResult struct {
	CompactionID       string         `json:"compactionId"`
	SourceCommandID    CommandID      `json:"sourceCommandId,omitempty"`
	StartSeq           uint64         `json:"startSeq"`
	SummarySeq         uint64         `json:"summarySeq"`
	EndSeq             uint64         `json:"endSeq"`
	Summary            []ContentBlock `json:"summary"`
	ShadowedRange      SurfaceRange   `json:"shadowedRange"`
	ShadowedSeqs       []uint64       `json:"shadowedSeqs"`
	ShadowedTokenCount int            `json:"shadowedTokenCount"`
}

type ManualCompactionErrorCode string

const (
	ManualCompactionBusy        ManualCompactionErrorCode = "busy"
	ManualCompactionCancelled   ManualCompactionErrorCode = "cancelled"
	ManualCompactionChanged     ManualCompactionErrorCode = "changed"
	ManualCompactionSummary     ManualCompactionErrorCode = "summary"
	ManualCompactionCommit      ManualCompactionErrorCode = "commit"
	ManualCompactionPersistence ManualCompactionErrorCode = "persistence"
)

// ManualCompactionError classifies an expected idle-session compaction failure.
type ManualCompactionError struct {
	Code    ManualCompactionErrorCode
	Message string
	cause   error
}

func newManualCompactionError(code ManualCompactionErrorCode, message string, cause error) *ManualCompactionError {
	return &ManualCompactionError{Code: code, Message: message, cause: cause}
}

func (e *ManualCompactionError) Error() string {
	if e == nil {
		return "<nil>"
	}
	return e.Message
}

func (e *ManualCompactionError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.cause
}

type CompactionEngine interface {
	CompactIfNeeded(context.Context, *Agent, CompactionTrigger) (*CompactionResult, error)
	CompactNow(context.Context, *Agent, *CommandID, string) (*CompactionResult, error)
}

// CompactionRegionEngine is the optional capability behind DSH's explicit
// compactRegion surface. Keeping it separate preserves compatibility with
// custom engines that only implement automatic and manual whole-history
// selection.
type CompactionRegionEngine interface {
	CompactRegion(context.Context, *Agent, uint64, uint64) (*CompactionResult, error)
}

type BasicCompactionConfig struct {
	managed *ManagedCompactionDefaults // trusted DSH default dispatch, never JSON
	// dshSourcePolicy is sampled only from the trusted DSH Base contribution.
	// It is not a JSON setting and cannot alter generic Point compaction.
	dshSourcePolicy     bool
	dshPressureWarnings *compactionPressureWarnings

	// ContextWindow is a legacy fallback used only when the routed adapter does
	// not advertise capacity. New integrations should provide ModelInfo.
	ContextWindow  int     `json:"contextWindow,omitempty"`
	ThresholdRatio float64 `json:"thresholdRatio,omitempty"`
	// HeadroomTokens opts into output-reservation-aware pressure budgets. Nil
	// preserves generic Point's legacy budgets; DSH Base supplies 65,536.
	HeadroomTokens        *int                    `json:"headroomTokens,omitempty"`
	RetainRatio           *float64                `json:"retainRatio,omitempty"`
	RetainTokens          *int                    `json:"retainTokens,omitempty"`
	SummarizationProvider string                  `json:"summarizationProvider,omitempty"`
	SummarizationModel    string                  `json:"summarizationModel,omitempty"`
	MaxTokens             int                     `json:"maxTokens,omitempty"`
	CompactionRetries     *int                    `json:"compactionRetries,omitempty"`
	MaxOverflowRetries    *int                    `json:"maxOverflowRetries,omitempty"`
	ModelPolicies         []ModelCompactionPolicy `json:"modelPolicies,omitempty"`
	Auto                  *bool                   `json:"auto,omitempty"`
}

// ModelCompactionPolicy is an exact provider/model partial override. Pointer
// fields preserve the distinction between inheritance and an explicit zero or
// empty pair where the DSH policy grammar allows one.
type ModelCompactionPolicy struct {
	Provider              string   `json:"provider"`
	Model                 string   `json:"model"`
	ThresholdRatio        *float64 `json:"thresholdRatio,omitempty"`
	HeadroomTokens        *int     `json:"headroomTokens,omitempty"`
	RetainRatio           *float64 `json:"retainRatio,omitempty"`
	RetainTokens          *int     `json:"retainTokens,omitempty"`
	SummarizationProvider *string  `json:"summarizationProvider,omitempty"`
	SummarizationModel    *string  `json:"summarizationModel,omitempty"`
	MaxTokens             *int     `json:"maxTokens,omitempty"`
	CompactionRetries     *int     `json:"compactionRetries,omitempty"`
	MaxOverflowRetries    *int     `json:"maxOverflowRetries,omitempty"`
}

type resolvedBasicCompactionConfig struct {
	dshPressureWarnings *compactionPressureWarnings
	dshSourcePolicy     bool

	contextWindow int
	defaults      resolvedTargetCompactionPolicy
	modelPolicies []ModelCompactionPolicy
	auto          bool
}

type resolvedTargetCompactionPolicy struct {
	provider              string
	model                 string
	thresholdRatio        float64
	headroomTokens        *int
	retainRatio           *float64
	retainTokens          *int
	summarizationProvider string
	summarizationModel    string
	maxTokens             int
	compactionRetries     int
	maxOverflowRetries    int
}

type resolvedCompactSpec struct {
	resolvedTargetCompactionPolicy
	contextWindow   int
	thresholdTokens int
	concreteRetain  int
}

type BasicCompactor struct {
	config resolvedBasicCompactionConfig
	meter  TokenMeter

	overflowMu       sync.Mutex
	overflowRetries  int
	pressureWarnings compactionPressureWarnings
}

// CompactIfNeeded invokes the effect-owned compactor mounted for this agent.
// It is safe to use from serialized provider-recovery hooks; the durable
// bracket and surface stability check fail closed if another operation races.
func (a *Agent) CompactIfNeeded(ctx context.Context, trigger CompactionTrigger) (*CompactionResult, error) {
	if a == nil {
		return nil, errors.New("harness: compaction requires an agent")
	}
	a.compactionMu.RLock()
	engine := a.compaction
	a.compactionMu.RUnlock()
	if engine == nil {
		return nil, errors.New("harness: compaction is not mounted for this agent")
	}
	return engine.CompactIfNeeded(ctx, a, trigger)
}

// CompactNow reserves this agent while it is idle, compacts one useful older
// span below pressure thresholds, and admits later prompts behind the operation.
func (a *Agent) CompactNow(ctx context.Context, sourceCommandID ...CommandID) (*CompactionResult, error) {
	return a.CompactWithInstructions(ctx, "", sourceCommandID...)
}

// CompactWithInstructions is CompactNow plus the text supplied to /compact.
// PreCompact hooks receive that text as custom_instructions.
func (a *Agent) CompactWithInstructions(ctx context.Context, instructions string, sourceCommandID ...CommandID) (*CompactionResult, error) {
	if a == nil {
		return nil, errors.New("harness: compaction requires an agent")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	a.compactionMu.RLock()
	engine := a.compaction
	a.compactionMu.RUnlock()
	if engine == nil {
		return nil, errors.New("harness: compaction is not mounted for this agent")
	}
	if len(sourceCommandID) > 1 || (len(sourceCommandID) == 1 && sourceCommandID[0] == "") {
		return nil, errors.New("harness: manual compaction accepts at most one non-empty source command id")
	}
	var source *CommandID
	if len(sourceCommandID) == 1 {
		value := sourceCommandID[0]
		source = &value
	}
	result, err := a.runMaintenance(ctx, func(operationContext context.Context) (*CompactionResult, error) {
		return engine.CompactNow(operationContext, a, source, instructions)
	})
	if err != nil && ctx.Err() == nil && errors.Is(err, context.Canceled) {
		return nil, newManualCompactionError(ManualCompactionCancelled, "manual compaction was cancelled", err)
	}
	return result, err
}

// CompactRegion compacts one inclusive span named by its current surface
// event identities. The span is positional rather than a numeric sequence
// interval, so a replacement from an earlier compaction may legitimately make
// start greater than end.
func (a *Agent) CompactRegion(ctx context.Context, start, end uint64) (*CompactionResult, error) {
	if a == nil {
		return nil, errors.New("harness: compaction requires an agent")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	a.compactionMu.RLock()
	engine := a.compaction
	a.compactionMu.RUnlock()
	if engine == nil {
		return nil, errors.New("harness: compaction is not mounted for this agent")
	}
	regional, ok := engine.(CompactionRegionEngine)
	if !ok {
		return nil, errors.New("harness: mounted compaction engine does not support explicit regions")
	}
	return regional.CompactRegion(ctx, a, start, end)
}

func resolveBasicCompactionConfig(config BasicCompactionConfig) (resolvedBasicCompactionConfig, error) {
	resolved := resolvedBasicCompactionConfig{contextWindow: config.ContextWindow, auto: true, dshSourcePolicy: config.dshSourcePolicy, dshPressureWarnings: config.dshPressureWarnings}
	if resolved.contextWindow < 0 {
		return resolved, errors.New("harness: compaction context window must be positive when present")
	}
	defaults := resolvedTargetCompactionPolicy{
		thresholdRatio:        config.ThresholdRatio,
		headroomTokens:        cloneInt(config.HeadroomTokens),
		summarizationProvider: config.SummarizationProvider,
		summarizationModel:    config.SummarizationModel,
		maxTokens:             config.MaxTokens, compactionRetries: 1, maxOverflowRetries: 1,
	}
	if defaults.thresholdRatio == 0 {
		defaults.thresholdRatio = 0.8
	}
	if err := validateCompactionRatio("threshold ratio", defaults.thresholdRatio); err != nil {
		return resolved, err
	}
	if defaults.headroomTokens != nil && *defaults.headroomTokens < 0 {
		return resolved, errors.New("harness: compaction headroom tokens must not be negative")
	}
	if config.RetainRatio != nil && config.RetainTokens != nil {
		return resolved, errors.New("harness: compaction retain ratio and retain tokens are mutually exclusive")
	}
	if config.RetainTokens != nil {
		if *config.RetainTokens < 0 {
			return resolved, errors.New("harness: compaction retain tokens must not be negative")
		}
		value := *config.RetainTokens
		defaults.retainTokens = &value
	} else {
		retainRatio := 0.16
		if config.RetainRatio != nil {
			retainRatio = *config.RetainRatio
		}
		if defaults.headroomTokens != nil && retainRatio == 0 {
			return resolved, errors.New("harness: compaction retain ratio must be positive when headroom is configured")
		}
		if retainRatio < 0 || retainRatio >= defaults.thresholdRatio || math.IsNaN(retainRatio) {
			return resolved, errors.New("harness: compaction retain ratio must be non-negative and below threshold ratio")
		}
		defaults.retainRatio = &retainRatio
	}
	if defaults.maxTokens == 0 {
		defaults.maxTokens = 8192
		if defaults.headroomTokens != nil {
			defaults.maxTokens = *defaults.headroomTokens
		}
	}
	if defaults.maxTokens < 1 {
		return resolved, errors.New("harness: compaction max tokens must be positive")
	}
	if (defaults.summarizationProvider == "") != (defaults.summarizationModel == "") {
		return resolved, errors.New("harness: compaction summarization provider and model must be set together")
	}
	if config.CompactionRetries != nil {
		if *config.CompactionRetries < 0 {
			return resolved, errors.New("harness: compaction retries must not be negative")
		}
		defaults.compactionRetries = *config.CompactionRetries
	}
	if config.MaxOverflowRetries != nil {
		if *config.MaxOverflowRetries < 0 {
			return resolved, errors.New("harness: compaction max overflow retries must not be negative")
		}
		defaults.maxOverflowRetries = *config.MaxOverflowRetries
	}
	resolved.defaults = defaults
	seen := make(map[string]struct{}, len(config.ModelPolicies))
	for index, policy := range config.ModelPolicies {
		// Resolve implicit per-model caps before inheritance. An explicit global
		// cap wins over model headroom, but an implicit global cap must not.
		policy = cloneModelCompactionPolicy(policy)
		if policy.HeadroomTokens != nil && policy.MaxTokens == nil && config.MaxTokens == 0 {
			policy.MaxTokens = cloneInt(policy.HeadroomTokens)
		}
		if policy.Provider == "" || policy.Model == "" {
			return resolved, fmt.Errorf("harness: compaction model policy %d requires provider and model", index)
		}
		key := policy.Provider + "\x00" + policy.Model
		if _, exists := seen[key]; exists {
			return resolved, fmt.Errorf("harness: duplicate compaction model policy for %s/%s", policy.Provider, policy.Model)
		}
		seen[key] = struct{}{}
		if err := validateModelCompactionPolicy(policy, defaults); err != nil {
			return resolved, fmt.Errorf("harness: compaction model policy %s/%s: %w", policy.Provider, policy.Model, err)
		}
		resolved.modelPolicies = append(resolved.modelPolicies, cloneModelCompactionPolicy(policy))
	}
	if config.Auto != nil {
		resolved.auto = *config.Auto
	}
	return resolved, nil
}

func validateCompactionRatio(name string, value float64) error {
	if value <= 0 || value > 1 || math.IsNaN(value) {
		return fmt.Errorf("harness: compaction %s must be in (0, 1]", name)
	}
	return nil
}

func validateModelCompactionPolicy(policy ModelCompactionPolicy, defaults resolvedTargetCompactionPolicy) error {
	if policy.HeadroomTokens != nil && *policy.HeadroomTokens < 0 {
		return errors.New("headroom tokens must not be negative")
	}
	if policy.ThresholdRatio != nil {
		if err := validateCompactionRatio("threshold ratio", *policy.ThresholdRatio); err != nil {
			return err
		}
	}
	if policy.RetainRatio != nil && policy.RetainTokens != nil {
		return errors.New("retain ratio and retain tokens are mutually exclusive")
	}
	if policy.RetainTokens != nil && *policy.RetainTokens < 0 {
		return errors.New("retain tokens must not be negative")
	}
	if (policy.SummarizationProvider == nil) != (policy.SummarizationModel == nil) {
		return errors.New("summarization provider and model must be set together")
	}
	if policy.SummarizationProvider != nil && ((*policy.SummarizationProvider == "") != (*policy.SummarizationModel == "")) {
		return errors.New("summarization provider and model must be an empty or non-empty pair")
	}
	for name, value := range map[string]*int{
		"max tokens": policy.MaxTokens, "compaction retries": policy.CompactionRetries,
		"max overflow retries": policy.MaxOverflowRetries,
	} {
		if value != nil && ((name == "max tokens" && *value <= 0) || (name != "max tokens" && *value < 0)) {
			return fmt.Errorf("%s has an invalid value %d", name, *value)
		}
	}
	resolved := resolveTargetCompactionPolicyFrom(defaults, policy)
	if resolved.retainRatio != nil && resolved.headroomTokens != nil && *resolved.retainRatio == 0 {
		return errors.New("retain ratio must be positive when headroom is configured")
	}
	if resolved.retainRatio != nil && (*resolved.retainRatio < 0 || *resolved.retainRatio >= resolved.thresholdRatio || math.IsNaN(*resolved.retainRatio)) {
		return errors.New("retain ratio must be non-negative and below threshold ratio")
	}
	return nil
}

func cloneModelCompactionPolicy(policy ModelCompactionPolicy) ModelCompactionPolicy {
	clone := policy
	clone.ThresholdRatio = cloneFloat(policy.ThresholdRatio)
	clone.HeadroomTokens = cloneInt(policy.HeadroomTokens)
	clone.RetainRatio = cloneFloat(policy.RetainRatio)
	clone.RetainTokens = cloneInt(policy.RetainTokens)
	clone.SummarizationProvider = cloneString(policy.SummarizationProvider)
	clone.SummarizationModel = cloneString(policy.SummarizationModel)
	clone.MaxTokens = cloneInt(policy.MaxTokens)
	clone.CompactionRetries = cloneInt(policy.CompactionRetries)
	clone.MaxOverflowRetries = cloneInt(policy.MaxOverflowRetries)
	return clone
}

func cloneFloat(value *float64) *float64 {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
func cloneInt(value *int) *int {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}
func cloneString(value *string) *string {
	if value == nil {
		return nil
	}
	copy := *value
	return &copy
}

func (b *BasicCompactor) targetPolicy(target RequestContext) resolvedTargetCompactionPolicy {
	policy := b.config.defaults
	policy.provider, policy.model = target.Provider, target.Model
	for _, override := range b.config.modelPolicies {
		if override.Provider == target.Provider && override.Model == target.Model {
			policy = resolveTargetCompactionPolicyFrom(policy, override)
			break
		}
	}
	return policy
}

func resolveTargetCompactionPolicyFrom(base resolvedTargetCompactionPolicy, override ModelCompactionPolicy) resolvedTargetCompactionPolicy {
	result := base
	if override.ThresholdRatio != nil {
		result.thresholdRatio = *override.ThresholdRatio
	}
	if override.HeadroomTokens != nil {
		result.headroomTokens = cloneInt(override.HeadroomTokens)
	}
	if override.RetainTokens != nil {
		result.retainTokens, result.retainRatio = cloneInt(override.RetainTokens), nil
	}
	if override.RetainRatio != nil {
		result.retainRatio, result.retainTokens = cloneFloat(override.RetainRatio), nil
	}
	if override.SummarizationProvider != nil {
		result.summarizationProvider, result.summarizationModel = *override.SummarizationProvider, *override.SummarizationModel
	}
	if override.MaxTokens != nil {
		result.maxTokens = *override.MaxTokens
	}
	if override.CompactionRetries != nil {
		result.compactionRetries = *override.CompactionRetries
	}
	if override.MaxOverflowRetries != nil {
		result.maxOverflowRetries = *override.MaxOverflowRetries
	}
	return result
}

func resolveCompactSpec(policy resolvedTargetCompactionPolicy, contextWindow int) (resolvedCompactSpec, error) {
	return resolveCompactSpecForRequest(policy, contextWindow, 0)
}

func resolveCompactSpecForRequest(policy resolvedTargetCompactionPolicy, contextWindow, reservedCompletionTokens int) (resolvedCompactSpec, error) {
	if contextWindow <= 0 {
		return resolvedCompactSpec{}, fmt.Errorf("harness: no context capacity for %s/%s", policy.provider, policy.model)
	}
	threshold := int(math.Floor(float64(contextWindow) * policy.thresholdRatio))
	messageBudget := contextWindow
	if policy.headroomTokens != nil {
		if reservedCompletionTokens < 0 {
			return resolvedCompactSpec{}, errors.New("harness: compaction reserved completion tokens must not be negative")
		}
		if reservedCompletionTokens >= contextWindow {
			return resolvedCompactSpec{}, fmt.Errorf("harness: %s/%s reserves %d completion tokens of a %d-token context window, leaving no message budget", policy.provider, policy.model, reservedCompletionTokens, contextWindow)
		}
		messageBudget -= reservedCompletionTokens
		if *policy.headroomTokens < 0 || *policy.headroomTokens >= messageBudget {
			return resolvedCompactSpec{}, fmt.Errorf("harness: %s/%s reserves %d completion tokens and %d headroom tokens of a %d-token context window, leaving no pressure budget", policy.provider, policy.model, reservedCompletionTokens, *policy.headroomTokens, contextWindow)
		}
		threshold = min(threshold, messageBudget-*policy.headroomTokens)
	}
	retain := 0
	if policy.retainTokens != nil {
		retain = *policy.retainTokens
	} else {
		retain = int(math.Floor(float64(messageBudget) * *policy.retainRatio))
	}
	if retain >= threshold {
		return resolvedCompactSpec{}, fmt.Errorf("harness: %s/%s retain tokens %d must be below threshold %d", policy.provider, policy.model, retain, threshold)
	}
	return resolvedCompactSpec{resolvedTargetCompactionPolicy: policy, contextWindow: contextWindow, thresholdTokens: threshold, concreteRetain: retain}, nil
}

func (a *Agent) currentTurn() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.turn
}

var _ CompactionEngine = (*BasicCompactor)(nil)

const compactionCheckpointPreamble = "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint."

const compactionInstruction = `You are now acting as a compaction engine for this AI coding assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.

Output these Markdown sections in order using terse bullets: Primary Request and Intent; Key Technical Concepts; Files and Code; Errors and Fixes; Pending Jobs; Current Work; Next Step; Critical Context. Preserve exact paths, commands, errors, identifiers, numeric values, and user corrections. Output only the checkpoint text. Do not call tools or mention this request.`
