package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	point "github.com/phodal/pero/harness/go/runtime"
)

type Tool struct {
	registrationID             uint64
	catalogID                  uint64
	dshTodoNumberCompatibility bool
	nativeFinalContent         *nativeFinalContent
	nativeFinalTransfer        *sourceFinalContentTransfer
	nativeFinalOrigin          *point.Scope
	nativeFinalSelection       *finalContentSelection
	Schema                     ToolSchema
	ExecutionMode              ExecutionMode
	// Timeout is the cooperative execution budget enforced by the Base tool
	// runtime. A budgeted body receives a derived context and must settle after
	// cancellation; the registry never abandons a running tool goroutine.
	// Zero leaves the caller context unchanged.
	Timeout time.Duration
	// IsConcurrencySafe classifies one already-parsed, schema-valid call. It is
	// fail-closed: absence, panic, cancellation, or a false result is serial.
	// The callback is runtime-only and never appears in model-facing schemas.
	IsConcurrencySafe func(context.Context, ToolRequest) bool
	// ArgumentErrorMode is a trusted, runtime-only diagnostic opt-in.
	// Ordinary input validation remains authoritative for every mode.
	ArgumentErrorMode       ToolArgumentErrorMode `json:"-"`
	argumentErrorProjection *dshArgumentErrorProjection
	// ErrorOutputMode opts into final error-policy synchronization only.
	// It is trusted registration data, never model-visible input or metadata.
	ErrorOutputMode ToolErrorOutputMode `json:"-"`
	// RequiresApproval asks the nearest approval channel before execution.
	// With no channel or grant, execution fails closed as a tool result.
	RequiresApproval bool
	// AlwaysAskApproval is trusted registration policy: even auto-review must
	// consult the existing approval channel for each call. Never/read-only still deny.
	AlwaysAskApproval bool `json:"-"`
	// ExecuteRequest receives the exact Agent/call identity for tools whose
	// behavior depends on the session workspace or other scoped facts. Execute
	// remains the compact context-free form; exactly one executor is required.
	ExecuteRequest func(context.Context, ToolRequest) (ToolResult, error)
	Execute        func(context.Context, json.RawMessage) (ToolResult, error)
	ApprovalReason func(ToolRequest) string
	// ApprovalDescriptor is trusted host registration, never a schema field or
	// MCP annotation. It runs on validated arguments for this exact generation.
	ApprovalDescriptor func(context.Context, ToolRequest) (*NativeApprovalDescriptor, error)
	// ObserveResult runs after post-execute and spill projection, but before
	// finalization cleanup can fail. Only the returned outcome is final. This
	// callback observes effect-local results; it cannot transform visible output.
	ObserveResult  func(ToolOutcome)
	inputValidator *jsonschema.Resolved
	// RenderOutput is an optional pure projection for a schema-declared
	// canonical Value. It may change only Content/Meta, never control fields.
	// It is required if post-execute policy replaces the canonical value.
	RenderOutput func(context.Context, ToolRequest, json.RawMessage) (ToolOutputProjection, error)
	// SettleOutput consumes an exact source-policy receipt after Go After.
	// It may perform the source-owned spill effect, but can change only
	// presentation. Only BindDSHOutputProjection-enrolled proxies may set it.
	// Any unconsumed receipt must be discarded by the adapter's Finalized hook.
	SettleOutput func(context.Context, ToolRequest, ToolResult) (ToolOutputProjection, error)
	// NotifyTerminal publishes an already settled, detached observation after
	// every native finalizer and cap. Only an exact source-enrolled proxy may
	// install it. It cannot alter acceptance or trigger a policy retry. Its
	// callback runs after the native profile operation has been released.
	NotifyTerminal func(context.Context, ToolOutcome)
	// PreserveInitialOutputPair lets a trusted authoritative adapter retain its
	// already-settled initial Content/Meta. Value validation is never skipped;
	// later value-only policy rewrites still require RenderOutput. Runtime only.
	PreserveInitialOutputPair bool
	outputValidator           *jsonschema.Resolved
	owner                     *toolOwner
	dispatchCapture           *toolDispatchCapture
	capturedAgent             *Agent
	sourceProjectionCapture   *toolDispatchCapture
	// profileLease is trusted native composition metadata, never model input.
	// Uncommitted profile candidates are hidden from ordinary/base discovery.
	profileLease *ProfileOwnerLease
}

