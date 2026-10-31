package harness

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
)

type ApprovalOutcome string

const (
	ApprovalAllowedOnce ApprovalOutcome = "allowed-once"
	ApprovalRejected    ApprovalOutcome = "rejected"
	ApprovalCancelled   ApprovalOutcome = "cancelled"
	ApprovalUnavailable ApprovalOutcome = "unavailable"
)

type ApprovalPolicy string

const (
	ApprovalAsk   ApprovalPolicy = "ask"
	ApprovalNever ApprovalPolicy = "never"

	approvalAskPrompt   = "Approval policy: ask. Operations that require approval may ask through the configured answerers; without an available answerer, the request fails closed."
	approvalNeverPrompt = "Approval prompts are disabled in this session: actions that require approval are rejected automatically — do not request sandbox escalation (do not set `sandbox_permissions`)."
)

// SandboxModeEvent and SandboxFullAccessMode mirror the sandbox package's
// durable mode fact. The sandbox package imports harness, so the broker reads
// the fact by name instead of importing its owner.
const (
	SandboxModeEvent      = "sandbox/mode"
	SandboxFullAccessMode = "danger-full-access"
)

type ApprovalOptions struct {
	Policy ApprovalPolicy
}

type ApprovalRequest struct {
	ID       string     `json:"id"`
	Agent    *Agent     `json:"-"`
	CallID   ToolCallID `json:"callId,omitempty"`
	ToolName string     `json:"toolName"`
	Reason   string     `json:"reason,omitempty"`
	// Native is produced only by trusted registration code, never tool arguments.
	Native *NativeApprovalDescriptor `json:"-"`
}

// NativeApprovalDescriptor describes required confinement for one native call.
// It is not proof that a command has run. The executor must still enforce this
// policy or fail closed after approval. Version 1 supports only strict shell.
type NativeApprovalDescriptor struct {
	Version     int    `json:"version"`
	Operation   string `json:"operation"`
	Workspace   string `json:"workspace"`
	SandboxMode string `json:"sandbox_mode"`
	Enforcement string `json:"enforcement"`
	Network     string `json:"network"`
}

type ApprovalHandler func(context.Context, ApprovalRequest) (ApprovalOutcome, error)

type approvalEntry struct {
	id      uint64
	scope   *point.Scope
	handler ApprovalHandler
}

// ApprovalBroker is a fail-closed, effect-owned approval waterfall. Visible
// handlers are consulted from the most specific scope outward until one
// returns an outcome other than unavailable.
type ApprovalBroker struct {
	mu      sync.RWMutex
	nextID  uint64
	entries []approvalEntry
	policy  ApprovalPolicy
}

func NewApprovalBroker() *ApprovalBroker { return &ApprovalBroker{policy: ApprovalAsk} }

func NewApprovalBrokerWithOptions(options ApprovalOptions) (*ApprovalBroker, error) {
	if options.Policy == "" {
		options.Policy = ApprovalAsk
	}
	if err := validateApprovalPolicy(options.Policy); err != nil {
		return nil, err
	}
	return &ApprovalBroker{policy: options.Policy}, nil
}

func validateApprovalPolicy(policy ApprovalPolicy) error {
	if policy != ApprovalAsk && policy != ApprovalNever {
		return errors.New(`harness: approval policy must be "ask" or "never"`)
	}
	return nil
}

// ApprovalPolicyOverride folds the last durable approval/policy event. The
// absence of an override remains distinct from the broker's deployment
// default so resumed sessions can be recomposed under a new default.
func ApprovalPolicyOverride(events []Event) (ApprovalPolicy, bool, error) {
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Type != "approval/policy" {
			continue
		}
		var payload struct {
			Policy ApprovalPolicy `json:"policy"`
		}
		if err := json.Unmarshal(events[index].Data, &payload); err != nil {
			return "", false, fmt.Errorf("harness: decode approval/policy at seq %d: %w", events[index].Seq, err)
		}
		if err := validateApprovalPolicy(payload.Policy); err != nil {
			return "", false, fmt.Errorf("harness: invalid approval/policy at seq %d: %w", events[index].Seq, err)
		}
		return payload.Policy, true, nil
	}
	return "", false, nil
}

