package harness

import (
	"context"
	"sync"
	"sync/atomic"

	point "github.com/phodal/pero/harness/go/runtime"
)

type AgentStatus string

const (
	AgentIdle    AgentStatus = "idle"
	AgentRunning AgentStatus = "running"
	// DefaultMaxParallelToolCalls matches DSH's bounded rolling-pool default.
	DefaultMaxParallelToolCalls = 10
)

type TurnSource string

const (
	TurnSourceHuman  TurnSource = "human"
	TurnSourcePlugin TurnSource = "plugin"
)

type TurnResult struct {
	Turn   int
	Reason FinishKind
	Usage  *TokenUsage
}

// TurnOutcome is the asynchronous settlement of one accepted Agent turn.
type TurnOutcome struct {
	Turn TurnResult
	Err  error
}

type promptRequest struct {
	ctx          context.Context
	message      Message
	result       chan promptResult
	admitted     chan struct{}
	userAuthored bool
	owned        *OwnedFollowupReceipt
	durableWake  bool
	inboxEpoch   uint64
}

type promptResult struct {
	turn TurnResult
	err  error
}

type injectedMessage struct {
	message  Message
	admitted chan struct{}
}

type StepInput struct {
	Agent               *Agent
	Turn                int
	Step                int
	Messages            []Message
	Continue            bool
	Reject              bool
	StartsRequestSeries bool
}

type TurnStoppingInput struct {
	Agent *Agent
	Turn  int
}

type AgentErrorInput struct {
	Agent *Agent
	Turn  int
	Step  int
	Error error
}

type AgentStatusInput struct {
	Agent  *Agent
	Status AgentStatus
}

type RequestErrorInput struct {
	Agent    *Agent
	Turn     int
	Step     int
	Provider string
	Model    string
	Failure  ProviderFailure
	Attempt  int
	Retry    bool
	// RetryPolicy is the provider policy captured with the failed adapter
	// generation. Recovery must not re-read a replacement route's policy.
	RetryPolicy *ResolvedRetryPolicy
}

type InboxInsertedInput struct {
	Agent        *Agent
	Message      Message
	Target       InboxTarget
	UserAuthored bool
}

type InboxClaimedInput struct {
	Agent        *Agent
	Message      Message
	Turn         int
	UserAuthored bool
}

type InboxDiscardedInput struct {
	Agent        *Agent
	Message      Message
	UserAuthored bool
}

type AgentHooks struct {
	// MainRequest observes only an admitted, prepared loop dispatch after its
	// durable header fold. Its receipt is valid only during this notification.
	MainRequest  *point.Signal[MainRequestInput]
	PreStep      *point.Pipeline[StepInput]
	Request      *point.Pipeline[GenerateRequest]
	RequestError *point.Pipeline[RequestErrorInput]
	TurnStopping *point.Signal[TurnStoppingInput]
	// Error is a contained lifecycle notification. The loop never replaces the
	// original turn failure with a listener failure.
	Error     *point.Signal[AgentErrorInput]
	Status    *point.Signal[AgentStatusInput]
	Published *point.Signal[*Agent]
	// Activated fires only after the exact Agent is visible in AgentManager.
	// Published remains the pre-publication composition hook.
	Activated *point.Signal[*Agent]
	// Retiring fires after the whole runtime subtree loses admission authority,
	// before blocking worker/job drains. Provider cleanup must use exact owners.
	Retiring *point.Signal[*Agent]
	// Deactivated fires after the exact Agent is no longer visible and its
	// scoped runtime has stopped. Lifecycle services use it to release leases
	// that may have been acquired during Activated.
	Deactivated    *point.Signal[*Agent]
	InboxInserted  *point.Signal[InboxInsertedInput]
	InboxClaimed   *point.Signal[InboxClaimedInput]
	InboxDiscarded *point.Signal[InboxDiscardedInput]
}