// ToolCatalogProvider contributes an Agent-dependent tool view. It is paired
// with one ordinary generation: the provider may replace that generation's
// global proxy definitions, but not unrelated tools at the same Point scope.
type ToolCatalogProvider struct {
	// PrepareFinalContent is a narrow opt-in preparation path. Returning false
	// must not resolve a definition; ordinary legacy resolution runs later.
	// Returning true pins this exact native-capable definition before policy;
	// Agent/name/argument retargeting is rejected and Resolve is not called.
	PrepareFinalContent func(context.Context, *Agent, string) (Tool, bool, error)
	Schemas             func(context.Context, *Agent) ([]ToolSchema, error)
	Resolve             func(context.Context, *Agent, string) (Tool, bool, error)
	// Authoritative makes this provider the complete model-facing view for an
	// Agent. The provider can use Bind to retain an unpresented view of every
	// ordinary Go/dynamic capability and project those capabilities through an
	// external presentation runtime such as DSH native/PTC/both.
	Authoritative bool
	// Exclusive rejects overlapping authoritative presenters at registration.
	// Use it when a view cannot compose another presenter's declarations.
	Exclusive bool
	deferred  *DeferredTools
	// Bind receives a capability view that excludes this provider and every
	// authoritative presentation provider. It is invoked synchronously during
	// registration before the provider can serve requests.
	Bind func(ToolCatalogBase)
	// Release drops provider-side resources materialized for this exact Agent.
	// It is optional for stateless providers and runs after the Go Agent worker
	// has quiesced, in reverse catalog registration order.
	Release func(context.Context, *Agent) error
}

// ToolCatalogBase is the unpresented capability view owned by one catalog
// provider. It lets an authoritative presenter include and dispatch ordinary
// Go and independent dynamic tools without recursively invoking itself.
type ToolCatalogBase struct {
	catalogIdentity *toolCatalogIdentity
	registry        *ToolRegistry
	scope           *point.Scope
	generation      string
}

func (b ToolCatalogBase) Schemas(ctx context.Context, agent *Agent) ([]ToolSchema, error) {
	if b.registry == nil {
		return nil, errors.New("harness: tool catalog base is not initialized")
	}
	return b.registry.schemasForAgentBase(ctx, agent, b.scope, b.generation)
}

func (b ToolCatalogBase) Resolve(ctx context.Context, agent *Agent, name string) (Tool, bool, error) {
	if b.registry == nil {
		return Tool{}, false, errors.New("harness: tool catalog base is not initialized")
	}
	tool, found, err := b.registry.resolveForAgentBase(ctx, agent, name, b.scope, b.generation)
	if err != nil || !found {
		return tool, found, err
	}
	tool.dispatchCapture = nil
	tool.dispatchCapture = &toolDispatchCapture{base: b, agent: agent, tool: cloneTool(tool)}
	return tool, true, nil
}

// toolDispatchCapture retains the immutable selected callback/contract pair.
// Public Tool fields may be copied or changed without modifying this receipt.
type toolDispatchCapture struct {
	base  ToolCatalogBase
	agent *Agent
	tool  Tool
}

