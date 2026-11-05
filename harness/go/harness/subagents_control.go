package harness

import (
	"context"
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
	return f.registry.interruptActivation(caller, "", target, runID, f)
}
func (f *SubagentFacade) InterruptActivationByParentID(parentID, target SessionID, runID string) error {
	return f.registry.interruptActivation(nil, parentID, target, runID, f)
}
