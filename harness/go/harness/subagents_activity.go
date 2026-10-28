package harness

import (
	"context"
	"sync"
)

// RegisterArchivedSessionCheck attaches a read-only archive admission fence.
// The function runs under the registry mutex: it must only read an immutable or
// atomic snapshot, and must not block, perform I/O, or reenter the registry.
func (r *SubagentRegistry) RegisterArchivedSessionCheck(check func(SessionID) bool) func() {
	if check == nil {
		return func() {}
	}
	r.mu.Lock()
	r.nextID++
	id := r.nextID
	if r.archiveChecks == nil {
		r.archiveChecks = make(map[uint64]func(SessionID) bool)
	}
	r.archiveChecks[id] = check
	r.mu.Unlock()
	var once sync.Once
	return func() { once.Do(func() { r.mu.Lock(); delete(r.archiveChecks, id); r.mu.Unlock() }) }
}

func (r *SubagentRegistry) parentAdmitsLocked(parent *Agent) bool {
	if !r.liveParentLocked(parent) {
		return false
	}
	visited := make(map[*Agent]bool)
	for current := parent; current != nil && !visited[current]; current = current.Parent() {
		visited[current] = true
		if _, closed := r.closedParents[current]; closed {
			return false
		}
		for _, archived := range r.archiveChecks {
			if archived(current.ID()) {
				return false
			}
		}
		// A public fork's source session is not an execution owner.
		if !current.Delegated() {
			break
		}
	}
	return true
}

func (r *SubagentRegistry) preparationAdmitsLocked(ctx context.Context, parent *Agent) bool {
	if !r.parentAdmitsLocked(parent) {
		return false
	}
	facade, _ := ctx.Value(subagentFacadeContextKey{}).(*SubagentFacade)
	return facade == nil || facade.registry == r && !facade.closing && !subagentWithin(parent, facade.closedParents)
}

type SubagentActivityItem struct {
	ID    SessionID
	Label string
}
type SubagentActivitySnapshot struct {
	Active bool
	Items  []SubagentActivityItem
	Stop   func(context.Context) error
}

// CaptureSessionActivity captures exact runtime roots before an archive
// transaction. Stop rechecks only those roots after the durable archive fence
// is published, never adopting a replacement by SessionID.
func (r *SubagentRegistry) CaptureSessionActivity(id SessionID) SubagentActivitySnapshot {
	r.mu.Lock()
	roots := make(map[*Agent]struct{})
	consider := func(parent *Agent) {
		visited := make(map[*Agent]bool)
		for current := parent; current != nil && !visited[current]; current = current.Parent() {
			visited[current] = true
			if current.ID() == id {
				roots[current] = struct{}{}
				return
			}
			if !current.Delegated() {
				return
			}
		}
	}
	if r.agents != nil {
		if root, ok := r.agents.Get(id); ok {
			consider(root)
		}
	}
	for parent := range r.parentRecords {
		consider(parent)
	}
	for parent := range r.preparationReceipts {
		consider(parent)
	}
	records := r.descendantRecordsLocked(roots)
	tokens := r.descendantPreparationsLocked(roots, true)
	snapshot := SubagentActivitySnapshot{}
	for _, token := range tokens {
		if token.bound == nil {
			snapshot.Active = true
		}
	}
	seen := make(map[SessionID]bool)
	for _, record := range records {
		active := record.child == nil || record.child.Status() != AgentIdle || record.activation != nil && record.activation.closing.Load()
		if active {
			snapshot.Active = true
			if !seen[record.snapshot.ID] {
				seen[record.snapshot.ID] = true
				snapshot.Items = append(snapshot.Items, SubagentActivityItem{ID: record.snapshot.ID, Label: record.snapshot.Label})
			}
		}
	}
	r.mu.Unlock()
	snapshot.Stop = func(context.Context) error {
		r.mu.Lock()
		current := r.descendantRecordsLocked(roots)
		pending := r.descendantPreparationsLocked(roots, true)
		r.mu.Unlock()
		for _, token := range pending {
			token.cancel(ErrSubagentAdmissionClosed)
		}
		for _, record := range current {
			if record.child != nil {
				record.child.Cancel(ErrSubagentAdmissionClosed)
				continue
			}
			if record.activation != nil {
				r.beginActivationCleanup(record)
			} else if record.run.Cancel != nil {
				go func(record *subagentRecord) {
					_ = callSubagentCleanup(func() error { record.run.Cancel(ErrSubagentAdmissionClosed); return nil })
				}(record)
			}
		}
		return nil
	}
	return snapshot
}