// BindCapturedOwner retains a resolved base tool's owner/lease for settlement
// by a trusted authoritative proxy. It does not wrap callbacks or transfer
// ownership. The bound proxy is valid only for the capture's exact Agent.
func (b ToolCatalogBase) BindCapturedOwner(proxy Tool, captured Tool) (Tool, error) {
	capture := captured.dispatchCapture
	if b.registry == nil || capture == nil || capture.base != b || capture.agent == nil ||
		capture.tool.Schema.Name != proxy.Schema.Name || captured.Schema.Name != proxy.Schema.Name {
		return Tool{}, errors.New("harness: proxy owner binding requires this base's exact tool capture")
	}
	var err error
	proxy, err = bindCapturedDSHTodoNumbers(proxy, capture.tool)
	if err != nil {
		return Tool{}, err
	}
	proxy, err = bindCapturedArgumentErrors(proxy, capture.tool)
	if err != nil {
		return Tool{}, err
	}
	// Only the immutable private capture may transfer this output policy mode.
	if capture.tool.ErrorOutputMode != ErrorOutputLegacy && capture.tool.owner != nil {
		if err := capture.tool.owner.admissionError(); err != nil {
			return Tool{}, err
		}
	}
	proxy.ErrorOutputMode = capture.tool.ErrorOutputMode
	proxy.owner, proxy.profileLease = capture.tool.owner, capture.tool.profileLease
	proxy.capturedAgent = capture.agent
	proxy.nativeFinalContent = capture.tool.nativeFinalContent
	return proxy, nil
}

// Execute dispatches one presenter-owned nested call through the ordinary Go
// validation, approval, and pre/post pipelines while bypassing only the outer
// model-facing presentation. This is the equivalent of DSH run_code's
// parent-token sub-dispatch rather than a second direct model call.
func (b ToolCatalogBase) Execute(ctx context.Context, request ToolRequest) (ToolOutcome, error) {
	if b.registry == nil {
		return ToolOutcome{}, errors.New("harness: tool catalog base is not initialized")
	}
	return b.registry.executeWithResolver(ctx, request, true, func(callCtx context.Context, agent *Agent, name string) (Tool, bool, error) {
		if mode := requestedDSHProjection(ctx); mode != nil && mode.capture.base == b && mode.capture.agent == agent && mode.capture.tool.Schema.Name == name {
			return cloneTool(mode.capture.tool), true, nil
		}
		return b.registry.resolveForAgentBase(callCtx, agent, name, b.scope, b.generation)
	}, func(callCtx context.Context, agent *Agent, name string) (Tool, bool, error) {
		if mode := requestedDSHProjection(ctx); mode != nil && mode.capture.base == b && mode.capture.agent == agent && mode.capture.tool.Schema.Name == name {
			if mode.capture.tool.nativeFinalContent != nil {
				return cloneTool(mode.capture.tool), true, nil
			}
			return Tool{}, false, nil
		}
		return b.registry.prepareFinalContentView(callCtx, agent, name, b.scope, b.generation, true)
	})
}

// Dispatch executes only the already-admitted body of one base tool. External
// authoritative presenters use it after the outer ToolRegistry execution has
// completed Go validation, approval, and pre-execute policy. The outer
// execution remains responsible for Go post-execute, spill, and observers.
func (b ToolCatalogBase) Dispatch(ctx context.Context, request ToolRequest) (ToolResult, error) {
	if request.Agent == nil {
		return ToolResult{}, errors.New("harness: base tool dispatch requires an agent")
	}
	if b.registry == nil {
		return ToolResult{}, errors.New("harness: tool catalog base is not initialized")
	}
	if request.Agent.retired.Load() {
		return retiredToolResult(ToolAbortedBeforeDispatch, nil), nil
	}
	executionToken, admitted := toolExecutionFromContext(ctx)
	if !admitted || executionToken != request.executionToken || !hasToolBodyAdmission(ctx, request) {
		return ToolResult{}, errors.New("harness: base tool dispatch requires the matching admitted execution")
	}
	if request.Agent != nil && request.Agent.retired.Load() {
		return retiredToolResult(ToolAbortedBeforeDispatch, nil), nil
	}
	tool, ok, err := b.Resolve(ctx, request.Agent, request.Name)
	if err != nil {
		return ToolResult{}, err
	}
	if !ok {
		return ToolResult{}, fmt.Errorf("harness: unknown base tool %q", request.Name)
	}
	return b.DispatchCaptured(ctx, request, tool)
}

