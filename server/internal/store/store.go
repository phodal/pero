package store

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/phodal/pero/server/migrations"
)

type Store struct {
	pool  *pgxpool.Pool
	lease time.Duration
}

func Open(ctx context.Context, url string, lease time.Duration) (*Store, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
	if err = pool.Ping(ctx); err == nil {
		err = migrations.Apply(ctx, pool)
	}
	if err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool, lease: lease}, nil
}

func (s *Store) Close()                         { s.pool.Close() }
func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

const runColumns = `id,task_id,generation,COALESCE(worker_id,''),COALESCE(instance_id,''),status,lease_expires_at,spec,summary`

func readRun(row pgx.Row) (*Run, error) {
	var r Run
	var spec []byte
	err := row.Scan(&r.ID, &r.TaskID, &r.Generation, &r.WorkerID, &r.InstanceID, &r.Status, &r.LeaseExpiresAt, &spec, &r.Summary)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(spec, &r.Spec); err != nil {
		return nil, err
	}
	return &r, nil
}

// Reaping never makes a Run eligible for replay. A lost executor may still have effects.
func reap(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `UPDATE runs SET status='reconcile',summary='Execution lease expired; execution and cleanup require reconciliation' WHERE status IN ('running','cancel_requested') AND lease_expires_at <= clock_timestamp()`)
	return err
}

func (s *Store) Reap(ctx context.Context) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err = reap(ctx, tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Store) CreateWorker(ctx context.Context, name string, projects, labels []string) (Worker, string, error) {
	w := Worker{ID: newID("worker"), Name: name, Projects: projects, Labels: labels}
	if w.Labels == nil {
		w.Labels = []string{}
	}
	token := w.ID + "." + newID("secret")
	hash := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(ctx, `INSERT INTO workers(id,name,projects,labels,token_hash) VALUES($1,$2,$3,$4,$5)`, w.ID, w.Name, w.Projects, w.Labels, hash[:])
	return w, token, err
}

func (s *Store) AuthenticateWorker(ctx context.Context, token string) (string, error) {
	id, _, ok := strings.Cut(token, ".")
	if !ok {
		return "", ErrForbidden
	}
	var expected []byte
	err := s.pool.QueryRow(ctx, `SELECT w.token_hash FROM workers w LEFT JOIN worker_devices d ON d.worker_id=w.id WHERE w.id=$1 AND COALESCE(d.enabled,true)`, id).Scan(&expected)
	actual := sha256.Sum256([]byte(token))
	if err != nil || subtle.ConstantTimeCompare(expected, actual[:]) != 1 {
		return "", ErrForbidden
	}
	if _, err = s.pool.Exec(ctx, `UPDATE workers SET last_seen_at=clock_timestamp() WHERE id=$1`, id); err != nil {
		return "", err
	}
	return id, nil
}

func (s *Store) Workers(ctx context.Context) ([]Worker, error) {
	return s.listWorkers(ctx, nil)
}

// Idempotency keys are scoped to their original operation and canonical payload.
func receipt(ctx context.Context, tx pgx.Tx, key, operation string, payload any) (string, string, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}
	hash := sha256.Sum256(data)
	digest := hex.EncodeToString(hash[:])
	if key == "" {
		return "", digest, nil
	}
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "pero:receipt:"+key); err != nil {
		return "", "", err
	}
	var storedOp, storedDigest, id string
	err = tx.QueryRow(ctx, `SELECT operation,digest,resource_id FROM operator_receipts WHERE key=$1`, key).Scan(&storedOp, &storedDigest, &id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", digest, nil
	}
	if err != nil {
		return "", "", err
	}
	if storedOp != operation || storedDigest != digest {
		return "", "", ErrConflict
	}
	return id, digest, nil
}

func saveReceipt(ctx context.Context, tx pgx.Tx, key, operation, digest, id string) error {
	if key == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO operator_receipts(key,operation,digest,resource_id) VALUES($1,$2,$3,$4)`, key, operation, digest, id)
	return err
}
