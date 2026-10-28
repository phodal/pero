package store

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func sourceFixture() (GitHubRepository, GitHubIssue) {
	return GitHubRepository{ProjectID: "p", Owner: "acme", Repo: "repo", WorkspaceKey: "repo", AgentID: "fixture", Acceptance: "Check result", RequiredLabel: "pero:ready"}, GitHubIssue{RepositoryID: "200", Repository: "acme/repo", ID: "300", NodeID: "I_300", Number: 7, URL: "https://github.com/acme/repo/issues/7", Title: "Goal", Body: "Original body", State: "open", UpdatedAt: "2026-10-28T00:00:00Z", Labels: []string{"pero:ready"}}
}

func sourceTask(t *testing.T, s *Store, issue GitHubIssue) *Task {
	t.Helper()
	var id string
	if err := s.pool.QueryRow(context.Background(), `SELECT task_id FROM github_issues WHERE project_id='p' AND repository_id=$1 AND issue_id=$2`, issue.RepositoryID, issue.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	task, err := s.Task(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func TestGitHubRunningClosureAndSourceHistory(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	config, issue := sourceFixture()
	w, _ := mustWorker(t, s, "p")
	config.AutoDispatch = true
	config.WorkerID = w.ID
	if err := s.BindGitHubRepository(ctx, config, "200", false); err != nil {
		t.Fatal(err)
	}
	if err := s.BindGitHubRepository(ctx, config, "201", false); !errors.Is(err, ErrConflict) {
		t.Fatalf("repository identity rebound: %v", err)
	}
	change, err := s.SyncGitHubIssue(ctx, config, issue)
	if err != nil || !change.Dispatched {
		t.Fatalf("first auto dispatch: %+v %v", change, err)
	}
	task := sourceTask(t, s, issue)
	run, err := s.Claim(ctx, w.ID, "instance", "claim")
	if err != nil || run == nil {
		t.Fatalf("claim: %+v %v", run, err)
	}
	issue.State = "closed"
	issue.Body = "Changed body"
	issue.UpdatedAt = "2026-10-28T00:01:00Z"
	change, err = s.SyncGitHubIssue(ctx, config, issue)
	if err != nil || !change.Updated || change.Dispatched {
		t.Fatalf("closure sync: %+v %v", change, err)
	}
	current, err := s.Task(ctx, task.ID)
	if err != nil || current.State != "running" || current.LatestSource.State != "closed" || current.Source.State != "open" || current.Run.Spec.Source.State != "open" || current.Prompt != run.Spec.Prompt {
		t.Fatalf("running closure changed execution: %+v %v", current, err)
	}
	var versions int
	if err = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM github_issue_versions WHERE issue_id=$1`, issue.ID).Scan(&versions); err != nil || versions != 2 {
		t.Fatalf("immutable source revisions: %d %v", versions, err)
	}
	if _, err = s.Complete(ctx, run.ID, w.ID, "instance", run.Generation, Completion{Outcome: "succeeded", Summary: "Execution ended"}); err != nil {
		t.Fatal(err)
	}
	issue.State = "open"
	issue.UpdatedAt = "2026-10-28T00:02:00Z"
	change, err = s.SyncGitHubIssue(ctx, config, issue)
	if err != nil || change.Dispatched {
		t.Fatalf("reopen silently reran completed goal: %+v %v", change, err)
	}
}

func TestGitHubAutoDispatchVersusHumanClaim(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	config, issue := sourceFixture()
	client, _ := mustClient(t, s, "Alice", "p")
	if _, err := s.SyncGitHubIssue(ctx, config, issue); err != nil {
		t.Fatal(err)
	}
	task := sourceTask(t, s, issue)
	config.AutoDispatch = true
	var wg sync.WaitGroup
	wg.Add(2)
	var syncErr, claimErr error
	go func() { defer wg.Done(); _, syncErr = s.SyncGitHubIssue(ctx, config, issue) }()
	go func() { defer wg.Done(); _, claimErr = s.ClaimTask(ctx, &client, task.ID) }()
	wg.Wait()
	if syncErr != nil {
		t.Fatal(syncErr)
	}
	if claimErr != nil && !errors.Is(claimErr, ErrConflict) {
		t.Fatal(claimErr)
	}
	final, err := s.Task(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Run != nil && final.ClaimedBy != nil {
		t.Fatal("automatic dispatch stole a human claim")
	}
	if final.Run == nil && final.ClaimedBy == nil {
		t.Fatal("neither claim nor dispatch won")
	}
}

func TestGitHubAutoPolicyRequiresOpenLabelAndFirstRun(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	config, issue := sourceFixture()
	config.AutoDispatch = true
	issue.Labels = []string{}
	first, err := s.SyncGitHubIssue(ctx, config, issue)
	if err != nil || first.Dispatched {
		t.Fatalf("unlabeled issue auto-dispatched: %+v %v", first, err)
	}
	issue.Labels = []string{"pero:ready"}
	issue.State = "closed"
	issue.UpdatedAt = "2026-10-28T00:01:00Z"
	closed, err := s.SyncGitHubIssue(ctx, config, issue)
	if err != nil || closed.Dispatched {
		t.Fatalf("closed issue auto-dispatched: %+v %v", closed, err)
	}
	issue.State = "open"
	issue.UpdatedAt = "2026-10-28T00:02:00Z"
	open, err := s.SyncGitHubIssue(ctx, config, issue)
	if err != nil || !open.Dispatched {
		t.Fatalf("authorized policy failed: %+v %v", open, err)
	}
}

func TestGitHubChangedGoalNeverFreezesOldBodyWithNewProvenance(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	config, issue := sourceFixture()
	client, _ := mustClient(t, s, "Alice", "p")
	if _, err := s.SyncGitHubIssue(ctx, config, issue); err != nil {
		t.Fatal(err)
	}
	task := sourceTask(t, s, issue)
	if _, err := s.ClaimTask(ctx, &client, task.ID); err != nil {
		t.Fatal(err)
	}
	oldRevision := task.Source.Revision
	issue.Body = "Revised goal"
	issue.UpdatedAt = "2026-10-28T00:01:00Z"
	if _, err := s.SyncGitHubIssue(ctx, config, issue); err != nil {
		t.Fatal(err)
	}
	claimed, err := s.Task(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if claimed.Source.Revision != oldRevision || claimed.LatestSource.Revision == oldRevision || claimed.Prompt != task.Prompt {
		t.Fatal("claimed goal was relabelled under a new source revision")
	}
	if _, err = s.ClientDispatch(ctx, &client, task.ID, "", ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale claimed goal dispatched: %v", err)
	}
	if _, err = s.ReleaseTask(ctx, &client, task.ID); err != nil {
		t.Fatal(err)
	}
	// No additional provider edit is needed: the next sync refreshes an unclaimed draft.
	if _, err = s.SyncGitHubIssue(ctx, config, issue); err != nil {
		t.Fatal(err)
	}
	refreshed, err := s.Task(ctx, task.ID)
	if err != nil || refreshed.Source.Revision != refreshed.LatestSource.Revision || refreshed.Prompt == task.Prompt {
		t.Fatalf("released draft did not refresh: %+v %v", refreshed, err)
	}
	run, err := s.Dispatch(ctx, task.ID, "", "")
	if err != nil || run.Spec.Source.Revision != refreshed.LatestSource.Revision || run.Spec.Prompt != refreshed.Prompt {
		t.Fatalf("new Run provenance mismatch: %+v %v", run, err)
	}
	w, _ := mustWorker(t, s, "p")
	if _, err = s.Claim(ctx, w.ID, "instance", "claim"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Complete(ctx, run.ID, w.ID, "instance", run.Generation, Completion{Outcome: "succeeded"}); err != nil {
		t.Fatal(err)
	}
	issue.Body = "Third goal"
	issue.UpdatedAt = "2026-10-28T00:02:00Z"
	if _, err = s.SyncGitHubIssue(ctx, config, issue); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Dispatch(ctx, task.ID, "", ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("completed stale task silently froze third revision over second goal: %v", err)
	}
}
