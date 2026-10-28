package harness

import (
	"context"
	"errors"
	"sync"
)

// A preparation's exact parent resource is independent of whether the parent
// itself is a managed activation. The Manager joins this pending receipt only
// after publishing all withdrawn Agent scope receipts.
type subagentParentReceipt struct {
	parent     *Agent
	mu         sync.Mutex
	request    func(context.Context) error
	wait       func(context.Context) error
	claim      *subagentDisposalClaim
	capacity   *subagentCapacityLease
	prepared   func()
	retireOnce sync.Once
}

type subagentPreparationContextKey struct{}

func (r *SubagentRegistry) protectSubagentPreparation(ctx context.Context, parent *Agent) error {
	token, _ := ctx.Value(subagentPreparationContextKey{}).(*subagentPreparation)
	if token == nil {
		return errors.New("harness: provider preparation has no exact parent reservation")
	}
	if token.receipt != nil {
		return nil
	}
	receipt := &subagentParentReceipt{parent: parent, claim: &subagentDisposalClaim{started: true, done: make(chan struct{})}}
	r.mu.RLock()
	manager := r.agents
	r.mu.RUnlock()
	if manager == nil {
		return errors.New("harness: provider preparation requires AgentManager")
	}
	prepared, err := manager.RegisterCleanup(parent, receipt.retire)
	if err != nil {
		return err
	}
	parent.subagentReceipts.Add(1)
	receipt.prepared = prepared
	token.receipt = receipt
	return nil
}

func retainSubagentPreparationReceipt(ctx context.Context, request func(context.Context) error, wait func(context.Context) error) {
	token, _ := ctx.Value(subagentPreparationContextKey{}).(*subagentPreparation)
	if token == nil || token.receipt == nil {
		return
	}
	token.receipt.request, token.receipt.wait = request, wait
}

// No external callback runs on the Manager's resource-cleanup stack. A callback
// can retire this same parent with a fresh context without joining itself.
func (p *subagentParentReceipt) retire(context.Context) error {
	p.retireOnce.Do(func() {
		p.mu.Lock()
		request := p.request
		p.mu.Unlock()
		if request != nil {
			go func() { _ = callSubagentCleanup(func() error { return request(context.Background()) }) }()
		}
	})
	select {
	case <-p.claim.done:
		return p.claim.wait(context.Background())
	default:
		return &subagentDisposalPending{claim: p.claim}
	}
}

func (p *subagentParentReceipt) publish() {
	wait := p.wait
	capacity := p.capacity
	parent := p.parent
	prepared := p.prepared
	p.prepared = nil
	// All request/wait fields are final before the Manager can call retire.
	prepared()
	// No resource was established: return a failed reservation before its caller retries.
	if wait == nil {
		capacity.close()
	}
	go func() {
		var err error
		if wait != nil {
			err = wait(context.Background())
		}
		p.mu.Lock()
		p.request, p.wait, p.parent = nil, nil, nil
		p.mu.Unlock()
		capacity.close()
		parent.subagentReceipts.Add(-1)
		p.claim.complete(err)
	}()
}

func (r *SubagentRegistry) retainPreparedSubagentDisposal(ctx context.Context, disposal *subagentDisposalClaim, child *Agent) {
	if disposal == nil {
		return
	}
	r.mu.RLock()
	manager := r.agents
	r.mu.RUnlock()
	retainSubagentPreparationReceipt(ctx, disposal.callback(), func(ctx context.Context) error {
		err := disposal.wait(ctx)
		if child != nil && manager != nil {
			err = errors.Join(err, manager.WaitRetired(ctx, child))
		}
		return err
	})
}

func (r *SubagentRegistry) retainPreparedSubagentRecord(ctx context.Context, record *subagentRecord) {
	if token, _ := ctx.Value(subagentPreparationContextKey{}).(*subagentPreparation); token != nil {
		r.mu.Lock()
		token.bound = record
		r.mu.Unlock()
	}
	if record.activation == nil {
		return
	}
	retainSubagentPreparationReceipt(ctx, func(context.Context) error { return r.requestActivationDisposal(record) }, record.activation.wait)
}
