package store

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/phodal/pero/server/internal/runref"
)

type RunRef = runref.Ref

func (r Run) Ref() RunRef {
	return RunRef{TaskID: r.TaskID, RunID: r.ID, Generation: r.Generation}
}

func (s *Store) ClientRun(ctx context.Context, client *Client, ref RunRef) (*Run, error) {
	return readRun(s.pool.QueryRow(ctx, exactClientRun, ref.RunID, ref.TaskID, ref.Generation, client.Projects))
}

// ClientProjectRun reads one Run only when its persisted project is the URL project
// and that project is in the caller credential. The run id alone is not a grant.
func (s *Store) ClientProjectRun(ctx context.Context, client *Client, project, runID string) (*Run, error) {
	const query = `SELECT ` + runColumns + ` FROM runs
		WHERE id=$1 AND spec->>'project_id'=$2 AND spec->>'project_id'=ANY($3)
		AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id=runs.task_id AND tasks.spec->>'project_id'=$2 AND tasks.spec->>'project_id'=ANY($3))`
	return readRun(s.pool.QueryRow(ctx, query, runID, project, client.Projects))
}

const exactClientRun = `SELECT ` + runColumns + ` FROM runs
	WHERE id=$1 AND task_id=$2 AND generation=$3 AND spec->>'project_id'=ANY($4)
	AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id=$2 AND tasks.spec->>'project_id'=ANY($4))`

func (s *Store) ClientCancelRun(ctx context.Context, client *Client, ref RunRef) (*Run, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if _, err = clientOwnedTaskTx(ctx, tx, client, ref.TaskID); err != nil {
		return nil, err
	}
	if _, err = readRun(tx.QueryRow(ctx, exactClientRun, ref.RunID, ref.TaskID, ref.Generation, client.Projects)); err != nil {
		return nil, err
	}
	if err = cancelRun(ctx, tx, ref.RunID); err != nil {
		return nil, err
	}
	run, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, ref.RunID))
	if err != nil {
		return nil, err
	}
	return run, tx.Commit(ctx)
}

func cancelRun(ctx context.Context, tx pgx.Tx, runID string) error {
	_, err := tx.Exec(ctx, `UPDATE runs SET
		status=CASE WHEN status='queued' THEN 'cancelled' WHEN lease_expires_at<=clock_timestamp() THEN 'reconcile' ELSE 'cancel_requested' END,
		summary=CASE WHEN status='queued' THEN 'Cancelled before execution' WHEN lease_expires_at<=clock_timestamp() THEN 'Execution lease expired; cancellation is unconfirmed' ELSE summary END
		WHERE id=$1 AND status IN ('queued','running','cancel_requested')`, runID)
	return err
}
