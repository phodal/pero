package harness

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	point "github.com/phodal/pero/harness/go/runtime"
)

type SubagentStatus string

const (
	SubagentRunning   SubagentStatus = "running"
	SubagentCompleted SubagentStatus = "completed"
	SubagentAborted   SubagentStatus = "aborted"
	SubagentFailed    SubagentStatus = "failed"
)

type SubagentActivity string

const (
	SubagentActivityRunning SubagentActivity = "running"
	SubagentActivityIdle    SubagentActivity = "idle"
	SubagentActivityReady   SubagentActivity = "ready"
)

type SubagentCatalogKind string

const (
	SubagentCatalogChild      SubagentCatalogKind = "child"
	SubagentCatalogDiagnostic SubagentCatalogKind = "diagnostic"
)

type SubagentCatalogReason string

const (
	SubagentCatalogCorrupt     SubagentCatalogReason = "corrupt"
	SubagentCatalogUnsupported SubagentCatalogReason = "unsupported"
	SubagentCatalogUnavailable SubagentCatalogReason = "unavailable"
)

// SubagentCatalogEntry is a provider-neutral durable/live projection. Parent
// and depth are retained internally even for direct-child presentation so a
// descendants walk never needs to parse model-hidden descriptor content.
type SubagentCatalogEntry struct {
	Kind      SubagentCatalogKind    `json:"kind"`
	ID        SessionID              `json:"id"`
	Parent    SessionID              `json:"parent,omitempty"`
	Provider  string                 `json:"provider,omitempty"`
	Label     string                 `json:"label,omitempty"`
	Mode      SubagentDescriptorMode `json:"mode,omitempty"`
	Activity  SubagentActivity       `json:"activity,omitempty"`
	Reason    SubagentCatalogReason  `json:"reason,omitempty"`
	Depth     int                    `json:"depth,omitempty"`
	StartedAt time.Time              `json:"startedAt,omitempty"`
}

type SubagentCapabilities struct {
	AgentPreset  bool `json:"agentPreset"`
	AgentOptions bool `json:"agentOptions"`
	OutputSchema bool `json:"outputSchema"`
	Persona      bool `json:"persona"`
	ToolFilter   bool `json:"toolFilter"`
	DepthLimit   bool `json:"depthLimit"`
}

// SubagentAgentRouteDefaults is detached provider-owned model routing data.
// Providers whose route derives from the parent omit it.
type SubagentAgentRouteDefaults struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
}

// SubagentProviderRouteDefaults optionally exposes static child routing. The
// registry snapshots the returned value; callers never acquire the provider's
// mutable storage through a descriptor.
type SubagentProviderRouteDefaults interface {
	AgentRouteDefaults() *SubagentAgentRouteDefaults
}

// SubagentProviderDescriptor is the immutable, behavior-bearing portion of a
// provider that can safely cross a process boundary. Provider implementations
// and their scope ownership remain inside the Go runtime.
type SubagentProviderDescriptor struct {
	AgentRouteDefaults    *SubagentAgentRouteDefaults `json:"agentRouteDefaults,omitempty"`
	Name                  string                      `json:"name"`
	Capabilities          SubagentCapabilities        `json:"capabilities"`
	InheritsParentContext bool                        `json:"inheritsParentContext"`
	Continuable           bool                        `json:"continuable"`
}

type SubagentRequest struct {
	// CWD captures an orchestrator-owned execution directory. Empty inherits the
	// parent current directory at admission; it never changes the sandbox root.
	CWD string
	// ChildID optionally reserves the provider-owned Session identity before
	// preparation. Durable orchestrators use it to journal provisioning before
	// any child side effect; providers must return this exact identity.
	ChildID SessionID
	// SuppressParentSettlement keeps provider-generic completion notices out of
	// orchestrators that own their own durable mailbox/status protocol.
	SuppressParentSettlement bool
	Parent                   *Agent
	Label                    string
	Prompt                   string
	// PromptContent preserves the full DSH content-block request. Prompt remains
	// the compatibility text form for string-only providers; in-process
	// providers consume PromptContent when present.
	PromptContent   []ContentBlock
	Provider        string
	Model           string
	ReasoningEffort ReasoningEffort
	MaxSteps        int
	MaxTokens       int
	AgentPreset     string
	Persona         string
	ToolFilter      *ToolRestriction
	OutputSchema    json.RawMessage
	MaxDepth        int
	// ProviderManagedDepth represents an omitted cap, not an arbitrary large number.
	ProviderManagedDepth bool
	// Depth is provider-resolved by the registry and cannot be widened by a
	// caller. Session-backed providers persist it in the child header.
	Depth             int
	initialMessageID  string
	returnGuidance    func(context.Context, *Agent, SessionID) (string, error)
	activation        *subagentActivationState
	dshModelSelection bool
}

