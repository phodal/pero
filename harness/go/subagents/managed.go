package subagents

import (
	"context"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// This wrapper advertises managed continuation only for the selected Claude
// provider. Legacy spawn/fork providers retain their one-shot capability set.
type managedClaudeProvider struct{ *inProcessProvider }

type claudeBackgroundActivationKey struct{}

func (p *managedClaudeProvider) PrepareContinuable(ctx context.Context, request harness.SubagentRequest) (harness.SubagentContinuationProviderRun, error) {
	return harness.SubagentContinuationProviderRun{}, harness.ErrSubagentActivationModeUnsupported
}
func (p *managedClaudeProvider) PrepareActivation(ctx context.Context, request harness.SubagentRequest) (harness.SubagentContinuationProviderRun, error) {
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
func (p *managedClaudeProvider) continuationRun(ctx context.Context, child *harness.Agent) harness.SubagentContinuationProviderRun {
	background, _ := ctx.Value(claudeBackgroundActivationKey{}).(bool)
	return harness.SubagentContinuationProviderRun{Child: child, ChildID: child.ID(), Submit: child.FollowupResultContext, Dispose: func(ctx context.Context) error { return p.removeChild(ctx, child) }, RetainBackgroundActivities: background}
}
func (p *managedClaudeProvider) PrepareResume(ctx context.Context, parent *harness.Agent, id harness.SessionID) (harness.SubagentContinuationProviderRun, harness.SubagentSnapshot, error) {
	return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, harness.ErrSubagentActivationModeUnsupported
}
func (p *managedClaudeProvider) PrepareManagedResume(ctx context.Context, parent *harness.Agent, id harness.SessionID) (harness.SubagentContinuationProviderRun, harness.SubagentSnapshot, error) {
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
	if parent == nil || header.Origin != "subagent" || header.ParentSession != parent.ID() {
		return unavailable()
	}
	descriptor, found, err := harness.FoldSubagentDescriptor(session)
	if err != nil {
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
	}
	if !found || descriptor.Provider != p.name || descriptor.Mode != harness.SubagentDescriptorContinuable {
		return unavailable()
	}
	identity, found, err := selectedClaudeDefinition(session)
	if err != nil {
		return harness.SubagentContinuationProviderRun{}, harness.SubagentSnapshot{}, err
	}
	definition, selected := p.definitions[identity.Name]
	if !found || !selected {
		return unavailable()
	}
	request := harness.SubagentRequest{Parent: parent, ChildID: id, Depth: header.DelegationDepth, CWD: session.WorkingDirectory(), Provider: descriptor.AgentProvider, Model: descriptor.AgentModel, ReasoningEffort: descriptor.AgentReasoningEffort, Persona: descriptor.Persona, ToolFilter: descriptor.ToolFilter}
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
		if definition.Tools != nil {
			allow, err := availableToolAllow(ctx, p.h, child, definition.Tools)
			if err != nil {
				return err
			}
			_, err = p.h.Tools().Restrict(ctx, run, child, harness.ToolRestriction{Allow: allow})
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
	return p.continuationRun(ctx, child), harness.SubagentSnapshot{ID: id, Parent: parent.ID(), Provider: p.name, Label: descriptor.Label, Depth: header.DelegationDepth, Continuable: true, SuppressParentSettlement: descriptor.SuppressParentSettlement}, nil
}
