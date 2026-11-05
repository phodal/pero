package engineeringprofile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/tasks"
)

type Options struct {
	Mode        Mode
	MaxFeedback int
}

type candidateKey struct {
	agent     *harness.Agent
	messageID string
}
type candidate struct {
	contract Contract
	turn     int
}

type App struct {
	h           *harness.Harness
	instance    *point.Instance
	mode        Mode
	maxFeedback int
	active      atomic.Bool
	mu          sync.Mutex
	staged      map[candidateKey]candidate
}

// Mount contributes one run-owned App. It neither enables execution tools nor
// changes approval, task ownership, or provider budgets.
func Mount(ctx context.Context, h *harness.Harness, options Options) (*App, error) {
	if h == nil {
		return nil, errors.New("engineeringprofile: harness required")
	}
	if options.Mode == "" {
		options.Mode = Observe
	}
	if options.Mode != Observe && options.Mode != Feedback {
		return nil, errors.New("engineeringprofile: mode must be observe or feedback")
	}
	if options.MaxFeedback == 0 {
		options.MaxFeedback = 2
	}
	if options.MaxFeedback < 1 || options.MaxFeedback > 8 {
		return nil, errors.New("engineeringprofile: feedback limit must be 1..8")
	}
	a := &App{h: h, mode: options.Mode, maxFeedback: options.MaxFeedback, staged: make(map[candidateKey]candidate)}
	definition := point.Define(point.Descriptor{ID: "harness/engineering-profile", Requires: []point.Requirement{
		point.Require(harness.PromptRegistryKey), point.Require(harness.AgentHooksKey), point.Require(harness.ToolRegistryKey),
	}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		prompts, err := point.Resolve(run, harness.PromptRegistryKey)
		if err != nil {
			return nil, err
		}
		hooks, err := point.Resolve(run, harness.AgentHooksKey)
		if err != nil {
			return nil, err
		}
		tools, err := point.Resolve(run, harness.ToolRegistryKey)
		if err != nil {
			return nil, err
		}
		if err := a.mountPrompts(run, prompts); err != nil {
			return nil, err
		}
		if _, err = tools.Register(run, a.checkTool()); err != nil {
			return nil, err
		}
		if _, err = tools.Guard(run, a.guardCheck); err != nil {
			return nil, err
		}
		if _, err = hooks.InboxClaimed.On(run, a.claimed); err != nil {
			return nil, err
		}
		if _, err = hooks.InboxDiscarded.On(run, func(_ context.Context, input harness.InboxDiscardedInput) error {
			a.DiscardContract(input.Agent, input.Message.ID)
			return nil
		}); err != nil {
			return nil, err
		}
		if _, err = hooks.Retiring.On(run, func(_ context.Context, agent *harness.Agent) error {
			a.mu.Lock()
			defer a.mu.Unlock()
			for key := range a.staged {
				if key.agent == agent {
					delete(a.staged, key)
				}
			}
			return nil
		}); err != nil {
			return nil, err
		}
		if _, err = hooks.MainRequest.On(run, a.mainRequest); err != nil {
			return nil, err
		}
		if _, err = hooks.PreStep.Use(run, func(ctx context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
			input, err := next(input)
			if err != nil || input.Reject || !input.Continue || a.mode != Feedback || input.Step%32 != 0 || !a.accepts(input.Agent) {
				return input, err
			}
			message, err := a.progressReview(ctx, input.Agent, input.Turn, input.Step)
			if message != nil {
				input.Messages = append(input.Messages, *message)
			}
			return input, err
		}); err != nil {
			return nil, err
		}
		if _, err = hooks.TurnStopping.On(run, a.stopping); err != nil {
			return nil, err
		}
		if _, err = hooks.PostCompact.Use(run, func(ctx context.Context, input harness.CompactionHookInput, next point.Next[harness.CompactionHookInput]) (harness.CompactionHookInput, error) {
			input, err := next(input)
			if err != nil || !a.accepts(input.Agent) {
				return input, err
			}
			text, err := a.workContext(ctx, input.Agent)
			if err != nil {
				return input, err
			}
			if text != "" {
				input.Messages = append(input.Messages, contextMessage("engineering/checkpoint", text))
			}
			return input, nil
		}); err != nil {
			return nil, err
		}
		a.active.Store(true)
		return nil, run.Defer("engineering-profile", func(context.Context) error {
			a.active.Store(false)
			a.mu.Lock()
			a.staged = make(map[candidateKey]candidate)
			a.mu.Unlock()
			return nil
		})
	})
	instance, err := h.Runtime().Mount(nil, "engineering-profile", definition, nil)
	if err == nil {
		err = instance.WaitStable(ctx)
	}
	if err == nil && instance.Snapshot().State == point.Failed {
		err = fmt.Errorf("engineeringprofile: activation failed: %s", instance.Snapshot().LastError)
	}
	if err != nil {
		if instance != nil {
			_ = instance.Dispose(context.Background())
		}
		return nil, err
	}
	a.instance = instance
	return a, nil
}

