package store

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
)

type RunDesktopProfile string

const BlenderDesktop RunDesktopProfile = "blender"

type RunDesktopHandoff struct {
	RequestID string                 `json:"request_id"`
	Reason    string                 `json:"reason"`
	State     RunDesktopHandoffState `json:"state"`
}

type RunDesktopHandoffState string

const (
	desktopHandoffRequested RunDesktopHandoffState = "requested"
	desktopHandoffReturned  RunDesktopHandoffState = "returned"
)

func (h *RunDesktopHandoff) Requested(id string) bool {
	return h != nil && h.State == desktopHandoffRequested && h.RequestID == id
}

// An empty reason acknowledges the existing request after the Worker releases
// human input. A new request can replace a completed one.
func (h *RunDesktopHandoff) transition(id, reason string) (RunDesktopHandoff, error) {
	if reason == "" {
		if h == nil || h.RequestID != id {
			return RunDesktopHandoff{}, ErrConflict
		}
		next := *h
		next.State = desktopHandoffReturned
		return next, nil
	}
	if reason != strings.TrimSpace(reason) || utf8.RuneCountInString(reason) > 300 || strings.ContainsFunc(reason, unicode.IsControl) {
		return RunDesktopHandoff{}, ErrTaskInput
	}
	if h != nil && h.RequestID == id {
		if h.Reason == reason {
			return *h, nil
		}
		return RunDesktopHandoff{}, ErrConflict
	}
	if h != nil && h.State == desktopHandoffRequested {
		return RunDesktopHandoff{}, ErrConflict
	}
	return RunDesktopHandoff{RequestID: id, Reason: reason, State: desktopHandoffRequested}, nil
}

func (s *Store) RunDesktopHandoff(ctx context.Context, id, worker, instance string, generation int64, requestID, reason string) error {
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
	next, err := run.DesktopHandoff.transition(requestID, reason)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE runs SET desktop_handoff=$2 WHERE id=$1`, id, next); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

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