func SetApprovalPolicy(session *Session, policy ApprovalPolicy) (Event, error) {
	if session == nil {
		return Event{}, errors.New("harness: approval policy requires a session")
	}
	if err := validateApprovalPolicy(policy); err != nil {
		return Event{}, err
	}
	return session.Append("approval/policy", struct {
		Policy ApprovalPolicy `json:"policy"`
	}{policy})
}

func (b *ApprovalBroker) EffectivePolicy(session *Session) (ApprovalPolicy, error) {
	if b == nil || session == nil {
		return "", errors.New("harness: approval policy requires broker and session")
	}
	if override, found, err := ApprovalPolicyOverride(session.Events()); err != nil {
		return "", err
	} else if found {
		return override, nil
	}
	if b.policy == "" {
		return ApprovalAsk, nil
	}
	return b.policy, nil
}

func (b *ApprovalBroker) SetPolicy(agent *Agent, policy ApprovalPolicy) error {
	if b == nil || agent == nil {
		return errors.New("harness: approval policy requires broker and agent")
	}
	if err := validateApprovalPolicy(policy); err != nil {
		return err
	}
	previous, err := b.EffectivePolicy(agent.Session())
	if err != nil || previous == policy {
		return err
	}
	if _, err := SetApprovalPolicy(agent.Session(), policy); err != nil {
		return err
	}
	return agent.Inject(Message{Role: RoleUser, Content: []ContentBlock{{
		Type: BlockText,
		Text: fmt.Sprintf("The approval policy changed from %q to %q (changed by the user).", previous, policy),
	}}})
}

func approvalPolicyPrompt(policy ApprovalPolicy, session *Session) string {
	if policy == ApprovalNever {
		return approvalNeverPrompt
	}
	if session != nil {
		if mode, found, err := PermissionModeOverride(session.Events()); err == nil && found {
			if extra := permissionModePrompt(mode); extra != "" {
				return extra
			}
		}
	}
	return approvalAskPrompt
}

// SessionHasFullAccess reports whether the Session's last durable sandbox fact
// is danger-full-access. A Session without the fact is not full access.
func SessionHasFullAccess(events []Event) bool {
	for index := len(events) - 1; index >= 0; index-- {
		if events[index].Type != SandboxModeEvent {
			continue
		}
		var payload struct {
			Mode string `json:"mode"`
		}
		return json.Unmarshal(events[index].Data, &payload) == nil && payload.Mode == SandboxFullAccessMode
	}
	return false
}

func (b *ApprovalBroker) Register(run *point.Run, handler ApprovalHandler) (point.Dispose, error) {
	if run == nil || !run.Active() {
		return nil, point.ErrInactiveRun
	}
	if handler == nil {
		return nil, errors.New("harness: approval handler is nil")
	}
	b.mu.Lock()
	b.nextID++
	entry := approvalEntry{id: b.nextID, scope: run.Scope, handler: handler}
	b.entries = append(b.entries, entry)
	b.mu.Unlock()
	var once sync.Once
	dispose := point.Dispose(func(context.Context) error {
		once.Do(func() {
			b.mu.Lock()
			for index, current := range b.entries {
				if current.id == entry.id {
					b.entries = append(b.entries[:index], b.entries[index+1:]...)
					break
				}
			}
			b.mu.Unlock()
		})
		return nil
	})
	if err := run.Defer("approval-handler", dispose); err != nil {
		_ = dispose(context.Background())
		return nil, err
	}
	return dispose, nil
}

