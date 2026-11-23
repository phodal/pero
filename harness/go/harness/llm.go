package harness

import (
	"context"
	"errors"
	"fmt"
	"sync"

	harnessmedia "github.com/phodal/pero/harness/go/media"
	harnessmodel "github.com/phodal/pero/harness/go/model"
)

const InvalidPreparedCallCode = "INVALID_PREPARED_CALL"

type CallConfigAdapterDefaults = harnessmodel.CallConfigAdapterDefaults

// Adapter is the provider-neutral model seam. Implementations emit chunks in
// wire order and return one assembled completion for durable logging.
type Adapter interface {
	Generate(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error)
}

type AdapterFunc func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error)

func (fn AdapterFunc) Generate(ctx context.Context, request GenerateRequest, emit func(StreamChunk) error) (Completion, error) {
	return fn(ctx, request, emit)
}

// PreparedAdapterCall binds model metadata, retry policy, and dispatch to one
// adapter generation. Generate must be non-nil.
type PreparedAdapterCall struct {
	// AdapterDefaults belongs to the exact prepared generation. Never infer it
	// from equality with resolved metadata or the current model default.
	AdapterDefaults *CallConfigAdapterDefaults
	// ProjectsToolHistory is bound by a trusted cross-runtime adapter whose
	// unchanged runtime performs its own terminal history projection. It is
	// not provider metadata, a model capability or caller configuration.
	ProjectsToolHistory bool
	ModelInfo           ModelInfo
	RetryPolicy         *ResolvedRetryPolicy
	Generate            AdapterFunc
	validated           bool
}

// AdapterCallPreparer is the optional generation-consistency seam used by
// dynamic provider registries and settings-backed adapters.
type AdapterCallPreparer interface {
	PrepareAdapterCall(context.Context, string, string) (PreparedAdapterCall, error)
}

// GenerateCallPreparer binds an exact request, including adapter-owned
// defaults, to the model metadata, retry policy, and one-shot dispatch from
// the same adapter generation. Dynamic cross-runtime adapters use this seam
// when provider/model alone are not enough to prepare an exact call.
type GenerateCallPreparer interface {
	PrepareGenerateCall(context.Context, GenerateRequest) (PreparedAdapterCall, GenerateRequest, error)
}

func prepareGenerateCall(ctx context.Context, adapter Adapter, resolver ModelInfoResolver, request GenerateRequest) (PreparedAdapterCall, GenerateRequest, RequestContext, bool, error) {
	if preparer, ok := adapter.(GenerateCallPreparer); ok {
		prepared, resolved, err := preparer.PrepareGenerateCall(ctx, request)
		if err != nil {
			return PreparedAdapterCall{}, GenerateRequest{}, RequestContext{}, false, err
		}
		if resolved.Provider != request.Provider || resolved.Model != request.Model {
			return PreparedAdapterCall{}, GenerateRequest{}, RequestContext{}, false, NewProviderError(
				"prepared model call changed its provider route", InvalidPreparedCallCode, nil,
			)
		}
		prepared, err = validatePreparedAdapterCall(resolved.Provider, resolved.Model, prepared)
		if err != nil {
			return PreparedAdapterCall{}, GenerateRequest{}, RequestContext{}, false, err
		}
		if prepared.AdapterDefaults != nil && (prepared.AdapterDefaults.ReasoningEffort && resolved.ReasoningEffort == "" || prepared.AdapterDefaults.MaxTokens && resolved.MaxTokens <= 0) {
			return PreparedAdapterCall{}, GenerateRequest{}, RequestContext{}, false, NewProviderError("prepared defaults require their resolved controls", InvalidPreparedCallCode, nil)
		}
		requestContext, routed, err := requestContextFromModelInfo(resolved.Provider, resolved.Model, prepared.ModelInfo)
		return prepared, resolved, requestContext, routed, err
	}
	prepared, requestContext, routed, err := prepareAdapterCall(ctx, adapter, resolver, request.Provider, request.Model)
	return prepared, request, requestContext, routed, err
}

func prepareAdapterCall(ctx context.Context, adapter Adapter, resolver ModelInfoResolver, provider, model string) (PreparedAdapterCall, RequestContext, bool, error) {
	if preparer, ok := adapter.(AdapterCallPreparer); ok {
		prepared, err := preparer.PrepareAdapterCall(ctx, provider, model)
		if err != nil {
			return PreparedAdapterCall{}, RequestContext{}, false, err
		}
		prepared, err = validatePreparedAdapterCall(provider, model, prepared)
		if err != nil {
			return PreparedAdapterCall{}, RequestContext{}, false, err
		}
		requestContext, routed, err := requestContextFromModelInfo(provider, model, prepared.ModelInfo)
		return prepared, requestContext, routed, err
	}
	info := ModelInfo{Provider: provider, Model: model}
	if resolver != nil && provider != "" && model != "" {
		var err error
		info, err = resolver.ResolveModelInfo(ctx, provider, model)
		if err != nil {
			return PreparedAdapterCall{}, RequestContext{}, false, err
		}
	}
	requestContext, routed, err := requestContextFromModelInfo(provider, model, info)
	if err != nil {
		return PreparedAdapterCall{}, RequestContext{}, false, err
	}
	prepared := PreparedAdapterCall{
		ModelInfo: info,
		Generate:  adapter.Generate,
	}
	if policies, ok := adapter.(RetryPolicyProvider); ok {
		if policy, found := policies.RetryPolicyForProvider(provider); found {
			cloned := cloneRetryPolicy(policy)
			prepared.RetryPolicy = &cloned
		}
	}
	prepared, err = validatePreparedAdapterCall(provider, model, prepared)
	return prepared, requestContext, routed, err
}

