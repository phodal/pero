package store

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Client is an operator-provisioned collaboration identity, separate from a Worker.
// Its project scope comes from the stored credential, never request parameters.
type Client struct {
	ID       string   `json:"id"`
	Name     string   `json:"name"`
	Projects []string `json:"projects"`
	Role     string   `json:"role"`
}

func (s *Store) CreateClient(ctx context.Context, name string, projects []string) (Client, string, error) {
	c := Client{ID: newID("client"), Name: name, Projects: projects, Role: "client"}
	token := c.ID + "." + newID("secret")
	hash := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(ctx, `INSERT INTO clients(id,name,projects,token_hash) VALUES($1,$2,$3,$4)`, c.ID, c.Name, c.Projects, hash[:])
	return c, token, err
}

func (s *Store) AuthenticateClient(ctx context.Context, token string) (*Client, error) {
	id, _, ok := strings.Cut(token, ".")
	if !ok {
		return nil, ErrForbidden
	}
	c := &Client{Role: "client"}
	var expected []byte
	err := s.pool.QueryRow(ctx, `SELECT id,name,projects,token_hash FROM clients WHERE id=$1 UNION ALL SELECT c.id,c.name,c.projects,d.token_hash FROM desktop_credentials d JOIN clients c ON c.id=d.client_id WHERE d.id=$1`, id).Scan(&c.ID, &c.Name, &c.Projects, &expected)
	actual := sha256.Sum256([]byte(token))
	if err != nil || subtle.ConstantTimeCompare(expected, actual[:]) != 1 {
		return nil, ErrForbidden
	}
	return c, nil
}

