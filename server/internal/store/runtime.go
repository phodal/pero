package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/phodal/pero/server/internal/runtimebinding"
)

// ConfigureRuntimeWorker persists the queue fence. Disabling the provider does
// not turn this credential back into an ordinary Worker credential.
func (s *Store) ConfigureRuntimeWorker(ctx context.Context, config runtimebinding.Config) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var allowed bool
	if err = tx.QueryRow(ctx, `SELECT $2=ANY(projects) FROM workers WHERE id=$1 FOR UPDATE`, config.WorkerID, config.ProjectID).Scan(&allowed); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if !allowed {
		return ErrForbidden
	}
	var unsafe bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM runs r WHERE r.worker_id=$1 AND r.status IN ('running','cancel_requested','reconcile') AND NOT EXISTS(SELECT 1 FROM runtime_bindings b WHERE b.run_id=r.id))`, config.WorkerID).Scan(&unsafe); err != nil {
		return err
	}
	if unsafe {
		return ErrConflict
	}
	var data []byte
	err = tx.QueryRow(ctx, `SELECT data FROM runtime_bindings WHERE worker_id=$1 AND phase<>'released'`, config.WorkerID).Scan(&data)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err == nil {
		var current runtimebinding.Binding
		if err = json.Unmarshal(data, &current); err != nil {
			return err
		}
		if current.Config != config {
			return ErrConflict
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE workers SET runtime_only=true WHERE id=$1`, config.WorkerID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// DispatchRuntime reuses dispatchTx and reserves the original claim identity in
// that same transaction. Only the caller that created the reservation may issue
// the initial create; subsequent calls can only reconcile that operation.
func (s *Store) DispatchRuntime(ctx context.Context, taskID, key string, config runtimebinding.Config) (*Run, *runtimebinding.Binding, bool, error) {
	if key == "" {
		return nil, nil, false, ErrConflict
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, false, err
	}
	defer tx.Rollback(ctx)
	var runtimeOnly bool
	if err = tx.QueryRow(ctx, `SELECT runtime_only FROM workers WHERE id=$1 FOR UPDATE`, config.WorkerID).Scan(&runtimeOnly); errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, false, ErrNotFound
	}
	if err != nil {
		return nil, nil, false, err
	}
	if !runtimeOnly {
		return nil, nil, false, ErrForbidden
	}
	run, err := dispatchTx(ctx, tx, taskID, config.WorkerID, key)
	if err != nil {
		return nil, nil, false, err
	}
	if run.Spec.ProjectID != config.ProjectID || run.Spec.WorkspaceKey != config.WorkspaceKey || run.Spec.AgentID != config.AgentID {
		return nil, nil, false, ErrForbidden
	}
	current, err := readRuntime(tx.QueryRow(ctx, `SELECT data FROM runtime_bindings WHERE run_id=$1`, run.ID))
	if err == nil {
		if current.Config != config {
			return nil, nil, false, ErrConflict
		}
		if err = tx.Commit(ctx); err != nil {
			return nil, nil, false, err
		}
		return run, &current, false, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, nil, false, err
	}
	if run.Status != "queued" {
		return nil, nil, false, ErrConflict
	}
	var occupied bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM runtime_bindings WHERE worker_id=$1 AND phase<>'released')`, config.WorkerID).Scan(&occupied); err != nil {
		return nil, nil, false, err
	}
	if occupied {
		return nil, nil, false, ErrConflict
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return nil, nil, false, err
	}
	binding := runtimebinding.New(run.ID, config, now)
	data, err := json.Marshal(binding)
	if err != nil {
		return nil, nil, false, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO runtime_bindings(run_id,worker_id,version,phase,data) VALUES($1,$2,$3,$4,$5)`, run.ID, config.WorkerID, binding.Version, binding.Phase, data); err != nil {
		return nil, nil, false, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, nil, false, err
	}
	return run, &binding, true, nil
}

