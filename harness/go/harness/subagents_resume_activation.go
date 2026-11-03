package harness

import (
	"context"
	"errors"
)

type resumeDeliveryKey struct{}

// ResumeActivation accepts a new prompt under this facade's exact parent
// authority and returns the cleanup/result handle of that execution epoch.
func (f *SubagentFacade) ResumeActivation(ctx context.Context, parent *Agent, id SessionID, message Message) (SubagentActivation, error) {
	admitted, release, err := f.BeginOperation(ctx)
	if err != nil {
		return SubagentActivation{}, err
	}
	defer release()
	record, messageID, err := f.registry.deliverSubagentPrompt(context.WithValue(admitted, resumeDeliveryKey{}, "caller"), parent, id, message, "queue")
	if err != nil {
		return SubagentActivation{}, err
	}
	state := record.activation
	if state == nil {
		return SubagentActivation{}, errors.New("harness: resumed child has no managed activation")
	}
	return SubagentActivation{ChildID: id, MessageID: messageID, Result: state.result, Done: state.done, Wait: state.wait, Dispose: func(ctx context.Context) error { return f.registry.disposeActivation(ctx, record) }, RequestDispose: func() error { return f.registry.requestActivationDisposal(record) }}, nil
}