// WithDSHModelSelection requests the source-owned selected-model constraint at
// the provider's existing metadata-validation stage. This process-local bit is
// not a DTO/persistence field and does not authorize any operation or callback.
func (r SubagentRequest) WithDSHModelSelection() SubagentRequest {
	r.dshModelSelection = true
	return r
}

// DSHModelSelection reports the explicit process-local selection constraint.
func (r SubagentRequest) DSHModelSelection() bool { return r.dshModelSelection }

// ManagedActivation reports the lifecycle selected by the registry. Callers
// cannot set the private activation state through a request DTO.
func (r SubagentRequest) ManagedActivation() bool { return r.activation != nil }

// ManagedParentDelivery identifies a current background local activation whose
// continuation must survive retirement of its in-memory Agent.
func (r SubagentRequest) ManagedParentDelivery() bool {
	return r.activation != nil && r.activation.delivery == "parent"
}

var ErrSubagentPersistenceUnavailable = &subagentActivationError{"continuable subagents require session persistence", "PERSISTENCE_UNAVAILABLE"}
var ErrSubagentDuplicateChild = &subagentActivationError{"subagent child identity already exists", "DUPLICATE_CHILD"}

// PromptBlocks returns a detached canonical prompt, preferring the structured
// content supplied by a DSH-compatible caller over the legacy text field.
func (r SubagentRequest) PromptBlocks() []ContentBlock {
	if len(r.PromptContent) > 0 {
		return cloneContentBlocks(r.PromptContent)
	}
	if r.Prompt == "" {
		return nil
	}
	return []ContentBlock{{Type: BlockText, Text: r.Prompt}}
}

// InitialPromptMessage returns the registry-minted message that a continuable
// provider must admit as its first FIFO turn. The identity remains hidden from
// callers until admission succeeds, matching DSH's continuation receipt.
func (r SubagentRequest) InitialPromptMessage() Message {
	message := Message{ID: r.initialMessageID, Role: RoleUser, Content: r.PromptBlocks()}
	if r.ManagedActivation() {
		message.Source = json.RawMessage(`{"kind":"user"}`)
	}
	return message
}

// WithReturnGuidance supplies a process-local Host adapter for inspecting the
// exact child's standard adjacent-Agent messaging tool. It is not a request DTO
// field or persisted configuration and cannot alter authority or message IDs.
func (r SubagentRequest) WithReturnGuidance(probe func(context.Context, *Agent, SessionID) (string, error)) SubagentRequest {
	r.returnGuidance = probe
	return r
}

// InitialActivationMessage resolves current parent-delivery guidance only after
// the registry owns the prepared exact child. Providers must call this from
// Begin, so an inspection failure is covered by their registered cleanup lease.
func (r SubagentRequest) InitialActivationMessage(ctx context.Context, child *Agent) (Message, error) {
	message := r.InitialPromptMessage()
	if r.activation == nil || r.activation.delivery == "caller" || r.returnGuidance == nil {
		return message, nil
	}
	if child == nil || r.Parent == nil || child.Parent() != r.Parent || !child.Delegated() {
		return Message{}, errors.New("harness: return guidance requires the exact delegated child")
	}
	guidance, err := r.returnGuidance(ctx, child, r.Parent.ID())
	if err != nil {
		return Message{}, err
	}
	if guidance != "" {
		message.Content = append(message.Content, ContentBlock{Type: BlockText, Text: guidance})
	}
	return message, nil
}

func (r SubagentRequest) promptLabelText() string {
	if r.Prompt != "" {
		return r.Prompt
	}
	var text strings.Builder
	for _, block := range r.PromptContent {
		if block.Type == BlockText {
			text.WriteString(block.Text)
		}
	}
	return text.String()
}

