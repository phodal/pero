package store

import (
	"context"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
)

// TrialOperation is an authorized submission identity in one logical client's project.
// Client identity survives credential replacement and stays outside the trial payload.
type TrialOperation struct {
	projectID string
	id        string
	client    TaskClaimant
}

func (c Client) TrialOperation(project, id string) (TrialOperation, error) {
	if !slices.Contains(c.Projects, project) {
		return TrialOperation{}, ErrNotFound
	}
	return TrialOperation{projectID: project, id: id, client: TaskClaimant{ID: c.ID, Name: c.Name}}, nil
}

type TrialInput struct {
	Task     Spec   `json:"task"`
	WorkerID string `json:"worker_id,omitempty"`
}

type TrialReceiptStatus string

const (
	TrialDispatched              TrialReceiptStatus = "dispatched"
	TrialCancelledBeforeDispatch TrialReceiptStatus = "cancelled_before_dispatch"
)

// TrialReceipt identifies the original dispatch or a committed pre-dispatch cancel.
type TrialReceipt struct {
	Status TrialReceiptStatus `json:"status"`
	Run    *RunRef            `json:"run,omitempty"`
}

const trialReceiptQuery = `SELECT COALESCE(t.input_digest,''),COALESCE(r.task_id,''),COALESCE(r.id,''),COALESCE(r.generation,0)
	FROM trial_submissions t LEFT JOIN runs r ON r.id=t.run_id
	WHERE t.project_id=$1 AND t.client_id=$2 AND t.operation_id=$3`

func readTrialReceipt(row pgx.Row) (TrialReceipt, string, error) {
	var ref RunRef
	var digest string
	if err := row.Scan(&digest, &ref.TaskID, &ref.RunID, &ref.Generation); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return TrialReceipt{}, "", ErrNotFound
		}
		return TrialReceipt{}, "", err
	}
	if ref.RunID == "" {
		return TrialReceipt{Status: TrialCancelledBeforeDispatch}, "", nil
	}
	return TrialReceipt{Status: TrialDispatched, Run: &ref}, digest, nil
}

func (s *Store) TrialReceipt(ctx context.Context, op TrialOperation) (TrialReceipt, error) {
	receipt, _, err := readTrialReceipt(s.pool.QueryRow(ctx, trialReceiptQuery, op.projectID, op.client.ID, op.id))
	return receipt, err
}

// The unique insert decides who gets the operation. A committed row without a Run
// belongs to cancellation. Dispatch sets the Run and digest in its own insert transaction.
func (op TrialOperation) reserve(ctx context.Context, tx pgx.Tx) (bool, error) {
	result, err := tx.Exec(ctx, `INSERT INTO trial_submissions (project_id,client_id,operation_id)
		VALUES ($1,$2,$3) ON CONFLICT (project_id,client_id,operation_id) DO NOTHING`, op.projectID, op.client.ID, op.id)
	return result.RowsAffected() == 1, err
}

func (s *Store) EnsureTrialRun(ctx context.Context, op TrialOperation, input TrialInput) (TrialReceipt, error) {
	if input.Task.ProjectID != op.projectID {
		return TrialReceipt{}, ErrTaskInput
	}
	if err := input.Task.validateManual(); err != nil {
		return TrialReceipt{}, err
	}
	digest, err := inputDigest(input)
	if err != nil {
		return TrialReceipt{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TrialReceipt{}, err
	}
	defer tx.Rollback(ctx)
	created, err := op.reserve(ctx, tx)
	if err != nil {
		return TrialReceipt{}, err
	}
	if !created {
		receipt, original, err := readTrialReceipt(tx.QueryRow(ctx, trialReceiptQuery, op.projectID, op.client.ID, op.id))
		if err == nil && receipt.Run != nil && original != digest {
			return TrialReceipt{}, ErrConflict
		}
		return receipt, err
	}
	task, err := createTaskTx(ctx, tx, input.Task, "", &op.client)
	if err != nil {
		return TrialReceipt{}, err
	}
	run, err := dispatchTx(ctx, tx, task.ID, input.WorkerID, "", ordinaryDispatch)
	if err != nil {
		return TrialReceipt{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE trial_submissions SET input_digest=$4,run_id=$5
		WHERE project_id=$1 AND client_id=$2 AND operation_id=$3`, op.projectID, op.client.ID, op.id, digest, run.ID); err != nil {
		return TrialReceipt{}, err
	}
	ref := run.Ref()
	return TrialReceipt{Status: TrialDispatched, Run: &ref}, tx.Commit(ctx)
}

func (s *Store) CancelTrial(ctx context.Context, op TrialOperation) (TrialReceipt, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TrialReceipt{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := op.reserve(ctx, tx); err != nil {
		return TrialReceipt{}, err
	}
	receipt, _, err := readTrialReceipt(tx.QueryRow(ctx, trialReceiptQuery, op.projectID, op.client.ID, op.id))
	if err != nil {
		return TrialReceipt{}, err
	}
	if receipt.Run != nil {
		if err := cancelRun(ctx, tx, receipt.Run.RunID); err != nil {
			return TrialReceipt{}, err
		}
	}
	return receipt, tx.Commit(ctx)
}
