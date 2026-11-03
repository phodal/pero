package harness

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"

	harnesssession "github.com/phodal/pero/harness/go/session"
)

type interruptedStreamBlock struct {
	typeName BlockType
	text     string
}

// interruptedStreamAssembly retains only the safe, model-visible prefix that
// DSH commits when cancellation interrupts an active provider stream. Tool
// calls are deliberately observed but never finalized: a partial call cannot
// be dispatched or paired with a result.
type interruptedStreamAssembly struct {
	blocks         []interruptedStreamBlock
	reasoningIndex int
	textIndex      int
	usage          *TokenUsage
}

func newInterruptedStreamAssembly() *interruptedStreamAssembly {
	return &interruptedStreamAssembly{reasoningIndex: -1, textIndex: -1}
}

func (a *interruptedStreamAssembly) consume(chunk StreamChunk) {
	for _, block := range chunk.Content {
		switch block.Type {
		case BlockReasoning:
			if a.reasoningIndex < 0 {
				a.reasoningIndex = len(a.blocks)
				a.blocks = append(a.blocks, interruptedStreamBlock{typeName: BlockReasoning})
			}
			a.blocks[a.reasoningIndex].text += block.Text
		case BlockText:
			if a.textIndex < 0 {
				a.textIndex = len(a.blocks)
				a.blocks = append(a.blocks, interruptedStreamBlock{typeName: BlockText})
			}
			a.blocks[a.textIndex].text += block.Text
		}
	}
	if chunk.Usage != nil {
		usage := *chunk.Usage
		a.usage = &usage
	}
}

func (a *interruptedStreamAssembly) content() []ContentBlock {
	content := make([]ContentBlock, 0, len(a.blocks))
	for _, block := range a.blocks {
		if strings.TrimSpace(block.text) == "" {
			continue
		}
		content = append(content, ContentBlock{Type: block.typeName, Text: block.text})
	}
	return content
}