func (s *Store) ClientTasks(ctx context.Context, client *Client, cursor string, limit int, filters ...TaskFilter) (*TaskPage, error) {
	if err := s.Reap(ctx); err != nil {
		return nil, err
	}
	filter := TaskFilter{}
	if len(filters) > 0 {
		filter = filters[0]
	}
	ids := []string{}
	var err error
	if filter.SourceKind == "roadmap" {
		ids, err = s.roadmapTaskIDs(ctx, client, cursor, limit, filter)
		if err != nil {
			return nil, err
		}
	} else {
		var before *time.Time
		if cursor != "" {
			var value time.Time
			err := s.pool.QueryRow(ctx, `SELECT created_at FROM tasks WHERE id=$1 AND spec->>'project_id'=ANY($2)`, cursor, client.Projects).Scan(&value)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			if err != nil {
				return nil, err
			}
			before = &value
		}
		rows, err := s.pool.Query(ctx, `SELECT tasks.id FROM tasks LEFT JOIN github_issues g ON g.task_id=tasks.id LEFT JOIN roadmap_items road ON road.task_id=tasks.id WHERE spec->>'project_id'=ANY($1) AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::text)) AND ($5='' OR spec->'source'->>'kind'=$5) AND ($6='' OR (CASE WHEN road.task_id IS NOT NULL THEN COALESCE(road.latest->'tags','[]'::jsonb) WHEN g.task_id IS NOT NULL THEN COALESCE(g.latest->'labels','[]'::jsonb) ELSE COALESCE(spec->'tags','[]'::jsonb) END) ? $6) ORDER BY created_at DESC,id DESC LIMIT $4`, client.Projects, before, cursor, limit+1, filter.SourceKind, filter.Tag)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			if err = rows.Scan(&id); err != nil {
				rows.Close()
				return nil, err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	page := &TaskPage{Tasks: []Task{}}
	used := 0
	for _, id := range ids {
		if len(page.Tasks) >= limit {
			page.HasMore = true
			break
		}
		t, err := s.ClientTask(ctx, client, id)
		if err != nil {
			return nil, err
		}
		t.Run = nil
		encoded, err := encodedJSON(t)
		if err != nil {
			return nil, err
		}
		if used+len(encoded) > 512*1024-4096 && len(page.Tasks) > 0 {
			page.HasMore = true
			break
		}
		used += len(encoded)
		page.Tasks = append(page.Tasks, *t)
	}
	if page.HasMore && len(page.Tasks) > 0 {
		id := page.Tasks[len(page.Tasks)-1].ID
		page.NextCursor = &id
	}
	return page, nil
}

// Project filtering is part of the SQL predicate so private IDs and cursors look absent.
func clientTaskTx(ctx context.Context, tx pgx.Tx, client *Client, id string, lock bool) (*Task, error) {
	query := `SELECT id FROM tasks WHERE id=$1 AND spec->>'project_id'=ANY($2)`
	if lock {
		query += ` FOR UPDATE`
	} else {
		query += ` FOR SHARE`
	}
	var found string
	err := tx.QueryRow(ctx, query, id, client.Projects).Scan(&found)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return taskIn(ctx, tx, id)
}

func (s *Store) ClientTask(ctx context.Context, client *Client, id string) (*Task, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	return clientTaskTx(ctx, tx, client, id, false)
}

func taskBusy(t *Task) bool { return t.contributionSubmitted || taskExecutionBusy(t) }

func taskExecutionBusy(t *Task) bool {
	return t.Run != nil && (t.Run.Status == "queued" || t.Run.Status == "running" || t.Run.Status == "cancel_requested" || t.Run.Status == "reconcile")
}

func taskSourceClosed(t *Task) bool {
	if t.LatestSource != nil {
		return t.LatestSource.State == "closed" || t.LatestSource.State == "missing"
	}
	return t.Source != nil && (t.Source.State == "closed" || t.Source.State == "missing")
}
func taskSourceStale(t *Task) bool {
	return t.Source != nil && t.LatestSource != nil && t.Source.Revision != t.LatestSource.Revision
}

func (s *Store) ClientWorkers(ctx context.Context, client *Client) ([]Worker, error) {
	rows, err := s.pool.Query(ctx, `SELECT id,name,projects,labels FROM workers WHERE projects && $1 ORDER BY created_at,id`, client.Projects)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	workers := []Worker{}
	allowed := map[string]bool{}
	for _, project := range client.Projects {
		allowed[project] = true
	}
	for rows.Next() {
		var w Worker
		if err = rows.Scan(&w.ID, &w.Name, &w.Projects, &w.Labels); err != nil {
			return nil, err
		}
		visible := []string{}
		for _, project := range w.Projects {
			if allowed[project] {
				visible = append(visible, project)
			}
		}
		w.Projects = visible
		workers = append(workers, w)
	}
	return workers, rows.Err()
}

func (s *Store) ClaimTask(ctx context.Context, client *Client, id string) (*Task, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	t, err := clientTaskTx(ctx, tx, client, id, true)
	if err != nil {
		return nil, err
	}
	changed, err := t.claim(TaskClaimant{ID: client.ID, Name: client.Name})
	if err != nil {
		return nil, err
	}
	if !changed {
		return t, nil
	}
	if _, err = tx.Exec(ctx, `UPDATE tasks SET claimed_by_client_id=$2 WHERE id=$1`, id, client.ID); err != nil {
		return nil, err
	}
	t, err = taskIn(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return t, nil
}

func (s *Store) ReleaseTask(ctx context.Context, client *Client, id string) (*Task, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	t, err := clientTaskTx(ctx, tx, client, id, true)
	if err != nil {
		return nil, err
	}
	changed, err := t.release(client.ID)
	if err != nil {
		return nil, err
	}
	if !changed {
		return t, nil
	}
	if _, err = tx.Exec(ctx, `UPDATE tasks SET claimed_by_client_id=NULL WHERE id=$1`, id); err != nil {
		return nil, err
	}
	t, err = taskIn(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return t, nil
}

func (s *Store) ClientDispatch(ctx context.Context, client *Client, id, worker, key string) (*Run, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	t, err := clientTaskTx(ctx, tx, client, id, true)
	if err != nil {
		return nil, err
	}
	if t.ClaimedBy == nil || t.ClaimedBy.ID != client.ID {
		return nil, ErrForbidden
	}
	if key != "" {
		key = "client:" + client.ID + ":" + key
	}
	run, err := dispatchTx(ctx, tx, id, worker, key)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return run, nil
}

func (s *Store) ClientCancel(ctx context.Context, client *Client, id string) (*Run, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	t, err := clientTaskTx(ctx, tx, client, id, true)
	if err != nil {
		return nil, err
	}
	if t.ClaimedBy == nil || t.ClaimedBy.ID != client.ID {
		return nil, ErrForbidden
	}
	if t.CurrentRunID == "" {
		return nil, ErrConflict
	}
	_, err = tx.Exec(ctx, `UPDATE runs SET status=CASE WHEN status='queued' THEN 'cancelled' WHEN lease_expires_at<=clock_timestamp() THEN 'reconcile' ELSE 'cancel_requested' END,summary=CASE WHEN status='queued' THEN 'Cancelled before execution' WHEN lease_expires_at<=clock_timestamp() THEN 'Execution lease expired; cancellation is unconfirmed' ELSE summary END WHERE id=$1 AND status IN ('queued','running','cancel_requested')`, t.CurrentRunID)
	if err != nil {
		return nil, err
	}
	run, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, t.CurrentRunID))
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return run, nil
}
