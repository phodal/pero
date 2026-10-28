package harness

import (
	"context"
	"errors"
	"sort"
)

var ErrSubagentAdmissionClosed = &subagentActivationError{"harness: subagent parent admission is closed", "DRAINING"}
var ErrSubagentDrainPending = &subagentActivationError{"harness: descendant drain is pending", "SUBAGENT_DRAIN_PENDING"}

func (r *SubagentRegistry) signalSubagentOwnershipLocked() {
	if r.ownershipChanged != nil {
		close(r.ownershipChanged)
	}
	r.ownershipChanged = make(chan struct{})
}

func scopedSubagentRecords(records []*subagentRecord, facade *SubagentFacade) []*subagentRecord {
	if facade == nil {
		return records
	}
	out := records[:0]
	for _, record := range records {
		if subagentRecordFacade(record) == facade {
			out = append(out, record)
		}
	}
	return out
}
func scopedSubagentPreparations(tokens []*subagentPreparation, facade *SubagentFacade) []*subagentPreparation {
	if facade == nil {
		return tokens
	}
	out := tokens[:0]
	for _, token := range tokens {
		if token.facade == facade {
			out = append(out, token)
		}
	}
	return out
}

func subagentWithin(parent *Agent, roots map[*Agent]struct{}) bool {
	visited := make(map[*Agent]bool)
	for current := parent; current != nil && !visited[current]; current = current.Parent() {
		if _, ok := roots[current]; ok {
			return true
		}
		visited[current] = true
		if !current.Delegated() {
			break
		}
	}
	return false
}

func (r *SubagentRegistry) descendantRecordsLocked(roots map[*Agent]struct{}) []*subagentRecord {
	seen := make(map[*subagentRecord]bool)
	var records []*subagentRecord
	add := func(record *subagentRecord) {
		if record == nil || seen[record] || !subagentWithin(record.parent, roots) {
			return
		}
		if _, isRoot := roots[record.child]; isRoot {
			return
		}
		seen[record] = true
		records = append(records, record)
	}
	for _, record := range r.records {
		add(record)
	}
	for _, owned := range r.parentRecords {
		for record := range owned {
			add(record)
		}
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].snapshot.Depth != records[j].snapshot.Depth {
			return records[i].snapshot.Depth > records[j].snapshot.Depth
		}
		return records[i].snapshot.ID < records[j].snapshot.ID
	})
	return records
}

func (r *SubagentRegistry) descendantPreparationsLocked(roots map[*Agent]struct{}, final bool) []*subagentPreparation {
	all := r.parentPreparations
	if final {
		all = r.preparationReceipts
	}
	var tokens []*subagentPreparation
	for parent, preparations := range all {
		if subagentWithin(parent, roots) {
			for token := range preparations {
				tokens = append(tokens, token)
			}
		}
	}
	return tokens
}

// SubagentDrainReceipt is a final receipt for an immutable set of runtime
// owners. Cancellation of Wait never cancels its already requested cleanup.
type SubagentDrainReceipt struct {
	done        chan struct{}
	err         error
	maySelfWait bool
	agents      map[*Agent]struct{}
}

func (d *SubagentDrainReceipt) Wait(ctx context.Context) error {
	if d == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	select {
	case <-d.done:
		return d.err
	case <-ctx.Done():
		return ctx.Err()
	}
}
func (d *SubagentDrainReceipt) Done() <-chan struct{} { return d.done }

// DisposalDependsOn tests exact live runtime identity for trusted-host callback
// proof. Session IDs and wire-provided claims alone never establish ownership.
func (d *SubagentDrainReceipt) DisposalDependsOn(agent *Agent) bool {
	if d == nil || agent == nil {
		return false
	}
	_, found := d.agents[agent]
	return found
}

// descendantDrainGraphLocked includes retained descendants outside a facade
// whenever the selected parent cleanup still depends on them.
func (r *SubagentRegistry) descendantDrainGraphLocked(records []*subagentRecord) ([]*subagentRecord, map[*Agent]struct{}) {
	pending := append([]*subagentRecord(nil), records...)
	seen := make(map[*subagentRecord]bool)
	agents := make(map[*Agent]struct{})
	var graph []*subagentRecord
	for len(pending) != 0 {
		record := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		if record == nil || seen[record] {
			continue
		}
		seen[record] = true
		graph = append(graph, record)
		if record.child != nil {
			agents[record.child] = struct{}{}
			for child := range r.parentRecords[record.child] {
				pending = append(pending, child)
			}
		}
		if state := record.activation; state != nil {
			for child := range state.owned {
				pending = append(pending, child)
			}
		}
	}
	return graph, agents
}