func (a *Agent) runTurn(ctx context.Context, initial []Message, claimNextTurn bool, closeClaimBoundary func([]Message)) (result TurnResult, err error) {
	a.injectMu.Lock()
	a.acceptingInject = a.externalTurn == nil
	a.injectMu.Unlock()
	defer func() {
		a.injectMu.Lock()
		a.acceptingInject = false
		a.injectMu.Unlock()
	}()
	a.mu.Lock()
	a.turn++
	turn := a.turn
	source := TurnSourcePlugin
	if a.turnHuman {
		source = TurnSourceHuman
	}
	a.mu.Unlock()
	result.Turn = turn
	if _, err = a.session.Append("turn/start", struct {
		Turn   int        `json:"turn"`
		Source TurnSource `json:"source"`
	}{turn, source}); err != nil {
		return result, err
	}
	reason := FinishError
	maxTokens := false
	openStep := 0
	currentStep := 0
	defer func() {
		if openStep != 0 {
			_, closeErr := a.session.Append("step/end", struct{ Turn, Step int }{turn, openStep})
			if err == nil && closeErr != nil {
				err = closeErr
			}
		}
		if err != nil {
			reason = finishFromError(err)
			if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
				// Match DSH's notification boundary: report the original failure
				// without allowing observer failures to replace it.
				_ = a.hooks.Error.EmitAll(ctx, AgentErrorInput{Agent: a, Turn: turn, Step: currentStep, Error: err})
			}
		}
		if err == nil && maxTokens {
			reason = FinishMaxTokens
		}
		result.Reason = reason
		payload := struct {
			Turn   int        `json:"turn"`
			Reason FinishKind `json:"reason"`
			Error  string     `json:"error,omitempty"`
		}{Turn: turn, Reason: reason}
		if err != nil {
			payload.Error = err.Error()
		}
		if _, appendErr := a.session.Append("turn/end", payload); err == nil && appendErr != nil {
			err = appendErr
		}
	}()

	pending := cloneMessages(initial)
	uncommitted := cloneMessages(pending)
	// Only a direct request-context error proves that cancellation alone
	// stopped a checkpoint. errors.Is would also match a joined storage error;
	// retrying that failure could block the settlement needed to recover it.
	// Conservatively leave wrapped/combined errors to explicit recovery.
	checkpointFailed := false
	defer func() {
		if err != nil {
			err = a.preserveUserAdmission(ctx, &uncommitted, err, !checkpointFailed)
		}
	}()
	for _, message := range pending {
		a.publishInboxClaimed(ctx, message, turn, source == TurnSourceHuman)
	}
	if claimNextTurn {
		claimed, claimErr := a.claimDurableInbox(ctx, InboxNextTurn, turn, closeClaimBoundary)
		pending = append(claimed, pending...)
		uncommitted = cloneMessages(pending)
		if claimErr != nil {
			checkpointFailed = ctx.Err() == nil || claimErr != ctx.Err()
			return result, claimErr
		}
	} else if closeClaimBoundary != nil {
		closeClaimBoundary(nil)
	}
	continuation := false
	if a.externalTurn != nil {
		if _, err = a.session.Append("step/start", struct{ Turn, Step int }{turn, 1}); err != nil {
			return result, err
		}
		openStep, currentStep = 1, 1
		uncommitted = nil
		externalMessages := cloneMessages(pending)
		if admissionErr := a.commitUserAdmissionContext(ctx, &pending); admissionErr != nil {
			// Join-wrapped cancel/revoke must stay a clean stop, not a turn failure.
			if errors.Is(admissionErr, errFollowupAdmissionDropped) {
				reason = FinishStop
				return result, nil
			}
			return result, admissionErr
		}
		reason, err = a.externalTurn(ctx, a, turn, externalMessages)
		return result, err
	}
	for step := 1; step <= a.maxSteps; step++ {
		// DSH's checkpoint policy makes the preceding durable prefix a hard
		// boundary before any pre-step plugin can construct the next request.
		if err := a.checkpoint(ctx); err != nil {
			// A known storage failure must settle before any explicit recovery.
			// Only request cancellation, rather than failed storage, permits the
			// independent non-cancelled recovery flush below.
			checkpointFailed = ctx.Err() == nil || err != ctx.Err()
			return result, err
		}
		a.inboxClaimMu.Lock()
		claimed, claimErr := a.claimDurableInbox(ctx, InboxNextStep, turn, a.inboxClaimUnlock)
		pending = append(claimed, pending...)
		uncommitted = cloneMessages(pending)
		if claimErr != nil {
			checkpointFailed = ctx.Err() == nil || claimErr != ctx.Err()
			return result, claimErr
		}
		if injected := a.takeInjected(ctx, turn); len(injected) != 0 {
			pending = append(injected, pending...)
			uncommitted = cloneMessages(pending)
		}
		pending = a.filterFollowupAdmissions(ctx, pending, false)
		uncommitted = cloneMessages(pending)
		surfaceBeforePreStep := a.session.SurfaceContentGeneration()
		decision, pipelineErr := a.hooks.PreStep.Run(ctx, StepInput{Agent: a, Turn: turn, Step: step, Messages: cloneMessages(pending), Continue: continuation}, func(_ context.Context, value StepInput) (StepInput, error) { return value, nil })
		if pipelineErr != nil {
			return result, pipelineErr
		}
		if !a.checkFollowupRewrite(ctx, pending, decision.Messages) {
			uncommitted = nil
			if restoreErr := a.restoreUnrelatedAdmission(pending); restoreErr != nil {
				return result, restoreErr
			}
			reason = FinishStop
			return result, nil
		}
		if surfaceBeforePreStep != a.session.SurfaceContentGeneration() {
			decision.StartsRequestSeries = true
		}
		if decision.Reject || (!decision.Continue && len(decision.Messages) == 0) {
			_ = a.filterFollowupAdmissions(ctx, pending, true)
			// Explicit successful PreStep rejection is an intentional policy
			// decision, not a preparation failure to recover.
			uncommitted = nil
			reason = FinishStop
			if decision.RejectReason != "" {
				return result, errors.New(decision.RejectReason)
			}
			return result, nil
		}
		// An errored PreStep retains original accepted bytes. After a successful
		// policy decision, retain its admitted rewrite if later preparation fails.
		uncommitted = cloneMessages(decision.Messages)
		for index := range decision.Messages {
			content, attachmentErr := materializeContentImages(ctx, a.attachments, decision.Messages[index].Content)
			if attachmentErr != nil {
				return result, fmt.Errorf("harness: admit message attachments: %w", attachmentErr)
			}
			decision.Messages[index].Content = content
		}
		uncommitted = cloneMessages(decision.Messages)
		if _, err := a.session.Append("step/start", struct{ Turn, Step int }{turn, step}); err != nil {
			return result, err
		}
		openStep = step
		currentStep = step
		presentation, err := a.prompts.AssemblePresentation(ctx, a)
		if err != nil {
			return result, err
		}
		tools, err := a.tools.SchemasForAgent(ctx, a)
		if err != nil {
			return result, joinPresentationRelease(err, presentation.Release, ctx)
		}
		// Transfer recovery ownership exactly once. generateStep preserves this
		// batch on its own pre-admission errors; runTurn must never duplicate it.
		uncommitted = nil
		completion, err := a.generateStepWithRuntime(a.withFollowupRecovery(ctx, pending), turn, step, presentation, tools, decision.StartsRequestSeries, decision.Messages)
		if err != nil {
			// errors.Join from Release must not turn intentional cancel/revoke into failure.
			if errors.Is(err, errFollowupAdmissionDropped) {
				reason = FinishStop
				return result, nil
			}
			return result, err
		}
		if completion.Message.Role == "" {
			completion.Message.Role = RoleAssistant
		}
		if completion.Finish == FinishMaxTokens {
			maxTokens = true
			// Enforce the stop contract independently of the provider adapter.
			// Unfinished calls must neither execute nor enter committed history.
			safe := make([]ContentBlock, 0, len(completion.Message.Content))
			for _, block := range completion.Message.Content {
				if block.Type != BlockToolCall {
					safe = append(safe, block)
				}
			}
			completion.Message.Content = safe
		}
		if err := a.hooks.AssistantReady.Emit(ctx, AssistantReadyInput{Agent: a, Turn: turn, Step: step, Message: cloneMessages([]Message{completion.Message})[0]}); err != nil {
			return result, err
		}
		if _, err := a.session.Append("assistant/message", struct {
			Turn    int         `json:"turn"`
			Step    int         `json:"step"`
			Message Message     `json:"message"`
			Finish  FinishKind  `json:"finish"`
			Usage   *TokenUsage `json:"usage,omitempty"`
		}{
			Turn: turn, Step: step, Message: completion.Message,
			Finish: completion.Finish, Usage: completion.Usage,
		}); err != nil {
			return result, err
		}
		result.Usage = completion.Usage
		calls := toolCalls(completion.Message)
		concluded := false
		if len(calls) > 0 {
			if concluded, err = a.executeToolCalls(ctx, turn, step, calls); err != nil {
				return result, err
			}
		}
		if _, err := a.session.Append("step/end", struct{ Turn, Step int }{turn, step}); err != nil {
			return result, err
		}
		openStep = 0
		if concluded || len(calls) == 0 {
			canContinue := ctx.Err() == nil && step < a.maxSteps &&
				(completion.Finish == "" || completion.Finish == FinishStop || completion.Finish == FinishToolCalls)
			if err := a.hooks.TurnStopping.Emit(ctx, TurnStoppingInput{
				Agent: a, Turn: turn, Step: step, Finish: completion.Finish, Concluded: concluded, CanContinue: canContinue,
			}); err != nil {
				return result, err
			}
			if injected := a.finishOrTakeInjected(ctx, turn); len(injected) != 0 {
				pending = injected
				uncommitted = cloneMessages(pending)
				continuation = true
				continue
			}
			if a.durableInbox.HasNextStep() {
				pending = nil
				continuation = true
				continue
			}
			reason = completion.Finish
			if concluded || reason == "" {
				reason = FinishStop
			}
			return result, nil
		}
		pending = nil
		continuation = true
	}
	return result, fmt.Errorf("harness: turn %d exceeded %d steps", turn, a.maxSteps)
}

