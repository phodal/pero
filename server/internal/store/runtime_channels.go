package store

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"time"
)

func channelRow(row pgx.Row) (runtimechannel.Session, error) {
	var s runtimechannel.Session
	var data []byte
	err := row.Scan(&data, &s.SecretHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, ErrNotFound
	}
	if err != nil {
		return s, err
	}
	err = json.Unmarshal(data, &s)
	return s, err
}
func (s *Store) RuntimeChannel(ctx context.Context, runID string) (runtimechannel.Session, error) {
	return channelRow(s.pool.QueryRow(ctx, `SELECT data,secret_hash FROM runtime_channels WHERE run_id=$1`, runID))
}
func saveChannel(ctx context.Context, tx pgx.Tx, c runtimechannel.Session) error {
	data, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `UPDATE runtime_channels SET data=$2 WHERE run_id=$1`, c.Scope.RunID, data)
	return err
}

// Live binding and Run checks are repeated under their owner locks immediately
// before every attachment/provider reservation. Token authentication alone is
// never execution authority, including the apiserver's token deletion grace.
func liveChannelScope(ctx context.Context, tx pgx.Tx, runID string) (runtimechannel.Scope, time.Time, error) {
	r, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1 FOR UPDATE`, runID))
	if err != nil {
		return runtimechannel.Scope{}, time.Time{}, err
	}
	b, err := readRuntime(tx.QueryRow(ctx, `SELECT data FROM runtime_bindings WHERE run_id=$1 FOR UPDATE`, runID))
	if err != nil {
		return runtimechannel.Scope{}, time.Time{}, err
	}
	var now time.Time
	if err = tx.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return runtimechannel.Scope{}, now, err
	}
	if !b.Config.IsIsolated() || r.Status != "running" || r.LeaseExpiresAt == nil || !r.LeaseExpiresAt.After(now) || b.Phase != runtimebinding.Ready || b.ReleaseRequested || b.ValidUntil == nil || !b.ValidUntil.After(now) || b.Snapshot == nil || b.Snapshot.Runtime == nil {
		return runtimechannel.Scope{}, now, ErrLease
	}
	scope := runtimechannel.Scope{RunID: r.ID, SessionID: r.ID, Generation: r.Generation, WorkerID: r.WorkerID, InstanceID: r.InstanceID, ProjectID: r.Spec.ProjectID, Namespace: b.Config.Namespace, ServiceAccount: b.Config.ServiceAccount, ServiceAccountUID: b.Config.ServiceAccountUID, Audience: b.Config.Audience, PodUID: b.Snapshot.Runtime.ID, RuntimeDigest: b.Snapshot.Runtime.Digest}
	if scope.Validate() != nil {
		return scope, now, ErrForbidden
	}
	return scope, now, nil
}
func (s *Store) ReserveRuntimeChannel(ctx context.Context, runID, worker, instance string, generation int64, sessionID, secret string, budget runtimechannel.ProviderBudget) (runtimechannel.Session, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return runtimechannel.Session{}, err
	}
	defer tx.Rollback(ctx)
	scope, now, err := liveChannelScope(ctx, tx, runID)
	if err != nil {
		return runtimechannel.Session{}, err
	}
	if scope.WorkerID != worker || scope.InstanceID != instance || scope.Generation != generation || scope.SessionID != sessionID {
		return runtimechannel.Session{}, ErrForbidden
	}
	wanted, err := runtimechannel.New(scope, secret, budget, now)
	if err != nil {
		return wanted, ErrForbidden
	}
	previous, err := channelRow(tx.QueryRow(ctx, `SELECT data,secret_hash FROM runtime_channels WHERE run_id=$1 FOR UPDATE`, runID))
	if err == nil {
		if previous.Scope != scope || previous.SecretHash != wanted.SecretHash || previous.Budget != budget {
			return previous, ErrConflict
		}
		return previous, tx.Commit(ctx)
	}
	if !errors.Is(err, ErrNotFound) {
		return wanted, err
	}
	data, err := json.Marshal(wanted)
	if err != nil {
		return wanted, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO runtime_channels(run_id,session_id,secret_hash,data) VALUES($1,$2,$3,$4)`, runID, sessionID, wanted.SecretHash, data)
	if err != nil {
		return wanted, err
	}
	return wanted, tx.Commit(ctx)
}

