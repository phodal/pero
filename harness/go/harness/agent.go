package harness

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"

	point "github.com/phodal/pero/harness/go/runtime"
	harnesstool "github.com/phodal/pero/harness/go/tool"
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
	RejectReason        string
	StartsRequestSeries bool
}

type TurnStoppingInput struct {
	Agent     *Agent
	Turn      int
	Step      int
	Finish    FinishKind
	Concluded bool
	// CanContinue reports loop eligibility; it never grants new tool authority.
	// Feedback listeners must not inject work when cancellation, finish reason
	// or the remaining step budget prevents another request in this turn.
	CanContinue bool
}

type CompactionHookInput struct {
	Agent   *Agent
	Trigger string
	Reject  bool
	Reason  string
	// Messages contains synthetic user context to append durably after a
	// successful compaction, before the next provider request is assembled.
	Messages           []Message
	CustomInstructions string
	CompactSummary     string
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

// ToolBatchCall is one resolved call in an assistant tool batch.
type ToolBatchCall struct {
	Name       string          `json:"tool_name"`
	ToolCallID ToolCallID      `json:"tool_use_id"`
	Input      json.RawMessage `json:"tool_input"`
	Response   json.RawMessage `json:"tool_response"`
}

// ToolBatchInput is the resolved assistant tool batch. Listeners may add one
// notice and stop the loop before the next model call.
type ToolBatchInput struct {
	Agent   *Agent
	Calls   []ToolBatchCall
	Context string
	Reason  string
	Stop    bool
}

type AssistantReadyInput struct {
	Agent      *Agent
	Turn, Step int
	Message    Message
}

type AgentHooks struct {
	// AssistantReady runs outside the session notification lane, before the
	// completed message is committed. Presentation effects may append events.
	AssistantReady *point.Signal[AssistantReadyInput]
	// MainRequest observes only an admitted, prepared loop dispatch after its
	// durable header fold. Its receipt is valid only during this notification.
	MainRequest     *point.Signal[MainRequestInput]
	PreStep         *point.Pipeline[StepInput]
	Request         *point.Pipeline[GenerateRequest]
	RequestError    *point.Pipeline[RequestErrorInput]
	TurnStopping    *point.Signal[TurnStoppingInput]
	PreCompact      *point.Pipeline[CompactionHookInput]
	PostCompact     *point.Pipeline[CompactionHookInput]
	PreModelSwitch  *point.Pipeline[ModelSwitchInput]
	PostModelSwitch *point.Pipeline[ModelSwitchInput]
	// PostToolBatch runs once after every tool call in one assistant batch.
	PostToolBatch *point.Pipeline[ToolBatchInput]
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
	Deactivated *point.Signal[*Agent]
	// BeforeInboxResume stages recoverable notices after persistence/controller readiness.
	BeforeInboxResume *point.Signal[*Agent]
	InboxInserted     *point.Signal[InboxInsertedInput]
	InboxClaimed      *point.Signal[InboxClaimedInput]
	InboxDiscarded    *point.Signal[InboxDiscardedInput]
}

func NewAgentHooks(runtime *point.Runtime) *AgentHooks {
	return &AgentHooks{
		AssistantReady:    point.NewSignal[AssistantReadyInput](runtime, "harness/agent/assistant-ready"),
		MainRequest:       point.NewSignal[MainRequestInput](runtime, "harness/agent/main-request"),
		PreStep:           point.NewPipeline[StepInput](runtime, "harness/agent/pre-step"),
		Request:           point.NewPipeline[GenerateRequest](runtime, "harness/agent/request"),
		RequestError:      point.NewPipeline[RequestErrorInput](runtime, "harness/agent/request-error"),
		TurnStopping:      point.NewSignal[TurnStoppingInput](runtime, "harness/agent/turn-stopping"),
		PreCompact:        point.NewPipeline[CompactionHookInput](runtime, "harness/agent/pre-compact"),
		PostCompact:       point.NewPipeline[CompactionHookInput](runtime, "harness/agent/post-compact"),
		PreModelSwitch:    point.NewPipeline[ModelSwitchInput](runtime, "harness/agent/pre-model-switch"),
		PostModelSwitch:   point.NewPipeline[ModelSwitchInput](runtime, "harness/agent/post-model-switch"),
		PostToolBatch:     point.NewPipeline[ToolBatchInput](runtime, "harness/agent/post-tool-batch"),
		Error:             point.NewSignal[AgentErrorInput](runtime, "harness/agent/error"),
		Status:            point.NewSignal[AgentStatusInput](runtime, "harness/agent/status"),
		Published:         point.NewSignal[*Agent](runtime, "harness/agent/published"),
		Activated:         point.NewSignal[*Agent](runtime, "harness/agent/activated"),
		Retiring:          point.NewSignal[*Agent](runtime, "harness/agent/retiring"),
		Deactivated:       point.NewSignal[*Agent](runtime, "harness/agent/deactivated"),
		BeforeInboxResume: point.NewSignal[*Agent](runtime, "harness/agent/before-inbox-resume"),
		InboxInserted:     point.NewSignal[InboxInsertedInput](runtime, "harness/agent/inbox-inserted"),
		InboxClaimed:      point.NewSignal[InboxClaimedInput](runtime, "harness/agent/inbox-claimed"),
		InboxDiscarded:    point.NewSignal[InboxDiscardedInput](runtime, "harness/agent/inbox-discarded"),
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
	mcpAccess            *MCPAccess
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
	readReuse            harnesstool.ReadReuse
	toolProgress         toolProgress // ordered continuation only; reset by turn
	delegated            bool
	parent               *Agent
	freshSession         bool
	titleStarted         atomic.Bool
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

// UnlimitedMaxSteps explicitly delegates turn termination to cancellation,
// provider budgets and the model. Zero continues to select DefaultMaxSteps.
const UnlimitedMaxSteps = -1

func newAgent(session *Session, scope *point.Scope, adapter Adapter, modelInfo ModelInfoResolver, attachments AttachmentStore, prompts *PromptRegistry, tools *ToolRegistry, hooks *AgentHooks, provider, model string, reasoningEffort ReasoningEffort, maxSteps, maxTokens, maxParallelToolCalls int, delegated bool, parent *Agent, freshSession bool) *Agent {
	idle := make(chan struct{})
	close(idle)
	if maxSteps <= 0 && maxSteps != UnlimitedMaxSteps {
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
