package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) Claim(ctx context.Context, worker, instance, request string, runtimePodUID ...string) (*Run, error) {
	podUID := ""
	if len(runtimePodUID) > 0 {
		podUID = runtimePodUID[0]
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	// The Worker row is its single slot and serializes duplicate claim requests.
	var projects []string
	var capabilities []byte
	var enabled, runtimeOnly bool
	var runtimeProfile string
	if err = tx.QueryRow(ctx, `SELECT CASE WHEN d.worker_id IS NOT NULL AND d.owner_id<>'operator' THEN ARRAY(SELECT unnest(w.projects) INTERSECT SELECT unnest(COALESCE(c.projects,'{}'::text[]))) ELSE w.projects END,d.capabilities,COALESCE(d.enabled,true),w.runtime_only,w.runtime_profile FROM workers w LEFT JOIN worker_devices d ON d.worker_id=w.id LEFT JOIN clients c ON c.id=d.owner_id WHERE w.id=$1 FOR UPDATE OF w`, worker).Scan(&projects, &capabilities, &enabled, &runtimeOnly, &runtimeProfile); err != nil {
		return nil, err
	}
	if !enabled {
		return nil, ErrForbidden
	}
	var previous *string
	var previousPodUID string
	err = tx.QueryRow(ctx, `SELECT run_id,runtime_pod_uid FROM claims WHERE worker_id=$1 AND instance_id=$2 AND request_id=$3`, worker, instance, request).Scan(&previous, &previousPodUID)
	if err == nil {
		if previousPodUID != podUID {
			return nil, ErrConflict
		}
		if previous == nil {
			return nil, nil
		}
		run, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, *previous))
		if err == nil && runtimeProfile == "isolated-agent-v1" {
			run.RemoteExecution = &RemoteExecution{SessionID: run.ID, WorkingDirectory: "/workspace/repo"}
		}
		return run, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if (!runtimeOnly && podUID != "") || (runtimeOnly && runtimeProfile == "isolated-agent-v1" && podUID != "") || (runtimeOnly && runtimeProfile != "isolated-agent-v1" && podUID == "") {
		return nil, ErrForbidden
	}
	if err = reap(ctx, tx); err != nil {
		return nil, err
	}
	var occupied bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM runs WHERE worker_id=$1 AND status IN ('running','cancel_requested','reconcile'))`, worker).Scan(&occupied); err != nil {
		return nil, err
	}
	var r *Run
	if !occupied {
		var runID string
		err = tx.QueryRow(ctx, `SELECT id FROM runs WHERE status='queued' AND spec->>'project_id'=ANY($1) AND (target_worker_id IS NULL OR target_worker_id=$2) AND ($3::jsonb IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements($3::jsonb) cap WHERE cap->>'project_id'=spec->>'project_id' AND cap->>'workspace_key'=spec->>'workspace_key' AND cap->>'agent_id'=spec->>'agent_id')) AND (($4=false AND NOT EXISTS(SELECT 1 FROM runtime_bindings b WHERE b.run_id=runs.id)) OR ($4=true AND EXISTS(SELECT 1 FROM runtime_bindings b WHERE b.run_id=runs.id AND b.worker_id=$2 AND b.phase='ready' AND ($6='isolated-agent-v1' OR b.pod_uid=$5) AND b.valid_until>clock_timestamp()))) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, projects, worker, capabilities, runtimeOnly, podUID, runtimeProfile).Scan(&runID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if err == nil {
			// Re-read after taking the Run lock: an observation may have changed
			// while the candidate SELECT waited for that lock.
			if runtimeOnly {
				var ready bool
				if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM runtime_bindings WHERE run_id=$1 AND worker_id=$2 AND phase='ready' AND ($4='isolated-agent-v1' OR pod_uid=$3) AND valid_until>clock_timestamp())`, runID, worker, podUID, runtimeProfile).Scan(&ready); err != nil {
					return nil, err
				}
				if !ready {
					return nil, ErrLease
				}
			}
			r, err = readRun(tx.QueryRow(ctx, `UPDATE runs SET status='running',worker_id=$2,instance_id=$3,lease_expires_at=LEAST(clock_timestamp()+($4*interval '1 second'),(SELECT valid_until FROM runtime_bindings WHERE run_id=$1)) WHERE id=$1 RETURNING `+runColumns, runID, worker, instance, s.lease.Seconds()))
			if err != nil {
				return nil, err
			}
		}
	}
	var runID *string
	if r != nil {
		if runtimeProfile == "isolated-agent-v1" {
			r.RemoteExecution = &RemoteExecution{SessionID: r.ID, WorkingDirectory: "/workspace/repo"}
		}
		runID = &r.ID
	}
	if _, err = tx.Exec(ctx, `INSERT INTO claims(worker_id,instance_id,request_id,run_id,runtime_pod_uid) VALUES($1,$2,$3,$4,$5)`, worker, instance, request, runID, podUID); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r, nil
}

func guard(ctx context.Context, tx pgx.Tx, id, worker, instance string, generation int64) (*Run, error) {
	r, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return nil, err
	}
	if r.WorkerID != worker || r.InstanceID != instance {
		return nil, ErrForbidden
	}
	if r.Generation != generation {
		return nil, ErrLease
	}
	var valid bool
	if err = tx.QueryRow(ctx, `SELECT status IN ('running','cancel_requested') AND lease_expires_at>clock_timestamp() AND ((NOT (SELECT runtime_only FROM workers WHERE id=$2) AND NOT EXISTS(SELECT 1 FROM runtime_bindings WHERE run_id=$1)) OR EXISTS(SELECT 1 FROM runtime_bindings WHERE run_id=$1 AND worker_id=$2 AND phase IN ('ready','cleanup_pending') AND valid_until>clock_timestamp())) FROM runs WHERE id=$1`, id, worker).Scan(&valid); err != nil {
		return nil, err
	}
	if !valid {
		return nil, ErrLease
	}
	return r, nil
}

func (s *Store) WorkerRun(ctx context.Context, id, worker, instance string) (*Run, error) {
	if err := s.Reap(ctx); err != nil {
		return nil, err
	}
	r, err := readRun(s.pool.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, id))
	if err != nil {
		return nil, err
	}
	if r.WorkerID != worker || r.InstanceID != instance {
		return nil, ErrForbidden
	}
	return r, nil
}

func (s *Store) Renew(ctx context.Context, id, worker, instance string, generation int64) (bool, time.Time, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, time.Time{}, err
	}
	defer tx.Rollback(ctx)
	r, err := guard(ctx, tx, id, worker, instance, generation)
	if err != nil {
		return false, time.Time{}, err
	}
	var expiry time.Time
	err = tx.QueryRow(ctx, `UPDATE runs SET lease_expires_at=LEAST(clock_timestamp()+($2*interval '1 second'),(SELECT valid_until FROM runtime_bindings WHERE run_id=$1)) WHERE id=$1 AND lease_expires_at>clock_timestamp() RETURNING lease_expires_at`, id, s.lease.Seconds()).Scan(&expiry)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, time.Time{}, ErrLease
	}
	if err != nil {
		return false, time.Time{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return false, time.Time{}, err
	}
	return r.Status == "cancel_requested", expiry, nil
}

func (s *Store) AppendEvents(ctx context.Context, id, worker, instance string, generation int64, events []Event) (int64, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	r, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return 0, err
	}
	if r.WorkerID != worker || r.InstanceID != instance {
		return 0, ErrForbidden
	}
	if r.Generation != generation {
		return 0, ErrLease
	}
	wrote := false
	if len(events) == 0 {
		return 0, ErrConflict
	}
	var last int64
	if err = tx.QueryRow(ctx, `SELECT COALESCE(MAX(seq),0) FROM run_events WHERE run_id=$1 AND generation=$2`, id, generation).Scan(&last); err != nil {
		return 0, err
	}
	for _, e := range events {
		if len(e.Data) == 0 {
			e.Data = json.RawMessage(`null`)
		}
		if e.Seq <= last {
			var same bool
			err = tx.QueryRow(ctx, `SELECT kind=$4 AND text=$5 AND data=$6::jsonb FROM run_events WHERE run_id=$1 AND generation=$2 AND seq=$3`, id, generation, e.Seq, e.Kind, e.Text, e.Data).Scan(&same)
			if errors.Is(err, pgx.ErrNoRows) || err == nil && !same {
				return 0, ErrConflict
			}
			if err != nil {
				return 0, err
			}
			continue
		}
		if e.Seq != last+1 {
			return 0, ErrConflict
		}
		if !wrote {
			if _, err = guard(ctx, tx, id, worker, instance, generation); err != nil {
				return 0, err
			}
			wrote = true
		}
		if _, err = tx.Exec(ctx, `INSERT INTO run_events(run_id,generation,seq,kind,text,data) VALUES($1,$2,$3,$4,$5,$6)`, id, generation, e.Seq, e.Kind, e.Text, e.Data); err != nil {
			return 0, err
		}
		last = e.Seq
	}
	if wrote {
		if _, err = guard(ctx, tx, id, worker, instance, generation); err != nil {
			return 0, err
		}
	}
	if err = tx.Commit(ctx); err != nil {
		return 0, err
	}
	return last, nil
}

func (s *Store) Complete(ctx context.Context, id, worker, instance string, generation int64, result Completion) (*Run, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	r, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return nil, err
	}
	if r.WorkerID != worker || r.InstanceID != instance {
		return nil, ErrForbidden
	}
	if r.Generation != generation {
		return nil, ErrLease
	}
	data, _ := json.Marshal(result)
	var hasReceipt, same bool
	if err = tx.QueryRow(ctx, `SELECT completion IS NOT NULL,COALESCE(completion=$2::jsonb,false) FROM runs WHERE id=$1`, id, data).Scan(&hasReceipt, &same); err != nil {
		return nil, err
	}
	if hasReceipt {
		if !same {
			return nil, ErrConflict
		}
		return r, nil
	}
	if _, err = guard(ctx, tx, id, worker, instance, generation); err != nil {
		return nil, err
	}
	// A late success cannot override a cancellation request. It needs reconciliation.
	if r.Status == "cancel_requested" && result.Outcome == "succeeded" {
		return nil, ErrConflict
	}
	r, err = readRun(tx.QueryRow(ctx, `UPDATE runs SET status=$2,summary=$3,completion=$4 WHERE id=$1 AND lease_expires_at>clock_timestamp() RETURNING `+runColumns, id, result.Outcome, result.Summary, data))
	if errors.Is(err, ErrNotFound) {
		return nil, ErrLease
	}
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r, nil
}