func (a *App) Dispose(ctx context.Context) error {
	if a == nil || a.instance == nil {
		return nil
	}
	return a.instance.Dispose(ctx)
}

func (a *App) accepts(agent *harness.Agent) bool {
	return a != nil && agent != nil && agent.Parent() == nil && !agent.IsExternal() && a.h.Runtime().Root().Contains(agent.Scope())
}

// StageContract is trusted host composition before Prompt. Admission of an
// exact human message, followed by its durable request fold, activates it.
func (a *App) StageContract(agent *harness.Agent, c Contract) error {
	if !a.accepts(agent) || !a.active.Load() {
		return errors.New("engineeringprofile: active native root agent required")
	}
	if err := c.Validate(); err != nil {
		return err
	}
	if !validID(c.MessageID) {
		return errors.New("engineeringprofile: host-assigned messageId required")
	}
	if revision, err := latestRevision(agent.Session(), c.ID); err != nil {
		return err
	} else if err := c.validateRevisionAfter(revision); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	key := candidateKey{agent, c.MessageID}
	if _, exists := a.staged[key]; exists {
		return errors.New("engineeringprofile: message already has a staged contract")
	}
	a.staged[key] = candidate{contract: cloneContract(c)}
	return nil
}

// DiscardContract clears only an unbound candidate, never historical facts.
func (a *App) DiscardContract(agent *harness.Agent, messageID string) {
	if a == nil {
		return
	}
	a.mu.Lock()
	delete(a.staged, candidateKey{agent, messageID})
	a.mu.Unlock()
}

func (a *App) claimed(_ context.Context, input harness.InboxClaimedInput) error {
	if !input.UserAuthored || !a.accepts(input.Agent) {
		return nil
	}
	a.mu.Lock()
	for key, staged := range a.staged {
		if key.agent == input.Agent && staged.turn > 0 && key.messageID != input.Message.ID {
			delete(a.staged, key)
		}
	}
	key := candidateKey{input.Agent, input.Message.ID}
	if c, ok := a.staged[key]; ok {
		c.turn = input.Turn
		a.staged[key] = c
	}
	a.mu.Unlock()
	_, err := input.Agent.Session().Append(humanClaimEvent, humanClaim{Version: 1, Turn: input.Turn, MessageID: input.Message.ID})
	return err
}