// DispatchCaptured executes the exact callback/contract selected by this
// base's Resolve for the same Agent. It requires the already admitted outer
// execution token and never resolves a replacement registration by name.
func (b ToolCatalogBase) DispatchCaptured(ctx context.Context, request ToolRequest, captured Tool) (ToolResult, error) {
	if b.registry == nil || request.Agent == nil {
		return ToolResult{}, errors.New("harness: captured base dispatch requires an initialized base and agent")
	}
	if request.Agent.retired.Load() {
		return retiredToolResult(ToolAbortedBeforeDispatch, nil), nil
	}
	token, admitted := toolExecutionFromContext(ctx)
	if !admitted || token != request.executionToken || !hasToolBodyAdmission(ctx, request) {
		return ToolResult{}, errors.New("harness: captured base dispatch requires the matching admitted execution")
	}
	capture := captured.dispatchCapture
	if capture == nil || capture.base != b || capture.agent != request.Agent ||
		capture.tool.Schema.Name != request.Name || captured.Schema.Name != request.Name || capture.tool.inputValidator == nil {
		return ToolResult{}, errors.New("harness: captured base dispatch does not match this base, agent, or tool")
	}
	outerRequest := request
	tool := capture.tool
	if tool.owner != nil && (tool.owner.registry != b.registry || !tool.owner.run.Scope.Contains(request.Agent.Scope())) {
		return ToolResult{}, errors.New("harness: captured base owner does not admit this agent")
	}
	if request.Agent.retired.Load() {
		return retiredToolResult(ToolAbortedBeforeDispatch, nil), nil
	}
	request.Arguments = append(json.RawMessage(nil), request.Arguments...)
	if err := validateRegisteredToolArguments(tool, request.Arguments); err != nil {
		if result, ok := projectRegisteredToolArgumentFailure(tool, request.Arguments, err); ok {
			return result, nil
		}
		return ToolResult{}, fmt.Errorf("harness: invalid captured tool arguments for %s: %w", request.Name, err)
	}
	mode := requestedDSHProjection(ctx)
	if mode == nil {
		mode, _ = ctx.Value(dshOutputProjectionKey{}).(*dshOutputProjectionMode)
	}
	var projectionErr error
	ctx, request.dshOutputProjection, projectionErr = admitDSHProjection(ctx, request, tool, mode)
	if projectionErr != nil {
		return ToolResult{}, projectionErr
	}
	request.owner, request.profileLease = tool.owner, tool.profileLease
	if tool.nativeFinalContent != nil && !request.finalContent.matches(request, tool.nativeFinalContent) {
		return ToolResult{}, errors.New("harness: captured dispatch lacks its exact native final-content receipt")
	}
	request.output = outputContract(tool)
	bodyCtx, retireBody, releaseParent, admissionErr := deriveToolBodyAdmission(ctx, outerRequest, request)
	if admissionErr != nil {
		return ToolResult{}, admissionErr
	}
	// Keep the parent's join ticket through native normalization and renderer
	// callbacks, even though body authority itself expires before projection.
	defer releaseParent()
	var result ToolResult
	var err error
	// The outer admitted proxy may have a different owner. Only this validated
	// capture can derive native body authority, and that authority expires
	// before native output projection or the outer post-execute callbacks.
	func() {
		defer retireBody()
		if tool.ExecuteRequest != nil {
			result, err = tool.ExecuteRequest(bodyCtx, request)
		} else {
			result, err = tool.Execute(bodyCtx, request.Arguments)
		}
	}()
	if err != nil {
		if request.output == nil {
			return result, err
		}
		result = toolBodyErrorResult(request, result, err)
	}
	return normalizeToolOutput(bodyCtx, request, result), nil
}

// ToolInterruptError ends the current tool batch and turn after recording a
// rejected result. It is distinct from a recoverable tool execution failure.
type ToolInterruptError struct{ Reason string }

func (err *ToolInterruptError) Error() string { return "tool execution interrupted: " + err.Reason }