func (r *SubagentRegistry) startDescendantDrainLocked(records []*subagentRecord, tokens []*subagentPreparation) *SubagentDrainReceipt {
	// Probe the entire exact cleanup graph before this request starts any
	// callbacks. The parent root's standing ownership receipt is not a callback.
	graph, agents := r.descendantDrainGraphLocked(records)
	receipt := &SubagentDrainReceipt{done: make(chan struct{}), agents: agents, maySelfWait: r.callbacks.Load() != 0}
	for _, record := range graph {
		receipt.maySelfWait = receipt.maySelfWait || agentCallbackMaySelfWait(record.child) ||
			(record.disposal != nil && record.disposal.inProgress()) ||
			(record.activation != nil && record.activation.busy.Load() != 0)
	}
	if len(records) == 0 && len(tokens) == 0 {
		close(receipt.done)
		return receipt
	}
	if r.disposed {
		go func() { receipt.err = r.Drain(context.Background()); close(receipt.done) }()
		return receipt
	}
	r.callbackWG.Add(1)
	if r.closedParents == nil {
		r.closedParents = make(map[*Agent]struct{})
	}
	for _, record := range records {
		if record.child != nil {
			r.closedParents[record.child] = struct{}{}
		}
		if record.activation != nil {
			record.activation.closing.Store(true)
		} else if r.records[record.snapshot.ID] == record {
			delete(r.records, record.snapshot.ID)
		}
	}
	// Publication and every input fence precede any foreign cancel/disposer.
	go func() {
		defer r.callbackWG.Done()
		for _, token := range tokens {
			token.cancel(ErrSubagentAdmissionClosed)
		}
		legacy := make(map[*subagentRecord]<-chan error)
		for _, record := range records {
			if record.activation != nil {
				r.beginActivationCleanup(record)
				continue
			}
			done := make(chan error, 1)
			legacy[record] = done
			go func(record *subagentRecord) {
				var err error
				if record.child != nil {
					record.child.Cancel(ErrSubagentAdmissionClosed)
					if r.agents != nil {
						removeErr := r.agents.RemoveExact(context.Background(), record.child)
						if !errors.Is(removeErr, ErrAgentDisposalInProgress) {
							err = errors.Join(err, removeErr)
						}
					}
				}
				if record.run.Cancel != nil {
					err = errors.Join(err, callSubagentCleanup(func() error { record.run.Cancel(ErrSubagentAdmissionClosed); return nil }))
				}
				if record.disposal != nil {
					cleanupErr := record.disposal.invoke(context.Background())
					if errors.Is(cleanupErr, ErrSubagentDisposalInProgress) {
						cleanupErr = record.disposal.wait(context.Background())
					}
					err = errors.Join(err, cleanupErr)
				}
				if record.child != nil && r.agents != nil {
					err = errors.Join(err, r.agents.WaitRetired(context.Background(), record.child))
				}
				done <- err
			}(record)
		}
		var joined error
		for _, record := range records {
			if record.activation != nil {
				joined = errors.Join(joined, record.activation.wait(context.Background()))
			} else {
				joined = errors.Join(joined, <-legacy[record])
			}
		}
		for _, token := range tokens {
			<-token.settled
			joined = errors.Join(joined, token.finalErr)
		}
		r.mu.Lock()
		r.callbackCleanupErr = errors.Join(r.callbackCleanupErr, joined)
		r.mu.Unlock()
		receipt.err = joined
		close(receipt.done)
	}()
	return receipt
}

// BeginDrainDescendants permanently closes delegation below exact live roots
// and requests all-provider cleanup without joining a synchronous callback.
func (r *SubagentRegistry) BeginDrainDescendants(parents []*Agent) *SubagentDrainReceipt {
	return r.beginDrainDescendants(parents, nil)
}