func (a *Agent) claimDurableInbox(ctx context.Context, target InboxTarget, turn int, afterCommit func([]Message)) ([]Message, error) {
	for barrier := a.inboxAdmissionBarrierLocked(target); barrier != nil; barrier = a.inboxAdmissionBarrierLocked(target) {
		a.inboxClaimMu.Unlock()
		select {
		case <-barrier:
		case <-ctx.Done():
		}
		a.inboxClaimMu.Lock()
		if err := contextFailure(ctx); err != nil {
			if afterCommit != nil {
				afterCommit(nil)
			}
			return nil, err
		}
	}
	claimed, err := a.durableInbox.Claim(target)
	if err != nil {
		if afterCommit != nil {
			afterCommit(nil)
		}
		return claimed, err
	}
	if len(claimed) == 0 {
		if afterCommit != nil {
			afterCommit(claimed)
		}
		return claimed, err
	}
	if err := a.session.Flush(ctx); err != nil {
		if afterCommit != nil {
			afterCommit(claimed)
		}
		_ = a.filterFollowupAdmissions(ctx, claimed, true)
		// Consumption has not passed its durability guard. Preserve the
		// original failed-claim settlement; do not replay it as future input.
		return nil, err
	}
	if afterCommit != nil {
		afterCommit(claimed)
	}
	var headID string
	if target == InboxNextTurn {
		headID = claimed[len(claimed)-1].ID
	}
	claimed = a.filterFollowupAdmissions(ctx, claimed, false)
	for _, message := range claimed {
		userAuthored := messageHasUserSource(message)
		if message.ID == headID {
			// The worker retains the head request's actual admission origin.
			// A plugin followup cannot become human by setting Source.kind.
			userAuthored = a.TurnUserAuthored()
		}
		a.publishInboxClaimed(ctx, message, turn, userAuthored)
	}
	return claimed, nil
}