func (r SubagentRequest) hasPromptContent() bool {
	for _, block := range r.PromptBlocks() {
		if block.Type == BlockImage || (block.Type == BlockText && strings.TrimSpace(block.Text) != "") {
			return true
		}
	}
	return false
}

type SubagentResult struct {
	ChildID    SessionID
	Status     SubagentStatus
	Reason     FinishKind
	Output     []ContentBlock
	Structured any
	Diagnostic string
}

// SubagentReport is an optional, non-terminal progress message from a child.
// Reports are advisory: the terminal SubagentResult remains authoritative.
type SubagentReport struct {
	ChildID SessionID      `json:"childId"`
	Content []ContentBlock `json:"content"`
	At      time.Time      `json:"at"`
}

type SubagentProviderRun struct {
	// Child binds an in-process run to its exact runtime generation. External providers leave it nil.
	Child   *Agent
	ChildID SessionID
	Result  <-chan SubagentResult
	Reports <-chan SubagentReport
	Begin   func()
	Cancel  func(error)
	Dispose func(context.Context) error
}

type SubagentProvider interface {
	Name() string
	Capabilities() SubagentCapabilities
	InheritsParentContext() bool
	Prepare(context.Context, SubagentRequest) (SubagentProviderRun, error)
}

// SubagentContinuationProvider is the optional in-process capability used by
// stable-id, multi-turn children. Method presence is the capability; callers
// fail loudly when a provider only supports one-shot runs.
type SubagentContinuationProvider interface {
	PrepareContinuable(context.Context, SubagentRequest) (SubagentContinuationProviderRun, error)
}

// SubagentManagedContinuationProvider explicitly opts into activation-owned
// lifecycle and must not install legacy report/FIFO-only composition.
type SubagentManagedContinuationProvider interface {
	PrepareActivation(context.Context, SubagentRequest) (SubagentContinuationProviderRun, error)
}

// SubagentManagedResumer reconstructs a local child for current activation
// control; there is deliberately no fallback to legacy PrepareResume.
type SubagentManagedResumer interface {
	PrepareManagedResume(context.Context, *Agent, SessionID) (SubagentContinuationProviderRun, SubagentSnapshot, error)
}

var ErrSubagentResumeUnavailable = errors.New("harness: subagent cold resume unavailable")

// SubagentContinuationResumer is implemented by session-backed providers.
// The registry serializes cold activation and publishes the returned child
// before admitting the caller's message.
type SubagentContinuationResumer interface {
	PrepareResume(context.Context, *Agent, SessionID) (SubagentContinuationProviderRun, SubagentSnapshot, error)
}

// SubagentCatalogProvider projects session-backed children without making
// them resident. Each damaged child is represented independently.
type SubagentCatalogProvider interface {
	ListPersisted(context.Context) ([]SubagentCatalogEntry, error)
}

type SubagentContinuationProviderRun struct {
	ChildID          SessionID
	Child            *Agent
	InitialMessageID string
	Begin            func(context.Context) (<-chan TurnOutcome, error)
	Submit           func(context.Context, Message) (<-chan TurnOutcome, error)
	Dispose          func(context.Context) error
	// CaptureStructured returns the committed activation-local object, if any.
	CaptureStructured func() any
	// StructuredAdmission is mandatory for managed OutputSchema providers.
	// Construct a fresh exact-child gate and use it for staging and initial input.
	StructuredAdmission *SubagentStructuredAdmission
}

// SubagentContinuationReceipt identifies both the durable child and the
// initial message accepted by its FIFO inbox.
type SubagentContinuationReceipt struct {
	ChildID   SessionID `json:"childId"`
	MessageID string    `json:"messageId"`
}

type SubagentRun struct {
	ID      SessionID
	Result  <-chan SubagentResult
	Reports <-chan SubagentReport
	Cancel  func(error)
	Dispose func(context.Context) error
	// Wait joins exact cleanup after Dispose; call outside synchronous observers.
	Wait func(context.Context) error
}

// SubagentLifecycle identifies one execution epoch. Continuable children use
// a new RunID for each admitted turn while retaining the same child ID.
type SubagentLifecycle struct {
	RunID      string
	Provider   string
	ID         SessionID
	Parent     *Agent
	Child      *Agent
	Local      bool
	StopReason SubagentStatus
	Managed    bool
	// Facade identifies the optional profile-local runtime service generation.
	Facade *SubagentFacade `json:"-"`
	Result *SubagentResult
}

