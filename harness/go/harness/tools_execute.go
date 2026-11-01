package harness

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"
)

func (r *ToolRegistry) Execute(ctx context.Context, request ToolRequest) (ToolOutcome, error) {
	return r.executeWithResolver(ctx, request, false, r.resolveForAgent, r.prepareFinalContentForAgent)
}

type toolExecutionContextKey struct{}

func toolExecutionFromContext(ctx context.Context) (ToolExecutionToken, bool) {
	if ctx == nil {
		return ToolExecutionToken{}, false
	}
	token, ok := ctx.Value(toolExecutionContextKey{}).(ToolExecutionToken)
	return token, ok && token.Valid()
}

func (r *ToolRegistry) executeWithResolver(ctx context.Context, request ToolRequest, nested bool, resolve func(context.Context, *Agent, string) (Tool, bool, error), preparers ...finalContentPreparation) (outcome ToolOutcome, err error) {
	var prepare finalContentPreparation
	if len(preparers) > 0 {
		prepare = preparers[0]
	}
	if ctx == nil {
		ctx = context.Background()
	}
	projectionMode := requestedDSHProjection(ctx)
	ctx = context.WithValue(ctx, dshOutputProjectionKey{}, (*dshOutputProjectionMode)(nil))
	parentToken, hasParent := toolExecutionFromContext(ctx)
	parentCall, _ := ctx.Value(toolCallLineageKey{}).(toolCallLineage)
	executionToken := ToolExecutionToken{id: r.nextExecution.Add(1)}
	request.executionToken = executionToken
	request.dshOutputProjection = false
	request.owner = nil
	request.profileLease = nil
	request.output = nil
	request.finalContent = nil
	if hasParent {
		request.parentExecutionToken = parentToken
	} else {
		request.parentExecutionToken = ToolExecutionToken{}
	}
	ctx = context.WithValue(ctx, toolExecutionContextKey{}, executionToken)
	executionRequest := request
	var preparedTool Tool
	var prepared bool
	var finalContent *toolFinalContentReceipt
	var releaseProfileOperation func()
	defer func() {
		// Release last, after exact-token finalization and all output settlement.
		if releaseProfileOperation != nil {
			defer func() {
				if releaseProfileOperation != nil {
					releaseProfileOperation()
				}
			}()
		}
		if recovered := recover(); recovered != nil {
			err = errors.Join(err, fmt.Errorf("harness: tool %q execution panicked: %v", executionRequest.Name, recovered))
		}
		// Even an error-only exit belongs to the exact admitted token. Preserve
		// this identity for finalizers when policy returned an empty outcome.
		outcome.Request = executionRequest
		if err != nil && !outcome.Result.IsError {
			contexts := outcome.Result.AdditionalContexts
			outcome.Result = ToolResult{IsError: true, Content: []ContentBlock{{Type: BlockText, Text: err.Error()}}}
			if executionRequest.output != nil {
				outcome.Result.AdditionalContexts = contexts
			}
		}
		outcome = retireSuccessfulToolOutcome(outcome)
		if r.Finalized != nil {
			// A cancelled caller cannot skip synchronous token cleanup. Values
			// such as scope and execution lineage remain in this context.
			err = errors.Join(err, r.Finalized.EmitAllCurrent(context.WithoutCancel(ctx), func() ToolOutcome {
				return observerToolOutcome(outcome)
			}))
		}
		outcome = retireSuccessfulToolOutcome(outcome)
		if finalContent != nil && err != nil && !outcome.Result.IsError {
			outcome.Result = toolOutputError(executionRequest, outcome.Result, err)
		}
		if executionRequest.output != nil {
			if err != nil && !outcome.Result.IsError {
				outcome.Result = toolOutputError(executionRequest, outcome.Result, err)
			}
			if outcome.Result.IsError {
				outcome.Result.Value, outcome.Result.ConcludesTurn = nil, false
			}
			outcome.Result = cloneToolResult(outcome.Result)
		}
		// Existing result observers remain provisional and retain their error
		// semantics. Only the final returned model presentation is capped,
		// after observer errors and all cleanup have been normalized.
		if finalContent != nil {
			outcome.Result = finalContent.finish(executionRequest, outcome.Result)
		}
		if executionRequest.output != nil && executionRequest.output.notification != nil {
			// Native mutation/cleanup is complete. A source observer may retire
			// this owner; do not make it join the operation delivering itself.
			if releaseProfileOperation != nil {
				releaseProfileOperation()
				releaseProfileOperation = nil
			}
			observationCtx := context.WithValue(context.WithoutCancel(ctx), profileOwnerCallContextKey{}, nil)
			executionRequest.output.notification.publish(observationCtx, outcome)
		}
	}()
	if request.Agent != nil && request.Agent.retired.Load() {
		return ToolOutcome{Request: request, Result: retiredToolResult(ToolAbortedBeforeDispatch, nil)}, nil
	}
	if prepare != nil {
		var prepareErr error
		preparedTool, prepared, prepareErr = prepare(ctx, request.Agent, request.Name)
		if prepareErr != nil {
			return ToolOutcome{}, prepareErr
		}
		if prepared {
			request.Arguments = append([]byte(nil), request.Arguments...)
			finalContent, prepareErr = prepareNativeFinalContent(preparedTool, request)
			if prepareErr != nil {
				return ToolOutcome{}, prepareErr
			}
			request.owner, request.profileLease = preparedTool.owner, preparedTool.profileLease
			request.output = outputContract(preparedTool)
			request.finalContent = finalContent
			executionRequest = request
			executionRequest.Arguments = append([]byte(nil), finalContent.arguments...)
			// The prepared registration is already exact before Before runs. Its
			// effect-free formatter receipt remains usable on admission failure;
			// accepted owner work stays borrowed through final-content finish.
			if preparedTool.profileLease != nil {
				var admissionErr error
				ctx, releaseProfileOperation, admissionErr = preparedTool.profileLease.BeginOperation(ctx)
				if admissionErr != nil {
					return ToolOutcome{Request: request, Result: toolBodyErrorResult(request, ToolResult{}, admissionErr)}, nil
				}
			}
		}
	}
	filtered, err := r.Before.Run(ctx, request, func(_ context.Context, value ToolRequest) (ToolRequest, error) { return value, nil })
	if err != nil {
		return ToolOutcome{}, err
	}
	if prepared && (filtered.Agent != finalContent.agent || filtered.Name != finalContent.name || !bytes.Equal(filtered.Arguments, finalContent.arguments)) {
		return ToolOutcome{}, errors.New("harness: Before retargeted a prepared final-content call; execution denied")
	}
	// Middleware may reconstruct a request. Execution lineage is registry-owned
	// and therefore cannot be removed or forged by a pipeline transform.
	filtered.executionToken = executionToken
	filtered.dshOutputProjection = request.dshOutputProjection
	filtered.owner = nil
	filtered.profileLease = nil
	filtered.output = nil
	filtered.finalContent = finalContent
	filtered.parentExecutionToken = request.parentExecutionToken
	filtered.rootCallID = filtered.CallID
	if hasParent && parentCall.token == parentToken && parentCall.owner == filtered.Agent && parentCall.rootCallID != "" {
		filtered.rootCallID = parentCall.rootCallID
	}
	if filtered.CallID != "" && filtered.rootCallID != "" {
		ctx = context.WithValue(ctx, toolCallLineageKey{}, toolCallLineage{owner: filtered.Agent, token: executionToken, rootCallID: filtered.rootCallID})
	} else {
		ctx = context.WithValue(ctx, toolCallLineageKey{}, toolCallLineage{})
	}
	if prepared {
		filtered.owner, filtered.profileLease = preparedTool.owner, preparedTool.profileLease
		filtered.output = outputContract(preparedTool)
	}
	executionRequest = filtered
	if filtered.Agent == nil {
		return ToolOutcome{}, errors.New("harness: tool execution requires an agent")
	}
	if filtered.Agent.retired.Load() {
		return r.settle(ctx, ToolOutcome{Request: filtered, Result: retiredToolResult(ToolAbortedBeforeDispatch, nil)}, nested, "", nil)
	}
	if !filtered.parentExecutionToken.Valid() {
		// Top-level calls may enter side-effecting tools. The model-facing call
		// event must be durable before any approval or tool body runs; nested
		// presenter dispatches reuse their outer call's checkpoint.
		if flushErr := filtered.Agent.checkpoint(ctx); flushErr != nil {
			return r.settle(ctx, ToolOutcome{Request: filtered, Result: ToolResult{
				IsError: true, Content: []ContentBlock{{Type: BlockText, Text: "Error: " + flushErr.Error()}},
			}}, nested, "", nil)
		}
	}
	// Cancellation can overtake a nested presenter call as well as a root
	// checkpoint. No body has started yet, so use the pre-dispatch code.
	if contextFailure(ctx) != nil {
		return ToolOutcome{Request: filtered, Result: toolPolicyErrorResult(
			"tool call aborted before dispatch", "AbortError", ToolAbortedBeforeDispatch, nil,
		)}, nil
	}
	if filtered.DenyReason != "" {
		return r.settle(ctx, ToolOutcome{Request: filtered, Result: ToolResult{
			IsError: true, Content: []ContentBlock{{Type: BlockText, Text: filtered.DenyReason}},
		}}, nested, "", nil)
	}
	if prepared && !r.preparedFinalContentAdmitted(filtered.Agent, preparedTool) {
		return ToolOutcome{}, errors.New("harness: prepared tool selection or restrictions changed before dispatch")
	}
	tool, ok := preparedTool, prepared
	var resolveErr error
	if !prepared {
		tool, ok, resolveErr = resolve(ctx, filtered.Agent, filtered.Name)
	}
	if resolveErr != nil {
		return ToolOutcome{Request: filtered, Result: ToolResult{IsError: true, Content: []ContentBlock{{Type: BlockText, Text: resolveErr.Error()}}}}, nil
	}
	if !ok {
		return ToolOutcome{Request: filtered, Result: ToolResult{IsError: true, Content: []ContentBlock{{Type: BlockText, Text: "unknown tool: " + filtered.Name}}}}, nil
	}
	if tool.nativeFinalContent != nil && !prepared {
		return ToolOutcome{}, errors.New("harness: native final-content tool requires unambiguous opt-in preparation")
	}
	if tool.profileLease != nil && releaseProfileOperation == nil {
		var admissionErr error
		ctx, releaseProfileOperation, admissionErr = tool.profileLease.BeginOperation(ctx)
		if admissionErr != nil {
			return ToolOutcome{Request: filtered, Result: toolBodyErrorResult(filtered, ToolResult{}, admissionErr)}, nil
		}
	}
	// Keep the resolved registration identity through post-execute and final
	// observers. Neither model input nor middleware can transfer this lease.
	filtered.owner = tool.owner
	filtered.profileLease = tool.profileLease
	filtered.output = outputContract(tool)
	ctx, filtered.dshOutputProjection, resolveErr = admitDSHProjection(ctx, filtered, tool, projectionMode)
	if resolveErr != nil {
		return ToolOutcome{Request: filtered}, resolveErr
	}
	executionRequest = filtered
	if tool.capturedAgent != nil && tool.capturedAgent != filtered.Agent {
		return ToolOutcome{Request: filtered, Result: retiredToolResult(ToolAbortedBeforeDispatch, nil)}, nil
	}
	if err := validateRegisteredToolArguments(tool, filtered.Arguments); err != nil {
		if result, ok := projectRegisteredToolArgumentFailure(tool, filtered.Arguments, err); ok {
			return ToolOutcome{Request: filtered, Result: result}, nil
		}
		return ToolOutcome{Request: filtered, Result: ToolResult{
			IsError: true,
			Content: []ContentBlock{{Type: BlockText, Text: "invalid tool arguments for " + filtered.Name + ": " + err.Error()}},
		}}, nil
	}
	if tool.RequiresApproval || tool.AlwaysAskApproval || filtered.RequestApproval {
		var native *NativeApprovalDescriptor
		if tool.ApprovalDescriptor != nil {
			candidate, descriptorErr := tool.ApprovalDescriptor(ctx, filtered)
			if descriptorErr != nil {
				return ToolOutcome{Request: filtered, Result: toolBodyErrorResult(filtered, ToolResult{}, descriptorErr)}, nil
			}
			if candidate != nil {
				copy := *candidate
				native = &copy
			}
		}
		approval := ApprovalUnavailable
		if r.approval != nil {
			reason := "execute tool " + filtered.Name
			if tool.ApprovalReason != nil {
				if candidate := tool.ApprovalReason(filtered); candidate != "" {
					reason = candidate
				}
			}
			// A runtime hook decision describes this exact call and therefore
			// takes precedence over the tool's static approval description.
			if filtered.ApprovalReason != "" {
				reason = filtered.ApprovalReason
			}
			// Host callbacks may cancel or retire this exact registration. A stale
			// descriptor must not escape to an approval client, even though the
			// dispatch guard below would also prevent the eventual tool body.
			if contextFailure(ctx) != nil || filtered.Agent.retired.Load() {
				return r.settle(ctx, ToolOutcome{Request: filtered, Result: retiredToolResult(ToolAbortedBeforeDispatch, nil)}, nested, tool.Schema.Name, tool.ObserveResult)
			}
			if filtered.owner != nil && filtered.owner.admissionError() != nil {
				return r.settle(ctx, ToolOutcome{Request: filtered, Result: retiredToolOwnerResult(nil)}, nested, tool.Schema.Name, tool.ObserveResult)
			}
			if filtered.profileLease != nil && !filtered.profileLease.active() {
				return r.settle(ctx, ToolOutcome{Request: filtered, Result: retiredToolOwnerResult(nil)}, nested, tool.Schema.Name, tool.ObserveResult)
			}
			approval, err = r.approval.Request(ctx, ApprovalRequest{
				Agent: filtered.Agent, CallID: filtered.CallID, ToolName: filtered.Name,
				Reason: reason, Native: native, AlwaysAsk: tool.AlwaysAskApproval,
			})
			if err != nil {
				if contextFailure(ctx) != nil {
					return r.settle(ctx, ToolOutcome{Request: filtered, Result: toolPolicyErrorResult(
						"tool call aborted before dispatch", "AbortError", ToolAbortedBeforeDispatch, nil,
					)}, nested, tool.Schema.Name, tool.ObserveResult)
				}
				return ToolOutcome{}, err
			}
		}
		if approval != ApprovalAllowedOnce {
			if contextFailure(ctx) != nil {
				return r.settle(ctx, ToolOutcome{Request: filtered, Result: toolPolicyErrorResult(
					"tool call aborted before dispatch", "AbortError", ToolAbortedBeforeDispatch, nil,
				)}, nested, tool.Schema.Name, tool.ObserveResult)
			}
			return r.settle(ctx, ToolOutcome{Request: filtered, Result: ToolResult{
				IsError: true, Content: []ContentBlock{{Type: BlockText, Text: "tool approval " + string(approval) + ": " + filtered.Name}},
			}}, nested, tool.Schema.Name, tool.ObserveResult)
		}
	}
	if contextFailure(ctx) != nil {
		return r.settle(ctx, ToolOutcome{Request: filtered, Result: toolPolicyErrorResult(
			"tool call aborted before dispatch", "AbortError", ToolAbortedBeforeDispatch, nil,
		)}, nested, tool.Schema.Name, tool.ObserveResult)
	}
	// This check is outside the entire extensible Before waterfall: an outer
	// middleware that catches an inner error cannot resurrect denied dispatch.
	if guardErr := r.guards.Emit(ctx, filtered); guardErr != nil {
		return ToolOutcome{}, guardErr
	}
	if contextFailure(ctx) != nil {
		return r.settle(ctx, ToolOutcome{Request: filtered, Result: toolPolicyErrorResult(
			"tool call aborted before dispatch", "AbortError", ToolAbortedBeforeDispatch, nil,
		)}, nested, tool.Schema.Name, tool.ObserveResult)
	}
	// Resolution, approval and guards are external callbacks and may retire this
	// exact generation. Revalidate immediately before entering its body.
	if filtered.Agent.retired.Load() {
		return r.settle(ctx, ToolOutcome{Request: filtered, Result: retiredToolResult(ToolAbortedBeforeDispatch, nil)}, nested, tool.Schema.Name, tool.ObserveResult)
	}
	var result ToolResult
	var executeErr error
	filtered.Arguments = append(json.RawMessage(nil), filtered.Arguments...)
	executeCtx := ctx
	var cancelTimeout context.CancelFunc
	if tool.Timeout > 0 {
		executeCtx, cancelTimeout = context.WithTimeoutCause(ctx, tool.Timeout, errToolTimeoutDeadline)
		defer cancelTimeout() // also release the timer if the body panics
	}
	func() {
		bodyCtx, retireBody := withToolBodyAdmission(executeCtx, filtered)
		defer retireBody()
		if tool.ExecuteRequest != nil {
			result, executeErr = tool.ExecuteRequest(bodyCtx, filtered)
		} else {
			result, executeErr = tool.Execute(bodyCtx, filtered.Arguments)
		}
	}()
	timedOut := tool.Timeout > 0 && errors.Is(context.Cause(executeCtx), errToolTimeoutDeadline)
	if cancelTimeout != nil {
		cancelTimeout()
	}
	if executeErr != nil {
		result = toolBodyErrorResult(filtered, result, executeErr)
	}
	// The timeout wrapper owns its deadline classification. Once its timer wins,
	// it remains authoritative even if caller cancellation arrives while the
	// cooperative body is still cleaning up.
	if timedOut {
		message := "tool call timed out after " + formatTimeoutMilliseconds(tool.Timeout) + "ms"
		result = toolPolicyErrorResult(message, "ToolTimeoutError", ToolTimeout, nil)
	} else if contextFailure(ctx) != nil && !result.IsError {
		result = toolPolicyErrorResult("tool call aborted", "AbortError", ToolAborted, result.AdditionalContexts)
	}
	result = normalizeToolOutput(ctx, filtered, result)
	outcome = ToolOutcome{Request: filtered, Result: result}
	return r.settle(ctx, outcome, nested, tool.Schema.Name, tool.ObserveResult)
}