// commitUserAdmission consumes recovery ownership before publishing. If an
// append fails, callers report that failure rather than retrying an uncertain
// partial publication and duplicating already admitted input.
func (a *Agent) commitUserAdmission(pending *[]Message) error {
	return a.commitUserAdmissionContext(context.Background(), pending)
}

func (a *Agent) commitUserAdmissionContext(ctx context.Context, pending *[]Message) error {
	messages := *pending
	*pending = nil
	if handled, err := a.commitGuardedAdmission(ctx, messages); handled {
		return err
	}
	for _, message := range messages {
		if message.Role == RoleUser {
			if _, err := a.session.Append("user/message", message); err != nil {
				return err
			}
		}
	}
	return nil
}

// preserveUserAdmission closes failure-return recovery from inbox consumption
// through canonical user admission. It is not a crash-atomic claim transaction.
// Flush independently of cancelled provider work, unless a checkpoint has
// already reported unavailable storage. In that case append in memory, report
// the original failure, and leave durability to an explicit later checkpoint.
// Retrying that failed checkpoint here could prevent its own settlement/Error
// notification, which is what allows the owner to restore storage.
func (a *Agent) preserveUserAdmission(ctx context.Context, pending *[]Message, cause error, flush bool) error {
	if len(*pending) == 0 {
		return cause
	}
	*pending = a.filterFollowupAdmissions(ctx, *pending, true)
	err := a.commitUserAdmission(pending)
	if flush {
		err = errors.Join(err, a.session.Flush(context.WithoutCancel(ctx)))
	}
	if err != nil {
		return errors.Join(cause, fmt.Errorf("harness: preserve accepted request input: %w", err))
	}
	return cause
}

func (a *Agent) generateStep(ctx context.Context, turn, step int, system string, tools []ToolSchema, startsRequestSeries bool, pending ...[]Message) (completion Completion, resultErr error) {
	return a.generateStepWithRuntime(ctx, turn, step, PromptPresentation{System: system}, tools, startsRequestSeries, pending...)
}

// joinPresentationRelease runs Release after the primary result. A nil release
// error must not wrap the primary error: errors.Join always allocates a
// joinError, which breaks == checks for intentional follow-up cancel/revoke.
func joinPresentationRelease(err error, release func(context.Context) error, ctx context.Context) error {
	if release == nil {
		return err
	}
	if releaseErr := release(context.WithoutCancel(ctx)); releaseErr != nil {
		return errors.Join(err, releaseErr)
	}
	return err
}

