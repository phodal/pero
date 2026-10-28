package store

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestPublicContributionWithoutProjectOrWorkerGrant(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	if err := s.CommunityUpsertUser(ctx, 101, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := s.CommunityUpsertUser(ctx, 102, "bob"); err != nil {
		t.Fatal(err)
	}
	alice := Client{ID: "", Name: "alice", Projects: []string{}}
	bob := Client{ID: "", Name: "bob", Projects: []string{}}
	if err := s.pool.QueryRow(ctx, `SELECT client_id FROM community_users WHERE id=101`).Scan(&alice.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT client_id FROM community_users WHERE id=102`).Scan(&bob.ID); err != nil {
		t.Fatal(err)
	}
	task, err := s.CreateTask(ctx, Spec{Title: "Private title", Prompt: "secret requirements", Acceptance: "secret acceptance", ProjectID: "team", WorkspaceKey: "secret workspace", AgentID: "private agent"}, "")
	if err != nil {
		t.Fatal(err)
	}
	hidden, err := s.CreateTask(ctx, testSpec("private"), "")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.CommunityPublish(ctx, task.ID, "Public title", "Reviewed requirements", "https://github.com/phodal/pero/issues/2"); err != nil {
		t.Fatal(err)
	}
	generic, err := s.CreateTask(ctx, testSpec("research"), "")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.CommunityPublish(ctx, generic.ID, "Public research", "Review scientific results", "https://example.org/paper"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Contribution(ctx, &alice, generic.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-coding publication in contribution API: %v", err)
	}
	page, err := s.Contributions(ctx, &alice, "", 1)
	if err != nil || len(page.Contributions) != 1 || page.HasMore {
		t.Fatalf("public list: %+v %v", page, err)
	}
	encoded, _ := json.Marshal(page)
	if strings.Contains(string(encoded), "secret") || strings.Contains(string(encoded), "private agent") {
		t.Fatalf("private task data exposed: %s", encoded)
	}
	c := &page.Contributions[0]
	if c.Repository != "phodal/pero" || c.SourceRevision == "" || c.State != "available" {
		t.Fatalf("contribution: %+v", c)
	}
	if _, err = s.Contribution(ctx, &alice, hidden.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("private contribution exposed: %v", err)
	}
	if _, err = s.ClientTask(ctx, &alice, task.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("publication granted project scope: %v", err)
	}
	if workers, err := s.ClientWorkers(ctx, &alice); err != nil || len(workers) != 0 {
		t.Fatalf("publication granted workers: %+v %v", workers, err)
	}
	if _, err = s.ClientDispatch(ctx, &alice, task.ID, "", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("publication granted remote execution: %v", err)
	}
	internal, _ := mustClient(t, s, "confidential worker identity", "team")
	if _, err = s.ClaimTask(ctx, &internal, task.ID); err != nil {
		t.Fatal(err)
	}
	reserved, err := s.Contribution(ctx, &alice, task.ID)
	encoded, _ = json.Marshal(reserved)
	if err != nil || strings.Contains(string(encoded), internal.Name) || strings.Contains(string(encoded), internal.ID) {
		t.Fatalf("private claimant exposed: %s %v", encoded, err)
	}
	if _, err = s.ReleaseTask(ctx, &internal, task.ID); err != nil {
		t.Fatal(err)
	}
	if c, err = s.ClaimContribution(ctx, &alice, task.ID); err != nil || c.ClaimedBy == nil || c.ClaimedBy.ID != alice.ID || c.State != "claimed" {
		t.Fatalf("claim: %+v %v", c, err)
	}
	if _, err = s.ClaimContribution(ctx, &bob, task.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("claim stolen: %v", err)
	}
	if _, err = s.ReleaseContribution(ctx, &bob, task.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign release: %v", err)
	}
	wrong, _ := ParsePullRequest("https://github.com/other/repo/pull/1", "branch", strings.Repeat("a", 40), c.SourceRevision)
	if _, err = s.SubmitContribution(ctx, &alice, task.ID, wrong); !errors.Is(err, ErrContributionInput) {
		t.Fatalf("wrong repository accepted: %v", err)
	}
	stale, _ := ParsePullRequest("https://github.com/phodal/pero/pull/1", "branch", strings.Repeat("a", 40), "stale")
	if _, err = s.SubmitContribution(ctx, &alice, task.ID, stale); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale goal accepted: %v", err)
	}
	pr, _ := ParsePullRequest("https://github.com/phodal/pero/pull/1", "branch", strings.Repeat("a", 40), c.SourceRevision)
	if _, err = s.SubmitContribution(ctx, &bob, task.ID, pr); !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign submission: %v", err)
	}
	if c, err = s.SubmitContribution(ctx, &alice, task.ID, pr); err != nil || c.State != "submitted" || c.PullRequest == nil {
		t.Fatalf("submit: %+v %v", c, err)
	}
	if c, err = s.SubmitContribution(ctx, &alice, task.ID, pr); err != nil || c.PullRequest.URL != pr.URL {
		t.Fatalf("submission retry: %+v %v", c, err)
	}
	updated, _ := ParsePullRequest(pr.URL, pr.Branch, strings.Repeat("b", 40), pr.SourceRevision)
	if c, err = s.SubmitContribution(ctx, &alice, task.ID, updated); err != nil || c.PullRequest.HeadSHA != updated.HeadSHA {
		t.Fatalf("same PR follow-up: %+v %v", c, err)
	}
	different, _ := ParsePullRequest("https://github.com/phodal/pero/pull/2", pr.Branch, updated.HeadSHA, pr.SourceRevision)
	if _, err = s.SubmitContribution(ctx, &alice, task.ID, different); !errors.Is(err, ErrConflict) {
		t.Fatalf("different PR replaced candidate: %v", err)
	}
	original, err := s.Task(ctx, task.ID)
	if err != nil || original.CurrentRunID != "" || original.Run != nil {
		t.Fatalf("submission manufactured a run: %+v %v", original, err)
	}
	// A project-scoped caller cannot release or remotely dispatch the submitted candidate either.
	scoped := alice
	scoped.Projects = []string{"team"}
	if _, err = s.ReleaseTask(ctx, &scoped, task.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("scoped release discarded submission: %v", err)
	}
	if _, err = s.ClientDispatch(ctx, &scoped, task.ID, "", ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("remote dispatch replayed local work: %v", err)
	}
	if published, err := s.CommunityTask(ctx, task.ID); err != nil || published.State != "submitted" || published.Accepted {
		t.Fatalf("submission accepted or missing publicly: %+v %v", published, err)
	}
	var scope int
	if err = s.pool.QueryRow(ctx, `SELECT cardinality(projects) FROM clients WHERE id=$1`, alice.ID).Scan(&scope); err != nil || scope != 0 {
		t.Fatalf("scope changed: %d %v", scope, err)
	}
}

// Pagination is bounded even when an entire scan contains other public work.
func TestContributionPaginationSkipsOtherPublicWork(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	if err := s.CommunityUpsertUser(ctx, 101, "alice"); err != nil {
		t.Fatal(err)
	}
	alice := Client{}
	if err := s.pool.QueryRow(ctx, `SELECT client_id FROM community_users WHERE id=101`).Scan(&alice.ID); err != nil {
		t.Fatal(err)
	}
	task, err := s.CreateTask(ctx, testSpec("code"), "")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.CommunityPublish(ctx, task.ID, "Code change", "Implement this code change", "https://github.com/acme/repo/issues/1"); err != nil {
		t.Fatal(err)
	}
	spec, _ := json.Marshal(testSpec("research"))
	if _, err = s.pool.Exec(ctx, `INSERT INTO tasks(id,spec) SELECT 'research_' || i,$1::jsonb FROM generate_series(1,201) AS i`, spec); err != nil {
		t.Fatal(err)
	}
	if _, err = s.pool.Exec(ctx, `INSERT INTO community_tasks(task_id,title,description,project,source_url,published_at) SELECT id,'Paper review','Review this paper','research','', '2050-01-01'::timestamptz FROM tasks WHERE id LIKE 'research_%'`); err != nil {
		t.Fatal(err)
	}
	page, err := s.Contributions(ctx, &alice, "", 50)
	if err != nil || len(page.Contributions) != 0 || !page.HasMore || page.NextCursor == nil || *page.NextCursor == "" {
		t.Fatalf("bounded scan: %+v %v", page, err)
	}
	next, err := s.Contributions(ctx, &alice, *page.NextCursor, 50)
	if err != nil || len(next.Contributions) != 1 || next.Contributions[0].TaskID != task.ID || next.HasMore {
		t.Fatalf("cursor did not advance over generic work: %+v %v", next, err)
	}
}