type ToolRequest struct {
	finalContent        *toolFinalContentReceipt
	dshOutputProjection bool
	rootCallID          ToolCallID
	Agent               *Agent
	CallID              ToolCallID
	Name                string
	Arguments           json.RawMessage
	// DenyReason and RequestApproval are runtime-only pre-execute decisions.
	// Pipelines may set them but model-provided input cannot forge them.
	DenyReason string
	// EndTurn records that a denied call should finish the turn. Failed tool
	// results otherwise stay available for the model to correct.
	EndTurn         bool
	RequestApproval bool
	ApprovalReason  string
	// Preapproved is set by trusted runtime policy for this exact invocation,
	// never decoded from model arguments. Base approval policy still applies.
	Preapproved bool `json:"-"`

	executionToken       ToolExecutionToken
	parentExecutionToken ToolExecutionToken
	owner                *toolOwner
	profileLease         *ProfileOwnerLease
	output               *toolOutputContract
}

// ToolExecutionToken is a registry-owned, operation-local execution identity.
// Its value is deliberately opaque: callers can retain and compare tokens but
// only ToolRegistry can mint one. Unlike model-supplied call IDs, it remains
// collision-free across nested presenter dispatches.
type ToolExecutionToken struct{ id uint64 }

const (
	ToolTimeout               = "TOOL_TIMEOUT"
	ToolAborted               = "ABORTED"
	ToolAbortedBeforeDispatch = "ABORTED_BEFORE_DISPATCH"
)

var errToolTimeoutDeadline = errors.New("harness: tool timeout deadline")

func (token ToolExecutionToken) Valid() bool { return token.id != 0 }

// RootCallID is the registry-owned root tool-call identity for job provenance.
// Empty means this native invocation had no attributable model call ID.
func (request ToolRequest) RootCallID() ToolCallID { return request.rootCallID }

// ExecutionToken returns the identity of this exact tool execution.
// UsesDSHOutputProjection reports the trusted mode of the admitted request.
func (request ToolRequest) UsesDSHOutputProjection() bool { return request.dshOutputProjection }

func (request ToolRequest) ExecutionToken() ToolExecutionToken { return request.executionToken }

// ParentExecutionToken identifies the presenter/tool execution that dispatched
// this request. Root model-facing calls have no parent token.
func (request ToolRequest) ParentExecutionToken() (ToolExecutionToken, bool) {
	return request.parentExecutionToken, request.parentExecutionToken.Valid()
}

type ToolOutcome struct {
	Request ToolRequest
	Result  ToolResult
}

type toolEntry struct {
	id         uint64
	tool       Tool
	scope      *point.Scope
	generation string
	owner      *toolOwner
}

type toolCatalogEntry struct {
	id         uint64
	provider   ToolCatalogProvider
	scope      *point.Scope
	generation string
}

type toolRestrictionEntry struct {
	id    uint64
	scope *point.Scope
	allow map[string]struct{}
	deny  map[string]struct{}
	admit func(*Agent, string) bool
	agent *Agent
}

// ToolGuard is a post-waterfall execution check. Nil abstains; an error denies
// dispatch. Unlike middleware, a guard cannot override an earlier denial.
type ToolGuard func(context.Context, ToolRequest) error

type ToolRegistry struct {
	runtime        *point.Runtime
	mu             sync.RWMutex
	nextID         uint64
	entries        map[string][]toolEntry
	catalogs       []toolCatalogEntry
	catalogPending map[toolCatalogIdentityKey]*toolCatalogIdentity
	deferredEpoch  string
	restrictions   []toolRestrictionEntry
	approval       *ApprovalBroker
	spills         *SpillRegistry
	nextExecution  atomic.Uint64
	guards         *point.Signal[ToolRequest]
	closed         atomic.Bool
	callbacks      atomic.Int64
	ownerMu        sync.Mutex
	activeOwners   map[*toolOwner]int

	Before *point.Pipeline[ToolRequest]
	After  *point.Pipeline[ToolOutcome]
	// Results observes transformed and spill-projected outcomes before final
	// cleanup. It cannot change output. A later Finalized failure can still
	// invalidate success, so only the returned outcome is the final receipt.
	Results *point.Signal[ToolOutcome]
	// Finalized is cleanup-only and runs once after every execution exit, even
	// when policy, projection, observers, cancellation or the body failed.
	// Listeners release token-scoped resources; they must not commit results.
	// Failures are joined without skipping later cleanup listeners.
	Finalized *point.Signal[ToolOutcome]
}

