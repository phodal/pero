package harness

import (
	"context"
	"errors"
	"strings"

	point "github.com/phodal/pero/harness/go/runtime"
)

// SubagentCatalogQuery is the read-only capability supplied by session-query.
// It never loads an Agent, adopts control authority, or globally scans child
// descriptors. The returned rows belong to this exact parent's own log suffix.
type SubagentCatalogQuery interface {
	ReadSubagentCatalog(context.Context, SessionID) ([]SubagentChildCatalogEntry, error)
	SubagentSessionResident(SessionID) bool
}

// SubagentCatalogReadOwner is optional for legacy query consumers. DSH tool
// discovery requires an exact query-owner receipt for its complete traversal.
// The release function must be idempotent; the returned query must fence owner
// retirement before and after reads. It grants no Agent/control authority.
type SubagentCatalogReadOwner interface {
	BeginSubagentCatalogRead(context.Context) (context.Context, SubagentCatalogQuery, func(), error)
}

var SubagentCatalogQueryKey = point.NewKey[SubagentCatalogQuery]("harness.subagent-catalog-query")

type subagentCatalogError struct{ code, message string }

func (e *subagentCatalogError) Error() string         { return e.message }
func (e *subagentCatalogError) ToolErrorCode() string { return e.code }

var ErrSubagentCatalogQueryUnavailable = &subagentCatalogError{"SUBAGENT_CONTROL_QUERY_UNAVAILABLE", "listing subagents requires the session query service"}
var ErrSubagentCatalogProjectionsUnavailable = &subagentCatalogError{"SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE", "listing subagents requires the registered subagentCatalog projection"}
var ErrSubagentCatalogOwnerRetired = &subagentCatalogError{"SUBAGENT_CONTROL_QUERY_RETIRED", "subagent catalog query owner is retired"}
var ErrSubagentCatalogReadOwnerUnavailable = &subagentCatalogError{"SUBAGENT_CONTROL_QUERY_UNAVAILABLE", "listing subagents requires a query owner read lease"}
var errSubagentListingCancelled = &subagentCatalogError{"CANCELLED", "subagent listing was cancelled"}

// SubagentDescendantEntry matches the current recursive catalog view. Optional
// fields remain absent on diagnostics; createdAt is deliberately not exported.
type SubagentDescendantEntry struct {
	Kind        string    `json:"kind"`
	ID          SessionID `json:"id"`
	ParentID    SessionID `json:"parentId"`
	Depth       int       `json:"depth"`
	Mode        string    `json:"mode,omitempty"`
	Label       *string   `json:"label,omitempty"`
	Name        string    `json:"name,omitempty"`
	Path        string    `json:"path,omitempty"`
	Activity    string    `json:"activity,omitempty"`
	HasChildren *bool     `json:"hasChildren,omitempty"`
	Reason      string    `json:"reason,omitempty"`
}

func (r *SubagentRegistry) catalogQuery() (SubagentCatalogQuery, error) {
	if r == nil || r.runtime == nil {
		return nil, ErrSubagentCatalogQueryUnavailable
	}
	query, ok := point.Lookup(r.runtime, r.runtime.Root(), SubagentCatalogQueryKey)
	if !ok || query == nil {
		return nil, ErrSubagentCatalogQueryUnavailable
	}
	return query, nil
}