func (a *Agent) generateStepWithRuntime(ctx context.Context, turn, step int, presentation PromptPresentation, tools []ToolSchema, startsRequestSeries bool, pending ...[]Message) (completion Completion, resultErr error) {
	if presentation.Release != nil {
		defer func() { resultErr = joinPresentationRelease(resultErr, presentation.Release, ctx) }()
	}
	system, runtime := presentation.System, presentation.RuntimeContext
	var admission []Message
	if len(pending) > 0 {
		admission = cloneMessages(pending[0])
	}
	defer func() {
		resultErr = a.preserveUserAdmission(ctx, &admission, resultErr, true)
	}()
	requestAttempt := 0
	for {
		if err := contextFailure(ctx); err != nil {
			return Completion{}, err
		}
		plan, err := a.session.ContextPlanWithMessages(admission)
		if err != nil {
			return Completion{}, err
		}
		boundaryMessages := harnesssession.ProviderMessages(plan.Messages())
		selection := a.ModelSelection()
		request := GenerateRequest{
			Provider: selection.Provider, Model: selection.Model, ReasoningEffort: selection.ReasoningEffort, System: system, RuntimeContext: runtime,
			Messages: cloneMessages(boundaryMessages), Tools: append([]ToolSchema(nil), tools...),
			MaxTokens: a.maxTokens, Agent: a, Attachments: a.attachments, Turn: turn, Step: step,
		}
		request, err = a.hooks.Request.Run(ctx, request, func(_ context.Context, value GenerateRequest) (GenerateRequest, error) { return value, nil })
		if err != nil {
			return Completion{}, err
		}
		prepared, request, requestContext, routed, err := prepareGenerateCall(ctx, a.adapter, a.modelInfo, request)
		if err != nil {
			return Completion{}, fmt.Errorf("harness: prepare model call for %s/%s: %w", request.Provider, request.Model, err)
		}
		request.Tools, err = a.tools.boundDeferredRequest(ctx, a, request.Tools, prepared)
		if err != nil {
			return Completion{}, err
		}
		request.Tools = BoundToolCatalogs(request.Tools)
		if presentation.Guidance != nil {
			guidance, err := presentation.Guidance(ctx, PromptCapabilities{Tools: request.Tools, Model: prepared.ModelInfo})
			if err != nil {
				return Completion{}, err
			}
			if guidance != "" {
				request.System = strings.TrimSpace(request.System + "\n\n" + guidance)
			}
		}
		if presentation.RefreshRuntimeContext != nil {
			request.RuntimeContext, err = presentation.RefreshRuntimeContext(ctx)
			if err != nil {
				return Completion{}, err
			}
		}
		if err := ValidateReasoningEffort(prepared.ModelInfo, request.ReasoningEffort); err != nil {
			return Completion{}, err
		}
		generation := a.session.SurfaceContentGeneration()
		attemptStartsSeries := startsRequestSeries && requestAttempt == 0 || generation != a.requestSurfaceGeneration
		previous, found, headerErr := a.session.RequestHeader()
		if headerErr != nil {
			return Completion{}, headerErr
		}
		toolsChanged := found && !sameToolSchemas(previous.Tools, request.Tools)
		messagesRewritten := !reflect.DeepEqual(request.Messages, boundaryMessages)
		inHistory := prepared.ModelInfo.SystemPromptUpdate == "in-history"
		promptStartsSeries := attemptStartsSeries || messagesRewritten || (prepared.ModelInfo.ToolUpdate == "" && toolsChanged)
		if err := a.session.CommitSystemPrompt(turn, step, request.System, inHistory && !messagesRewritten, promptStartsSeries); err != nil {
			return Completion{}, err
		}
		if request.RuntimeContext != nil {
			if err := a.session.CommitRuntimeContext(*request.RuntimeContext); err != nil {
				return Completion{}, err
			}
		}
		if err := a.commitUserAdmissionContext(ctx, &admission); err != nil {
			return Completion{}, err
		}
		plan, err = a.session.ContextPlan()
		if err != nil {
			return Completion{}, err
		}
		if inHistory {
			if !messagesRewritten {
				request.Messages = plan.Messages()
			} else {
				// A request middleware rewrite breaks prefix identity. The prompt
				// was consolidated above; retain the caller's message rewrite.
				for _, message := range plan.Messages() {
					if message.Role == RoleSystem {
						request.Messages = append([]Message{message}, request.Messages...)
						break
					}
				}
			}
			request.System = ""
		}
		generation = a.session.SurfaceContentGeneration()
		attemptStartsSeries = attemptStartsSeries || generation != a.requestSurfaceGeneration
		header := RequestHeaderEvent{
			AdapterDefaults: prepared.AdapterDefaults,
			Turn:            turn, Step: step, Provider: request.Provider, Model: request.Model, ReasoningEffort: request.ReasoningEffort,
			TransientModel: request.TransientModel,
			Temperature:    request.Temperature, MaxTokens: request.MaxTokens, Stop: append([]string(nil), request.Stop...),
			Tools: request.Tools, StartsSeries: attemptStartsSeries,
		}
		if !a.requestHeaderLogged {
			if found {
				header.Reason = "resume"
			} else {
				header.Reason = "initial"
			}
		} else if !found || !sameRequestHeaderState(previous, header) {
			header.Reason = "change"
		} else if header.StartsSeries {
			header.Reason = "series"
			header.StartsSeries = false
		}
		if header.Reason != "" {
			committed, err := a.session.Append("request/header", header)
			if err != nil {
				return Completion{}, err
			}
			if found && header.Reason != "series" {
				if err := a.session.AppendToolUpdates(turn, step, previous.Tools, request.Tools, committed.Seq); err != nil {
					return Completion{}, err
				}
			}
		}
		a.requestHeaderLogged = true
		// Tool updates enter the authoritative surface before deriving the final
		// boundary. A middleware-selected prefix cannot claim complete history.
		plan, err = a.session.ContextPlan()
		if err != nil {
			return Completion{}, err
		}
		if !messagesRewritten {
			request.Messages = harnesssession.ProviderMessages(plan.Messages())
			if inHistory {
				request.Messages = plan.Messages()
			}
			request.ToolHistory, err = a.session.ToolHistory()
			if err != nil {
				return Completion{}, err
			}
		} else {
			request.ToolHistory = nil
			if request.RuntimeContext != nil {
				request.Messages = includeAdmittedRuntimeContext(request.Messages, plan.Messages())
			}
		}
		a.requestSurfaceGeneration = generation
		if routed {
			previous, found, contextErr := a.session.RequestContext()
			if contextErr != nil {
				return Completion{}, contextErr
			}
			if !found || previous != requestContext {
				if _, err := a.session.Append("request/context", requestContext); err != nil {
					return Completion{}, err
				}
			}
		}
		if plan.MemoryTokens > 0 || len(plan.Omitted) > 0 {
			// Memory pruning is defined by the Session ContextPlan, so request
			// middleware cannot silently change its model-visible messages.
			plannedMessages := harnesssession.ProviderMessages(plan.Messages())
			if inHistory {
				plannedMessages = plan.Messages()
			}
			if !reflect.DeepEqual(request.Messages, plannedMessages) {
				return Completion{}, fmt.Errorf("harness: request hook changed ContextPlan messages; use Session surface operations")
			}
		}
		if plan.MemoryTokens > 0 || len(plan.Omitted) > 0 {
			// Persist the Session selection identity in the request prefix.
			if _, err := a.session.Append("request/context-plan", struct {
				Kind         string `json:"kind"`
				Digest       string `json:"digest"`
				MemoryTokens int    `json:"memoryTokens"`
				MemoryBudget int    `json:"memoryBudget"`
			}{plan.Kind, plan.Digest(), plan.MemoryTokens, plan.MemoryBudget}); err != nil {
				return Completion{}, err
			}
		}

		// The request header and route context are part of the exact request
		// prefix. Do not enter provider code until that prefix is durable.
		if err := a.checkpoint(ctx); err != nil {
			return Completion{}, err
		}
		attemptStream := newInterruptedStreamAssembly()
		completion, requestErr := a.generateMainRequest(ctx, prepared, request, func(chunk StreamChunk) error {
			_, appendErr := a.session.Append("assistant/chunk", struct {
				Turn  int         `json:"turn"`
				Step  int         `json:"step"`
				Chunk StreamChunk `json:"chunk"`
			}{turn, step, chunk})
			if appendErr == nil {
				attemptStream.consume(chunk)
			}
			return appendErr
		})
		if requestErr == nil && (completion.Finish == FinishError || completion.Finish == FinishAborted) {
			requestErr = NewProviderError("provider request ended with "+string(completion.Finish), "", nil)
		}
		if requestErr == nil {
			return completion, nil
		}
		// A later cancellation or recovery failure must not erase the exact
		// generation's already-recorded dispatch withdrawal.
		withAdmissionFailure := func(err error) error {
			var admission *mainRequestAdmissionError
			if errors.As(requestErr, &admission) {
				return errors.Join(err, admission)
			}
			return err
		}
		if cancellation := contextFailure(ctx); cancellation != nil {
			content := attemptStream.content()
			if len(content) > 0 {
				source, marshalErr := json.Marshal(struct {
					Kind     string `json:"kind"`
					Provider string `json:"provider"`
					Model    string `json:"model"`
				}{Kind: "model", Provider: request.Provider, Model: request.Model})
				if marshalErr != nil {
					return Completion{}, marshalErr
				}
				if _, appendErr := a.session.Append("assistant/message", struct {
					Turn        int         `json:"turn"`
					Step        int         `json:"step"`
					Message     Message     `json:"message"`
					Interrupted bool        `json:"interrupted"`
					Usage       *TokenUsage `json:"usage,omitempty"`
				}{
					Turn: turn, Step: step,
					Message:     Message{Role: RoleAssistant, Content: content, Source: source},
					Interrupted: true, Usage: attemptStream.usage,
				}); appendErr != nil {
					return Completion{}, appendErr
				}
			} else if _, err := a.session.Append("assistant/attempt", struct {
				Turn int `json:"turn"`
				Step int `json:"step"`
			}{turn, step}); err != nil {
				return Completion{}, err
			}
			return Completion{}, withAdmissionFailure(cancellation)
		}
		// Failed streams are separate durable attempts even when the next
		// request reuses the same canonical envelope and emits no new header.
		if _, err := a.session.Append("assistant/attempt", struct {
			Turn int `json:"turn"`
			Step int `json:"step"`
		}{turn, step}); err != nil {
			return Completion{}, err
		}
		requestAttempt++
		decision, recoveryErr := a.hooks.RequestError.Run(ctx, RequestErrorInput{
			Agent: a, Turn: turn, Step: step, Provider: request.Provider, Model: request.Model,
			Failure: ProviderFailureFromError(requestErr), Attempt: requestAttempt, RetryPolicy: prepared.RetryPolicy,
		}, func(_ context.Context, value RequestErrorInput) (RequestErrorInput, error) { return value, nil })
		if recoveryErr != nil {
			return Completion{}, withAdmissionFailure(fmt.Errorf("harness: request-error recovery: %w", recoveryErr))
		}
		if err := contextFailure(ctx); err != nil {
			return Completion{}, withAdmissionFailure(err)
		}
		if !decision.Retry {
			return Completion{}, requestErr
		}
	}
}