func (b *ApprovalBroker) Request(ctx context.Context, request ApprovalRequest) (ApprovalOutcome, error) {
	if request.Agent == nil || request.ToolName == "" {
		return ApprovalUnavailable, errors.New("harness: approval requires agent and tool name")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if !hasOpenApprovalTurn(request.Agent.Session().Events()) {
		return ApprovalUnavailable, errors.New("harness: approval request must be enclosed by an open turn")
	}
	policy, err := b.EffectivePolicy(request.Agent.Session())
	if err != nil {
		return ApprovalUnavailable, err
	}
	// Approval identities survive broker replacement and Session resume. A
	// process-local counter would reuse old audit/UI request IDs after restart.
	request.ID = "approval-" + rand.Text()
	if _, err := request.Agent.Session().Append("approval/asked", request); err != nil {
		return ApprovalUnavailable, err
	}
	outcome := b.resolve(ctx, request, policy)
	_, appendErr := request.Agent.Session().Append("approval/decided", struct {
		ID      string          `json:"id"`
		Outcome ApprovalOutcome `json:"outcome"`
	}{request.ID, outcome})
	return outcome, appendErr
}

// Decide answers an ask whose approval/asked audit event another authority
// sharing this Session already appended under request.ID — the DSH plugin
// bridge, whose plugins call their own approval service. It applies the same
// policy and answerer waterfall as Request, so interactive answerers can match
// the visible prompt by ID, but appends nothing: the caller owns the audit pair.
func (b *ApprovalBroker) Decide(ctx context.Context, request ApprovalRequest) (ApprovalOutcome, error) {
	if request.Agent == nil || request.ToolName == "" || request.ID == "" {
		return ApprovalUnavailable, errors.New("harness: delegated approval requires agent, tool name and id")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	policy, err := b.EffectivePolicy(request.Agent.Session())
	if err != nil {
		return ApprovalUnavailable, err
	}
	return b.resolve(ctx, request, policy), nil
}

func (b *ApprovalBroker) resolve(ctx context.Context, request ApprovalRequest, policy ApprovalPolicy) ApprovalOutcome {
	if ctx.Err() != nil {
		return ApprovalCancelled
	}
	// ApprovalNever stays fail-closed, including when a session mode would
	// otherwise allow the call. A recorded mode decides the rest.
	if outcome, ask := permissionDecision(policy, request); !ask {
		return outcome
	}
	return b.decide(ctx, request, b.visibleHandlers(request.Agent.Scope()))
}

func hasOpenApprovalTurn(events []Event) bool {
	for index := len(events) - 1; index >= 0; index-- {
		switch events[index].Type {
		case "turn/start":
			return true
		case "turn/end":
			return false
		}
	}
	return false
}

func (b *ApprovalBroker) decide(ctx context.Context, request ApprovalRequest, handlers []ApprovalHandler) ApprovalOutcome {
	answer := make(chan ApprovalOutcome, 1)
	go func() {
		outcome := ApprovalUnavailable
		for _, handler := range handlers {
			candidate, failed := callApprovalHandler(ctx, handler, request)
			if failed {
				outcome = ApprovalUnavailable
				break
			}
			if candidate != ApprovalUnavailable {
				outcome = candidate
				break
			}
		}
		answer <- outcome
	}()
	select {
	case <-ctx.Done():
		return ApprovalCancelled
	case outcome := <-answer:
		return outcome
	}
}

func callApprovalHandler(ctx context.Context, handler ApprovalHandler, request ApprovalRequest) (outcome ApprovalOutcome, failed bool) {
	defer func() {
		if recover() != nil {
			outcome = ApprovalUnavailable
			failed = true
		}
	}()
	outcome, err := handler(ctx, request)
	if err != nil {
		return ApprovalUnavailable, true
	}
	switch outcome {
	case ApprovalAllowedOnce, ApprovalRejected, ApprovalCancelled, ApprovalUnavailable:
		return outcome, false
	default:
		return ApprovalUnavailable, true
	}
}

func (b *ApprovalBroker) visibleHandlers(scope *point.Scope) []ApprovalHandler {
	b.mu.RLock()
	entries := append([]approvalEntry(nil), b.entries...)
	b.mu.RUnlock()
	visible := entries[:0]
	for _, entry := range entries {
		if entry.scope.Contains(scope) {
			visible = append(visible, entry)
		}
	}
	sort.SliceStable(visible, func(i, j int) bool {
		if visible[i].scope != visible[j].scope {
			if visible[i].scope.Contains(visible[j].scope) {
				return false
			}
			if visible[j].scope.Contains(visible[i].scope) {
				return true
			}
		}
		return visible[i].id < visible[j].id
	})
	result := make([]ApprovalHandler, len(visible))
	for index, entry := range visible {
		result[index] = entry.handler
	}
	return result
}
