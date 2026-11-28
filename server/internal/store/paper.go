package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/phodal/pero/server/internal/paperdomain"
	"github.com/phodal/pero/server/internal/runlifecycle"
)

func (s *Store) PaperIdentity(ctx context.Context, owner, project, id string) (paperdomain.Record, error) {
	return readPaper(s.pool.QueryRow(ctx, `SELECT id,project_id,owner_host,local_project,app_instance,app_version,revision,media_type,body
		FROM paper_revisions WHERE owner_host=$1 AND project_id=$2 AND id=$3`, owner, project, id))
}

func (s *Store) PaperByDigest(ctx context.Context, project, digest string) (paperdomain.Record, error) {
	return readPaper(s.pool.QueryRow(ctx, `SELECT id,project_id,owner_host,local_project,app_instance,app_version,revision,media_type,body
		FROM paper_revisions WHERE project_id=$1 AND revision=$2`, project, digest))
}

func (s *Store) SavePaper(ctx context.Context, record paperdomain.Record) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO paper_revisions(id,project_id,owner_host,local_project,app_instance,app_version,revision,media_type,body)
		VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
		record.ID, record.Project, record.OwnerHost, record.LocalProject, record.AppInstance, record.AppVersion, record.Revision, record.MediaType, record.Body)
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		return ErrConflict
	}
	return err
}

func readPaper(row pgx.Row) (paperdomain.Record, error) {
	var record paperdomain.Record
	err := row.Scan(&record.ID, &record.Project, &record.OwnerHost, &record.LocalProject, &record.AppInstance, &record.AppVersion, &record.Revision, &record.MediaType, &record.Body)
	if errors.Is(err, pgx.ErrNoRows) {
		return paperdomain.Record{}, ErrNotFound
	}
	return record, err
}

func (s *Store) ObservationReceipts(ctx context.Context, project, runID string) ([]runlifecycle.Receipt, error) {
	rows, err := s.pool.Query(ctx, `SELECT request_id,operation,input_hash,outcome FROM run_observation_receipts
		WHERE project_id=$1 AND run_id=$2 ORDER BY request_id`, project, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var receipts []runlifecycle.Receipt
	for rows.Next() {
		var receipt runlifecycle.Receipt
		if err = rows.Scan(&receipt.RequestID, &receipt.Operation, &receipt.InputHash, &receipt.Outcome); err != nil {
			return nil, err
		}
		receipts = append(receipts, receipt)
	}
	return receipts, rows.Err()
}

func (s *Store) SaveObservationReceipt(ctx context.Context, project, runID string, receipt runlifecycle.Receipt) error {
	_, err := s.pool.Exec(ctx, `INSERT INTO run_observation_receipts(project_id,run_id,request_id,operation,input_hash,outcome)
		VALUES($1,$2,$3,$4,$5,$6)`, project, runID, receipt.RequestID, receipt.Operation, receipt.InputHash, receipt.Outcome)
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		return ErrConflict
	}
	return err
}