// sameRequestHeaderState compares what the durable log would say, not Go
// representations: the previous header was decoded from JSON, so reflect.DeepEqual
// on raw tool schemas (whitespace, key order) or nil-versus-empty slices called
// every unchanged request "changed" and logged the whole tool list again.
func sameRequestHeaderState(left, right RequestHeaderEvent) bool {
	left.Turn, left.Step, left.Reason, left.StartsSeries = 0, 0, "", false
	right.Turn, right.Step, right.Reason, right.StartsSeries = 0, 0, "", false
	return sameJSONValue(left, right)
}

func sameToolSchemas(left, right []ToolSchema) bool { return sameJSONValue(left, right) }

// sameJSONValue is equality of the canonical JSON encodings, with object keys
// sorted so raw schemas that differ only in layout compare equal.
func sameJSONValue(left, right any) bool {
	canonical := func(value any) ([]byte, bool) {
		raw, err := json.Marshal(value)
		if err != nil {
			return nil, false
		}
		var decoded any
		if err := json.Unmarshal(raw, &decoded); err != nil {
			return nil, false
		}
		normalized, err := json.Marshal(decoded)
		return normalized, err == nil
	}
	a, okA := canonical(left)
	b, okB := canonical(right)
	return okA && okB && bytes.Equal(a, b)
}

