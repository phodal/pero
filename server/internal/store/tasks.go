package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s *Store) CreateTask(ctx context.Context, spec Spec, key string) (*Task, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	task, err := createTaskTx(ctx, tx, spec, key, nil, false)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return task, nil
}

func createTaskTx(ctx context.Context, tx pgx.Tx, spec Spec, key string, creator *TaskClaimant, requireWorkerCapability bool) (*Task, error) {
	id, digest, err := receipt(ctx, tx, key, "create-task", spec)
	if err != nil {
		return nil, err
	}
	if id != "" {
		return taskIn(ctx, tx, id)
	}
	if requireWorkerCapability {
		capability := []WorkerCapability{{ProjectID: spec.ProjectID, WorkspaceKey: spec.WorkspaceKey, AgentID: spec.AgentID}}
		var available bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM worker_devices d JOIN workers w ON w.id=d.worker_id
			WHERE d.enabled AND $1=ANY(w.projects) AND d.capabilities @> $2::jsonb)`, spec.ProjectID, capability).Scan(&available); err != nil {
			return nil, err
		}
		if !available {
			return nil, ErrWorkerIneligible
		}
	}
	id = newID("task")
	data, _ := json.Marshal(spec)
	var owner *string
	if creator != nil {
		owner = &creator.ID
	}
	if _, err = tx.Exec(ctx, `INSERT INTO tasks(id,spec,claimed_by_client_id) VALUES($1,$2,$3)`, id, data, owner); err != nil {
		return nil, err
	}
	if err = saveReceipt(ctx, tx, key, "create-task", digest, id); err != nil {
		return nil, err
	}
	return &Task{ID: id, Spec: spec, State: "draft", ClaimedBy: creator}, nil
}

func taskIn(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, id string) (*Task, error) {
	var t Task
	var spec []byte
	var claimedID, claimedName string
	var latest []byte
	var latestRevision string
	var roadmap []byte
	err := q.QueryRow(ctx, `SELECT t.id,t.spec,COALESCE(t.current_run_id,''),COALESCE(c.id,''),COALESCE(c.name,''),g.latest,COALESCE(g.revision,''),road.latest,EXISTS(SELECT 1 FROM contribution_pull_requests pr WHERE pr.task_id=t.id) FROM tasks t LEFT JOIN clients c ON c.id=t.claimed_by_client_id LEFT JOIN github_issues g ON g.task_id=t.id LEFT JOIN roadmap_items road ON road.task_id=t.id WHERE t.id=$1`, id).Scan(&t.ID, &spec, &t.CurrentRunID, &claimedID, &claimedName, &latest, &latestRevision, &roadmap, &t.contributionSubmitted)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(spec, &t.Spec); err != nil {
		return nil, err
	}
	if len(latest) > 0 {
		var issue GitHubIssue
		if err = json.Unmarshal(latest, &issue); err != nil {
			return nil, err
		}
		t.LatestSource = gitHubSource(issue, latestRevision)
	}
	if len(roadmap) > 0 {
		var source Source
		if err = json.Unmarshal(roadmap, &source); err != nil {
			return nil, err
		}
		t.LatestSource = &source
	}
	if claimedID != "" {
		t.ClaimedBy = &TaskClaimant{ID: claimedID, Name: claimedName}
	}
	t.State = "draft"
	if t.CurrentRunID != "" {
		t.Run, err = readRun(q.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, t.CurrentRunID))
		if err != nil {
			return nil, err
		}
		t.State = t.Run.Status
		t.CurrentDesktopProfile = t.Run.DesktopProfile
	}
	return &t, nil
}

func (s *Store) Task(ctx context.Context, id string) (*Task, error) {
	if err := s.Reap(ctx); err != nil {
		return nil, err
	}
	return taskIn(ctx, s.pool, id)
}

func (s *Store) Tasks(ctx context.Context, cursor string, limit int, filters ...TaskFilter) (*TaskPage, error) {
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
		ids, err = s.roadmapTaskIDs(ctx, nil, cursor, limit, filter)
		if err != nil {
			return nil, err
		}
	} else {
		var before *time.Time
		if cursor != "" {
			var value time.Time
			err := s.pool.QueryRow(ctx, `SELECT created_at FROM tasks WHERE id=$1`, cursor).Scan(&value)
			if errors.Is(err, pgx.ErrNoRows) {
				return nil, ErrNotFound
			}
			if err != nil {
				return nil, err
			}
			before = &value
		}
		rows, err := s.pool.Query(ctx, `SELECT tasks.id FROM tasks LEFT JOIN github_issues g ON g.task_id=tasks.id LEFT JOIN roadmap_items road ON road.task_id=tasks.id WHERE ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::text)) AND ($4='' OR spec->'source'->>'kind'=$4) AND ($5='' OR (CASE WHEN road.task_id IS NOT NULL THEN COALESCE(road.latest->'tags','[]'::jsonb) WHEN g.task_id IS NOT NULL THEN COALESCE(g.latest->'labels','[]'::jsonb) ELSE COALESCE(spec->'tags','[]'::jsonb) END) ? $5) ORDER BY created_at DESC,id DESC LIMIT $3`, before, cursor, limit+1, filter.SourceKind, filter.Tag)
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
		t, err := taskIn(ctx, s.pool, id)
		if err != nil {
			return nil, err
		}
		// Detail owns the full Run; repeating its snapshot in every list row doubles payloads.
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
		last := page.Tasks[len(page.Tasks)-1].ID
		page.NextCursor = &last
	}
	return page, nil
}

func (s *Store) Dispatch(ctx context.Context, id, worker, key string, desktop ...RunDesktopProfile) (*Run, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	r, err := dispatchTx(ctx, tx, id, worker, key, ordinaryDispatch, desktop...)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r, nil
}

// dispatchTx shares the caller's task lock and transaction with claim/source guards.
func dispatchTx(ctx context.Context, tx pgx.Tx, id, worker, key string, mode dispatchMode, desktop ...RunDesktopProfile) (*Run, error) {
	var profile RunDesktopProfile
	if len(desktop) != 0 {
		profile = desktop[0]
	}
	if profile != "" && (profile != BlenderDesktop || worker == "") {
		return nil, ErrTaskInput
	}
	var spec []byte
	var current string
	err := tx.QueryRow(ctx, `SELECT spec,COALESCE(current_run_id,'') FROM tasks WHERE id=$1 FOR UPDATE`, id).Scan(&spec, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	operation := "dispatch:" + id
	var selection any = worker
	if profile != "" {
		selection = [2]string{worker, string(profile)}
	}
	previous, digest, err := receipt(ctx, tx, key, operation, selection)
	if err != nil {
		return nil, err
	}
	if previous != "" {
		return readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, previous))
	}
	bound, err := taskIn(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if bound.contributionSubmitted || taskSourceClosed(bound) || taskSourceStale(bound) {
		return nil, ErrConflict
	}
	if worker != "" {
		if err := checkWorkerPlacement(ctx, tx, worker, spec, mode); err != nil {
			return nil, err
		}
	}
	if current != "" {
		var status, target string
		var existingProfile RunDesktopProfile
		var reconciled bool
		if err = tx.QueryRow(ctx, `SELECT status,COALESCE(target_worker_id,''),desktop_profile,reconciliation IS NOT NULL FROM runs WHERE id=$1`, current).Scan(&status, &target, &existingProfile, &reconciled); err != nil {
			return nil, err
		}
		if status == "reconcile" && !reconciled {
			return nil, ErrConflict
		}
		if status == "queued" || status == "running" || status == "cancel_requested" {
			if target != worker || existingProfile != profile {
				return nil, ErrConflict
			}
			r, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, current))
			if err != nil {
				return nil, err
			}
			if err = saveReceipt(ctx, tx, key, operation, digest, current); err != nil {
				return nil, err
			}
			return r, nil
		}
	}
	runID := newID("run")
	r, err := readRun(tx.QueryRow(ctx, `INSERT INTO runs(id,task_id,generation,spec,target_worker_id,status,desktop_profile) SELECT $1,$2,COALESCE(MAX(generation),0)+1,$3,NULLIF($4,''),'queued',$5 FROM runs WHERE task_id=$2 RETURNING `+runColumns, runID, id, spec, worker, profile))
	if err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `UPDATE tasks SET current_run_id=$2 WHERE id=$1`, id, runID); err != nil {
		return nil, err
	}
	if err = saveReceipt(ctx, tx, key, operation, digest, runID); err != nil {
		return nil, err
	}
	return r, nil
}

func jsonProject(data []byte) string {
	var spec Spec
	_ = json.Unmarshal(data, &spec)
	return spec.ProjectID
}

func (s *Store) Cancel(ctx context.Context, id string) (*Run, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	var runID string
	err = tx.QueryRow(ctx, `SELECT COALESCE(current_run_id,'') FROM tasks WHERE id=$1 FOR UPDATE`, id).Scan(&runID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if runID == "" {
		return nil, ErrConflict
	}
	if err = cancelRun(ctx, tx, runID); err != nil {
		return nil, err
	}
	r, err := readRun(tx.QueryRow(ctx, `SELECT `+runColumns+` FROM runs WHERE id=$1`, runID))
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return r, nil
}

func encodedJSON(value any) ([]byte, error) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	err := e.Encode(value)
	return b.Bytes(), err
}

func (s *Store) Events(ctx context.Context, runID string) (*EventTail, error) {
	rows, err := s.pool.Query(ctx, `SELECT seq,kind,text,data FROM run_events WHERE run_id=$1 ORDER BY seq DESC LIMIT 201`, runID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tail := &EventTail{Events: []Event{}}
	used := 0
	for rows.Next() {
		var e Event
		if err = rows.Scan(&e.Seq, &e.Kind, &e.Text, &e.Data); err != nil {
			return nil, err
		}
		encoded, err := encodedJSON(e)
		if err != nil {
			return nil, err
		}
		if len(tail.Events) >= 200 || used+len(encoded) > 256*1024 {
			tail.Truncated = true
			break
		}
		used += len(encoded)
		tail.Events = append(tail.Events, e)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	for i, j := 0, len(tail.Events)-1; i < j; i, j = i+1, j-1 {
		tail.Events[i], tail.Events[j] = tail.Events[j], tail.Events[i]
	}
	if len(tail.Events) > 0 {
		first, last := tail.Events[0].Seq, tail.Events[len(tail.Events)-1].Seq
		tail.FirstSeq = &first
		tail.LastSeq = &last
	}
	return tail, nil
}
