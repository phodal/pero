package store

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/phodal/pero/server/internal/projectsource"
)

func (s *Store) ClientSaveWebSource(ctx context.Context, client *Client, project string, source projectsource.ReviewedWebSource) (projectsource.Summary, error) {
	if !slices.Contains(client.Projects, project) {
		return projectsource.Summary{}, ErrForbidden
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return projectsource.Summary{}, err
	}
	defer tx.Rollback(ctx)
	// The shared project can have simultaneous collectors. Check capacity and
	// freeze the capture under a transaction lock scoped to that project.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 19294219))`, project); err != nil {
		return projectsource.Summary{}, err
	}
	draft := source.Draft()
	previous, err := readProjectWebSource(tx.QueryRow(ctx, `
		SELECT project_id, source, sha256, saved_at FROM project_web_sources WHERE project_id=$1 AND capture_id=$2`, project, draft.ID))
	if err == nil {
		if previous.Source != draft {
			return projectsource.Summary{}, ErrConflict
		}
		return previous.Summary(), nil
	}
	if !errors.Is(err, ErrNotFound) {
		return projectsource.Summary{}, err
	}
	var count int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM project_web_sources WHERE project_id=$1`, project).Scan(&count); err != nil {
		return projectsource.Summary{}, err
	}
	if count >= projectsource.MaxSourcesPerProject {
		return projectsource.Summary{}, ErrConflict
	}
	data, err := json.Marshal(draft)
	if err != nil {
		return projectsource.Summary{}, err
	}
	saved, err := readProjectWebSource(tx.QueryRow(ctx, `
		INSERT INTO project_web_sources (project_id, capture_id, source, sha256, author_client_id)
		VALUES ($1,$2,$3,$4,$5) RETURNING project_id, source, sha256, saved_at`,
		project, draft.ID, data, source.SHA256(), client.ID))
	if err != nil {
		return projectsource.Summary{}, err
	}
	return saved.Summary(), tx.Commit(ctx)
}

func (s *Store) ClientWebSources(ctx context.Context, client *Client, project string) ([]projectsource.Summary, error) {
	if !slices.Contains(client.Projects, project) {
		return nil, ErrForbidden
	}
	rows, err := s.pool.Query(ctx, `
		SELECT capture_id, source->>'title', source->>'url', source->>'scope',
			(source->>'truncated')::boolean, sha256, saved_at
		FROM project_web_sources WHERE project_id=$1 ORDER BY saved_at DESC, capture_id`, project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sources := []projectsource.Summary{}
	for rows.Next() {
		var entry projectsource.Summary
		if err := rows.Scan(&entry.ID, &entry.Title, &entry.URL, &entry.Scope, &entry.Truncated, &entry.SHA256, &entry.SavedAt); err != nil {
			return nil, err
		}
		sources = append(sources, entry)
	}
	return sources, rows.Err()
}

func (s *Store) ClientWebSource(ctx context.Context, client *Client, project string, id projectsource.CaptureID) (projectsource.Snapshot, error) {
	if !slices.Contains(client.Projects, project) {
		return projectsource.Snapshot{}, ErrForbidden
	}
	return readProjectWebSource(s.pool.QueryRow(ctx, `
		SELECT project_id, source, sha256, saved_at FROM project_web_sources WHERE project_id=$1 AND capture_id=$2`, project, string(id)))
}

func readProjectWebSource(row pgx.Row) (projectsource.Snapshot, error) {
	var saved projectsource.Snapshot
	var data []byte
	if err := row.Scan(&saved.ProjectID, &data, &saved.SHA256, &saved.SavedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return saved, ErrNotFound
		}
		return saved, err
	}
	return saved, json.Unmarshal(data, &saved.Source)
}
