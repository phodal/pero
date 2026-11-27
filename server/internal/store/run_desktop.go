package store

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type RunDesktopProfile string

const BlenderDesktop RunDesktopProfile = "blender"

type DesktopFile string

const MaxDesktopFileBytes = 8 << 20

func (f DesktopFile) Valid() bool {
	switch f {
	case "screenshot.png", "screenshot.jpg", "actions.json", "result.blend", "result.obj":
		return true
	default:
		return false
	}
}

type RunDesktopFile struct {
	Name   DesktopFile `json:"name"`
	SHA256 string      `json:"sha256"`
	Bytes  int         `json:"bytes"`
}

func (s *Store) RunDesktopLease(ctx context.Context, id, worker, instance string, generation int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	run, err := guard(ctx, tx, id, worker, instance, generation)
	if err != nil {
		return err
	}
	if run.DesktopProfile != BlenderDesktop || run.Status != "running" {
		return ErrLease
	}
	return nil
}

func (s *Store) DesktopRun(ctx context.Context, client *Client, runID string, live bool) (*Run, error) {
	run, err := readRun(s.pool.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, runID))
	if err != nil {
		return nil, err
	}
	if run.DesktopProfile != BlenderDesktop {
		return nil, ErrNotFound
	}
	if client != nil {
		task, err := s.ClientTask(ctx, client, run.TaskID)
		if err != nil {
			return nil, err
		}
		if live && (task.CurrentRunID != runID || task.ClaimedBy == nil || task.ClaimedBy.ID != client.ID) {
			return nil, ErrForbidden
		}
	}
	if live && run.Status != "running" {
		return nil, ErrLease
	}
	return run, nil
}

func (s *Store) SaveRunDesktopFile(ctx context.Context, runID, worker, instance string, generation int64, file DesktopFile, data []byte) (RunDesktopFile, error) {
	if !file.Valid() || len(data) == 0 || len(data) > MaxDesktopFileBytes {
		return RunDesktopFile{}, ErrTaskInput
	}
	entry := RunDesktopFile{Name: file, SHA256: fmt.Sprintf("sha256:%x", sha256.Sum256(data)), Bytes: len(data)}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return entry, err
	}
	defer tx.Rollback(ctx)
	run, err := guard(ctx, tx, runID, worker, instance, generation)
	if err != nil {
		return entry, err
	}
	if run.DesktopProfile != BlenderDesktop {
		return entry, ErrForbidden
	}
	_, err = tx.Exec(ctx, `INSERT INTO run_desktop_files(run_id,name,sha256,content) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`, runID, file, entry.SHA256, data)
	if err != nil {
		return entry, err
	}
	var hash string
	if err = tx.QueryRow(ctx, `SELECT sha256 FROM run_desktop_files WHERE run_id=$1 AND name=$2`, runID, file).Scan(&hash); err != nil {
		return entry, err
	}
	if hash != entry.SHA256 {
		return entry, ErrConflict
	}
	return entry, tx.Commit(ctx)
}

func (s *Store) RunDesktopFiles(ctx context.Context, runID string) ([]RunDesktopFile, error) {
	rows, err := s.pool.Query(ctx, `SELECT name,sha256,octet_length(content) FROM run_desktop_files WHERE run_id=$1 ORDER BY name`, runID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[RunDesktopFile])
}

func (s *Store) RunDesktopFile(ctx context.Context, runID string, file DesktopFile) ([]byte, error) {
	var hash string
	var data []byte
	err := s.pool.QueryRow(ctx, `SELECT sha256,content FROM run_desktop_files WHERE run_id=$1 AND name=$2`, runID, file).Scan(&hash, &data)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if hash != fmt.Sprintf("sha256:%x", sha256.Sum256(data)) {
		return nil, errors.New("stored desktop artifact integrity mismatch")
	}
	return data, nil
}