// Guard registers an effect-owned, scope-visible check after the complete
// Before waterfall and approval, immediately before dispatch. The first denial
// is final: no later guard or pre-execute middleware can turn it into permission.
// Callbacks run without registry locks and receive their own argument snapshot.
// Callers that own per-Agent state must also compare the exact Agent pointer;
// scope visibility alone does not transfer that state's authority to children.
func (r *ToolRegistry) Guard(run *point.Run, guard ToolGuard) (point.Dispose, error) {
	if r == nil || r.guards == nil || guard == nil {
		return nil, errors.New("harness: tool guard requires a registry and callback")
	}
	var active atomic.Bool
	active.Store(true)
	dispose, err := r.guards.On(run, func(ctx context.Context, request ToolRequest) error {
		if !active.Load() || !run.Active() || request.Agent == nil || !run.Scope.Contains(request.Agent.Scope()) {
			return nil
		}
		request.Arguments = append(json.RawMessage(nil), request.Arguments...)
		return guard(ctx, request)
	})
	if err != nil {
		return nil, err
	}
	return func(ctx context.Context) error {
		// A previously captured signal snapshot must not revive a released
		// registration. Owner disposal is independently fenced by Run.Active.
		active.Store(false)
		return dispose(ctx)
	}, nil
}

// Restrict registers one Agent-scope mask over tools inherited from ancestor
// scopes. It validates names against the current inherited catalog before
// publication and snapshots the filter so later caller mutation is harmless.
func (r *ToolRegistry) Restrict(ctx context.Context, run *point.Run, agent *Agent, restriction ToolRestriction) (point.Dispose, error) {
	if run == nil || !run.Active() {
		return nil, point.ErrInactiveRun
	}
	if agent == nil || agent.Scope() != run.Scope {
		return nil, errors.New("harness: tool restriction requires the exact scoped agent run")
	}
	if restriction.Allow == nil && restriction.Deny == nil {
		return nil, errors.New("harness: empty tool restriction is a no-op")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	schemas, err := r.SchemasForAgent(ctx, agent)
	if err != nil {
		return nil, err
	}
	known := make(map[string]struct{}, len(schemas))
	for _, schema := range schemas {
		known[schema.Name] = struct{}{}
	}
	r.mu.RLock()
	for name, entries := range r.entries {
		if entry, ok := nearestToolEntry(entries, run.Scope); ok {
			if entry.scope == run.Scope {
				delete(known, name)
			} else {
				// Validate against the underlying inherited catalog, not the
				// currently filtered view. A second restriction may legally name
				// a capability hidden by the first; restrictions then intersect.
				known[name] = struct{}{}
			}
		}
	}
	r.mu.RUnlock()
	allow, err := compileToolRestrictionNames("allow", restriction.Allow, known)
	if err != nil {
		return nil, err
	}
	deny, err := compileToolRestrictionNames("deny", restriction.Deny, known)
	if err != nil {
		return nil, err
	}

	return r.registerRestriction(run, toolRestrictionEntry{scope: run.Scope, allow: allow, deny: deny})
}

// RestrictWhen installs a trusted, synchronous policy in the existing catalog
// and dispatch restriction owner. It applies to all definitions in this scope,
// including newly registered tools. The predicate must not call this registry.
func (r *ToolRegistry) RestrictWhen(run *point.Run, admit func(*Agent, string) bool) (point.Dispose, error) {
	if run == nil || !run.Active() {
		return nil, point.ErrInactiveRun
	}
	if admit == nil {
		return nil, errors.New("harness: dynamic restriction requires a predicate")
	}
	return r.registerRestriction(run, toolRestrictionEntry{scope: run.Scope, admit: admit})
}

func (r *ToolRegistry) registerRestriction(run *point.Run, entry toolRestrictionEntry) (point.Dispose, error) {
	r.mu.Lock()
	r.nextID++
	entry.id = r.nextID
	r.restrictions = append(r.restrictions, entry)
	r.mu.Unlock()
	var once sync.Once
	dispose := point.Dispose(func(context.Context) error {
		once.Do(func() {
			r.mu.Lock()
			for index := range r.restrictions {
				if r.restrictions[index].id == entry.id {
					r.restrictions = append(r.restrictions[:index], r.restrictions[index+1:]...)
					break
				}
			}
			r.mu.Unlock()
		})
		return nil
	})
	if err := run.Defer("tool-restriction", dispose); err != nil {
		_ = dispose(context.Background())
		return nil, err
	}
	return dispose, nil
}

func compileToolRestrictionNames(field string, names []string, known map[string]struct{}) (map[string]struct{}, error) {
	if names == nil {
		return nil, nil
	}
	compiled := make(map[string]struct{}, len(names))
	unknown := make([]string, 0)
	for _, name := range names {
		if name == "" {
			return nil, fmt.Errorf("harness: tool restriction %s contains an empty name", field)
		}
		compiled[name] = struct{}{}
		if _, ok := known[name]; !ok {
			unknown = append(unknown, name)
		}
	}
	if len(unknown) != 0 {
		knownNames := make([]string, 0, len(known))
		for name := range known {
			knownNames = append(knownNames, name)
		}
		sort.Strings(knownNames)
		return nil, fmt.Errorf("harness: tool restriction names unknown inherited tools %q; known inherited tools: %v", unknown, knownNames)
	}
	return compiled, nil
}

func NewToolRegistry(runtime *point.Runtime, approvals ...*ApprovalBroker) *ToolRegistry {
	var approval *ApprovalBroker
	if len(approvals) > 0 {
		approval = approvals[0]
	}
	return newToolRegistryWithSpills(runtime, approval, nil)
}

func newToolRegistryWithSpills(runtime *point.Runtime, approval *ApprovalBroker, spills *SpillRegistry) *ToolRegistry {
	registry := &ToolRegistry{
		runtime:   runtime,
		entries:   make(map[string][]toolEntry),
		guards:    point.NewSignal[ToolRequest](runtime, "harness/tools/guard"),
		Before:    point.NewPipeline[ToolRequest](runtime, "harness/tools/pre-execute"),
		After:     point.NewPipeline[ToolOutcome](runtime, "harness/tools/post-execute"),
		Results:   point.NewSignal[ToolOutcome](runtime, "harness/tools/result"),
		Finalized: point.NewSignal[ToolOutcome](runtime, "harness/tools/finalized"),
		approval:  approval,
		spills:    spills,
	}
	return registry
}

func visibleToolRestrictions(entries []toolRestrictionEntry, agent *Agent) []toolRestrictionEntry {
	result := make([]toolRestrictionEntry, 0, len(entries))
	for _, entry := range entries {
		if entry.scope.Contains(agent.Scope()) {
			entry.agent = agent
			result = append(result, entry)
		}
	}
	return result
}

func toolRestrictionsAdmit(restrictions []toolRestrictionEntry, name string, origin *point.Scope) bool {
	for _, restriction := range restrictions {
		if restriction.admit != nil && !restriction.admit(restriction.agent, name) {
			return false
		}
		// A restriction masks only definitions inherited from an ancestor of
		// its own scope. Definitions contributed at or below that scope are the
		// child's own response/control surface and remain exempt.
		if origin == nil || origin == restriction.scope || !origin.Contains(restriction.scope) {
			continue
		}
		if restriction.allow != nil {
			if _, ok := restriction.allow[name]; !ok {
				return false
			}
		}
		if _, denied := restriction.deny[name]; denied {
			return false
		}
	}
	return true
}
