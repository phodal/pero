package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// The publication is the authority; a GitHub identity gains no project/Worker scope.
func contributionTx(ctx context.Context, tx pgx.Tx, client *Client, id string, lock bool) (*Contribution, error) {
	query := `SELECT p.title,p.description,p.project,p.source_url,COALESCE(owner.login,'') FROM tasks t JOIN community_tasks p ON p.task_id=t.id LEFT JOIN community_users owner ON owner.client_id=t.claimed_by_client_id WHERE t.id=$1 AND EXISTS(SELECT 1 FROM community_users WHERE client_id=$2)`
	if lock {
		query += ` FOR UPDATE OF t`
	} else {
		query += ` FOR SHARE OF t`
	}
	p := PublicTask{ID: id}
	err := tx.QueryRow(ctx, query, id, client.ID).Scan(&p.Title, &p.Description, &p.Project, &p.SourceURL, &p.Contributor)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	t, err := taskIn(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM community_points a WHERE a.task_id=$1 AND a.delta=1 AND NOT EXISTS(SELECT 1 FROM community_points v WHERE v.reverses=a.id))`, id).Scan(&p.Accepted); err != nil {
		return nil, err
	}
	pr := &PullRequest{}
	err = tx.QueryRow(ctx, `SELECT url,branch,head_sha,source_revision FROM contribution_pull_requests WHERE task_id=$1`, id).Scan(&pr.URL, &pr.Branch, &pr.HeadSHA, &pr.SourceRevision)
	if errors.Is(err, pgx.ErrNoRows) {
		pr = nil
	} else if err != nil {
		return nil, err
	} else {
		pr.repository, _ = githubRepository(pr.URL)
	}
	c := newContribution(p, t, pr)
	if c.Repository == "" {
		return nil, ErrNotFound
	}
	return &c, nil
}

func (s *Store) Contribution(ctx context.Context, client *Client, id string) (*Contribution, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	return contributionTx(ctx, tx, client, id, false)
}

func (s *Store) Contributions(ctx context.Context, client *Client, cursor string, limit int) (*ContributionPage, error) {
	const scanLimit = 200
	var before *time.Time
	if cursor != "" {
		var value time.Time
		err := s.pool.QueryRow(ctx, `SELECT published_at FROM community_tasks WHERE task_id=$1`, cursor).Scan(&value)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		if err != nil {
			return nil, err
		}
		before = &value
	}
	rows, err := s.pool.Query(ctx, `SELECT task_id FROM community_tasks WHERE EXISTS(SELECT 1 FROM community_users WHERE client_id=$1) AND ($2::timestamptz IS NULL OR (published_at,task_id)<($2::timestamptz,$3::text)) ORDER BY published_at DESC,task_id DESC LIMIT $4`, client.ID, before, cursor, scanLimit+1)
	if err != nil {
		return nil, err
	}
	ids := []string{}
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
	page := &ContributionPage{Contributions: []Contribution{}}
	used, last := 0, cursor
	// Bound work when generic public research tasks sit between coding goals.
	// The opaque cursor advances over skipped publications as well as returned goals.
	for index, id := range ids {
		if index == scanLimit {
			page.HasMore = true
			break
		}
		c, err := s.Contribution(ctx, client, id)
		if errors.Is(err, ErrNotFound) {
			last = id
			continue
		}
		if err != nil {
			return nil, err
		}
		if len(page.Contributions) >= limit {
			page.HasMore = true
			break
		}
		encoded, err := encodedJSON(c)
		if err != nil {
			return nil, err
		}
		if used+len(encoded) > 512*1024-4096 && len(page.Contributions) > 0 {
			page.HasMore = true
			break
		}
		used += len(encoded)
		page.Contributions = append(page.Contributions, *c)
		last = id
	}
	if page.HasMore {
		page.NextCursor = &last
	}

	return page, nil
}

func (s *Store) ClaimContribution(ctx context.Context, client *Client, id string) (*Contribution, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := contributionTx(ctx, tx, client, id, true)
	if err != nil {
		return nil, err
	}
	changed, err := c.claim(TaskClaimant{ID: client.ID, Name: client.Name})
	if err != nil {
		return nil, err
	}
	if changed {
		if _, err = tx.Exec(ctx, `UPDATE tasks SET claimed_by_client_id=$2 WHERE id=$1`, id, client.ID); err != nil {
			return nil, err
		}
	}
	c, err = contributionTx(ctx, tx, client, id, false)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return c, nil
}
func (s *Store) ReleaseContribution(ctx context.Context, client *Client, id string) (*Contribution, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := contributionTx(ctx, tx, client, id, true)
	if err != nil {
		return nil, err
	}
	changed, err := c.release(client.ID)
	if err != nil {
		return nil, err
	}
	if changed {
		if _, err = tx.Exec(ctx, `UPDATE tasks SET claimed_by_client_id=NULL WHERE id=$1`, id); err != nil {
			return nil, err
		}
	}
	c, err = contributionTx(ctx, tx, client, id, false)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return c, nil
}
func (s *Store) SubmitContribution(ctx context.Context, client *Client, id string, pr PullRequest) (*Contribution, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	c, err := contributionTx(ctx, tx, client, id, true)
	if err != nil {
		return nil, err
	}
	if err = c.submit(client.ID, pr); err != nil {
		return nil, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO contribution_pull_requests(task_id,client_id,url,branch,head_sha,source_revision) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(task_id) DO UPDATE SET head_sha=EXCLUDED.head_sha`, id, client.ID, pr.URL, pr.Branch, pr.HeadSHA, pr.SourceRevision); err != nil {
		return nil, err
	}
	c, err = contributionTx(ctx, tx, client, id, false)
	if err != nil {
		return nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, err
	}
	return c, nil
}
