package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"
)

const holdsWorkerSlot = `(status IN ('running','cancel_requested') OR (status='reconcile' AND reconciliation IS NULL))`

type RunReconciliationDisposition string

const (
	RunConfirmedNotStarted RunReconciliationDisposition = "confirmed_not_started"
	RunConfirmedStopped    RunReconciliationDisposition = "confirmed_stopped"
)

var ErrRunReconciliationInput = errors.New("reconciliation requires a confirmed disposition and a bounded evidence reference")

type RunReconciliationDecision struct {
	Disposition RunReconciliationDisposition `json:"disposition"`
	Evidence    string                       `json:"evidence"`
}

func (d RunReconciliationDecision) validate() error {
	if d.Disposition != RunConfirmedNotStarted && d.Disposition != RunConfirmedStopped {
		return ErrRunReconciliationInput
	}
	if strings.TrimSpace(d.Evidence) == "" || strings.ContainsRune(d.Evidence, 0) || utf8.RuneCountInString(d.Evidence) > 1024 {
		return ErrRunReconciliationInput
	}
	return nil
}

// RunReconciliation releases an execution fence while preserving the original outcome.
type RunReconciliation struct {
	Run RunRef `json:"run"`
	RunReconciliationDecision
	RecordedAt time.Time `json:"recorded_at"`
	RecordedBy string    `json:"recorded_by"`
}

func (r Run) Reconciliation() *RunReconciliation { return r.reconciliation }

// ResolveRun is called by the operator after reviewing evidence from the original
// owner. Managed infrastructure must release its own binding first.
func (s *Store) ResolveRun(ctx context.Context, ref RunRef, decision RunReconciliationDecision) (*RunReconciliation, error) {
	if err := decision.validate(); err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	run, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1 AND task_id=$2 AND generation=$3 FOR UPDATE`, ref.RunID, ref.TaskID, ref.Generation))
	if err != nil {
		return nil, err
	}
	if run.Status != "reconcile" {
		return nil, ErrConflict
	}
	if prior := run.Reconciliation(); prior != nil {
		if prior.RunReconciliationDecision != decision {
			return nil, ErrConflict
		}
		return prior, nil
	}
	var unmanagedOrReleased bool
	if err = tx.QueryRow(ctx, `SELECT NOT EXISTS(SELECT 1 FROM runtime_bindings WHERE run_id=$1 AND phase<>'released')`, ref.RunID).Scan(&unmanagedOrReleased); err != nil {
		return nil, err
	}
	if !unmanagedOrReleased {
		return nil, ErrConflict
	}
	receipt := &RunReconciliation{Run: ref, RunReconciliationDecision: decision, RecordedAt: time.Now().UTC(), RecordedBy: "operator"}
	data, err := json.Marshal(receipt)
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `UPDATE runs SET reconciliation=$2 WHERE id=$1`, ref.RunID, data); err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return receipt, nil
}
