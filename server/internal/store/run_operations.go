package store

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// RunRef pins an execution even when the Task advances to a new generation.
type RunRef struct {
	TaskID     string `json:"task_id"`
	RunID      string `json:"run_id"`
	Generation int64  `json:"generation"`
}

func (r Run) Ref() RunRef {
	return RunRef{TaskID: r.TaskID, RunID: r.ID, Generation: r.Generation}
}

func (s *Store) ClientRun(ctx context.Context, client *Client, ref RunRef) (*Run, error) {
	return readRun(s.pool.QueryRow(ctx, exactClientRun, ref.RunID, ref.TaskID, ref.Generation, client.Projects))
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
