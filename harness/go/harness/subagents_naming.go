package harness

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
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

// DSHIdentityGuidance tells managed agents their own address and their durable
// creator. A root that hosts a cold child is not the child's creator.
func (r *SubagentRegistry) DSHIdentityGuidance(ctx context.Context, caller *Agent, capabilities PromptCapabilities) (string, error) {
	if caller == nil || !capabilities.HasTool("send_message") && !capabilities.HasTool("list_agents") {
		return "", nil
	}
	r.mu.RLock()
	root, err := r.liveTreeRootLocked(caller)
	path := []SessionID{caller.ID()}
	if err == nil {
		for current := caller; current != root; {
			record := r.records[current.ID()]
			if len(record.creationAncestors) > 0 {
				path = append(path, record.creationAncestors...)
				break
			}
			current = record.parent
			path = append(path, current.ID())
		}
	}
	r.mu.RUnlock()
	if err != nil {
		return "Your DSH agent ID is " + strconv.Quote(string(caller.ID())) + ". Your collaboration root is unavailable; continue independent work.", nil
	}
	var guidance string
	if caller == root {
		guidance = `You are the root agent of this DSH tree. Your address is "lead".`
	} else {
		self, creator := string(path[0]), string(path[1])
		if path[1] == root.ID() {
			creator = "lead"
		}
		if read, query, release, err := r.beginCatalogRead(ctx, caller); err == nil {
			defer release()
			var segments []string
			for i := len(path) - 1; i > 0; i-- {
				rows, err := query.ReadSubagentCatalog(read, path[i])
				if err != nil {
					break
				}
				var name string
				for _, row := range rows {
					if row.ID == path[i-1] {
						name = row.Name
						break
					}
				}
				if name == "" {
					break
				}
				segments = append(segments, name)
				if i == 2 {
					creator = strings.Join(segments, "/")
				}
				if i == 1 {
					self = strings.Join(segments, "/")
				}
			}
		}
		if current, err := r.LiveTreeRoot(caller); err != nil || current != root {
			return "Your DSH agent ID is " + strconv.Quote(string(caller.ID())) + ". Your collaboration root is unavailable; continue independent work.", nil
		}
		guidance = "Your DSH agent address is " + strconv.Quote(self) + ". Your original creator's address is " + strconv.Quote(creator) + `. The root is "lead".`
		if capabilities.HasTool("send_message") && !capabilities.HasTool("team_task_update") {
			guidance += " When you finish, send your creator a self-contained result."
		}
	}
	if capabilities.HasTool("send_message") {
		guidance += " Use send_message to communicate without ending your turn."
	}
	if capabilities.HasTool("list_agents") {
		guidance += " Use list_agents to find collaborator addresses."
	}
	return guidance, nil
}
