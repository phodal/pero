package harness

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"

	point "github.com/phodal/pero/harness/go/runtime"
)

// sessionSubagentCatalogQuery reads the parent's journal, not the global
// roster or the child's descriptor. Detached reads do not publish Sessions.
type sessionSubagentCatalogQuery struct {
	run         *point.Run
	sessions    *SessionStore
	projections *SessionProjectionRegistry
	persistence SessionPersistence
}

// ProvideSubagentCatalogQuery binds the read side to the current contribution.
func (h *Harness) ProvideSubagentCatalogQuery(run *point.Run, persistence SessionPersistence) error {
	query := &sessionSubagentCatalogQuery{run, h.Sessions(), h.Projections(), persistence}
	_, err := point.Provide(run, SubagentCatalogQueryKey, SubagentCatalogQuery(query))
	return err
}

func (q *sessionSubagentCatalogQuery) check(ctx context.Context) error {
	if !q.run.Active() || q.run.Context.Err() != nil {
		return ErrSubagentCatalogOwnerRetired
	}
	return context.Cause(ctx)
}

func (q *sessionSubagentCatalogQuery) BeginSubagentCatalogRead(ctx context.Context) (context.Context, SubagentCatalogQuery, func(), error) {
	if err := q.check(ctx); err != nil {
		return nil, nil, nil, err
	}
	admitted, cancel := context.WithCancelCause(ctx)
	stop := context.AfterFunc(q.run.Context, func() { cancel(ErrSubagentCatalogOwnerRetired) })
	return admitted, q, func() { stop(); cancel(context.Canceled) }, nil
}

func (q *sessionSubagentCatalogQuery) SubagentSessionResident(id SessionID) bool {
	_, live := q.sessions.Get(id)
	return live
}

func (q *sessionSubagentCatalogQuery) ReadSubagentCatalog(ctx context.Context, id SessionID) ([]SubagentChildCatalogEntry, error) {
	if err := q.check(ctx); err != nil {
		return nil, err
	}
	unavailable := errors.New("subagent catalog session is unavailable")
	corrupt := catalogReadError("subagent catalog session is corrupt")
	session, live := q.sessions.Get(id)
	if !live {
		if q.persistence == nil {
			return nil, unavailable
		}
		var err error
		session, err = q.persistence.Load(ctx, id)
		if fence := q.check(ctx); fence != nil {
			return nil, fence
		}
		if err != nil {
			var path *fs.PathError
			if errors.As(err, &path) {
				return nil, unavailable
			}
			return nil, corrupt
		}
	}
	snapshot, err := q.projections.Snapshot(session, "subagentCatalog")
	if fence := q.check(ctx); fence != nil {
		return nil, fence
	}
	if err != nil {
		return nil, corrupt
	}
	value, present := snapshot.Values["subagentCatalog"]
	if !present {
		return nil, ErrSubagentCatalogProjectionsUnavailable
	}
	var rows []SubagentChildCatalogEntry
	if err := json.Unmarshal(value, &rows); err != nil {
		return nil, corrupt
	}
	return rows, nil
}

type catalogReadError string

func (e catalogReadError) Error() string         { return string(e) }
func (e catalogReadError) ToolErrorCode() string { return "SESSION_QUERY_CORRUPT_SESSION" }