type SubagentSnapshot struct {
	ID          SessionID      `json:"id"`
	Parent      SessionID      `json:"parent"`
	Provider    string         `json:"provider"`
	Label       string         `json:"label,omitempty"`
	Status      SubagentStatus `json:"status"`
	Depth       int            `json:"depth"`
	StartedAt   time.Time      `json:"startedAt"`
	FinishedAt  time.Time      `json:"finishedAt,omitempty"`
	Continuable bool           `json:"continuable,omitempty"`
	// SuppressParentSettlement is persisted by session-backed providers but is
	// not a model-facing capability. Durable orchestrators use it to preserve
	// ownership of their mailbox protocol after cold resume.
	SuppressParentSettlement bool `json:"-"`
}

type subagentProviderEntry struct {
	id       uint64
	scope    *point.Scope
	provider SubagentProvider
}

type subagentRecord struct {
	admissionMu              sync.Mutex
	snapshot                 SubagentSnapshot
	run                      SubagentRun
	parent                   *Agent
	child                    *Agent
	submit                   func(context.Context, Message) (<-chan TurnOutcome, error)
	dispose                  func(context.Context) error
	disposal                 *subagentDisposalClaim
	activation               *subagentActivationState
	activationOwner          *subagentActivationState
	captureStructured        func() any
	structuredAdmission      *SubagentStructuredAdmission
	requiresStructured       bool
	epoch                    uint64
	suppressParentSettlement bool
	runID                    string
}

type subagentProviderWatcher struct {
	mu         sync.Mutex
	id         uint64
	scope      *point.Scope
	callback   func([]SubagentProviderDescriptor)
	active     bool
	delivering bool
	pending    bool
}

func (w *subagentProviderWatcher) deliver(registry *SubagentRegistry) {
	registry.mu.RLock()
	w.mu.Lock()
	if registry.disposed || registry.watchers[w.id] != w || !w.active {
		w.mu.Unlock()
		registry.mu.RUnlock()
		return
	}
	if w.delivering {
		w.pending = true
		w.mu.Unlock()
		registry.mu.RUnlock()
		return
	}
	w.delivering = true
	w.mu.Unlock()
	registry.mu.RUnlock()
	w.drain(registry)
}

// drain owns one serial delivery claim, never a lock across callbacks. A
// callback may unsubscribe or notify reentrantly; pending snapshots coalesce.
func (w *subagentProviderWatcher) drain(registry *SubagentRegistry) {
	defer func() {
		if recovered := recover(); recovered != nil {
			w.mu.Lock()
			w.delivering, w.pending = false, false
			w.mu.Unlock()
			panic(recovered)
		}
	}()
	for {
		registry.mu.RLock()
		w.mu.Lock()
		if registry.disposed || registry.watchers[w.id] != w || !w.active {
			w.delivering, w.pending = false, false
			w.mu.Unlock()
			registry.mu.RUnlock()
			return
		}
		registry.callbacks.Add(1)
		registry.callbackWG.Add(1)
		w.mu.Unlock()
		registry.mu.RUnlock()
		// This callback is now admitted. Unsubscribe revokes future admission;
		// it deliberately does not join a callback already executing.
		func() {
			defer registry.endSubagentCallback()
			w.callback(registry.ProviderDescriptors(w.scope))
		}()
		w.mu.Lock()
		if !w.pending || !w.active {
			w.delivering, w.pending = false, false
			w.mu.Unlock()
			return
		}
		w.pending = false
		w.mu.Unlock()
	}
}

