package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func communityFixture(t *testing.T) (*Store, *Task, Worker, Worker) {
	t.Helper()
	s, _ := integrationStore(t)
	ctx := context.Background()
	for id, login := range map[int64]string{101: "alice", 102: "bob"} {
		if err := s.CommunityUpsertUser(ctx, id, login); err != nil {
			t.Fatal(err)
		}
	}
	alice, _ := mustWorker(t, s, "p")
	bob, _ := mustWorker(t, s, "p")
	if err := s.CommunityBindWorker(ctx, alice.ID, "alice"); err != nil {
		t.Fatal(err)
	}
	if err := s.CommunityBindWorker(ctx, bob.ID, "bob"); err != nil {
		t.Fatal(err)
	}
	task, err := s.CreateTask(ctx, testSpec("p"), "")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.CommunityPublish(ctx, task.ID, "Public title", "Public requirements", "https://github.com/phodal/pero/issues/2"); err != nil {
		t.Fatal(err)
	}
	return s, task, alice, bob
}
func TestCommunityConcurrentClaimAndIndependentAcceptance(t *testing.T) {
	s, task, alice, bob := communityFixture(t)
	ctx := context.Background()
	if _, err := s.CommunityClaim(ctx, task.ID, alice.ID, 102); !errors.Is(err, ErrForbidden) {
		t.Fatalf("foreign Worker: %v", err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	winner := int64(0)
	runID := ""
	worker := ""
	for _, candidate := range []struct {
		id     int64
		worker string
	}{{101, alice.ID}, {102, bob.ID}} {
		wg.Add(1)
		go func(id int64, w string) {
			defer wg.Done()
			run, err := s.CommunityClaim(ctx, task.ID, w, id)
			if err == nil {
				mu.Lock()
				defer mu.Unlock()
				if winner != 0 {
					t.Error("two contributors claimed one task")
				}
				winner, runID, worker = id, run, w
			} else if !errors.Is(err, ErrConflict) {
				t.Errorf("claim: %v", err)
			}
		}(candidate.id, candidate.worker)
	}
	wg.Wait()
	if winner == 0 {
		t.Fatal("no claim winner")
	}
	if err := s.CommunityAccept(ctx, task.ID, runID, "https://example.com/report", "Not yet finished"); !errors.Is(err, ErrConflict) {
		t.Fatalf("queued award: %v", err)
	}
	run, err := s.Claim(ctx, worker, "instance", "claim")
	if err != nil || run == nil || run.ID != runID {
		t.Fatalf("worker claim: %+v %v", run, err)
	}
	if _, err = s.Complete(ctx, run.ID, worker, "instance", run.Generation, Completion{Outcome: "succeeded", Summary: "Agent says success"}); err != nil {
		t.Fatal(err)
	}
	ranks, err := s.CommunityLeaderboard(ctx, time.Unix(0, 0))
	if err != nil || len(ranks) != 0 {
		t.Fatalf("success manufactured points: %+v %v", ranks, err)
	}
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.CommunityAccept(ctx, task.ID, runID, "https://example.com/report", "Reviewed"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	ranks, err = s.CommunityLeaderboard(ctx, time.Unix(0, 0))
	if err != nil || len(ranks) != 1 || ranks[0].Points != 1 {
		t.Fatalf("duplicate scoring: %+v %v", ranks, err)
	}
	history, _, err := s.CommunityHistory(ctx, "", task.ID, 0)
	if err != nil || len(history) != 1 {
		t.Fatalf("history: %+v %v", history, err)
	}
	award := history[0].ID
	// Award in a previous week, revoke now: the old period must also be corrected.
	if _, err = s.pool.Exec(ctx, `UPDATE community_points SET created_at=now()-interval '10 days' WHERE id=$1`, award); err != nil {
		t.Fatal(err)
	}
	if err = s.CommunityReverse(ctx, task.ID, award, "Review withdrawn"); err != nil {
		t.Fatal(err)
	}
	if err = s.CommunityReverse(ctx, task.ID, award, "Repeated request"); err != nil {
		t.Fatal(err)
	}
	for _, since := range []time.Time{time.Unix(0, 0), time.Now().AddDate(0, 0, -15), time.Now().AddDate(0, 0, -7)} {
		ranks, err = s.CommunityLeaderboard(ctx, since)
		if err != nil || len(ranks) != 0 {
			t.Fatalf("reversal totals: %+v %v", ranks, err)
		}
	}
	history, _, err = s.CommunityHistory(ctx, "", task.ID, 0)
	if err != nil || len(history) != 2 {
		t.Fatalf("append-only reversal: %+v %v", history, err)
	}
	if err = s.CommunityAccept(ctx, task.ID, runID, "https://example.com/report", "Stale replay"); !errors.Is(err, ErrConflict) {
		t.Fatalf("replayed acceptance resurrected revoked award: %v", err)
	}
}
func TestCommunityPrivateTasksSourceAndSessionBoundaries(t *testing.T) {
	s, task, alice, _ := communityFixture(t)
	ctx := context.Background()
	private, err := s.CreateTask(ctx, testSpec("p"), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CommunityTask(ctx, private.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("private task: %v", err)
	}
	if _, err = s.CommunityClaim(ctx, private.ID, alice.ID, 101); !errors.Is(err, ErrNotFound) {
		t.Fatalf("private claim: %v", err)
	}
	client, _, err := s.CreateClient(ctx, "desktop", []string{"p"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ClaimTask(ctx, &client, task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CommunityClaim(ctx, task.ID, alice.ID, 101); !errors.Is(err, ErrConflict) {
		t.Fatalf("Desktop ownership overwritten: %v", err)
	}
	if err = s.CommunityBindWorker(ctx, alice.ID, "bob"); !errors.Is(err, ErrConflict) {
		t.Fatalf("ownership transferred: %v", err)
	}
	if err = s.CommunityCreateSession(ctx, "session-secret", "csrf", 101, false); err != nil {
		t.Fatal(err)
	}
	session, err := s.CommunitySession(ctx, "session-secret")
	if err != nil || session.ID != 101 {
		t.Fatalf("session: %+v %v", session, err)
	}
	if _, err = s.CommunitySession(ctx, "wrong"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("wrong token: %v", err)
	}
	if _, err = s.pool.Exec(ctx, `UPDATE community_sessions SET expires_at=now()-interval '1 second'`); err != nil {
		t.Fatal(err)
	}
	if _, err = s.CommunitySession(ctx, "session-secret"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired token: %v", err)
	}
}

func TestCommunityPublicSourceFactsFollowLatestProviderObservation(t *testing.T) {
	s, _, worker, _ := communityFixture(t)
	ctx := context.Background()
	config, issue := sourceFixture()
	if _, err := s.SyncGitHubIssue(ctx, config, issue); err != nil {
		t.Fatal(err)
	}
	task := sourceTask(t, s, issue)
	if err := s.CommunityPublish(ctx, task.ID, "Reviewed public title", "Reviewed public scope", issue.URL); err != nil {
		t.Fatal(err)
	}
	runID, err := s.CommunityClaim(ctx, task.ID, worker.ID, 101)
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.Claim(ctx, worker.ID, "instance", "source-run")
	if err != nil || run == nil || run.ID != runID {
		t.Fatalf("claim: %+v %v", run, err)
	}
	if _, err = s.Complete(ctx, run.ID, worker.ID, "instance", run.Generation, Completion{Outcome: "failed", Summary: "Inspect before retry"}); err != nil {
		t.Fatal(err)
	}
	oldRevision := run.Spec.Source.Revision
	check := func(state string, closed bool) {
		t.Helper()
		detail, err := s.CommunityTask(ctx, task.ID)
		if err != nil || detail.State != state || detail.SourceClosed != closed || !detail.SourceChanged {
			t.Fatalf("public detail: %+v %v", detail, err)
		}
		list, _, err := s.CommunityTasks(ctx, 0)
		if err != nil {
			t.Fatal(err)
		}
		found := false
		for _, item := range list {
			if item.ID == task.ID {
				found = true
				if item.State != detail.State || item.SourceClosed != detail.SourceClosed || item.SourceChanged != detail.SourceChanged {
					t.Fatal("public list/detail source facts disagree")
				}
			}
		}
		if !found {
			t.Fatal("published source missing")
		}
		if _, err = s.CommunityClaim(ctx, task.ID, worker.ID, 101); !errors.Is(err, ErrConflict) {
			t.Fatalf("changed source accepted another claim: %v", err)
		}
		original, err := s.Task(ctx, task.ID)
		if err != nil || original.CurrentRunID != runID || original.Source.Revision != oldRevision || original.Run.Spec.Source.Revision != oldRevision || original.Run.Spec.Source.State != "open" {
			t.Fatalf("source display changed original execution: %+v %v", original, err)
		}
	}
	issue.Body = "Updated provider goal"
	issue.UpdatedAt = "2026-10-28T00:01:00Z"
	if _, err = s.SyncGitHubIssue(ctx, config, issue); err != nil {
		t.Fatal(err)
	}
	check("source_changed", false)
	issue.State = "closed"
	issue.UpdatedAt = "2026-10-28T00:02:00Z"
	if _, err = s.SyncGitHubIssue(ctx, config, issue); err != nil {
		t.Fatal(err)
	}
	check("closed", true)
}

func TestCommunityListsImportsOnlyFromPublicRepositories(t *testing.T) {
	for _, tc := range []struct {
		name    string
		bound   bool
		private bool
		listed  int
	}{
		{"public repository", true, false, 4},
		{"private repository", true, true, 0},
		{"visibility not observed", false, false, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := integrationStore(t)
			ctx := context.Background()
			config, issue := sourceFixture()
			if tc.bound {
				if err := s.BindGitHubRepository(ctx, config, issue.RepositoryID, tc.private); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := s.SyncGitHubIssue(ctx, config, issue); err != nil {
				t.Fatal(err)
			}
			_, snapshot := roadmapFixture()
			if _, err := s.SyncRoadmap(ctx, config, snapshot); err != nil {
				t.Fatal(err)
			}
			list, _, err := s.CommunityTasks(ctx, 0)
			if err != nil || len(list) != tc.listed {
				t.Fatalf("listed %d, want %d: %v", len(list), tc.listed, err)
			}
			if tc.listed == 0 {
				return
			}
			task := sourceTask(t, s, issue)
			listed, err := s.CommunityTask(ctx, task.ID)
			if err != nil || listed.Title != issue.Title || listed.SourceURL != issue.URL {
				t.Fatalf("source listing: %+v %v", listed, err)
			}
			if err = s.CommunityPublish(ctx, task.ID, "Reviewed title", "Reviewed scope", issue.URL); err != nil {
				t.Fatal(err)
			}
			issue.Title, issue.UpdatedAt = "Edited upstream", "2026-10-28T00:01:00Z"
			if _, err = s.SyncGitHubIssue(ctx, config, issue); err != nil {
				t.Fatal(err)
			}
			if listed, err = s.CommunityTask(ctx, task.ID); err != nil || listed.Title != "Reviewed title" {
				t.Fatalf("reviewed text replaced by sync: %+v %v", listed, err)
			}
		})
	}
}