func toolBodyErrorResult(request ToolRequest, result ToolResult, err error) ToolResult {
	contexts := result.AdditionalContexts
	result = ToolResult{IsError: true, Content: []ContentBlock{{Type: BlockText, Text: err.Error()}}}
	if request.output != nil {
		result.AdditionalContexts = contexts
	}
	var coded interface{ ToolErrorCode() string }
	if errors.As(err, &coded) && coded.ToolErrorCode() != "" {
		result.Meta, _ = json.Marshal(struct {
			Code string `json:"code"`
		}{Code: coded.ToolErrorCode()})
	}
	return result
}

func toolPolicyErrorResult(message, name, code string, contexts []DeferredContext) ToolResult {
	meta, _ := json.Marshal(struct {
		Message string `json:"message"`
		Name    string `json:"name"`
		Code    string `json:"code"`
		Info    struct {
			Name string `json:"name"`
			Code string `json:"code"`
		} `json:"info"`
	}{Message: message, Name: name, Code: code, Info: struct {
		Name string `json:"name"`
		Code string `json:"code"`
	}{Name: name, Code: code}})
	return ToolResult{
		Content:            []ContentBlock{{Type: BlockText, Text: "Error: " + message}},
		IsError:            true,
		Meta:               meta,
		AdditionalContexts: append([]DeferredContext(nil), contexts...),
	}
}

