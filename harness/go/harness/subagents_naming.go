package harness

import (
	"encoding/json"
	"strconv"
	"sync"

	point "github.com/phodal/pero/harness/go/runtime"
)

// A reservation spans provider startup and the synchronous catalog append.
// A settled child is represented only by its creator's own journal.
func (r *SubagentRegistry) reserveDSHAgentName(parent *Agent, requested *string) (string, func(), error) {
	if requested != nil && !validDSHAgentName(*requested) {
		return "", nil, &subagentActivationError{"agent name must be 1-32 lower-case letters, digits or hyphens starting with a letter, other than lead", "INVALID_AGENT_NAME"}
	}
	projections, ok := point.Lookup(r.runtime, r.runtime.Root(), SessionProjectionKey)
	if !ok {
		return "", nil, ErrSubagentCatalogProjectionsUnavailable
	}
	r.nameMu.Lock()
	defer r.nameMu.Unlock()
	snapshot, err := projections.Snapshot(parent.Session(), "subagentCatalog")
	if err != nil {
		return "", nil, err
	}
	raw, ok := snapshot.Values["subagentCatalog"]
	if !ok {
		return "", nil, ErrSubagentCatalogProjectionsUnavailable
	}
	var rows []SubagentChildCatalogEntry
	if err := json.Unmarshal(raw, &rows); err != nil {
		return "", nil, err
	}
	taken := make(map[string]bool, len(rows))
	for _, row := range rows {
		if row.Name != "" {
			taken[row.Name] = true
		}
	}
	pending := r.pendingNames[parent]
	var name string
	if requested != nil {
		name = *requested
		if taken[name] || pending[name] {
			return "", nil, &subagentActivationError{"agent name is already used by a sibling", "DUPLICATE_AGENT_NAME"}
		}
	} else {
		for n := 1; ; n++ {
			name = "agent-" + strconv.Itoa(n)
			if !taken[name] && !pending[name] {
				break
			}
		}
	}
	if pending == nil {
		pending = make(map[string]bool)
		if r.pendingNames == nil {
			r.pendingNames = make(map[*Agent]map[string]bool)
		}
		r.pendingNames[parent] = pending
	}
	pending[name] = true
	var once sync.Once
	release := func() {
		once.Do(func() {
			r.nameMu.Lock()
			defer r.nameMu.Unlock()
			delete(pending, name)
			if len(pending) == 0 {
				delete(r.pendingNames, parent)
			}
		})
	}
	return name, release, nil
}