// ListChildrenBySessionID reads parent-owned facts in event order, regardless
// of parent Agent residency. Legacy ListChildren/Catalog remain compatibility
// surfaces and are not used by the current public service facade.
func (r *SubagentRegistry) ListChildrenBySessionID(ctx context.Context, parentID SessionID) ([]SubagentChildCatalogEntry, error) {
	query, err := r.catalogQuery()
	if err != nil {
		return nil, err
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return query.ReadSubagentCatalog(ctx, parentID)
}

// ListDescendantsBySessionID follows only reachable catalogs in stable
// pre-order. A read releases all Session observations before the next branch.
func (r *SubagentRegistry) ListDescendantsBySessionID(ctx context.Context, rootID SessionID) ([]SubagentDescendantEntry, error) {
	query, err := r.catalogQuery()
	if err != nil {
		return nil, err
	}
	return listSubagentDescendants(ctx, query, rootID)
}

func listSubagentDescendants(ctx context.Context, query SubagentCatalogQuery, rootID SessionID) ([]SubagentDescendantEntry, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	read := func(id SessionID) ([]SubagentChildCatalogEntry, error) {
		if errors.Is(context.Cause(ctx), ErrSubagentCatalogOwnerRetired) {
			return nil, ErrSubagentCatalogOwnerRetired
		}
		if ctx.Err() != nil {
			return nil, errSubagentListingCancelled
		}
		rows, err := query.ReadSubagentCatalog(ctx, id)
		// A dependency retirement is fatal, never a contained branch failure.
		if errors.Is(err, ErrSubagentCatalogOwnerRetired) {
			return nil, err
		}
		if errors.Is(context.Cause(ctx), ErrSubagentCatalogOwnerRetired) {
			return nil, ErrSubagentCatalogOwnerRetired
		}
		if ctx.Err() != nil {
			return nil, errSubagentListingCancelled
		}
		return rows, err
	}
	children, err := read(rootID)
	if err != nil {
		return nil, err
	}
	type position struct {
		entry  SubagentChildCatalogEntry
		parent SessionID
		depth  int
		path   string
	}
	stack := make([]position, 0, len(children))
	push := func(rows []SubagentChildCatalogEntry, parent SessionID, depth int, path string) {
		for i := len(rows) - 1; i >= 0; i-- {
			stack = append(stack, position{rows[i], parent, depth, path})
		}
	}
	push(children, rootID, 1, "")
	visited := map[SessionID]bool{rootID: true}
	result := make([]SubagentDescendantEntry, 0)
	for len(stack) > 0 {
		last := len(stack) - 1
		position := stack[last]
		stack = stack[:last]
		entry := position.entry
		if visited[entry.ID] {
			continue
		}
		visited[entry.ID] = true
		children = nil
		if entry.Mode != "external" {
			children, err = read(entry.ID)
		} else {
			err = nil
		}
		row := SubagentDescendantEntry{ID: entry.ID, ParentID: position.parent, Depth: position.depth}
		if entry.Name != "" {
			switch {
			case position.depth == 1:
				row.Path = entry.Name
			case position.path != "":
				row.Path = position.path + "/" + entry.Name
			}
		}
		if err != nil {
			var fatal *subagentCatalogError
			var callerFence *subagentCatalogCallerError
			if errors.As(err, &fatal) || errors.As(err, &callerFence) {
				return nil, err
			}
			row.Kind = "diagnostic"
			row.Reason = "unavailable"
			var coded interface{ ToolErrorCode() string }
			if errors.As(err, &coded) && (coded.ToolErrorCode() == "SESSION_QUERY_CORRUPT_SESSION" || coded.ToolErrorCode() == "SESSION_QUERY_SOURCE_CONFLICT") {
				row.Reason = "corrupt"
			}
			result = append(result, row)
			continue
		}
		if entry.Mode == "unknown" {
			row.Kind = "diagnostic"
			row.Reason = "unsupported"
		} else {
			row.Kind = "child"
			row.Mode = entry.Mode
			row.Label = entry.Label
			row.Name = entry.Name
			row.Activity = "inactive"
			if query.SubagentSessionResident(entry.ID) {
				row.Activity = "running"
			}
			has := len(children) > 0
			row.HasChildren = &has
		}
		result = append(result, row)
		push(children, entry.ID, position.depth+1, row.Path)
	}
	return result, nil
}

// subagentCatalogCallerError keeps exact-caller failures fatal across the
// existing traversal's branch-diagnostic boundary.
type subagentCatalogCallerError struct{ error }

func (e *subagentCatalogCallerError) Unwrap() error { return e.error }

type agentCatalogQuery struct {
	SubagentCatalogQuery
	registry *SubagentRegistry
	parent   *Agent
}

func (q agentCatalogQuery) ReadSubagentCatalog(ctx context.Context, id SessionID) ([]SubagentChildCatalogEntry, error) {
	if err := q.registry.requireLiveParent(q.parent); err != nil {
		return nil, &subagentCatalogCallerError{err}
	}
	rows, err := q.SubagentCatalogQuery.ReadSubagentCatalog(ctx, id)
	if fence := q.registry.requireLiveParent(q.parent); fence != nil {
		return nil, &subagentCatalogCallerError{fence}
	}
	return rows, err
}

func (r *SubagentRegistry) beginCatalogRead(ctx context.Context, caller *Agent) (context.Context, agentCatalogQuery, func(), error) {
	query, err := r.catalogQuery()
	if err != nil {
		return nil, agentCatalogQuery{}, nil, err
	}
	owner, ok := query.(SubagentCatalogReadOwner)
	if !ok {
		return nil, agentCatalogQuery{}, nil, ErrSubagentCatalogReadOwnerUnavailable
	}
	admitted, leased, release, err := owner.BeginSubagentCatalogRead(ctx)
	if err != nil {
		return nil, agentCatalogQuery{}, nil, err
	}
	if admitted == nil || leased == nil || release == nil {
		if release != nil {
			release()
		}
		return nil, agentCatalogQuery{}, nil, ErrSubagentCatalogReadOwnerUnavailable
	}
	return admitted, agentCatalogQuery{SubagentCatalogQuery: leased, registry: r, parent: caller}, release, nil
}

// ListAgentsDSH reads only exact-caller reachable parent-owned catalogs. Legacy
// Catalog and unrestricted query service entrypoints keep their prior behavior.
func (r *SubagentRegistry) ListAgentsDSH(ctx context.Context, parent *Agent, recursive bool) ([]SubagentDescendantEntry, error) {
	if r == nil || !r.beginSubagentCallback() {
		return nil, ErrSubagentAdmissionClosed
	}
	defer r.endSubagentCallback()
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := r.requireLiveParent(parent); err != nil {
		return nil, err
	}
	admitted, fenced, release, err := r.beginCatalogRead(ctx, parent)
	if err != nil {
		return nil, err
	}
	defer release()
	var rows []SubagentDescendantEntry
	if recursive {
		rows, err = listSubagentDescendants(admitted, fenced, parent.ID())
	} else {
		var children []SubagentChildCatalogEntry
		children, err = fenced.ReadSubagentCatalog(admitted, parent.ID())
		if err == nil {
			rows = make([]SubagentDescendantEntry, 0, len(children))
			for _, child := range children {
				rows = append(rows, SubagentDescendantEntry{Kind: "child", ID: child.ID, Mode: child.Mode, Label: child.Label, Name: child.Name})
			}
		}
	}
	if err != nil {
		return nil, err
	}
	if err := admitted.Err(); err != nil {
		return nil, context.Cause(admitted)
	}
	if err := r.requireLiveParent(parent); err != nil {
		return nil, err
	}
	// Source public status is Agent turn activity, not Session residency.
	for i := range rows {
		if rows[i].Kind != "child" {
			continue
		}
		rows[i].Activity = "inactive"
		if agent, ok := r.agents.Get(rows[i].ID); ok && agent != nil && agent.Status() == AgentRunning {
			rows[i].Activity = "running"
		}
	}
	return rows, nil
}

// A DSH child address is a machine name, not the display label.
func validDSHAgentName(name string) bool {
	if len(name) == 0 || len(name) > 32 || name == "lead" || name[0] < 'a' || name[0] > 'z' {
		return false
	}
	for i := 1; i < len(name); i++ {
		c := name[i]
		if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
			return false
		}
	}
	return true
}