func readRuntime(row pgx.Row) (runtimebinding.Binding, error) {
	var data []byte
	if err := row.Scan(&data); errors.Is(err, pgx.ErrNoRows) {
		return runtimebinding.Binding{}, ErrNotFound
	} else if err != nil {
		return runtimebinding.Binding{}, err
	}
	var binding runtimebinding.Binding
	err := json.Unmarshal(data, &binding)
	return binding, err
}
func (s *Store) RuntimeBinding(ctx context.Context, runID string) (runtimebinding.Binding, error) {
	return readRuntime(s.pool.QueryRow(ctx, `SELECT data FROM runtime_bindings WHERE run_id=$1`, runID))
}
func (s *Store) RuntimeBindings(ctx context.Context, worker ...string) ([]runtimebinding.Binding, error) {
	workerID := ""
	if len(worker) > 0 {
		workerID = worker[0]
	}
	rows, err := s.pool.Query(ctx, `SELECT data FROM runtime_bindings WHERE phase<>'released' AND ($1='' OR worker_id=$1) ORDER BY run_id LIMIT 100`, workerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bindings := []runtimebinding.Binding{}
	for rows.Next() {
		binding, err := readRuntime(rows)
		if err != nil {
			return nil, err
		}
		bindings = append(bindings, binding)
	}
	return bindings, rows.Err()
}
func (s *Store) RuntimeRun(ctx context.Context, runID string) (*Run, error) {
	if err := s.Reap(ctx); err != nil {
		return nil, err
	}
	return readRun(s.pool.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, runID))
}

// SaveRuntimeBinding serializes observation changes with execution writes by
// locking Run first. A failed identity/readiness observation cannot leave a
// previously admitted Run claimable; existing events and completion stay intact.
func (s *Store) SaveRuntimeBinding(ctx context.Context, expectedVersion int64, next runtimebinding.Binding) (runtimebinding.Binding, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return runtimebinding.Binding{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1 FOR UPDATE`, next.RunID)); err != nil {
		return runtimebinding.Binding{}, err
	}
	previous, err := readRuntime(tx.QueryRow(ctx, `SELECT data FROM runtime_bindings WHERE run_id=$1 FOR UPDATE`, next.RunID))
	if err != nil {
		return runtimebinding.Binding{}, err
	}
	if previous.Version != expectedVersion {
		return runtimebinding.Binding{}, ErrConflict
	}
	if err = next.ValidateNext(previous); err != nil {
		return runtimebinding.Binding{}, err
	}
	next.Version = previous.Version + 1
	if err = saveRuntime(ctx, tx, next); err != nil {
		return runtimebinding.Binding{}, err
	}
	if next.Phase == runtimebinding.Reconcile || next.Snapshot != nil && next.ValidUntil == nil {
		if _, err = tx.Exec(ctx, `UPDATE runs SET status='reconcile',summary='Runtime identity or readiness lost; prompt was not replayed' WHERE id=$1 AND status IN ('queued','running','cancel_requested')`, next.RunID); err != nil {
			return runtimebinding.Binding{}, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return runtimebinding.Binding{}, err
	}
	return next, nil
}
func saveRuntime(ctx context.Context, tx pgx.Tx, binding runtimebinding.Binding) error {
	podUID := ""
	if binding.Snapshot != nil && binding.Snapshot.Runtime != nil {
		podUID = binding.Snapshot.Runtime.ID
	}
	data, err := json.Marshal(binding)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE runtime_bindings SET version=$2,phase=$3,pod_uid=$4,valid_until=$5,data=$6 WHERE run_id=$1`, binding.RunID, binding.Version, binding.Phase, podUID, binding.ValidUntil, data)
	return err
}

// ReleaseRuntime requests cancellation but does not delete a resource or erase
// an execution receipt. Existing lease renewals remain possible while the same
// runtime is observed and the Worker is acknowledging cancellation.
func (s *Store) ReleaseRuntime(ctx context.Context, runID string) (runtimebinding.Binding, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return runtimebinding.Binding{}, err
	}
	defer tx.Rollback(ctx)
	if _, err = readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1 FOR UPDATE`, runID)); err != nil {
		return runtimebinding.Binding{}, err
	}
	binding, err := readRuntime(tx.QueryRow(ctx, `SELECT data FROM runtime_bindings WHERE run_id=$1 FOR UPDATE`, runID))
	if err != nil {
		return runtimebinding.Binding{}, err
	}
	if binding.ReleaseRequested || binding.Phase == runtimebinding.Released {
		return binding, nil
	}
	binding = binding.RequestRelease()
	binding.Version++
	if err = saveRuntime(ctx, tx, binding); err != nil {
		return runtimebinding.Binding{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE runs SET status=CASE WHEN status='queued' THEN 'cancelled' WHEN lease_expires_at<=clock_timestamp() THEN 'reconcile' ELSE 'cancel_requested' END,summary=CASE WHEN status='queued' THEN 'Cancelled before execution' WHEN lease_expires_at<=clock_timestamp() THEN 'Execution lease expired; cancellation is unconfirmed' ELSE summary END WHERE id=$1 AND status IN ('queued','running','cancel_requested')`, runID); err != nil {
		return runtimebinding.Binding{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return runtimebinding.Binding{}, err
	}
	return binding, nil
}