// PrepareAdapterCall binds one auxiliary request to the same provider
// generation used by the Agent loop. Capability plugins such as session-title
// may dispatch outside a turn without bypassing dynamic route consistency.
func PrepareAdapterCall(ctx context.Context, adapter Adapter, resolver ModelInfoResolver, provider, model string) (PreparedAdapterCall, error) {
	prepared, _, _, err := prepareAdapterCall(ctx, adapter, resolver, provider, model)
	return prepared, err
}

func validatePreparedAdapterCall(provider, model string, prepared PreparedAdapterCall) (PreparedAdapterCall, error) {
	if prepared.validated {
		return prepared, nil
	}
	if prepared.Generate == nil {
		return PreparedAdapterCall{}, errors.New("harness: prepared adapter call has no dispatch")
	}
	if _, _, err := requestContextFromModelInfo(provider, model, prepared.ModelInfo); err != nil {
		return PreparedAdapterCall{}, err
	}
	if err := validateModelReasoningInfo(prepared.ModelInfo); err != nil {
		return PreparedAdapterCall{}, err
	}
	prepared.ModelInfo = cloneModelInfo(prepared.ModelInfo)
	if prepared.AdapterDefaults != nil {
		snapshot := *prepared.AdapterDefaults
		if !snapshot.ReasoningEffort && !snapshot.MaxTokens {
			prepared.AdapterDefaults = nil
		} else {
			prepared.AdapterDefaults = &snapshot
		}
	}
	if prepared.RetryPolicy != nil {
		if err := ValidateResolvedRetryPolicy(*prepared.RetryPolicy); err != nil {
			return PreparedAdapterCall{}, fmt.Errorf("harness: prepared adapter retry policy: %w", err)
		}
		policy := cloneRetryPolicy(*prepared.RetryPolicy)
		prepared.RetryPolicy = &policy
	}
	dispatch := prepared.Generate
	var dispatchMu sync.Mutex
	dispatched := false
	prepared.Generate = func(ctx context.Context, request GenerateRequest, emit func(StreamChunk) error) (Completion, error) {
		dispatchMu.Lock()
		if dispatched {
			dispatchMu.Unlock()
			return Completion{}, NewProviderError("a prepared model call can only be dispatched once", InvalidPreparedCallCode, nil)
		}
		if request.Provider != provider || request.Model != model {
			dispatchMu.Unlock()
			return Completion{}, NewProviderError("prepared model call route changed before adapter dispatch", InvalidPreparedCallCode, nil)
		}
		dispatched = true
		dispatchMu.Unlock()
		projected, err := harnessmedia.ProjectFilesToText(request.Messages, request.Attachments)
		if err != nil {
			return Completion{}, err
		}
		request.Messages = projected
		if !prepared.ProjectsToolHistory && !request.toolHistoryProjected {
			tools, err := harnessmodel.ProjectToolUpdates(request.Messages, request.Tools, prepared.ModelInfo.ToolUpdate, request.ToolHistory)
			if err != nil {
				return Completion{}, err
			}
			request.Messages, request.Tools = tools.Messages, tools.Tools
			request.toolHistoryProjected = true
		}
		return dispatch(ctx, request, emit)
		if request.promptReceipt != nil {
			var err error
			ctx, err = recordPromptReceipt(ctx, request)
			if err != nil {
				return Completion{}, err
			}
		}
	}
	prepared.validated = true
	return prepared, nil
}

func requestContextFromModelInfo(provider, model string, info ModelInfo) (RequestContext, bool, error) {
	if provider == "" || model == "" {
		return RequestContext{}, false, nil
	}
	if info.Provider != provider || info.Model != model {
		return RequestContext{}, false, fmt.Errorf(
			"harness: model info route mismatch: requested %s/%s, resolved %s/%s",
			provider, model, info.Provider, info.Model,
		)
	}
	if info.ContextWindow < 0 {
		return RequestContext{}, false, errors.New("harness: model context window must be positive when present")
	}
	return RequestContext{Provider: provider, Model: model, ContextWindow: info.ContextWindow, SystemPromptUpdate: info.SystemPromptUpdate}, true, nil
}
