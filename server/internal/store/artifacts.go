package store

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/phodal/pero/server/internal/artifacts"
)

// ReserveArtifactExport is a trusted runtime composition call, not a Worker or
// Agent HTTP capability. It freezes source identities and policy before I/O.
func (s *Store) ReserveArtifactExport(ctx context.Context, source artifacts.Source, policy artifacts.Policy, operationID string) (artifacts.Export, error) {
	if source.Validate() != nil {
		return artifacts.Export{}, artifacts.ErrInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return artifacts.Export{}, err
	}
	defer tx.Rollback(ctx)
	run, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1 FOR UPDATE`, source.RunID))
	if err != nil {
		return artifacts.Export{}, err
	}
	if source.TaskID != run.TaskID || source.Generation != run.Generation || source.ProjectID != run.Spec.ProjectID {
		return artifacts.Export{}, ErrForbidden
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return artifacts.Export{}, err
	}
	next, err := artifacts.NewExport(source, policy, operationID, now)
	if err != nil {
		return next, err
	}
	previous, err := readArtifactExport(tx.QueryRow(ctx, `SELECT data FROM artifact_exports WHERE run_id=$1 AND generation=$2`, source.RunID, source.Generation))
	if err == nil {
		if previous.ID != next.ID || previous.Source != next.Source || previous.PolicyDigest != next.PolicyDigest {
			return artifacts.Export{}, ErrConflict
		}
		return previous, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return artifacts.Export{}, err
	}
	data, err := json.Marshal(next)
	if err != nil {
		return artifacts.Export{}, err
	}
	var inserted string
	err = tx.QueryRow(ctx, `INSERT INTO artifact_exports(id,run_id,generation,project_id,version,phase,data) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`, next.ID, source.RunID, source.Generation, source.ProjectID, next.Version, next.Phase, data).Scan(&inserted)
	if errors.Is(err, pgx.ErrNoRows) {
		return artifacts.Export{}, ErrConflict
	}
	if err != nil {
		return artifacts.Export{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return artifacts.Export{}, err
	}
	return next, nil
}

func readArtifactExport(row pgx.Row) (artifacts.Export, error) {
	var data []byte
	if err := row.Scan(&data); errors.Is(err, pgx.ErrNoRows) {
		return artifacts.Export{}, ErrNotFound
	} else if err != nil {
		return artifacts.Export{}, err
	}
	var value artifacts.Export
	err := json.Unmarshal(data, &value)
	return value, err
}

func (s *Store) ArtifactExport(ctx context.Context, id string) (artifacts.Export, error) {
	return readArtifactExport(s.pool.QueryRow(ctx, `SELECT data FROM artifact_exports WHERE id=$1`, id))
}

// mutateArtifactExport permits an identical original-operation replay even when
// the caller lost the committed version receipt. Conflicting stale writes fail.
func (s *Store) mutateArtifactExport(ctx context.Context, id string, version int64, apply func(artifacts.Export) (artifacts.Export, error)) (artifacts.Export, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return artifacts.Export{}, err
	}
	defer tx.Rollback(ctx)
	previous, err := readArtifactExport(tx.QueryRow(ctx, `SELECT data FROM artifact_exports WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return artifacts.Export{}, err
	}
	next, err := apply(previous)
	if err != nil {
		return artifacts.Export{}, err
	}
	if reflect.DeepEqual(previous, next) {
		return previous, nil
	}
	if previous.Version != version {
		return artifacts.Export{}, ErrConflict
	}
	next.Version++
	data, err := json.Marshal(next)
	if err != nil {
		return artifacts.Export{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE artifact_exports SET version=$2,phase=$3,data=$4 WHERE id=$1`, id, next.Version, next.Phase, data); err != nil {
		return artifacts.Export{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return artifacts.Export{}, err
	}
	return next, nil
}

func (s *Store) BeginArtifactExport(ctx context.Context, id string, version int64, q artifacts.Quiescence) (artifacts.Export, error) {
	return s.mutateArtifactExport(ctx, id, version, func(e artifacts.Export) (artifacts.Export, error) { return e.Begin(q) })
}

func (s *Store) AuthorizeArtifactDataGC(ctx context.Context, id string, version int64, a artifacts.GCApproval) (artifacts.Export, error) {
	return s.mutateArtifactExport(ctx, id, version, func(e artifacts.Export) (artifacts.Export, error) { return e.AllowDataGC(a) })
}

func (s *Store) RunArtifactExports(ctx context.Context, runID string) ([]artifacts.Export, error) {
	return s.runArtifactExports(ctx, nil, runID)
}

func (s *Store) ClientArtifactExports(ctx context.Context, client *Client, runID string) ([]artifacts.Export, error) {
	if client == nil {
		return nil, ErrForbidden
	}
	return s.runArtifactExports(ctx, client, runID)
}

func (s *Store) runArtifactExports(ctx context.Context, client *Client, runID string) ([]artifacts.Export, error) {
	query := `SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id WHERE r.id=$1`
	args := []any{runID}
	if client != nil {
		query += ` AND t.spec->>'project_id'=ANY($2) AND r.spec->>'project_id'=ANY($2)`
		args = append(args, client.Projects)
	}
	var found string
	if err := s.pool.QueryRow(ctx, query, args...).Scan(&found); errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	} else if err != nil {
		return nil, err
	}
	rows, err := s.pool.Query(ctx, `SELECT data FROM artifact_exports WHERE run_id=$1 ORDER BY generation,id LIMIT 256`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []artifacts.Export{}
	for rows.Next() {
		e, err := readArtifactExport(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, e)
	}
	return result, rows.Err()
}
