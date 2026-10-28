package store

import (
	"context"
	"crypto/sha256"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type CommunityUser struct {
	ID    int64
	Login string
}
type CommunitySession struct {
	CommunityUser
	Operator bool
	CSRF     string
}
type PublicTask struct {
	ID, Title, Description, Project, SourceURL, State, RunID, Contributor string
	ContributorID                                                         int64
	Accepted                                                              bool
	SourceClosed, SourceChanged                                           bool
}
type CommunityRank struct {
	Login  string
	Points int64
}
type PointEntry struct {
	ID, TaskID, Title, RunID, Login, EvidenceURL, Note string
	Delta                                              int
	CreatedAt                                          time.Time
	Reversed                                           bool
}

func (s *Store) CommunityUpsertUser(ctx context.Context, id int64, login string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, id); err != nil {
		return err
	}
	var client string
	err = tx.QueryRow(ctx, `SELECT client_id FROM community_users WHERE id=$1`, id).Scan(&client)
	if errors.Is(err, pgx.ErrNoRows) {
		client = newID("client")
		// Community sessions are the credential; this internal client has no usable bearer token.
		hash := sha256.Sum256([]byte(newID("secret")))
		if _, err = tx.Exec(ctx, `INSERT INTO clients(id,name,projects,token_hash) VALUES($1,$2,'{}',$3)`, client, login, hash[:]); err != nil {
			return err
		}
	} else if err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO community_users(id,login,client_id) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET login=EXCLUDED.login`, id, login, client); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `UPDATE clients SET name=$2 WHERE id=$1`, client, login); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) CommunityCreateSession(ctx context.Context, token, csrf string, userID int64, operator bool) error {
	hash := sha256.Sum256([]byte(token))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `DELETE FROM community_sessions WHERE expires_at < now()`); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO community_sessions(digest,user_id,operator,csrf,expires_at) VALUES($1,NULLIF($2,0),$3,$4,now()+interval '12 hours')`, hash[:], userID, operator, csrf)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) CommunitySession(ctx context.Context, token string) (*CommunitySession, error) {
	hash := sha256.Sum256([]byte(token))
	var v CommunitySession
	err := s.pool.QueryRow(ctx, `SELECT COALESCE(u.id,0),COALESCE(u.login,''),s.operator,s.csrf FROM community_sessions s LEFT JOIN community_users u ON u.id=s.user_id WHERE s.digest=$1 AND s.expires_at>now()`, hash[:]).Scan(&v.ID, &v.Login, &v.Operator, &v.CSRF)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &v, err
}
func (s *Store) CommunityDeleteSession(ctx context.Context, token string) error {
	hash := sha256.Sum256([]byte(token))
	_, err := s.pool.Exec(ctx, `DELETE FROM community_sessions WHERE digest=$1`, hash[:])
	return err
}
func (s *Store) CommunityBindWorker(ctx context.Context, worker, login string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	result, err := tx.Exec(ctx, `INSERT INTO community_worker_owners(worker_id,user_id) SELECT w.id,u.id FROM workers w CROSS JOIN community_users u WHERE w.id=$1 AND lower(u.login)=lower($2) ON CONFLICT(worker_id) DO NOTHING`, worker, login)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrConflict
	}
	_, err = tx.Exec(ctx, `UPDATE clients c SET projects=ARRAY(SELECT DISTINCT unnest(c.projects || w.projects)) FROM workers w,community_users u WHERE w.id=$1 AND lower(u.login)=lower($2) AND c.id=u.client_id`, worker, login)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) CommunityOwnedWorkers(ctx context.Context, user int64, project string) ([]Worker, error) {
	rows, err := s.pool.Query(ctx, `SELECT w.id,w.name FROM workers w JOIN community_worker_owners o ON o.worker_id=w.id WHERE o.user_id=$1 AND $2=ANY(w.projects) ORDER BY w.name,w.id`, user, project)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Worker{}
	for rows.Next() {
		var w Worker
		if err = rows.Scan(&w.ID, &w.Name); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// CommunityPublish also replaces the public text of an already listed Task, so
// an operator can review what a public source published on its own.
func (s *Store) CommunityPublish(ctx context.Context, id, title, description, source string) error {
	result, err := s.pool.Exec(ctx, `INSERT INTO community_tasks(task_id,title,description,project,source_url) SELECT id,$2,$3,spec->>'project_id',$4 FROM tasks WHERE id=$1 ON CONFLICT(task_id) DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,source_url=EXCLUDED.source_url`, id, title, description, source)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// publishPublicSource lists an imported goal whose repository GitHub reports as
// public; that content is already public. Private repositories still need
// CommunityPublish. An existing listing keeps its reviewed text.
func publishPublicSource(ctx context.Context, tx pgx.Tx, config GitHubRepository, id string, spec Spec) error {
	_, err := tx.Exec(ctx, `INSERT INTO community_tasks(task_id,title,description,project,source_url)
	 SELECT $1,$2,$3,$4,$5 WHERE EXISTS(SELECT 1 FROM github_repositories WHERE project_id=$4 AND name=$6 AND NOT private)
	 ON CONFLICT(task_id) DO NOTHING`, id, spec.Title, spec.Prompt, config.ProjectID, spec.Source.URL, strings.ToLower(config.Name()))
	return err
}

const publicTaskQuery = `SELECT p.task_id,p.title,p.description,p.project,p.source_url,
 CASE
  WHEN source.closed AND COALESCE(r.status,'draft') IN ('draft','failed','cancelled') THEN 'closed'
  WHEN source.changed AND COALESCE(r.status,'draft') IN ('draft','failed','cancelled') THEN 'source_changed'
  WHEN t.claimed_by_client_id IS NOT NULL AND owner.id IS NULL AND COALESCE(r.status,'draft') IN ('draft','failed','cancelled') THEN 'reserved'
  WHEN r.status='succeeded' AND EXISTS(SELECT 1 FROM community_points a JOIN community_points v ON v.reverses=a.id WHERE a.run_id=r.id) THEN 'revoked'
  ELSE COALESCE(r.status,'draft') END,
 COALESCE(r.id,''),COALESCE(credited.login,u.login,owner.login,''),COALESCE(u.id,owner.id,0),
 award.id IS NOT NULL,source.closed,source.changed
 FROM community_tasks p
 JOIN tasks t ON t.id=p.task_id
 LEFT JOIN github_issues github ON github.task_id=t.id
 LEFT JOIN roadmap_items roadmap ON roadmap.task_id=t.id
 CROSS JOIN LATERAL (
  SELECT COALESCE(roadmap.latest->>'state',github.latest->>'state',t.spec->'source'->>'state','') IN ('closed','missing') AS closed,
   COALESCE(COALESCE(roadmap.latest->>'revision',github.revision)<>t.spec->'source'->>'revision',false) AS changed
 ) source
 LEFT JOIN runs r ON r.id=t.current_run_id
 LEFT JOIN community_assignments ca ON ca.run_id=r.id
 LEFT JOIN community_users u ON u.id=ca.user_id
 LEFT JOIN community_users owner ON owner.client_id=t.claimed_by_client_id
 LEFT JOIN LATERAL (
  SELECT a.id,a.user_id FROM community_points a WHERE a.task_id=p.task_id AND a.delta=1
  AND NOT EXISTS(SELECT 1 FROM community_points v WHERE v.reverses=a.id) LIMIT 1
 ) award ON true
 LEFT JOIN community_users credited ON credited.id=award.user_id`

func scanPublic(row pgx.Row) (PublicTask, error) {
	var t PublicTask
	err := row.Scan(&t.ID, &t.Title, &t.Description, &t.Project, &t.SourceURL, &t.State, &t.RunID, &t.Contributor, &t.ContributorID, &t.Accepted, &t.SourceClosed, &t.SourceChanged)
	if errors.Is(err, pgx.ErrNoRows) {
		err = ErrNotFound
	}
	return t, err
}
func (s *Store) CommunityTasks(ctx context.Context, offset int) ([]PublicTask, bool, error) {
	rows, err := s.pool.Query(ctx, publicTaskQuery+` ORDER BY p.published_at DESC,p.task_id LIMIT 51 OFFSET $1`, offset)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []PublicTask{}
	for rows.Next() {
		t, err := scanPublic(rows)
		if err != nil {
			return nil, false, err
		}
		out = append(out, t)
	}
	more := len(out) > 50
	if more {
		out = out[:50]
	}
	return out, more, rows.Err()
}
func (s *Store) CommunityTask(ctx context.Context, id string) (PublicTask, error) {
	return scanPublic(s.pool.QueryRow(ctx, publicTaskQuery+` WHERE p.task_id=$1`, id))
}

// Claim uses the same Task lock and Run schema as operator dispatch. There is no second queue.
func (s *Store) CommunityClaim(ctx context.Context, taskID, worker string, user int64) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var spec []byte
	var current string
	err = tx.QueryRow(ctx, `SELECT t.spec,COALESCE(t.current_run_id,'') FROM tasks t JOIN community_tasks p ON p.task_id=t.id WHERE t.id=$1 FOR UPDATE OF t`, taskID).Scan(&spec, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	t, err := taskIn(ctx, tx, taskID)
	if err != nil {
		return "", err
	}
	if taskSourceClosed(t) {
		return "", ErrConflict
	}
	var client string
	if err = tx.QueryRow(ctx, `SELECT client_id FROM community_users WHERE id=$1`, user).Scan(&client); err != nil {
		return "", ErrForbidden
	}
	if t.ClaimedBy != nil && t.ClaimedBy.ID != client {
		return "", ErrConflict
	}
	var allowed bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM workers w JOIN community_worker_owners o ON o.worker_id=w.id WHERE w.id=$1 AND o.user_id=$2 AND $3=ANY(w.projects))`, worker, user, jsonProject(spec)).Scan(&allowed)
	if err != nil {
		return "", err
	}
	if !allowed {
		return "", ErrForbidden
	}
	var awarded bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM community_points a WHERE a.task_id=$1 AND a.delta=1 AND NOT EXISTS(SELECT 1 FROM community_points v WHERE v.reverses=a.id))`, taskID).Scan(&awarded)
	if err != nil {
		return "", err
	}
	if awarded {
		return "", ErrConflict
	}
	if current != "" {
		var status, target string
		var owner int64
		err = tx.QueryRow(ctx, `SELECT r.status,COALESCE(r.target_worker_id,''),COALESCE(a.user_id,0) FROM runs r LEFT JOIN community_assignments a ON a.run_id=r.id WHERE r.id=$1`, current).Scan(&status, &target, &owner)
		if err != nil {
			return "", err
		}
		if (status == "queued" || status == "running") && owner == user && target == worker {
			return current, nil
		}
		var revoked bool
		if status == "succeeded" {
			if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM community_points a JOIN community_points v ON v.reverses=a.id WHERE a.run_id=$1)`, current).Scan(&revoked); err != nil {
				return "", err
			}
		}
		if status != "failed" && status != "cancelled" && !revoked {
			return "", ErrConflict
		}
	}
	if _, err = tx.Exec(ctx, `UPDATE tasks SET claimed_by_client_id=$2 WHERE id=$1`, taskID, client); err != nil {
		return "", err
	}
	run, err := dispatchTx(ctx, tx, taskID, worker, "")
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO community_assignments(run_id,task_id,user_id,worker_id) VALUES($1,$2,$3,$4)`, run.ID, taskID, user, worker)
	if err != nil {
		return "", err
	}
	return run.ID, tx.Commit(ctx)
}

// Decisions pin the succeeded Run shown to the operator; stale forms cannot accept a replacement.
func (s *Store) CommunityAccept(ctx context.Context, taskID, runID, evidence, note string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var current string
	err = tx.QueryRow(ctx, `SELECT COALESCE(current_run_id,'') FROM tasks WHERE id=$1 FOR UPDATE`, taskID).Scan(&current)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if current != runID {
		return ErrConflict
	}
	var user int64
	err = tx.QueryRow(ctx, `SELECT a.user_id FROM community_assignments a JOIN runs r ON r.id=a.run_id WHERE a.run_id=$1 AND a.task_id=$2 AND r.status='succeeded' AND r.worker_id=a.worker_id`, runID, taskID).Scan(&user)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConflict
	}
	if err != nil {
		return err
	}
	var revoked bool
	err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM community_points a JOIN community_points v ON v.reverses=a.id WHERE a.run_id=$1)`, runID).Scan(&revoked)
	if err != nil {
		return err
	}
	if revoked {
		return ErrConflict
	}
	var existing string
	err = tx.QueryRow(ctx, `SELECT a.run_id FROM community_points a WHERE a.task_id=$1 AND a.delta=1 AND NOT EXISTS(SELECT 1 FROM community_points v WHERE v.reverses=a.id)`, taskID).Scan(&existing)
	if err == nil {
		if existing == runID {
			return nil
		}
		return ErrConflict
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO community_points(id,task_id,run_id,user_id,delta,evidence_url,note) VALUES($1,$2,$3,$4,1,$5,$6)`, newID("point"), taskID, runID, user, evidence, note)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
func (s *Store) CommunityReverse(ctx context.Context, taskID, awardID, note string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var id string
	if err = tx.QueryRow(ctx, `SELECT id FROM tasks WHERE id=$1 FOR UPDATE`, taskID).Scan(&id); err != nil {
		return err
	}
	result, err := tx.Exec(ctx, `INSERT INTO community_points(id,task_id,run_id,user_id,delta,reverses,evidence_url,note) SELECT $1,task_id,run_id,user_id,-1,id,evidence_url,$4 FROM community_points WHERE id=$2 AND task_id=$3 AND delta=1 ON CONFLICT(reverses) DO NOTHING`, newID("point"), awardID, taskID, note)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		var exists bool
		err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM community_points WHERE reverses=$1 AND task_id=$2)`, awardID, taskID).Scan(&exists)
		if err != nil {
			return err
		}
		if !exists {
			return ErrConflict
		}
	}
	return tx.Commit(ctx)
}

// Reversals remove the original award from its original period, even when revoked later.
func (s *Store) CommunityLeaderboard(ctx context.Context, since time.Time) ([]CommunityRank, error) {
	rows, err := s.pool.Query(ctx, `SELECT u.login,COUNT(*) FROM community_points a JOIN community_users u ON u.id=a.user_id WHERE a.delta=1 AND a.created_at >= $1 AND NOT EXISTS(SELECT 1 FROM community_points v WHERE v.reverses=a.id) GROUP BY u.id,u.login ORDER BY COUNT(*) DESC,lower(u.login),u.id LIMIT 100`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CommunityRank{}
	for rows.Next() {
		var r CommunityRank
		if err = rows.Scan(&r.Login, &r.Points); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (s *Store) CommunityHistory(ctx context.Context, login, task string, offset int) ([]PointEntry, bool, error) {
	rows, err := s.pool.Query(ctx, `SELECT a.id,a.task_id,p.title,a.run_id,u.login,a.delta,a.evidence_url,a.note,a.created_at,EXISTS(SELECT 1 FROM community_points v WHERE v.reverses=a.id) FROM community_points a JOIN community_tasks p ON p.task_id=a.task_id JOIN community_users u ON u.id=a.user_id WHERE ($1='' OR lower(u.login)=lower($1)) AND ($2='' OR a.task_id=$2) ORDER BY a.created_at DESC,a.id LIMIT 51 OFFSET $3`, login, task, offset)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	out := []PointEntry{}
	for rows.Next() {
		var e PointEntry
		if err = rows.Scan(&e.ID, &e.TaskID, &e.Title, &e.RunID, &e.Login, &e.Delta, &e.EvidenceURL, &e.Note, &e.CreatedAt, &e.Reversed); err != nil {
			return nil, false, err
		}
		out = append(out, e)
	}
	more := len(out) > 50
	if more {
		out = out[:50]
	}
	return out, more, rows.Err()
}