func formatTimeoutMilliseconds(timeout time.Duration) string {
	if timeout%time.Millisecond == 0 {
		return strconv.FormatInt(timeout.Milliseconds(), 10)
	}
	return strconv.FormatFloat(float64(timeout)/float64(time.Millisecond), 'f', -1, 64)
}

func retiredToolResult(code string, contexts []DeferredContext) ToolResult {
	return toolPolicyErrorResult("tool call aborted: agent generation was retired", "AbortError", code, contexts)
}

func retireSuccessfulToolOutcome(outcome ToolOutcome) ToolOutcome {
	if outcome.Request.Agent != nil && outcome.Request.Agent.retired.Load() && !outcome.Result.IsError {
		outcome.Result = retiredToolResult(ToolAborted, outcome.Result.AdditionalContexts)
	}
	if outcome.Request.owner != nil && outcome.Request.owner.admissionError() != nil && !outcome.Result.IsError {
		outcome.Result = retiredToolOwnerResult(outcome.Result.AdditionalContexts)
	}
	if outcome.Request.profileLease != nil && !outcome.Request.profileLease.active() && !outcome.Result.IsError {
		outcome.Result = retiredToolOwnerResult(outcome.Result.AdditionalContexts)
	}
	return outcome
}

func (r *ToolRegistry) settle(ctx context.Context, outcome ToolOutcome, nested bool, toolName string, observer func(ToolOutcome)) (ToolOutcome, error) {
	// Keep post-execute cleanup and rollback callbacks, but do not let a
	// retired generation commit a successful result at a later observer boundary.
	outcome = retireSuccessfulToolOutcome(outcome)
	request := outcome.Request
	before := outcome.Result
	if request.output != nil {
		before = cloneToolResult(before)
		outcome.Result = cloneToolResult(outcome.Result)
	}
	var err error
	outcome, err = r.After.Run(ctx, outcome, func(_ context.Context, value ToolOutcome) (ToolOutcome, error) { return value, nil })
	// Post-execute policy may transform the result, not transfer an already
	// executed operation to another Agent, call, or execution-token lineage.
	outcome.Request = request
	if err != nil {
		// A failed After callback can still return accepted redacted content.
		// Preserve its error, but never transport the pre-policy message.
		outcome.Result = normalizeToolErrorOutputAfter(request, before, outcome.Result)
		return outcome, err
	}
	outcome.Result = normalizeToolOutputAfter(ctx, request, before, outcome.Result)
	outcome = retireSuccessfulToolOutcome(outcome)
	outcome.Result = settleToolProjection(ctx, request, outcome.Result)
	outcome = retireSuccessfulToolOutcome(outcome)
	if r.spills != nil && !request.dshOutputProjection {
		outcome.Result, err = r.spills.Project(ctx, outcome.Request, outcome.Result, nested)
		if err != nil {
			return outcome, err
		}
	}
	outcome = retireSuccessfulToolOutcome(outcome)
	// A failed authoritative result cannot end the turn, even if a provisional
	// tool body requested it before a post-execute policy rejected the result.
	if outcome.Result.IsError {
		outcome.Result.ConcludesTurn = false
	}
	if observer != nil {
		if err := callToolResultObserver(toolName, observer, observerToolOutcome(outcome)); err != nil {
			return outcome, err
		}
	}
	outcome = retireSuccessfulToolOutcome(outcome)
	if err := r.Results.EmitCurrent(ctx, func() ToolOutcome { return observerToolOutcome(retireSuccessfulToolOutcome(outcome)) }); err != nil {
		return outcome, err
	}
	return retireSuccessfulToolOutcome(outcome), nil
}

func callToolResultObserver(name string, observer func(ToolOutcome), outcome ToolOutcome) (err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("harness: tool %q result observer panicked: %v", name, recovered)
		}
	}()
	observer(outcome)
	return nil
}
