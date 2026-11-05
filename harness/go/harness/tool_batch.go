package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/tool"
)

func (a *Agent) executeToolCalls(ctx context.Context, turn, step int, calls []ContentBlock) (bool, error) {
	outcomes := make([]ToolOutcome, len(calls))
	toolCtx, cancelTools := context.WithCancel(ctx)
	defer cancelTools()
	interrupted := false
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
		if interrupted {
			call := calls[start]
			outcomes[start] = ToolOutcome{Request: ToolRequest{Agent: a, CallID: call.ToolCallID, Name: call.Name, Arguments: call.Arguments}, Result: ToolResult{IsError: true, Content: []ContentBlock{{Type: BlockText, Text: "Tool batch interrupted before dispatch."}}}}
			start++
			continue
		}
		if a.toolExecutionMode(ctx, calls[start]) == ExecutionSerial {
			outcomes[start] = a.executeOneTool(toolCtx, calls[start])
			if outcomes[start].Request.EndTurn {
				interrupted = true
				cancelTools()
			}
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
					outcomes[index] = a.executeOneTool(toolCtx, calls[index])
					done <- index
				}()
			}
			if active == 0 {
				break
			}
			index := <-done
			if outcomes[index].Request.EndTurn {
				interrupted, barrier = true, true
				cancelTools()
			}
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
		concluded = concluded || outcome.Request.EndTurn || outcome.Result.ConcludesTurn
		if reminder := a.toolProgress.observe(turn, calls[index], outcome.Result); reminder != nil {
			deferred = append(deferred, *reminder)
		}
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
	if err := a.projectToolBatch(ctx, outcomes, blocks); err != nil {
		return false, err
	}
	// OpenAI-compatible histories require every result for one assistant tool
	// batch to remain contiguous. Deferred user context is therefore committed
	// only after all results, while preserving call and context order.
	for i, block := range blocks {
		if _, err := a.session.Append("tool/result", block); err != nil {
			return false, err
		}
		d := tool.ObserveDiagnostic(calls[i].Name, calls[i].Arguments, outcomes[i].Result.Content, outcomes[i].Result.IsError)
		if d.Failed {
			if _, err := a.session.Append("tool/diagnostic", struct {
				Turn       int             `json:"turn"`
				Step       int             `json:"step"`
				CallID     ToolCallID      `json:"callId"`
				Diagnostic tool.Diagnostic `json:"diagnostic"`
			}{turn, step, calls[i].ToolCallID, d}); err != nil {
				return false, err
			}
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
		var interrupt *ToolInterruptError
		request.EndTurn = errors.As(err, &interrupt)
		return ToolOutcome{Request: request, Result: ToolResult{IsError: true, ConcludesTurn: request.EndTurn, Content: []ContentBlock{{Type: BlockText, Text: err.Error()}}}}
	}
	return outcome
}
