package store

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/phodal/pero/server/internal/artifacts"
)

func (s *Store) BindArtifactCollector(ctx context.Context, id string, version int64, a artifacts.CollectorAuthority) (artifacts.Export, error) {
	// The authority's expiry is checked against the database clock, not a caller
	// supplied time. Actual Pod/SA observation belongs to trusted runtime wiring.
	var now time.Time
	if err := s.pool.QueryRow(ctx, `SELECT clock_timestamp()`).Scan(&now); err != nil {
		return artifacts.Export{}, err
	}
	return s.mutateArtifactExport(ctx, id, version, func(e artifacts.Export) (artifacts.Export, error) { return e.BindCollector(a, now) })
}

func (s *Store) ReserveArtifactObject(ctx context.Context, id, entryID string, size int64, digest string) (artifacts.Entry, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return artifacts.Entry{}, err
	}
	defer tx.Rollback(ctx)
	e, err := readArtifactExport(tx.QueryRow(ctx, `SELECT data FROM artifact_exports WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return artifacts.Entry{}, err
	}
	next, err := e.FileEntry(entryID, size, digest)
	if err != nil {
		return artifacts.Entry{}, err
	}
	var raw []byte
	err = tx.QueryRow(ctx, `SELECT data FROM artifact_objects WHERE export_id=$1 AND entry_id=$2`, id, entryID).Scan(&raw)
	if err == nil {
		var old artifacts.Entry
		if json.Unmarshal(raw, &old) != nil || old != next {
			return artifacts.Entry{}, ErrConflict
		}
		return old, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return artifacts.Entry{}, err
	}
	if e.Phase != artifacts.Collecting || e.Quiescence == nil || e.GC != nil {
		return artifacts.Entry{}, artifacts.ErrNotReady
	}
	var total int64
	var count int
	if err = tx.QueryRow(ctx, `SELECT COALESCE(SUM(bytes),0),COUNT(*) FROM artifact_objects WHERE export_id=$1`, id).Scan(&total, &count); err != nil {
		return artifacts.Entry{}, err
	}
	if count >= e.Policy.MaxFiles || size > e.Policy.MaxTotalBytes-total {
		return artifacts.Entry{}, artifacts.ErrInvalid
	}
	raw, err = json.Marshal(next)
	if err != nil {
		return artifacts.Entry{}, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO artifact_objects(export_id,entry_id,bytes,data) VALUES($1,$2,$3,$4)`, id, entryID, size, raw); err != nil {
		return artifacts.Entry{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return artifacts.Entry{}, err
	}
	return next, nil
}

// VerifyArtifactObject accepts only an exact previously reserved object. The
// caller is trusted storage composition after Put/Read checksum verification.
func (s *Store) VerifyArtifactObject(ctx context.Context, id string, entry artifacts.Entry) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	e, err := readArtifactExport(tx.QueryRow(ctx, `SELECT data FROM artifact_exports WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return err
	}
	if e.GC != nil {
		return artifacts.ErrNotReady
	}
	var raw []byte
	if err = tx.QueryRow(ctx, `SELECT data FROM artifact_objects WHERE export_id=$1 AND entry_id=$2`, id, entry.ID).Scan(&raw); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	var stored artifacts.Entry
	if json.Unmarshal(raw, &stored) != nil || stored != entry {
		return ErrConflict
	}
	if _, err = tx.Exec(ctx, `UPDATE artifact_objects SET verified=true WHERE export_id=$1 AND entry_id=$2`, id, entry.ID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CommitArtifactManifest is the publication boundary. It requires exact stored
// verification receipts for every object, not a caller's assertion of upload.
func (s *Store) CommitArtifactManifest(ctx context.Context, id string, version int64, m artifacts.Manifest) (artifacts.Export, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return artifacts.Export{}, err
	}
	defer tx.Rollback(ctx)
	previous, err := readArtifactExport(tx.QueryRow(ctx, `SELECT data FROM artifact_exports WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return artifacts.Export{}, err
	}
	next, err := previous.Commit(m)
	if err != nil {
		return artifacts.Export{}, err
	}
	if reflect.DeepEqual(previous, next) {
		return previous, nil
	}
	if previous.Version != version {
		return artifacts.Export{}, ErrConflict
	}
	rows, err := tx.Query(ctx, `SELECT data,verified FROM artifact_objects WHERE export_id=$1`, id)
	if err != nil {
		return artifacts.Export{}, err
	}
	stored := map[string]artifacts.Entry{}
	for rows.Next() {
		var raw []byte
		var verified bool
		if err = rows.Scan(&raw, &verified); err != nil {
			rows.Close()
			return artifacts.Export{}, err
		}
		var entry artifacts.Entry
		if !verified || json.Unmarshal(raw, &entry) != nil {
			rows.Close()
			return artifacts.Export{}, artifacts.ErrNotReady
		}
		stored[entry.ID] = entry
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return artifacts.Export{}, err
	}
	if len(stored) != len(m.Entries) {
		return artifacts.Export{}, artifacts.ErrConflict
	}
	for _, entry := range m.Entries {
		if stored[entry.ID] != entry {
			return artifacts.Export{}, artifacts.ErrConflict
		}
	}
	next.Version++
	data, err := json.Marshal(next)
	if err != nil {
		return artifacts.Export{}, err
	}
	if _, err = tx.Exec(ctx, `UPDATE artifact_exports SET version=$2,phase=$3,data=$4 WHERE id=$1`, id, next.Version, next.Phase, data); err != nil {
		return artifacts.Export{}, err
	}
	if err = tx.Commit(ctx); err != nil {
		return artifacts.Export{}, err
	}
	return next, nil
}