// role is a trusted HTTP routing decision. PodIdentity must come from the online
// TokenReview adapter. A caller cannot authorize itself by supplying a Pod UID.
func (s *Store) AttachRuntimeChannel(ctx context.Context, runID, sessionID, role, secret string, pod runtimechannel.PodIdentity) (runtimechannel.Session, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return runtimechannel.Session{}, err
	}
	defer tx.Rollback(ctx)
	scope, now, err := liveChannelScope(ctx, tx, runID)
	if err != nil {
		return runtimechannel.Session{}, err
	}
	c, err := channelRow(tx.QueryRow(ctx, `SELECT data,secret_hash FROM runtime_channels WHERE run_id=$1 FOR UPDATE`, runID))
	if err != nil {
		return c, err
	}
	if c.Scope != scope || sessionID != scope.SessionID || role == "worker" && !c.CheckSecret(secret) || role == "agent" && !scope.Accepts(pod) {
		return c, ErrForbidden
	}
	c, err = c.Attach(role, now)
	if err != nil {
		return c, ErrConflict
	}
	if err = saveChannel(ctx, tx, c); err != nil {
		return c, err
	}
	return c, tx.Commit(ctx)
}
func (s *Store) AuthorizeRuntimeChannel(ctx context.Context, runID string) (runtimechannel.Session, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return runtimechannel.Session{}, err
	}
	defer tx.Rollback(ctx)
	scope, now, err := liveChannelScope(ctx, tx, runID)
	if err != nil {
		return runtimechannel.Session{}, err
	}
	c, err := channelRow(tx.QueryRow(ctx, `SELECT data,secret_hash FROM runtime_channels WHERE run_id=$1`, runID))
	if err != nil {
		return c, err
	}
	if c.Scope != scope || !c.Live(now) {
		return c, ErrLease
	}
	return c, tx.Commit(ctx)
}
func (s *Store) StopRuntimeChannel(ctx context.Context, runID string, unexpected bool) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT id FROM runs WHERE id=$1 FOR UPDATE`, runID); err != nil {
		return err
	}
	c, err := channelRow(tx.QueryRow(ctx, `SELECT data,secret_hash FROM runtime_channels WHERE run_id=$1 FOR UPDATE`, runID))
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	c = c.Stop(unexpected)
	if err = saveChannel(ctx, tx, c); err != nil {
		return err
	}
	if c.State == runtimechannel.Lost {
		_, err = tx.Exec(ctx, `UPDATE runs SET status='reconcile',summary='Remote ACP transport lost; prompt was not replayed' WHERE id=$1 AND status='running'`, runID)
		if err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// Startup is a fail-closed settlement for the explicitly single-relay profile.
// There is no transparent failover/resume of an in-flight ACP prompt.
func (s *Store) FenceRuntimeChannels(ctx context.Context, workerID string) error {
	rows, err := s.pool.Query(ctx, `SELECT run_id FROM runtime_channels WHERE data->'scope'->>'worker_id'=$1 AND data->>'state' IN ('reserved','attached','started')`, workerID)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err = s.StopRuntimeChannel(ctx, id, true); err != nil {
			return err
		}
	}
	return nil
}
func (s *Store) ReserveRuntimeProvider(ctx context.Context, runID string, pod runtimechannel.PodIdentity) (runtimechannel.Session, string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return runtimechannel.Session{}, "", err
	}
	defer tx.Rollback(ctx)
	scope, now, err := liveChannelScope(ctx, tx, runID)
	if err != nil {
		return runtimechannel.Session{}, "", err
	}
	c, err := channelRow(tx.QueryRow(ctx, `SELECT data,secret_hash FROM runtime_channels WHERE run_id=$1 FOR UPDATE`, runID))
	if err != nil {
		return c, "", err
	}
	if c.Scope != scope || !scope.Accepts(pod) {
		return c, "", ErrForbidden
	}
	c, err = c.ReserveProvider(now)
	if err != nil {
		return c, "", err
	}
	if err = saveChannel(ctx, tx, c); err != nil {
		return c, "", err
	}
	id := newID("provider")
	if _, err = tx.Exec(ctx, `INSERT INTO runtime_provider_attempts(id,run_id) VALUES($1,$2)`, id, runID); err != nil {
		return c, "", err
	}
	return c, id, tx.Commit(ctx)
}
func (s *Store) FinishRuntimeProvider(ctx context.Context, runID, attempt string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	c, err := channelRow(tx.QueryRow(ctx, `SELECT data,secret_hash FROM runtime_channels WHERE run_id=$1 FOR UPDATE`, runID))
	if err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `UPDATE runtime_provider_attempts SET finished=true WHERE id=$1 AND run_id=$2 AND NOT finished`, attempt, runID)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 1 {
		if err = saveChannel(ctx, tx, c.FinishProvider()); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// CloseRuntimeTransport revokes the one-shot transport without racing the
// trusted Worker's already-journaled terminal receipt. EOF never reopens it;
// recovery/startup separately marks an unknown execution for reconciliation.
func (s *Store) CloseRuntimeTransport(ctx context.Context, runID string) error {
	return s.StopRuntimeChannel(ctx, runID, false)
}
