package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

var ErrWorkerIneligible = errors.New("selected Worker is disabled, requires a managed runtime, or does not support the task workspace and Agent")

type workerAdmission struct {
	projects       []string
	capabilities   []byte
	enabled        bool
	runtimeOnly    bool
	runtimeProfile string
}

func readWorkerAdmission(ctx context.Context, tx pgx.Tx, worker string, lock bool) (workerAdmission, error) {
	query := `SELECT CASE WHEN d.worker_id IS NOT NULL AND d.owner_id<>'operator'
		THEN ARRAY(SELECT unnest(w.projects) INTERSECT SELECT unnest(COALESCE(c.projects,'{}'::text[]))) ELSE w.projects END,
		d.capabilities, COALESCE(d.enabled,true), w.runtime_only, w.runtime_profile
		FROM workers w LEFT JOIN worker_devices d ON d.worker_id=w.id LEFT JOIN clients c ON c.id=d.owner_id WHERE w.id=$1`
	if lock {
		query += ` FOR UPDATE OF w`
	}
	var admission workerAdmission
	err := tx.QueryRow(ctx, query, worker).Scan(&admission.projects, &admission.capabilities, &admission.enabled, &admission.runtimeOnly, &admission.runtimeProfile)
	if errors.Is(err, pgx.ErrNoRows) {
		return workerAdmission{}, ErrNotFound
	}
	return admission, err
}

// Both explicit placement and claim use the same task-to-Worker predicate.
// A legacy Worker without a device inventory still checks project grants.

const workerProjectMatches = `spec->>'project_id'=ANY($1)`
const workerCapabilityMatches = `($2::jsonb IS NULL OR EXISTS (
	SELECT 1 FROM jsonb_array_elements($2::jsonb) cap WHERE cap->>'project_id'=spec->>'project_id'
	AND cap->>'workspace_key'=spec->>'workspace_key' AND cap->>'agent_id'=spec->>'agent_id'))`
const workerMatchesSpec = workerProjectMatches + ` AND ` + workerCapabilityMatches

type dispatchMode bool

const (
	ordinaryDispatch dispatchMode = false
	managedDispatch  dispatchMode = true
)

func checkWorkerPlacement(ctx context.Context, tx pgx.Tx, worker string, spec []byte, mode dispatchMode) error {
	a, err := readWorkerAdmission(ctx, tx, worker, false)
	if err != nil {
		return err
	}
	var authorized, compatible bool
	if err := tx.QueryRow(ctx, `SELECT `+workerProjectMatches+`, `+workerCapabilityMatches+` FROM (SELECT $3::jsonb AS spec) task`, a.projects, a.capabilities, spec).Scan(&authorized, &compatible); err != nil {
		return err
	}
	if !authorized {
		return ErrForbidden
	}
	if !a.enabled || a.runtimeOnly != bool(mode) || !compatible {
		return ErrWorkerIneligible
	}
	return nil
}
