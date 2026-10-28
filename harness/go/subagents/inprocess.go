// Package subagents provides concrete providers and model tools for the
// Harness subagent capability seam.
package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type InProcessOptions struct {
	// Compaction is fixed trusted launch policy, never a model argument.
	Compaction  *harness.BasicCompactionConfig
	EntryID     string
	Name        string
	Persistence harness.SessionPersistence
}

type inProcessProvider struct {
	compaction     *harness.BasicCompactionConfig
	h              *harness.Harness
	registry       *harness.SubagentRegistry
	name           string
	fork           bool
	persistence    harness.SessionPersistence
	prepareSeed    func(context.Context, harness.SubagentRequest) (*harness.Session, error)
	next           atomic.Uint64
	persistenceMu  sync.Mutex
	detachSessions map[*harness.Session]func() error
}

func MountInProcess(ctx context.Context, h *harness.Harness, options InProcessOptions) (*point.Instance, error) {
	return mountInProcess(ctx, h, options, false)
}

// MountForkInProcess registers the DSH-compatible fork provider. Its seed is
// captured once through the parent's last completed turn.
func MountForkInProcess(ctx context.Context, h *harness.Harness, options InProcessOptions) (*point.Instance, error) {
	return mountInProcess(ctx, h, options, true)
}

func mountInProcess(ctx context.Context, h *harness.Harness, options InProcessOptions, fork bool) (*point.Instance, error) {
	if h == nil || h.Runtime() == nil || h.Subagents() == nil {
		return nil, errors.New("subagents: in-process provider requires a running harness")
	}
	if options.EntryID == "" {
		if fork {
			options.EntryID = "subagents/fork-in-process"
		} else {
			options.EntryID = "subagents/in-process"
		}
	}
	if options.Name == "" {
		if fork {
			options.Name = "fork"
		} else {
			options.Name = "spawn"
		}
	}
	var compaction *harness.BasicCompactionConfig
	if options.Compaction != nil {
		copied := harness.CloneBasicCompactionConfig(*options.Compaction)
		compaction = &copied
	}
	provider := &inProcessProvider{compaction: compaction,
		h: h, name: options.Name, fork: fork, persistence: options.Persistence,
		detachSessions: make(map[*harness.Session]func() error),
	}
	definition := point.Define(
		point.Descriptor{ID: "harness/contribution/subagent-in-process/" + options.EntryID, Requires: []point.Requirement{point.Require(harness.SubagentRegistryKey)}},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			registry, err := point.Resolve(run, harness.SubagentRegistryKey)
			if err != nil {
				return nil, err
			}
			provider.registry = registry
			_, err = registry.RegisterProvider(run, provider)
			return nil, err
		},
	)
	instance, err := h.Runtime().Mount(nil, options.EntryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("subagents: in-process provider activation failed: %s", snapshot.LastError)
	}
	return instance, nil
}

func (p *inProcessProvider) Name() string { return p.name }

func (p *inProcessProvider) Capabilities() harness.SubagentCapabilities {
	return harness.SubagentCapabilities{AgentOptions: true, OutputSchema: true, Persona: true, ToolFilter: true, DepthLimit: true}
}

func (p *inProcessProvider) InheritsParentContext() bool { return p.fork }

func (p *inProcessProvider) Prepare(ctx context.Context, request harness.SubagentRequest) (harness.SubagentProviderRun, error) {
	if request.Parent == nil || request.AgentPreset != "" {
		return harness.SubagentProviderRun{}, errors.New("subagents: bounded provider requires a parent and supports only one-shot delegation without presets")
	}
	if err := ctx.Err(); err != nil {
		return harness.SubagentProviderRun{}, err
	}
	child, structured, err := p.createChild(ctx, request)
	if err != nil {
		return harness.SubagentProviderRun{}, err
	}
	lifetime, cancel := context.WithCancelCause(context.Background())
	result := make(chan harness.SubagentResult, 1)
	var beginOnce sync.Once
	var disposeOnce sync.Once
	var disposeErr error
	begin := func() {
		beginOnce.Do(func() {
			go func() {
				turn, promptErr := child.Prompt(lifetime, harness.Message{Role: harness.RoleUser, Content: request.PromptBlocks()})
				outcome := harness.SubagentResult{ChildID: child.ID(), Reason: turn.Reason}
				switch {
				case promptErr == nil:
					outcome.Output = lastAssistantOutput(child.Session())
					outcome.Structured = structured.value()
					if len(request.OutputSchema) != 0 && outcome.Structured == nil {
						outcome.Status = harness.SubagentFailed
						outcome.Reason = harness.FinishError
						outcome.Diagnostic = "subagent finished without required structured output"
					} else {
						outcome.Status = harness.SubagentCompleted
					}
				case lifetime.Err() != nil:
					outcome.Status = harness.SubagentAborted
					outcome.Reason = harness.FinishAborted
					outcome.Diagnostic = "subagent run was cancelled"
				default:
					outcome.Status = harness.SubagentFailed
					outcome.Reason = harness.FinishError
					outcome.Diagnostic = promptErr.Error()
					outcome.Output = lastAssistantOutput(child.Session())
				}
				result <- outcome
				close(result)
			}()
		})
	}
	dispose := func(disposeCtx context.Context) error {
		disposeOnce.Do(func() {
			cancel(errors.New("subagent run disposed"))
			disposeErr = p.removeChild(disposeCtx, child)
		})
		return disposeErr
	}
	return harness.SubagentProviderRun{
		Child: child, ChildID: child.ID(), Result: result, Begin: begin,
		Cancel: func(cause error) {
			if cause == nil {
				cause = context.Canceled
			}
			cancel(cause)
			child.Cancel(cause)
		},
		Dispose: dispose,
	}, nil
}