func (a *App) mainRequest(ctx context.Context, input harness.MainRequestInput) error {
	if !input.Active() || !a.accepts(input.Agent()) {
		return nil
	}
	agent := input.Agent()
	turn, step := input.Boundary()
	var selected candidate
	var key candidateKey
	a.mu.Lock()
	for k, c := range a.staged {
		if k.agent == agent && c.turn == turn && c.turn != 0 {
			selected, key = c, k
			break
		}
	}
	a.mu.Unlock()
	if selected.turn != 0 {
		current, ok, err := Current(agent.Session())
		if err != nil {
			return err
		}
		if !ok || current.MessageID != selected.contract.MessageID {
			revision, err := latestRevision(agent.Session(), selected.contract.ID)
			if err != nil {
				return err
			}
			if err := selected.contract.validateRevisionAfter(revision); err != nil {
				return err
			}
			if _, err = agent.Session().Append(contractEvent, binding{Version: 1, Turn: turn, Contract: selected.contract}); err != nil {
				return err
			}
		}
		if err = agent.Session().Flush(ctx); err != nil {
			return err
		}
		a.DiscardContract(agent, key.messageID)
	}
	// Telemetry is best effort. It does not replace or block a provider failure.
	system, err := agent.Session().EffectiveSystemPrompt()
	if err != nil {
		return nil
	}
	header, ok, err := agent.Session().RequestHeader()
	if err != nil || !ok {
		return nil
	}
	schemas, err := json.Marshal(header.Tools)
	if err != nil {
		return nil
	}
	provider, model := input.Route()
	_, _ = agent.Session().Append(measurementEvent, struct {
		Version      string `json:"profileVersion"`
		Provider     string `json:"provider"`
		Model        string `json:"model"`
		Turn         int    `json:"turn"`
		Step         int    `json:"step"`
		SystemBytes  int    `json:"systemBytes"`
		SchemaBytes  int    `json:"schemaBytes"`
		SystemDigest string `json:"systemDigest"`
	}{Version, provider, model, turn, step, len(system), len(schemas), digest([]byte(system))})
	return nil
}

// Assessment reads existing tasks and settled execution facts; it does not
// maintain another task table or accept model-authored verification claims.
func (a *App) Assessment(ctx context.Context, agent *harness.Agent) (Assessment, bool, error) {
	if !a.accepts(agent) {
		return Assessment{}, false, nil
	}
	c, ok, err := Current(agent.Session())
	if err != nil || !ok {
		return Assessment{}, ok, err
	}
	checks, err := evaluateChecks(ctx, agent, c)
	if err != nil {
		return Assessment{}, true, err
	}
	var open []tasks.TaskID
	if len(c.TaskIDs) > 0 {
		state, err := tasks.Current(agent.Session())
		if err != nil {
			return Assessment{}, true, err
		}
		for _, id := range c.TaskIDs {
			task, err := state.Get(id)
			if err != nil || task.Status != tasks.Completed {
				open = append(open, id)
			}
		}
	}
	return Assess(c, checks, open, evaluateDelivery(ctx, agent.Session().WorkingDirectory(), c.Delivery)...), true, nil
}

func (a *App) stopping(ctx context.Context, input harness.TurnStoppingInput) error {
	if !a.accepts(input.Agent) || a.mode != Feedback || !input.CanContinue || input.Concluded || ctx.Err() != nil {
		return nil
	}
	assessment, ok, err := a.Assessment(ctx, input.Agent)
	if err != nil {
		return err
	}
	if !ok {
		return a.reviewUnboundDelivery(input)
	}
	c, _, err := Current(input.Agent.Session())
	if err != nil {
		return err
	}
	if c.Kind != Change || assessment.Ready {
		return nil
	}
	// A missing capability is a blocker, not an invitation to expand authority.
	schemas, err := a.h.Tools().SchemasForAgent(ctx, input.Agent)
	if err != nil {
		return err
	}
	available := make(map[string]bool)
	for _, schema := range schemas {
		available[schema.Name] = true
	}
	for _, spec := range c.Checks {
		if spec.Required && !available[spec.Tool] {
			return nil
		}
	}
	count, seen, err := attempts(input.Agent.Session(), c, assessment.Fingerprint)
	if err != nil || seen || count >= a.maxFeedback {
		return err
	}
	id := fmt.Sprintf("engineering-feedback-%s-%d-%d", digest([]byte(c.ID))[:12], c.Revision, count+1)
	reservation := attempt{Version: 1, ContractID: c.ID, Revision: c.Revision, Fingerprint: assessment.Fingerprint, MessageID: id}
	if _, err = input.Agent.Session().Append(attemptEvent, reservation); err != nil {
		return err
	}
	if err = input.Agent.Session().Flush(ctx); err != nil {
		return err
	}
	return input.Agent.Inject(contextMessage(id, "The bound engineering contract still has unresolved acceptance work. Observed acceptance: "+assessmentText(assessment)))
}
