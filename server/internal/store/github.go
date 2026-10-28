package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type GitHubRepository struct {
	ProjectID     string `json:"project_id"`
	Owner         string `json:"owner"`
	Repo          string `json:"repo"`
	WorkspaceKey  string `json:"workspace_key"`
	AgentID       string `json:"agent_id"`
	Acceptance    string `json:"acceptance"`
	AutoDispatch  bool   `json:"auto_dispatch"`
	RequiredLabel string `json:"required_label"`
	WorkerID      string `json:"worker_id,omitempty"`
	RoadmapPath   string `json:"roadmap_path,omitempty"`
}

func (r GitHubRepository) Name() string { return r.Owner + "/" + r.Repo }

type GitHubIssue struct {
	RepositoryID string   `json:"repository_id"`
	Repository   string   `json:"repository"`
	ID           string   `json:"issue_id"`
	NodeID       string   `json:"node_id"`
	Number       int64    `json:"number"`
	URL          string   `json:"url"`
	Title        string   `json:"title"`
	Body         string   `json:"body"`
	State        string   `json:"state"`
	UpdatedAt    string   `json:"updated_at"`
	Labels       []string `json:"labels"`
}
type GitHubChange struct{ Imported, Updated, Dispatched bool }

func gitHubSource(issue GitHubIssue, revision string) *Source {
	return &Source{Kind: "github", Repository: issue.Repository, IssueNumber: issue.Number, URL: issue.URL, Revision: revision, State: issue.State, UpdatedAt: issue.UpdatedAt, IssueID: issue.ID, RepositoryID: issue.RepositoryID, Tags: issue.Labels}
}

func (s *Store) BindGitHubRepository(ctx context.Context, config GitHubRepository, id string, private bool) error {
	var bound string
	err := s.pool.QueryRow(ctx, `INSERT INTO github_repositories(project_id,name,repository_id,private) VALUES($1,$2,$3,$4) ON CONFLICT(project_id,name) DO UPDATE SET private=CASE WHEN github_repositories.repository_id=EXCLUDED.repository_id THEN EXCLUDED.private ELSE github_repositories.private END RETURNING repository_id`, config.ProjectID, strings.ToLower(config.Name()), id, private).Scan(&bound)
	if err != nil {
		return err
	}
	if bound != id {
		return ErrConflict
	}
	return nil
}

func (s *Store) GitHubSyncRecord(ctx context.Context, config GitHubRepository, partial bool, message string) error {
	_, err := s.pool.Exec(ctx, `UPDATE github_repositories SET last_synced_at=clock_timestamp(),partial=$3,last_error=$4 WHERE project_id=$1 AND name=$2`, config.ProjectID, strings.ToLower(config.Name()), partial, message)
	return err
}

// SyncGitHubIssue and human claim use the same Task row lock. Source data may
// refresh while a Run executes, but that Run's immutable snapshot never changes.
func (s *Store) SyncGitHubIssue(ctx context.Context, config GitHubRepository, issue GitHubIssue) (GitHubChange, error) {
	change := GitHubChange{}
	data, err := json.Marshal(issue)
	if err != nil {
		return change, err
	}
	hash := sha256.Sum256(data)
	revision := hex.EncodeToString(hash[:])
	source := gitHubSource(issue, revision)
	spec := Spec{Title: issue.Title, Prompt: strings.TrimSpace(issue.Title + "\n\n" + issue.Body), Acceptance: config.Acceptance, ProjectID: config.ProjectID, WorkspaceKey: config.WorkspaceKey, AgentID: config.AgentID, Source: source, Tags: issue.Labels}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return change, err
	}
	defer tx.Rollback(ctx)
	key := config.ProjectID + ":" + issue.RepositoryID + ":" + issue.ID
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, "pero:github:"+key); err != nil {
		return change, err
	}
	var id, priorRevision string
	var priorUpdated time.Time
	err = tx.QueryRow(ctx, `SELECT task_id,revision,updated_at FROM github_issues WHERE project_id=$1 AND repository_id=$2 AND issue_id=$3 FOR UPDATE`, config.ProjectID, issue.RepositoryID, issue.ID).Scan(&id, &priorRevision, &priorUpdated)
	isNew := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !isNew {
		return change, err
	}
	updated, err := time.Parse(time.RFC3339, issue.UpdatedAt)
	if err != nil {
		return change, err
	}
	if !isNew && updated.Before(priorUpdated) {
		return change, nil
	}
	if isNew {
		id = newID("task")
		encoded, _ := json.Marshal(spec)
		if _, err = tx.Exec(ctx, `INSERT INTO tasks(id,spec) VALUES($1,$2)`, id, encoded); err != nil {
			return change, err
		}
		change.Imported = true
	}
	if err = publishPublicSource(ctx, tx, config, id, spec); err != nil {
		return change, err
	}
	var current string
	var claimed *string
	var oldSpec []byte
	if err = tx.QueryRow(ctx, `SELECT spec,COALESCE(current_run_id,''),claimed_by_client_id FROM tasks WHERE id=$1 FOR UPDATE`, id).Scan(&oldSpec, &current, &claimed); err != nil {
		return change, err
	}
	if !isNew {
		var existing Spec
		if err = json.Unmarshal(oldSpec, &existing); err != nil {
			return change, err
		}
		if priorRevision != revision {
			change.Updated = true
		}
		// A retained goal keeps its exact provenance. Latest provider metadata
		// is hydrated separately as Task.latest_source, never relabelled here.
		if current == "" && claimed == nil && (existing.Source == nil || existing.Source.Revision != revision) {
			encoded, _ := json.Marshal(spec)
			if _, err = tx.Exec(ctx, `UPDATE tasks SET spec=$2 WHERE id=$1`, id, encoded); err != nil {
				return change, err
			}
			change.Updated = true
		}
	}
	if _, err = tx.Exec(ctx, `INSERT INTO github_issues(project_id,repository_id,issue_id,node_id,task_id,revision,updated_at,latest) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(project_id,repository_id,issue_id) DO UPDATE SET node_id=EXCLUDED.node_id,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at,latest=EXCLUDED.latest`, config.ProjectID, issue.RepositoryID, issue.ID, issue.NodeID, id, revision, updated, data); err != nil {
		return change, err
	}
	if _, err = tx.Exec(ctx, `INSERT INTO github_issue_versions(project_id,repository_id,issue_id,revision,payload) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, config.ProjectID, issue.RepositoryID, issue.ID, revision, data); err != nil {
		return change, err
	}
	// The Run row arbitrates closure versus a concurrent Worker claim. A Run
	// already marked running keeps its frozen input and is never auto-cancelled.
	if issue.State == "closed" && current != "" {
		if _, err = tx.Exec(ctx, `UPDATE runs SET status='cancelled',summary='GitHub issue closed before execution' WHERE id=$1 AND status='queued'`, current); err != nil {
			return change, err
		}
	}
	eligible := config.AutoDispatch && config.RequiredLabel != "" && issue.State == "open" && current == "" && claimed == nil
	label := false
	for _, value := range issue.Labels {
		if value == config.RequiredLabel {
			label = true
			break
		}
	}
	if eligible && label {
		if _, err = dispatchTx(ctx, tx, id, config.WorkerID, "github-auto:"+id); err != nil {
			return change, err
		}
		change.Dispatched = true
	}
	if err = tx.Commit(ctx); err != nil {
		return change, err
	}
	return change, nil
}