func (p *inProcessProvider) createChild(ctx context.Context, request harness.SubagentRequest) (*harness.Agent, *structuredCapture, error) {
	reservedIdentity := request.ChildID != ""
	childID := request.ChildID
	if childID == "" {
		childID = harness.SessionID(fmt.Sprintf("%s-subagent-%d-%d", request.Parent.ID(), time.Now().UTC().UnixNano(), p.next.Add(1)))
	}
	var structured *structuredCapture
	options, err := p.childAgentOptions(request, &structured)
	if err != nil {
		return nil, nil, err
	}
	// Resolve an explicit or inherited route before publishing a child Session.
	// Adapters own exact-model validity; a failed lookup must leave neither a
	// live child nor a durable catalog entry behind.
	if options.Provider != "" || options.Model != "" {
		if options.Provider == "" || options.Model == "" {
			return nil, nil, errors.New("subagents: effective child provider and model must be supplied together")
		}
		info, err := p.h.Providers().ResolveModelInfo(ctx, options.Provider, options.Model)
		if err != nil {
			return nil, nil, fmt.Errorf("subagents: resolve child model route %s/%s: %w", options.Provider, options.Model, err)
		}
		// Reuse the already-resolved exact route metadata after all existing
		// preparation gates. Do not invoke a second resolver or move admission.
		if request.DSHModelSelection() && options.ReasoningEffort != "" && info.Reasoning == nil {
			return nil, nil, harness.NewProviderError(fmt.Sprintf("provider %q model %q does not support reasoning effort %q", options.Provider, options.Model, options.ReasoningEffort), "UNSUPPORTED_REASONING_EFFORT", nil)
		}
		if err := harness.ValidateReasoningEffort(info, options.ReasoningEffort); err != nil {
			return nil, nil, fmt.Errorf("subagents: resolve child model route %s/%s: %w", options.Provider, options.Model, err)
		}
	}
	options.ID = childID
	var seed *harness.Session
	if p.prepareSeed != nil {
		request.ChildID = childID
		seed, err = p.prepareSeed(ctx, request)
		if err != nil {
			return nil, nil, err
		}
		if seed != nil && (seed.Header().ID != childID || seed.Header().ParentSession != request.Parent.ID() || seed.Header().Origin != "subagent" || seed.Header().DelegationDepth != request.Depth) {
			return nil, nil, errors.New("subagents: invalid detached seed identity")
		}
	} else if p.fork {
		seed, err = request.Parent.Session().ForkCompletedTurnsForSubagent(childID, request.Depth)
		if errors.Is(err, harness.ErrSessionForkUnavailable) {
			seed, err = nil, nil
		}
		if err != nil {
			return nil, nil, fmt.Errorf("subagents: fork parent context: %w", err)
		}
	}
	if reservedIdentity && p.persistence != nil {
		exists, err := persistedSubagentIdentityExists(ctx, p.persistence, childID)
		if err != nil {
			return nil, nil, err
		}
		if exists {
			return nil, nil, fmt.Errorf("%w: %q", harness.ErrSubagentDuplicateChild, childID)
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, nil, err
	}
	var child *harness.Agent
	if seed != nil {
		child, err = p.h.Agents().Resume(ctx, seed, options)
	} else {
		child, err = p.h.Agents().Create(ctx, options)
	}

	if err != nil {
		return nil, nil, err
	}
	descriptorRequest := request
	descriptor, err := harness.SnapshotSubagentDescriptor(p.name, descriptorRequest, false)
	if err != nil {
		p.rollbackChild(child)
		return nil, nil, err
	}
	if _, err := child.Session().Append("subagent/descriptor", descriptor); err != nil {
		p.rollbackChild(child)
		return nil, nil, err
	}
	if _, err := harness.SetApprovalPolicy(child.Session(), harness.ApprovalNever); err != nil {
		p.rollbackChild(child)
		return nil, nil, err
	}
	if err := p.attachSession(ctx, child.Session()); err != nil {
		p.rollbackChild(child)
		return nil, nil, err
	}
	return child, structured, nil
}

func (p *inProcessProvider) attachSession(ctx context.Context, session *harness.Session) error {
	if p.persistence == nil {
		return nil
	}
	owner, live := p.h.Agents().Get(session.Header().ID)
	if !live || owner.Session() != session {
		return errors.New("subagents: child Session is no longer current")
	}
	detach, err := p.persistence.Attach(ctx, session)
	if err != nil {
		return fmt.Errorf("subagents: attach child session persistence: %w", err)
	}
	p.persistenceMu.Lock()
	current, live := p.h.Agents().Get(session.Header().ID)
	if !live || current != owner || current.Session() != session {
		p.persistenceMu.Unlock()
		_ = detach()
		return errors.New("subagents: child retired during persistence attachment")
	}
	if _, exists := p.detachSessions[session]; exists {
		p.persistenceMu.Unlock()
		_ = detach()
		return fmt.Errorf("subagents: child session %q already has persistence attached", session.Header().ID)
	}
	p.detachSessions[session] = detach
	p.persistenceMu.Unlock()
	return nil
}

func (p *inProcessProvider) detachSession(session *harness.Session) error {
	p.persistenceMu.Lock()
	detach := p.detachSessions[session]
	delete(p.detachSessions, session)
	p.persistenceMu.Unlock()
	if detach == nil {
		return nil
	}
	return detach()
}

func (p *inProcessProvider) removeChild(ctx context.Context, child *harness.Agent) error {
	// The child's scoped cleanup owns its writer lease, including when an
	// ancestor removal already withdrew the map entry and is still draining.
	return p.h.Agents().RemoveExact(ctx, child)
}

func (p *inProcessProvider) rollbackChild(child *harness.Agent) {
	_ = p.removeChild(context.Background(), child)
	p.h.Sessions().RemoveExact(child.Session())
}

// childAgentOptions narrows native inheritance for the explicitly enabled, trusted
// one-shot surface. No request may change its parent's route or enlarge a budget.
func (p *inProcessProvider) childAgentOptions(request harness.SubagentRequest, structured **structuredCapture) (harness.AgentOptions, error) {
	provider, model, effort, err := parentAgentRoute(request.Parent)
	if err != nil {
		return harness.AgentOptions{}, err
	}
	if (request.Provider != "" && request.Provider != provider) || (request.Model != "" && request.Model != model) || (request.ReasoningEffort != "" && request.ReasoningEffort != effort) {
		return harness.AgentOptions{}, errors.New("subagents: child model route must match parent")
	}
	if request.MaxSteps < 0 || request.MaxTokens < 0 {
		return harness.AgentOptions{}, errors.New("subagents: negative child budget")
	}
	ceiling := request.Parent.MaxTokens()
	header, found, err := request.Parent.Session().RequestHeader()
	if err != nil {
		return harness.AgentOptions{}, err
	}
	if found && header.MaxTokens > 0 && (ceiling <= 0 || header.MaxTokens < ceiling) {
		ceiling = header.MaxTokens
	}
	steps, tokens := request.MaxSteps, request.MaxTokens
	if steps == 0 {
		steps = request.Parent.MaxSteps()
	}
	if tokens == 0 {
		tokens = ceiling
	}
	if (request.Parent.MaxSteps() > 0 && steps > request.Parent.MaxSteps()) || (ceiling > 0 && tokens > ceiling) {
		return harness.AgentOptions{}, errors.New("subagents: child budget exceeds parent")
	}
	cwd := request.Parent.Session().WorkingDirectory()
	resolvedCWD, err := filepath.Abs(cwd)
	if err != nil {
		return harness.AgentOptions{}, err
	}
	if request.CWD != "" && request.CWD != cwd && request.CWD != resolvedCWD {
		return harness.AgentOptions{}, errors.New("subagents: child working directory must match parent")
	}
	var compaction *harness.BasicCompactionConfig
	if p.compaction != nil {
		copied := harness.CloneBasicCompactionConfig(*p.compaction)
		compaction = &copied
	}
	return harness.AgentOptions{Compaction: compaction,
		CWD: request.Parent.Session().Header().CWD, Provider: provider, Model: model, ReasoningEffort: effort, MaxSteps: steps, MaxTokens: tokens,
		Delegated: true, Parent: request.Parent, DelegationDepth: request.Depth,
		Configure: func(ctx context.Context, run *point.Run, agent *harness.Agent) error {
			// Preserve the native writer lease cleanup ordering before agent.worker.
			if err := run.Defer("subagent-persistence", func(context.Context) error { return p.detachSession(agent.Session()) }); err != nil {
				return err
			}
			if agent.Session().WorkingDirectory() != cwd {
				if _, err := agent.Session().Append("working-directory/change", struct {
					CWD string `json:"cwd"`
				}{cwd}); err != nil {
					return err
				}
			}
			// Approval is pinned before publication; parent scope owns executable sandbox
			// policy. Session mode events cannot select or widen Pero launch authority.
			if _, err := harness.SetApprovalPolicy(agent.Session(), harness.ApprovalNever); err != nil {
				return err
			}
			if request.Persona != "" {
				if _, err := p.h.Prompts().Register(run, harness.PromptSection{ID: "subagent/persona/" + string(agent.ID()), Order: 50, Content: func(context.Context, *harness.Agent) (string, error) { return request.Persona, nil }}); err != nil {
					return err
				}
			}
			if _, err := p.h.Prompts().Register(run, harness.PromptSection{ID: "subagent/delegation/" + string(agent.ID()), Order: 8500, Content: func(context.Context, *harness.Agent) (string, error) {
				return "You are a delegated subagent. Your permission scope cannot be widened from this session: operations requiring approval are rejected automatically. Report limitations to the delegating agent instead of retrying denied operations.", nil
			}}); err != nil {
				return err
			}
			if request.ToolFilter != nil {
				if _, err := p.h.Tools().Restrict(ctx, run, agent, *request.ToolFilter); err != nil {
					return err
				}
			}
			if len(request.OutputSchema) != 0 {
				capture, err := attachStructuredCapture(p.h, run, agent, request.OutputSchema)
				if err != nil {
					return err
				}
				*structured = capture
			}
			return nil
		},
	}, nil
}

// parentAgentRouteForDelegation reads the latest committed request route. A
// request hook may have selected a different provider/model than the Agent's
// creation defaults; child inheritance follows what actually served the
// parent, matching reconstruction and cold-resume semantics.
func parentAgentRoute(parent *harness.Agent) (string, string, harness.ReasoningEffort, error) {
	if parent == nil {
		return "", "", "", errors.New("subagents: child route requires a parent")
	}
	header, found, err := parent.Session().RequestHeader()
	if err != nil {
		return "", "", "", fmt.Errorf("subagents: read parent request route: %w", err)
	}
	if found {
		if (header.Provider == "") != (header.Model == "") {
			return "", "", "", errors.New("subagents: parent request route is incomplete")
		}
		if header.Provider != "" {
			return header.Provider, header.Model, header.ReasoningEffort, nil
		}
	}
	return parent.Provider(), parent.Model(), parent.ReasoningEffort(), nil
}

func lastAssistantOutput(session *harness.Session) []harness.ContentBlock {
	seedLength := session.Header().SeedLength
	events := session.Events()
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Seq <= seedLength || events[index].Type != "assistant/message" {
			continue
		}
		var payload struct {
			Message harness.Message `json:"message"`
		}
		if json.Unmarshal(events[index].Data, &payload) == nil && payload.Message.Role == harness.RoleAssistant {
			return append([]harness.ContentBlock(nil), payload.Message.Content...)
		}
	}
	return nil
}

var _ harness.SubagentProvider = (*inProcessProvider)(nil)

func persistedSubagentIdentityExists(ctx context.Context, persistence harness.SessionPersistence, id harness.SessionID) (bool, error) {
	if reader, ok := persistence.(harness.SessionIdentityPersistence); ok {
		return reader.Exists(ctx, id)
	}
	// Existing custom backends keep their interface. A failed/corrupt Load is
	// never treated as an available identity; only a real not-found is absent.
	stored, err := persistence.Load(ctx, id)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if stored == nil {
		return false, errors.New("subagents: persistence returned a nil Session without not-found")
	}
	return true, nil
}