func NewAgentHooks(runtime *point.Runtime) *AgentHooks {
	return &AgentHooks{
		MainRequest:    point.NewSignal[MainRequestInput](runtime, "harness/agent/main-request"),
		PreStep:        point.NewPipeline[StepInput](runtime, "harness/agent/pre-step"),
		Request:        point.NewPipeline[GenerateRequest](runtime, "harness/agent/request"),
		RequestError:   point.NewPipeline[RequestErrorInput](runtime, "harness/agent/request-error"),
		TurnStopping:   point.NewSignal[TurnStoppingInput](runtime, "harness/agent/turn-stopping"),
		Error:          point.NewSignal[AgentErrorInput](runtime, "harness/agent/error"),
		Status:         point.NewSignal[AgentStatusInput](runtime, "harness/agent/status"),
		Published:      point.NewSignal[*Agent](runtime, "harness/agent/published"),
		Activated:      point.NewSignal[*Agent](runtime, "harness/agent/activated"),
		Retiring:       point.NewSignal[*Agent](runtime, "harness/agent/retiring"),
		Deactivated:    point.NewSignal[*Agent](runtime, "harness/agent/deactivated"),
		InboxInserted:  point.NewSignal[InboxInsertedInput](runtime, "harness/agent/inbox-inserted"),
		InboxClaimed:   point.NewSignal[InboxClaimedInput](runtime, "harness/agent/inbox-claimed"),
		InboxDiscarded: point.NewSignal[InboxDiscardedInput](runtime, "harness/agent/inbox-discarded"),
	}
}

type Agent struct {
	subagentReceipts atomic.Int64

	// retired is a one-way dispatch fence, separate from worker readiness.
	// Prepared/configuring Agents may compose tools before publication; a
	// removed generation must never regain authority through an old pointer.
	retirement           atomic.Pointer[agentRetirement] // exact receipt may be queried through any manager
	retired              atomic.Bool
	resourcePreparations atomic.Int64
	// Exact child-provider obligations may reenter parent retirement after preparation.
	id                   SessionID
	session              *Session
	scope                *point.Scope
	adapter              Adapter
	modelInfo            ModelInfoResolver
	attachments          AttachmentStore
	prompts              *PromptRegistry
	tools                *ToolRegistry
	hooks                *AgentHooks
	provider             string
	model                string
	modelSelection       func(*Session) AgentModelSelection
	initialAgentPreset   string
	reasoningEffort      ReasoningEffort
	maxSteps             int
	maxTokens            int
	maxParallelToolCalls int
	agentLoopConfig      *AgentLoopConfig
	delegated            bool
	parent               *Agent
	freshSession         bool
	externalTurn         ExternalTurn
	externalConfigs      ExternalConfigs
	externalSelectConfig ExternalSelectConfig
	externalModels       ExternalModels
	externalSelectModel  ExternalSelectModel

	compactionMu sync.RWMutex
	compaction   CompactionEngine
	prunerMu     sync.RWMutex
	pruner       *ToolResultPruner

	inbox chan promptRequest
	done  chan struct{}
	ready chan struct{}

	operationPhase      atomic.Pointer[agentRetirementPhase]
	operationRoot       context.Context    // guarded by operationMu
	operationRootCancel context.CancelFunc // guarded by operationMu
	operationMu         sync.Mutex
	operations          map[*agentOperation]struct{} // guarded by operationMu
	operationWG         sync.WaitGroup
	operationCount      atomic.Int64
	admissionMu         sync.Mutex
	activityMu          sync.Mutex
	pendingPrompts      atomic.Int64
	injectMu            sync.Mutex
	injected            []injectedMessage
	acceptingInject     bool
	durableInbox        *DurableInbox
	durableWake         bool
	inboxEpoch          uint64
	followupAdmissionMu sync.Mutex
	followupAdmissions  map[string]*followupAdmissionReceipt
	pendingRequests     map[string]promptRequest
	inboxClaimMu        sync.Mutex
	inboxAdmissions     map[string]chan struct{} // guarded by inboxClaimMu

	mu             sync.Mutex
	status         AgentStatus
	maintenance    bool
	idle           chan struct{}
	turnCancel     context.CancelCauseFunc
	activityCtx    context.Context
	workerCtx      context.Context
	turn           int
	turnHuman      bool
	inboxParked    bool   // DSH interrupt driver latch, guarded by mu
	inboxInterrupt uint64 // changes before a synchronous interrupt observer returns
	// requestHeaderLogged is process-lifetime state, matching DSH's distinction
	// between the first request of a new loop and the first request after Resume.
	// Only the single Agent worker reads or writes it.
	requestHeaderLogged      bool
	requestSurfaceGeneration uint64
}