type SubagentRegistry struct {
	presetValidator atomic.Pointer[subagentPresetValidator]
	runtime         *point.Runtime
	resumeMu        sync.Mutex

	mu                  sync.RWMutex
	nextID              uint64
	providers           []subagentProviderEntry
	watchers            map[uint64]*subagentProviderWatcher
	records             map[SessionID]*subagentRecord
	activationParents   map[*Agent]*subagentActivationState
	activationPools     map[*Agent]*subagentActivationPool
	config              SubagentRuntimeConfig
	parentPreparations  map[*Agent]map[*subagentPreparation]struct{}
	preparationReceipts map[*Agent]map[*subagentPreparation]struct{}
	ownershipChanged    chan struct{}
	closedParents       map[*Agent]struct{}
	archiveChecks       map[uint64]func(SessionID) bool
	parentRecords       map[*Agent]map[*subagentRecord]struct{}
	agents              *AgentManager
	disposed            bool
	callbacks           atomic.Int64
	activationReceipts  atomic.Int64
	callbackWG          sync.WaitGroup
	callbackCleanupErr  error
	disposeDone         chan struct{}
	disposeErr          error
	Started             *point.Signal[SubagentLifecycle]
	Ended               *point.Signal[SubagentLifecycle]
}

func (r *SubagentRegistry) attachAgents(agents *AgentManager) {
	r.mu.Lock()
	r.agents = agents
	r.mu.Unlock()
}

func NewSubagentRegistry(runtime *point.Runtime) *SubagentRegistry {
	if runtime == nil {
		panic("harness: subagent registry runtime must not be nil")
	}
	return &SubagentRegistry{
		runtime: runtime, config: DefaultSubagentRuntimeConfig(), records: make(map[SessionID]*subagentRecord), watchers: make(map[uint64]*subagentProviderWatcher),
		Started: point.NewSignal[SubagentLifecycle](runtime, "harness/subagent/start"),
		Ended:   point.NewSignal[SubagentLifecycle](runtime, "harness/subagent/end"),
	}
}

// subagentPresetValidator is an effect-owned bridge to the Host's existing
// preset authority, not another preset store or composition implementation.
type subagentPresetValidator struct {
	run      *point.Run
	validate func(context.Context, string) error
}

func (r *SubagentRegistry) RegisterAgentPresetValidator(run *point.Run, validate func(context.Context, string) error) (point.Dispose, error) {
	if r == nil || run == nil || !run.Active() || run.Scope == nil || run.Scope.Runtime() != r.runtime || validate == nil {
		return nil, errors.New("harness: agent preset validator requires an active Host run")
	}
	entry := &subagentPresetValidator{run: run, validate: validate}
	r.mu.Lock()
	if r.disposed {
		r.mu.Unlock()
		return nil, errors.New("harness: subagent registry is disposed")
	}
	if !r.presetValidator.CompareAndSwap(nil, entry) {
		r.mu.Unlock()
		return nil, errors.New("harness: agent preset validator already registered")
	}
	r.mu.Unlock()
	dispose := point.Dispose(func(context.Context) error {
		if r.presetValidator.CompareAndSwap(entry, nil) {
			r.notifyProviderWatchers()
		}
		return nil
	})
	if err := run.Defer("subagents:agent-preset-validator", dispose); err != nil {
		_ = dispose(context.Background())
		return nil, err
	}
	r.notifyProviderWatchers()
	return dispose, nil
}

func (r *SubagentRegistry) SupportsAgentPresets() bool {
	if r == nil {
		return false
	}
	entry := r.presetValidator.Load()
	return entry != nil && entry.run.Active()
}

// PrepareAgentPreset validates against one Host effect and returns a final
// admission check. Call it again after Agent activation, rolling back if the
// composition authority was withdrawn or replaced while creating the child.
func (r *SubagentRegistry) PrepareAgentPreset(ctx context.Context, id string) (func() error, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if r == nil {
		return nil, errors.New("harness: independent agent preset selection is unavailable")
	}
	entry := r.presetValidator.Load()
	if entry == nil || !entry.run.Active() {
		return nil, errors.New("harness: independent agent preset selection is unavailable")
	}
	if id == "" || strings.TrimSpace(id) != id {
		return nil, errors.New("harness: agent preset id must not be blank or surrounded by whitespace")
	}
	check := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if r.presetValidator.Load() != entry || !entry.run.Active() {
			return errors.New("harness: agent preset validator was withdrawn")
		}
		return nil
	}
	if err := check(); err != nil {
		return nil, err
	}
	if err := entry.validate(ctx, id); err != nil {
		return nil, err
	}
	if err := check(); err != nil {
		return nil, err
	}
	return check, nil
}

func (r *SubagentRegistry) ValidateAgentPreset(ctx context.Context, id string) error {
	_, err := r.PrepareAgentPreset(ctx, id)
	return err
}