// ResolveAgentNameDSH translates a root-relative name through parent journals.
// The returned ID is not a membership or control grant. A single unmatched
// token is an ID candidate; a slash path must resolve within this live tree.
func (r *SubagentRegistry) ResolveAgentNameDSH(ctx context.Context, caller *Agent, address string) (SessionID, error) {
	if r == nil || !r.beginSubagentCallback() {
		return "", ErrSubagentAdmissionClosed
	}
	defer r.endSubagentCallback()
	if ctx == nil {
		ctx = context.Background()
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	root, err := r.LiveTreeRoot(caller)
	if err != nil {
		return "", err
	}
	if address == "lead" {
		return root.ID(), nil
	}
	segments := strings.Split(address, "/")
	missing := func() (SessionID, error) {
		if len(segments) == 1 {
			return SessionID(address), nil
		}
		return "", &subagentActivationError{"agent path was not found in this subagent tree", "AGENT_NAME_NOT_FOUND"}
	}
	for _, segment := range segments {
		if !validDSHAgentName(segment) {
			return missing()
		}
	}
	admitted, fenced, release, err := r.beginCatalogRead(ctx, caller)
	if err != nil {
		return "", err
	}
	defer release()
	current := root.ID()
	visited := map[SessionID]bool{current: true}
	for i, segment := range segments {
		rows, err := fenced.ReadSubagentCatalog(admitted, current)
		if err != nil {
			return "", err
		}
		if err := admitted.Err(); err != nil {
			return "", context.Cause(admitted)
		}
		now, err := r.LiveTreeRoot(caller)
		if err != nil {
			return "", err
		}
		if now != root {
			return "", &subagentActivationError{"agent tree changed during name resolution", "UNAUTHORIZED"}
		}
		var found *SubagentChildCatalogEntry
		for j := range rows {
			if rows[j].Name == segment {
				if found != nil {
					return "", &subagentActivationError{"agent path is ambiguous", "DUPLICATE_AGENT_NAME"}
				}
				found = &rows[j]
			}
		}
		if found == nil || visited[found.ID] || i < len(segments)-1 && found.Mode != "continuable" && found.Mode != "one-shot" {
			return missing()
		}
		current = found.ID
		visited[current] = true
	}
	return current, nil
}