func (r *SubagentRegistry) beginDrainDescendants(parents []*Agent, facade *SubagentFacade) *SubagentDrainReceipt {
	r.mu.Lock()
	defer r.mu.Unlock()
	roots := make(map[*Agent]struct{})
	closed := r.closedParents
	if facade != nil {
		closed = facade.closedParents
	}
	if closed == nil {
		closed = make(map[*Agent]struct{})
		if facade == nil {
			r.closedParents = closed
		} else {
			facade.closedParents = closed
		}
	}
	for _, parent := range parents {
		if r.liveParentLocked(parent) {
			roots[parent] = struct{}{}
			closed[parent] = struct{}{}
		}
	}
	return r.startDescendantDrainLocked(scopedSubagentRecords(r.descendantRecordsLocked(roots), facade), scopedSubagentPreparations(r.descendantPreparationsLocked(roots, true), facade))
}
func (r *SubagentRegistry) DrainDescendants(ctx context.Context, parents []*Agent) error {
	receipt := r.BeginDrainDescendants(parents)
	if receipt.maySelfWait {
		select {
		case <-receipt.done:
			return receipt.err
		default:
			return ErrSubagentDrainPending
		}
	}
	return receipt.Wait(ctx)
}

// BeginDrainChildren validates every selected direct owner before withdrawing
// any child, and retains exact records even after live registry withdrawal.
func (r *SubagentRegistry) BeginDrainChildren(parent *Agent, ids []SessionID) (*SubagentDrainReceipt, error) {
	return r.beginDrainChildren(parent, ids, nil)
}

func (r *SubagentRegistry) beginDrainChildren(parent *Agent, ids []SessionID, facade *SubagentFacade) (*SubagentDrainReceipt, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.liveParentLocked(parent) {
		return nil, &subagentActivationError{"harness: selected child teardown requires the exact live parent", "UNAUTHORIZED"}
	}
	wanted := make(map[SessionID]bool)
	for _, id := range ids {
		wanted[id] = true
	}
	all := scopedSubagentRecords(r.descendantRecordsLocked(map[*Agent]struct{}{parent: {}}), facade)
	selected := make(map[*Agent]struct{})
	var records []*subagentRecord
	seen := make(map[*subagentRecord]bool)
	for id := range wanted {
		if current := r.records[id]; current != nil && (facade == nil || subagentRecordFacade(current) == facade) && current.parent != parent {
			return nil, &subagentActivationError{"harness: selected activation is not a direct child", "UNAUTHORIZED"}
		}
		for _, record := range all {
			if record.snapshot.ID == id {
				if record.parent != parent {
					return nil, &subagentActivationError{"harness: selected activation is not a direct child", "UNAUTHORIZED"}
				}
				records = append(records, record)
				seen[record] = true
				if record.child != nil {
					selected[record.child] = struct{}{}
				}
			}
		}
	}
	for _, record := range scopedSubagentRecords(r.descendantRecordsLocked(selected), facade) {
		if !seen[record] {
			records = append(records, record)
			seen[record] = true
		}
	}
	tokens := scopedSubagentPreparations(r.descendantPreparationsLocked(selected, true), facade)
	seenTokens := make(map[*subagentPreparation]bool)
	for _, token := range tokens {
		seenTokens[token] = true
	}
	for _, pending := range r.preparationReceipts {
		for token := range pending {
			if seen[token.bound] && !seenTokens[token] {
				tokens = append(tokens, token)
				seenTokens[token] = true
			}
		}
	}
	return r.startDescendantDrainLocked(records, tokens), nil
}
func (r *SubagentRegistry) DrainChildren(ctx context.Context, parent *Agent, ids []SessionID) error {
	receipt, err := r.BeginDrainChildren(parent, ids)
	if err != nil {
		return err
	}
	if receipt.maySelfWait {
		select {
		case <-receipt.done:
			return receipt.err
		default:
			return ErrSubagentDrainPending
		}
	}
	return receipt.Wait(ctx)
}

// Facade wait/drain entrypoints are generation-local. Global native callers and
// workspace activity use the Registry methods above instead.
func (f *SubagentFacade) BeginDrainDescendants(parents []*Agent) *SubagentDrainReceipt {
	return f.registry.beginDrainDescendants(parents, f)
}
func (f *SubagentFacade) BeginDrainChildren(parent *Agent, ids []SessionID) (*SubagentDrainReceipt, error) {
	return f.registry.beginDrainChildren(parent, ids, f)
}