func contextFailure(ctx context.Context) error {
	if ctx == nil || ctx.Err() == nil {
		return nil
	}
	return ctx.Err()
}

func toolCalls(message Message) []ContentBlock {
	result := make([]ContentBlock, 0)
	for _, block := range message.Content {
		if block.Type == BlockToolCall {
			result = append(result, block)
		}
	}
	return result
}

func (a *Agent) executeToolCalls(ctx context.Context, turn, step int, calls []ContentBlock) (bool, error) {
	outcomes := make([]ToolOutcome, len(calls))
	for _, call := range calls {
		if _, err := a.session.Append("tool/call", struct {
			Turn      int             `json:"turn"`
			Step      int             `json:"step"`
			CallID    ToolCallID      `json:"callId"`
			Name      string          `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		}{turn, step, call.ToolCallID, call.Name, call.Arguments}); err != nil {
			return false, err
		}
	}
	for start := 0; start < len(calls); {
		if a.toolExecutionMode(ctx, calls[start]) == ExecutionSerial {
			outcomes[start] = a.executeOneTool(ctx, calls[start])
			start++
			continue
		}
		maxParallelToolCalls := a.MaxParallelToolCalls()
		done := make(chan int, maxParallelToolCalls)
		next, active := start, 0
		barrier := false
		for active > 0 || (!barrier && next < len(calls)) {
			for !barrier && active < maxParallelToolCalls && next < len(calls) {
				if a.toolExecutionMode(ctx, calls[next]) == ExecutionSerial {
					barrier = true
					break
				}
				index := next
				next++
				active++
				go func() {
					outcomes[index] = a.executeOneTool(ctx, calls[index])
					done <- index
				}()
			}
			if active == 0 {
				break
			}
			<-done
			active--
		}
		start = next
	}
	concluded := false
	blocks := make([]ContentBlock, len(outcomes))
	deferred := make([]DeferredContext, 0)
	for index, outcome := range outcomes {
		content, attachmentErr := materializeContentImages(ctx, a.attachments, outcome.Result.Content)
		if attachmentErr != nil {
			return false, fmt.Errorf("harness: admit tool-result attachments: %w", attachmentErr)
		}
		blocks[index] = ContentBlock{
			Type: BlockToolResult, ToolCallID: outcome.Request.CallID,
			Content: content, IsError: outcome.Result.IsError,
			Meta: append(json.RawMessage(nil), outcome.Result.Meta...),
		}
		for _, additional := range outcome.Result.AdditionalContexts {
			if additional.Role != RoleUser {
				return false, fmt.Errorf("harness: tool %q deferred non-user context role %q", outcome.Request.Name, additional.Role)
			}
			if len(additional.Content) == 0 {
				return false, fmt.Errorf("harness: tool %q deferred empty user context", outcome.Request.Name)
			}
			additional.Content, attachmentErr = materializeContentImages(ctx, a.attachments, additional.Content)
			if attachmentErr != nil {
				return false, fmt.Errorf("harness: admit deferred-context attachments: %w", attachmentErr)
			}
			additional.Source = append(json.RawMessage(nil), additional.Source...)
			deferred = append(deferred, additional)
		}
		concluded = concluded || outcome.Result.ConcludesTurn
	}
	if a.hooks != nil && a.hooks.PostToolBatch != nil {
		batch := ToolBatchInput{Agent: a, Calls: make([]ToolBatchCall, len(outcomes))}
		for index, outcome := range outcomes {
			batch.Calls[index] = ToolBatchCall{
				Name: outcome.Request.Name, ToolCallID: outcome.Request.CallID,
				Input: append(json.RawMessage(nil), outcome.Request.Arguments...), Response: serializedToolResponse(blocks[index].Content),
			}
		}
		batch, err := a.hooks.PostToolBatch.Run(ctx, batch, func(_ context.Context, value ToolBatchInput) (ToolBatchInput, error) { return value, nil })
		if err != nil {
			return false, err
		}
		notice := strings.TrimSpace(batch.Reason + "\n" + batch.Context)
		if notice != "" {
			source, err := json.Marshal(struct {
				Kind  string `json:"kind"`
				Event string `json:"event"`
			}{"post-tool-batch", "PostToolBatch"})
			if err != nil {
				return false, err
			}
			deferred = append(deferred, DeferredContext{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: notice}}, Source: source})
		}
		if batch.Stop {
			concluded = true
		}
	}
	// OpenAI-compatible histories require every result for one assistant tool
	// batch to remain contiguous. Deferred user context is therefore committed
	// only after all results, while preserving call and context order.
	for _, block := range blocks {
		if _, err := a.session.Append("tool/result", block); err != nil {
			return false, err
		}
	}
	for _, additional := range deferred {
		if _, err := a.session.Append("user/message", additional); err != nil {
			return false, err
		}
	}
	return concluded, nil
}

func serializedToolResponse(blocks []ContentBlock) json.RawMessage {
	if len(blocks) == 1 && blocks[0].Type == BlockText {
		raw, err := json.Marshal(blocks[0].Text)
		if err == nil {
			return raw
		}
	}
	raw, err := json.Marshal(blocks)
	if err != nil {
		return []byte("null")
	}
	return raw
}

func (a *Agent) toolExecutionMode(ctx context.Context, call ContentBlock) ExecutionMode {
	return a.tools.ExecutionMode(ctx, ToolRequest{
		Agent: a, CallID: call.ToolCallID, Name: call.Name,
		Arguments: append(json.RawMessage(nil), call.Arguments...),
	})
}

func (a *Agent) executeOneTool(ctx context.Context, call ContentBlock) ToolOutcome {
	request := ToolRequest{Agent: a, CallID: call.ToolCallID, Name: call.Name, Arguments: append(json.RawMessage(nil), call.Arguments...)}
	outcome, err := a.tools.Execute(ctx, request)
	if err != nil {
		return ToolOutcome{Request: request, Result: ToolResult{IsError: true, Content: []ContentBlock{{Type: BlockText, Text: err.Error()}}}}
	}
	return outcome
}

func finishFromError(err error) FinishKind {
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return FinishAborted
	}
	return FinishError
}

// A message rewrite may select a different prefix, but must not silently lose
// the current runtime snapshot admitted after the middleware ran. Retain other
// selected messages and use the canonical snapshot's identity and attribution.
func includeAdmittedRuntimeContext(messages, canonical []Message) []Message {
	isRuntime := func(message Message) bool {
		var source struct {
			Kind string `json:"kind"`
		}
		return json.Unmarshal(message.Source, &source) == nil && source.Kind == "runtime-context"
	}
	for index := len(canonical) - 1; index >= 0; index-- {
		current := canonical[index]
		if !isRuntime(current) {
			continue
		}
		result := make([]Message, 0, len(messages)+1)
		for _, message := range messages {
			if (current.ID != "" && message.ID == current.ID) ||
				(isRuntime(message) && reflect.DeepEqual(message.Content, current.Content)) {
				continue
			}
			result = append(result, message)
		}
		return append(result, cloneMessages([]Message{current})[0])
	}
	return messages
}
