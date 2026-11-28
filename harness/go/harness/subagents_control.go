package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
)

// DeliverSubagentPrompt is the trusted Host protocol seam. The browser adapter
// validates its source descriptor and attachment payload before invoking it.
// Unlike SendMessage, it preserves supplied user/protocol attribution verbatim.
func (r *SubagentRegistry) DeliverSubagentPrompt(ctx context.Context, parent *Agent, childID SessionID, message Message, delivery string) (messageID string, returnedErr error) {
	_, id, err := r.deliverSubagentPrompt(ctx, parent, childID, message, delivery)
	return id, err
}

func (r *SubagentRegistry) deliverSubagentPrompt(ctx context.Context, parent *Agent, childID SessionID, message Message, delivery string) (acceptedRecord *subagentRecord, messageID string, returnedErr error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if delivery != "queue" && delivery != "steer" {
		return nil, "", errors.New("harness: subagent delivery must be queue or steer")
	}
	if r == nil || !r.beginSubagentCallback() {
		return nil, "", ErrSubagentAdmissionClosed
	}
	defer r.endSubagentCallback()
	if err := ctx.Err(); err != nil {
		return nil, "", err
	}
	if err := r.requireLiveParent(parent); err != nil {
		return nil, "", err
	}
	if message.Role == "" {
		message.Role = RoleUser
	}
	if message.Role != RoleUser || len(message.Content) == 0 {
		return nil, "", errors.New("harness: subagent prompt requires nonempty user content")
	}
	if message.ID == "" {
		var err error
		message.ID, err = newMessageID()
		if err != nil {
			return nil, "", err
		}
	}
	preparation, release, err := r.reserveSubagentPreparation(ctx, parent)
	if err != nil {
		return nil, "", err
	}
	defer release()
	record, created, err := r.continuableRecordMode(preparation, parent, childID, true)
	if err != nil {
		if errors.Is(err, ErrSubagentResumeUnavailable) {
			return nil, "", &subagentActivationError{err.Error(), "NOT_RESUMABLE"}
		}
		return nil, "", err
	}
	if created {
		defer func() {
			record.activation.finishInitial()
			if returnedErr != nil {
				r.beginActivationCleanup(record)
			}
		}()
	}
	operation, err := record.child.beginOperation(ctx)
	if err != nil {
		return nil, "", err
	}
	defer operation.release()
	if err := assertSubagentImageCapable(operation.context, record.child, message.Content); err != nil {
		return nil, "", err
	}
	if err := r.admitActivationMessage(operation.context, record, parent, nil, cloneMessage(message), delivery); err != nil {
		return nil, "", err
	}
	return record, message.ID, nil
}

func assertSubagentImageCapable(ctx context.Context, child *Agent, content []ContentBlock) error {
	hasImage := slices.ContainsFunc(content, func(block ContentBlock) bool { return block.Type == BlockImage })
	if !hasImage || child.modelInfo == nil {
		return nil
	}
	selection := child.ModelSelection()
	if selection.Provider == "" || selection.Model == "" {
		return nil
	}
	info, err := child.modelInfo.ResolveModelInfo(ctx, selection.Provider, selection.Model)
	if err != nil {
		return err
	}
	if info.InputModalities != nil && !slices.Contains(info.InputModalities, "image") {
		return &subagentActivationError{fmt.Sprintf("Model %q does not support image input.", selection.Model), "MODEL_DOES_NOT_SUPPORT_IMAGES"}
	}
	return nil
}

func (f *SubagentFacade) InterruptActivation(caller *Agent, target SessionID, runID string) error {
	return f.registry.interruptActivation(caller, "", target, runID, f, false)
}
func (f *SubagentFacade) InterruptActivationByParentID(parentID, target SessionID, runID string) error {
	return f.registry.interruptActivation(nil, parentID, target, runID, f, false)
}

// DSHControlTools are the model-facing adapters. The registry, not model
// arguments or catalog visibility, determines who can deliver or interrupt.
func (r *SubagentRegistry) DSHControlTools() []Tool {
	return []Tool{
		r.dshControlTool("send_message",
			"Send text to another agent in your tree. A working agent receives it at its next step. An idle agent starts a turn when its saved route and tree allow it to resume. Returns a delivery ID.",
			`{"type":"object","properties":{"agent":{"type":"string","description":"Agent name or path shown by list_agents"},"message":{"type":"string"}},"required":["agent","message"],"additionalProperties":false}`,
			func(ctx context.Context, caller *Agent, target SessionID, message *string) (ToolResult, error) {
				if message == nil {
					return ToolResult{}, errors.New("send_message requires a text message")
				}
				id, err := r.sendMessage(ctx, caller, target, []ContentBlock{{Type: BlockText, Text: *message}}, subagentMessageNativeDSH)
				if err != nil {
					return ToolResult{}, err
				}
				raw, _ := json.Marshal(struct {
					MessageID string `json:"messageId"`
				}{id})
				return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: string(raw)}}}, nil
			}),
		r.dshControlTool("interrupt_agent",
			"Ask one of your descendants to stop its current work without stopping its own descendants. An inactive target is not started by this tool. Acceptance is not proof that cancellation has settled.",
			`{"type":"object","properties":{"agent":{"type":"string","description":"Name or path of a descendant from list_agents"}},"required":["agent"],"additionalProperties":false}`,
			func(ctx context.Context, caller *Agent, target SessionID, _ *string) (ToolResult, error) {
				if err := ctx.Err(); err != nil {
					return ToolResult{}, context.Cause(ctx)
				}
				if err := r.InterruptDSH(caller, target); err != nil {
					return ToolResult{}, err
				}
				return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: `{"accepted":true}`}}}, nil
			}),
	}
}

func (r *SubagentRegistry) dshControlTool(name, description, schema string, execute func(context.Context, *Agent, SessionID, *string) (ToolResult, error)) Tool {
	return Tool{
		Schema: ToolSchema{Name: name, Description: description, InputSchema: json.RawMessage(schema)},
		ExecuteRequest: func(ctx context.Context, request ToolRequest) (ToolResult, error) {
			lineage, _ := ctx.Value(toolCallLineageKey{}).(toolCallLineage)
			if request.Agent == nil || lineage.owner != request.Agent {
				return ToolResult{}, &subagentActivationError{name + " requires the exact live calling agent", "UNAUTHORIZED"}
			}
			var input struct {
				Agent   *string `json:"agent"`
				Message *string `json:"message"`
			}
			if err := json.Unmarshal(request.Arguments, &input); err != nil {
				return ToolResult{}, err
			}
			if input.Agent == nil {
				return ToolResult{}, errors.New(name + " requires an agent address")
			}
			target, err := r.ResolveAgentNameDSH(ctx, request.Agent, *input.Agent)
			if err != nil {
				return ToolResult{}, err
			}
			return execute(ctx, request.Agent, target, input.Message)
		},
	}
}