// DefaultMaxSteps leaves enough room for repository-scale coding turns while
// retaining a finite circuit breaker for callers that do not choose a budget.
const DefaultMaxSteps = 512

func newAgent(session *Session, scope *point.Scope, adapter Adapter, modelInfo ModelInfoResolver, attachments AttachmentStore, prompts *PromptRegistry, tools *ToolRegistry, hooks *AgentHooks, provider, model string, reasoningEffort ReasoningEffort, maxSteps, maxTokens, maxParallelToolCalls int, delegated bool, parent *Agent, freshSession bool) *Agent {
	idle := make(chan struct{})
	close(idle)
	if maxSteps <= 0 {
		maxSteps = DefaultMaxSteps
	}
	return &Agent{
		id: session.Header().ID, session: session, scope: scope,
		adapter: adapter, modelInfo: modelInfo, attachments: attachments, prompts: prompts, tools: tools, hooks: hooks,
		provider: provider, model: model, reasoningEffort: reasoningEffort, maxSteps: maxSteps, maxTokens: maxTokens,
		maxParallelToolCalls: maxParallelToolCalls, delegated: delegated, parent: parent, freshSession: freshSession,
		inbox: make(chan promptRequest, 32), done: make(chan struct{}), ready: make(chan struct{}), status: AgentIdle, idle: idle,
		pendingRequests:          make(map[string]promptRequest),
		requestSurfaceGeneration: session.SurfaceContentGeneration(),
	}
}

func (a *Agent) ID() SessionID                    { return a.id }
func (a *Agent) Session() *Session                { return a.session }
func (a *Agent) Scope() *point.Scope              { return a.scope }
func (a *Agent) Provider() string                 { return a.ModelSelection().Provider }
func (a *Agent) Model() string                    { return a.ModelSelection().Model }
func (a *Agent) ReasoningEffort() ReasoningEffort { return a.ModelSelection().ReasoningEffort }
func (a *Agent) MaxSteps() int                    { return a.maxSteps }
func (a *Agent) MaxTokens() int                   { return a.maxTokens }
func (a *Agent) MaxParallelToolCalls() int {
	if a.maxParallelToolCalls > 0 {
		return a.maxParallelToolCalls
	}
	return a.agentLoopConfig.MaxParallelToolCalls()
}
func (a *Agent) Status() AgentStatus { a.mu.Lock(); defer a.mu.Unlock(); return a.status }
func (a *Agent) Delegated() bool     { return a.delegated }
func (a *Agent) Parent() *Agent      { return a.parent }

// FreshSession reports whether this Agent owns a Session created for this
// activation rather than a previously persisted Session mounted by Resume.
func (a *Agent) FreshSession() bool { return a.freshSession }

// TurnUserAuthored reports whether the currently running turn was admitted by
// Prompt rather than by a plugin Followup. It is process-local driver state,
// not a durable claim about historical messages.
func (a *Agent) TurnUserAuthored() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.status == AgentRunning && a.turnHuman
}

// CurrentTurn returns the process-local turn currently executing, or the last
// completed turn while idle. Hook bridges use it only to correlate log-only
// events with the Session's open turn.
func (a *Agent) CurrentTurn() int {
	if a == nil {
		return 0
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.turn
}
