package subagents

import (
	"context"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// Managed creation is explicit for native and selected Claude providers.
// Legacy spawn/fork retain their one-shot capability set.
type managedInProcessProvider struct{ *inProcessProvider }

type claudeBackgroundActivationKey struct{}

func (p *managedInProcessProvider) SupportsDSHTreeResume() bool { return p.dshTreeResume }

func (p *managedInProcessProvider) PrepareContinuable(ctx context.Context, request harness.SubagentRequest) (harness.SubagentContinuationProviderRun, error) {
	return harness.SubagentContinuationProviderRun{}, harness.ErrSubagentActivationModeUnsupported
}
func (p *managedInProcessProvider) PrepareActivation(ctx context.Context, request harness.SubagentRequest) (harness.SubagentContinuationProviderRun, error) {
	child, capture, err := p.createChild(ctx, request)
	if err != nil {
		return harness.SubagentContinuationProviderRun{}, err
	}
	run := p.continuationRun(ctx, child)
	run.InitialMessageID = request.InitialPromptMessage().ID
	run.Begin = func(ctx context.Context) (<-chan harness.TurnOutcome, error) {
		if capture != nil && capture.admission != nil {
			return capture.admission.AdmitDSHMessage(ctx, request.InitialPromptMessage(), harness.InboxNextTurn)
		}
		return child.AdmitDSHMessage(ctx, request.InitialPromptMessage(), harness.InboxNextTurn)
	}
	if capture != nil {
		run.CaptureStructured = capture.value
		run.StructuredAdmission = capture.admission
	}
	return run, nil
}
func (p *managedInProcessProvider) continuationRun(ctx context.Context, child *harness.Agent) harness.SubagentContinuationProviderRun {
	background, _ := ctx.Value(claudeBackgroundActivationKey{}).(bool)
	return harness.SubagentContinuationProviderRun{Child: child, ChildID: child.ID(), Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { return p.removeChild(ctx, child) }, RetainBackgroundActivities: background}
}
func (p *managedInProcessProvider) PrepareResume(ctx context.Context, parent *harness.Agent, id harness.SessionID) (harness.SubagentContinuationProviderRun, harness.SubagentSnapshot, error) {
	return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, harness.ErrSubagentActivationModeUnsupported
}
func (p *managedInProcessProvider) PrepareManagedResume(ctx context.Context, parent *harness.Agent, id harness.SessionID) (harness.SubagentContinuationProviderRun, harness.SubagentSnapshot, error) {
	unavailable := func() (harness.SubagentContinuationProviderRun, harness.SubagentSnapshot, error) {
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, harness.ErrSubagentResumeUnavailable
	}
	session, found := p.h.Sessions().Get(id)
	if !found {
		if p.persistence == nil {
			return unavailable()
		}
		var err error
		session, err = p.persistence.Load(ctx, id)
		if err != nil {
			return unavailable()
		}
	}
	header := session.Header()
	if parent == nil || header.Origin != "subagent" {
		return unavailable()
	}
	creator, detached := harness.DSHColdResumeCreator(ctx, parent, id)
	if !detached {
		creator = parent.ID()
	}
	if header.ParentSession != creator {
		return unavailable()
	}
	descriptor, found, err := harness.FoldSubagentDescriptor(session)
	if err != nil {
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
	}
	if !found || descriptor.Provider != p.name || descriptor.Mode != harness.SubagentDescriptorContinuable {
		return unavailable()
	}
	if p.definitions == nil {
		// Native continuation uses the original route and tool
		// restrictions. Child options refuse an incompatible current parent
		// rather than silently switching providers or widening approvals.
		request := harness.SubagentRequest{Parent: parent, ChildID: id, Depth: header.DelegationDepth, CWD: session.WorkingDirectory(), Provider: descriptor.AgentProvider, Model: descriptor.AgentModel, ReasoningEffort: descriptor.AgentReasoningEffort, Persona: descriptor.Persona, ToolFilter: descriptor.ToolFilter}
		var capture *structuredCapture
		options, err := p.childAgentOptions(request, &capture)
		if err != nil {
			return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
		}
		if detached && (options.Provider != descriptor.AgentProvider || options.Model != descriptor.AgentModel || options.ReasoningEffort != descriptor.AgentReasoningEffort) {
			return unavailable()
		}
		if err := p.resolveChildRoute(ctx, request, options); err != nil {
			return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
		}
		child, err := p.h.Agents().Resume(ctx, session, options)
		if err != nil {
			return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
		}
		if err := p.attachSession(ctx, child.Session()); err != nil {
			_ = p.removeChild(context.Background(), child)
			return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
		}
		return p.continuationRun(ctx, child), harness.SubagentSnapshot{ID: id, Parent: header.ParentSession, Provider: p.name, Label: descriptor.Label, Depth: header.DelegationDepth, Continuable: true, SuppressParentSettlement: descriptor.SuppressParentSettlement}, nil
	}
	identity, found, err := selectedClaudeDefinition(session)
	if err != nil {
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
	}
	definition, selected := p.definitions[identity.Name]
	if !found || !selected {
		return unavailable()
	}
	memory, err := resumedAgentMemory(parent, definition, session)
	if err != nil {
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
	}
	keepMemory := false
	defer func() {
		if !keepMemory && memory.release != nil {
			memory.release()
		}
	}()
	request := harness.SubagentRequest{Parent: parent, ChildID: id, Depth: header.DelegationDepth, CWD: session.WorkingDirectory(), Provider: descriptor.AgentProvider, Model: descriptor.AgentModel, ReasoningEffort: descriptor.AgentReasoningEffort, Persona: descriptor.Persona, ToolFilter: descriptor.ToolFilter, MaxSteps: definition.MaxTurns}
	var capture *structuredCapture
	options, err := p.childAgentOptions(request, &capture)
	if err != nil {
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
	}
	if err := p.resolveChildRoute(ctx, request, options); err != nil {
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
	}
	base := options.Configure
	options.Configure = func(ctx context.Context, run *point.Run, child *harness.Agent) error {
		if err := base(ctx, run, child); err != nil {
			return err
		}
		if err := mountAgentMemory(ctx, p.h, run, child, memory, false); err != nil {
			return err
		}
		if definition.Tools != nil || len(definition.DisallowedTools) > 0 {
			filter := harness.ToolRestriction{Deny: definition.DisallowedTools}
			if definition.Tools != nil {
				allow, err := availableToolAllow(ctx, p.h, child, definition.Tools)
				if err != nil {
					return err
				}
				filter.Allow = allow
			}
			_, err = p.h.Tools().Restrict(ctx, run, child, filter)
			return err
		}
		return nil
	}
	child, err := p.h.Agents().Resume(ctx, session, options)
	if err != nil {
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
	}
	if err := p.attachSession(ctx, child.Session()); err != nil {
		_ = p.removeChild(context.Background(), child)
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
	}
	keepMemory = true
	return p.continuationRun(ctx, child), harness.SubagentSnapshot{ID: id, Parent: parent.ID(), Provider: p.name, Label: descriptor.Label, Depth: header.DelegationDepth, Continuable: true, SuppressParentSettlement: descriptor.SuppressParentSettlement}, nil
}

// ListPersisted projects only recognizable selected Claude continuations. It
// never resumes a child or grants an execution lease. An unreadable or no
// longer configured child is not eligible for ownership reassignment.
func (p *managedInProcessProvider) ListPersisted(ctx context.Context) ([]harness.SubagentCatalogEntry, error) {
	if p.persistence == nil {
		return nil, nil
	}
	var headers []harness.SessionHeader
	if catalog, ok := p.persistence.(harness.SessionCatalogPersistence); ok {
		candidates, err := catalog.ListCandidates(ctx)
		if err != nil {
			return nil, err
		}
		for _, candidate := range candidates {
			if candidate.Err == nil && candidate.Header != nil {
				headers = append(headers, *candidate.Header)
			}
		}
	} else {
		var err error
		headers, err = p.persistence.List(ctx)
		if err != nil {
			return nil, err
		}
	}
	var result []harness.SubagentCatalogEntry
	for _, header := range headers {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if header.Origin != "subagent" || header.ParentSession == "" || header.DelegationDepth <= 0 {
			continue
		}
		child, err := p.persistence.Load(ctx, header.ID)
		if err != nil || child.Header().ParentSession != header.ParentSession {
			continue
		}
		descriptor, found, err := harness.FoldSubagentDescriptor(child)
		if err != nil || !found || descriptor.Provider != p.name || descriptor.Mode != harness.SubagentDescriptorContinuable {
			continue
		}
		identity, found, err := selectedClaudeDefinition(child)
		if _, selected := p.definitions[identity.Name]; err != nil || !found || !selected {
			continue
		}
		result = append(result, harness.SubagentCatalogEntry{
			Kind: harness.SubagentCatalogChild, ID: header.ID, Parent: header.ParentSession,
			Provider: p.name, Label: descriptor.Label, Mode: descriptor.Mode, Depth: header.DelegationDepth,
			StartedAt: header.CreatedAt,
		})
	}
	return result, ctx.Err()
}
