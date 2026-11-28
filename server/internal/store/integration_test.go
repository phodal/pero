package store

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func integrationStore(t *testing.T) (*Store, string) {
	t.Helper()
	dsn := os.Getenv("PERO_TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("PERO_REQUIRE_TEST_DATABASE") == "1" {
			t.Fatal("PERO_TEST_DATABASE_URL is required for PostgreSQL acceptance")
		}
		t.Skip("set PERO_TEST_DATABASE_URL to exercise real PostgreSQL")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	schema := newID("test")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	s, err := Open(ctx, u.String(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		s.Close()
		_, _ = admin.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
		admin.Close()
	})
	return s, u.String()
}
func testSpec(project string) Spec {
	return Spec{Title: "Implement result", Prompt: "Create a result", Acceptance: "Result is inspectable", ProjectID: project, WorkspaceKey: "repo", AgentID: "fixture"}
}
func taskRun(t *testing.T, s *Store, project, worker string) (*Task, *Run) {
	t.Helper()
	ctx := context.Background()
	task, err := s.CreateTask(ctx, testSpec(project), "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.Dispatch(ctx, task.ID, worker, "")
	if err != nil {
		t.Fatal(err)
	}
	return task, run
}
func mustWorker(t *testing.T, s *Store, project string) (Worker, string) {
	t.Helper()
	w, token, err := s.CreateWorker(context.Background(), "test worker", []string{project}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return w, token
}

func TestPostgresConcurrentClaimsDurabilityAndReceipts(t *testing.T) {
	s, dsn := integrationStore(t)
	ctx := context.Background()
	w1, token := mustWorker(t, s, "p")
	w2, _ := mustWorker(t, s, "p")
	if id, err := s.AuthenticateWorker(ctx, token); err != nil || id != w1.ID {
		t.Fatalf("authenticate: %s %v", id, err)
	}
	if _, err := s.AuthenticateWorker(ctx, token+"wrong"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("incorrect token accepted: %v", err)
	}
	task, run := taskRun(t, s, "p", "")
	var wg sync.WaitGroup
	var mu sync.Mutex
	claims := []*Run{}
	var winningRequest string
	for i := 0; i < 16; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			w := w1
			if i%2 == 1 {
				w = w2
			}
			request := newID("claim")
			r, err := s.Claim(ctx, w.ID, "instance", request)
			if err != nil {
				t.Errorf("claim: %v", err)
				return
			}
			if r != nil {
				mu.Lock()
				claims = append(claims, r)
				winningRequest = request
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	if len(claims) != 1 {
		t.Fatalf("expected one claim, got %d", len(claims))
	}
	claimed := claims[0]
	if claimed.ID != run.ID || claimed.Spec.Prompt != task.Prompt {
		t.Fatalf("bad claim: %+v", claimed)
	}
	replayed, err := s.Claim(ctx, claimed.WorkerID, "instance", winningRequest)
	if err != nil || replayed.ID != claimed.ID {
		t.Fatalf("lost response receipt: %+v %v", replayed, err)
	}
	// A new process/pool reads the same Task/Run after a control-plane restart.
	restarted, err := Open(ctx, dsn, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	persisted, err := restarted.Task(ctx, task.ID)
	if err != nil || persisted.Run.ID != run.ID || persisted.State != "running" {
		t.Fatalf("durability: %+v %v", persisted, err)
	}
	_, err = s.pool.Exec(ctx, `UPDATE tasks SET spec=jsonb_set(spec,'{prompt}','"later task revision"') WHERE id=$1`, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	current, err := s.WorkerRun(ctx, run.ID, claimed.WorkerID, "instance")
	if err != nil || current.Spec.Prompt != "Create a result" {
		t.Fatalf("run snapshot changed: %+v %v", current, err)
	}
	events := []Event{{Seq: 1, Kind: "message", Text: "started", Data: json.RawMessage(`{"a":1,"b":2}`)}, {Seq: 2, Kind: "message", Text: "done"}}
	last, err := s.AppendEvents(ctx, run.ID, claimed.WorkerID, "instance", run.Generation, events)
	if err != nil || last != 2 {
		t.Fatalf("events: %d %v", last, err)
	}
	events[0].Data = json.RawMessage(`{"b":2,"a":1}`)
	if last, err = s.AppendEvents(ctx, run.ID, claimed.WorkerID, "instance", run.Generation, events); err != nil || last != 2 {
		t.Fatalf("event replay: %d %v", last, err)
	}
	changed := []Event{{Seq: 1, Kind: "message", Text: "different"}}
	if _, err = s.AppendEvents(ctx, run.ID, claimed.WorkerID, "instance", run.Generation, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("event conflict accepted: %v", err)
	}
	if _, err = s.AppendEvents(ctx, run.ID, claimed.WorkerID, "instance", run.Generation, []Event{{Seq: 4, Kind: "message"}}); !errors.Is(err, ErrConflict) {
		t.Fatalf("event gap accepted: %v", err)
	}
	result := Completion{Outcome: "succeeded", Summary: "Agent execution finished; no independent verification"}
	if _, err = s.Complete(ctx, run.ID, claimed.WorkerID, "instance", run.Generation, result); err != nil {
		t.Fatal(err)
	}
	_, err = s.pool.Exec(ctx, `UPDATE runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = restarted.Complete(ctx, run.ID, claimed.WorkerID, "instance", run.Generation, result); err != nil {
		t.Fatalf("completion receipt after lease: %v", err)
	}
	if last, err = s.AppendEvents(ctx, run.ID, claimed.WorkerID, "instance", run.Generation, events); err != nil || last != 2 {
		t.Fatalf("event receipt after lease: %d %v", last, err)
	}
	result.Summary = "different"
	if _, err = s.Complete(ctx, run.ID, claimed.WorkerID, "instance", run.Generation, result); !errors.Is(err, ErrConflict) {
		t.Fatalf("completion conflict accepted: %v", err)
	}
	stored, err := s.Events(ctx, run.ID)
	if err != nil || len(stored.Events) != 2 {
		t.Fatalf("durable events: %+v %v", stored, err)
	}
}

func TestPostgresLeaseLossAuthorizationAndCancel(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	w, _ := mustWorker(t, s, "allowed")
	other, _ := mustWorker(t, s, "other")
	task, run := taskRun(t, s, "allowed", w.ID)
	if r, err := s.Claim(ctx, other.ID, "wrong-instance", "wrong-request"); err != nil || r != nil {
		t.Fatalf("cross-project claim: %+v %v", r, err)
	}
	claimed, err := s.Claim(ctx, w.ID, "instance", "claim")
	if err != nil || claimed == nil {
		t.Fatalf("claim: %+v %v", claimed, err)
	}
	if _, _, err = s.Renew(ctx, run.ID, w.ID, "wrong-instance", run.Generation); !errors.Is(err, ErrForbidden) {
		t.Fatalf("instance isolation: %v", err)
	}
	if _, _, err = s.Renew(ctx, run.ID, other.ID, "instance", run.Generation); !errors.Is(err, ErrForbidden) {
		t.Fatalf("worker isolation: %v", err)
	}
	if _, _, err = s.Renew(ctx, run.ID, w.ID, "instance", run.Generation+1); !errors.Is(err, ErrLease) {
		t.Fatalf("generation isolation: %v", err)
	}
	_, err = s.pool.Exec(ctx, `UPDATE runs SET lease_expires_at=now()-interval '1 second' WHERE id=$1`, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.Renew(ctx, run.ID, w.ID, "instance", run.Generation); !errors.Is(err, ErrLease) {
		t.Fatalf("expired renewal resurrected: %v", err)
	}
	if _, err = s.AppendEvents(ctx, run.ID, w.ID, "instance", run.Generation, []Event{{Seq: 1, Kind: "late"}}); !errors.Is(err, ErrLease) {
		t.Fatalf("expired event accepted: %v", err)
	}
	if _, err = s.Complete(ctx, run.ID, w.ID, "instance", run.Generation, Completion{Outcome: "succeeded"}); !errors.Is(err, ErrLease) {
		t.Fatalf("expired result accepted: %v", err)
	}
	if err = s.Reap(ctx); err != nil {
		t.Fatal(err)
	}
	if r, err := s.Claim(ctx, w.ID, "instance", "next-claim"); err != nil || r != nil {
		t.Fatalf("lost run replayed: %+v %v", r, err)
	}
	if _, err = s.Dispatch(ctx, task.ID, w.ID, ""); !errors.Is(err, ErrConflict) {
		t.Fatalf("unresolved task redispatched: %v", err)
	}
	status, err := s.Task(ctx, task.ID)
	if err != nil || status.State != "reconcile" {
		t.Fatalf("expired state: %+v %v", status, err)
	}
	if observed, err := s.ClientRun(ctx, &Client{Projects: []string{"allowed"}}, run.Ref()); err != nil || observed.Ref() != run.Ref() || observed.Status != "reconcile" {
		t.Fatalf("exact historical reference lost the lease outcome: %+v %v", observed, err)
	}
	_, _ = taskRun(t, s, "allowed", w.ID)
	if r, err := s.Claim(ctx, w.ID, "new-instance", "quarantine"); err != nil || r != nil {
		t.Fatalf("unresolved worker accepted another task: %+v %v", r, err)
	}
	if _, err = s.ResolveRun(ctx, run.Ref(), RunReconciliationDecision{Disposition: RunConfirmedStopped, Evidence: "original worker verified its process group stopped"}); err != nil {
		t.Fatal(err)
	}
	if r, err := s.Claim(ctx, w.ID, "new-instance", "after-confirmed-stop"); err != nil || r == nil || r.ID == run.ID {
		t.Fatalf("resolved Worker did not acquire a distinct Run: %+v %v", r, err)
	}
	if _, err = s.Complete(ctx, run.ID, w.ID, "instance", run.Generation, Completion{Outcome: "succeeded"}); !errors.Is(err, ErrLease) {
		t.Fatalf("operator evidence restored the expired lease: %v", err)
	}
	// A separate clean Worker remains usable while the lost Worker is quarantined.
	w, _ = mustWorker(t, s, "allowed")
	queued, queuedRun := taskRun(t, s, "allowed", w.ID)
	if cancelled, err := s.Cancel(ctx, queued.ID); err != nil || cancelled.Status != "cancelled" {
		t.Fatalf("queued cancel: %+v %v", cancelled, err)
	}
	retry, err := s.Dispatch(ctx, queued.ID, w.ID, "")
	if err != nil || retry.Generation != queuedRun.Generation+1 {
		t.Fatalf("explicit retry: %+v %v", retry, err)
	}
	running, err := s.Claim(ctx, w.ID, "instance", "retry-claim")
	if err != nil || running == nil {
		t.Fatalf("retry claim: %+v %v", running, err)
	}
	if cancel, err := s.Cancel(ctx, queued.ID); err != nil || cancel.Status != "cancel_requested" {
		t.Fatalf("running cancel: %+v %v", cancel, err)
	}
	if cancel, _, err := s.Renew(ctx, running.ID, w.ID, "instance", running.Generation); err != nil || !cancel {
		t.Fatalf("cancel on renewal: %v %v", cancel, err)
	}
	if _, err = s.Complete(ctx, running.ID, w.ID, "instance", running.Generation, Completion{Outcome: "succeeded"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("late success overrode cancel: %v", err)
	}
	if done, err := s.Complete(ctx, running.ID, w.ID, "instance", running.Generation, Completion{Outcome: "cancelled", Summary: "process stopped"}); err != nil || done.Status != "cancelled" {
		t.Fatalf("cancel acknowledgement: %+v %v", done, err)
	}
}

func TestPostgresTaskPaginationAndBoundedEventTail(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	w, _ := mustWorker(t, s, "p")
	for i := 0; i < 5; i++ {
		if _, err := s.CreateTask(ctx, testSpec("p"), ""); err != nil {
			t.Fatal(err)
		}
	}
	seen := map[string]bool{}
	cursor := ""
	for pages := 0; pages < 3; pages++ {
		page, err := s.Tasks(ctx, cursor, 2)
		if err != nil {
			t.Fatal(err)
		}
		for _, task := range page.Tasks {
			if seen[task.ID] {
				t.Fatal("task appeared on two pages")
			}
			seen[task.ID] = true
			if task.Run != nil {
				t.Fatal("list duplicated Run snapshot")
			}
		}
		if !page.HasMore {
			break
		}
		if page.NextCursor == nil {
			t.Fatal("missing pagination cursor")
		}
		cursor = *page.NextCursor
	}
	if len(seen) != 5 {
		t.Fatalf("pagination lost tasks: %d", len(seen))
	}
	_, run := taskRun(t, s, "p", w.ID)
	if _, err := s.Claim(ctx, w.ID, "instance", "claim"); err != nil {
		t.Fatal(err)
	}
	for offset := 0; offset < 240; offset += 40 {
		batch := []Event{}
		for i := 0; i < 40; i++ {
			batch = append(batch, Event{Seq: int64(offset + i + 1), Kind: "message", Text: "event"})
		}
		if _, err := s.AppendEvents(ctx, run.ID, w.ID, "instance", run.Generation, batch); err != nil {
			t.Fatal(err)
		}
	}
	tail, err := s.Events(ctx, run.ID)
	if err != nil || !tail.Truncated || len(tail.Events) != 200 || *tail.FirstSeq != 41 || *tail.LastSeq != 240 {
		t.Fatalf("count tail: %+v %v", tail, err)
	}
	large := []Event{}
	for i := 0; i < 10; i++ {
		large = append(large, Event{Seq: int64(241 + i), Kind: "message", Text: strings.Repeat("\n", 32000)})
	}
	if _, err := s.AppendEvents(ctx, run.ID, w.ID, "instance", run.Generation, large); err != nil {
		t.Fatal(err)
	}
	tail, err = s.Events(ctx, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := encodedJSON(tail.Events)
	if err != nil || len(encoded) > 256*1024 || !tail.Truncated || *tail.LastSeq != 250 {
		t.Fatalf("byte tail size=%d truncated=%v err=%v", len(encoded), tail.Truncated, err)
	}
	// The tail only bounds the response; older evidence remains durably stored.
	var count int
	if err = s.pool.QueryRow(ctx, `SELECT COUNT(*) FROM run_events WHERE run_id=$1`, run.ID).Scan(&count); err != nil || count != 250 {
		t.Fatalf("tail deleted evidence: %d %v", count, err)
	}
}

func TestPostgresOperatorIdempotencyAndProjectScope(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	w, _ := mustWorker(t, s, "allowed")
	task, err := s.CreateTask(ctx, testSpec("other"), "create")
	if err != nil {
		t.Fatal(err)
	}
	same, err := s.CreateTask(ctx, testSpec("other"), "create")
	if err != nil || same.ID != task.ID {
		t.Fatalf("create replay: %+v %v", same, err)
	}
	if _, err = s.CreateTask(ctx, testSpec("allowed"), "create"); !errors.Is(err, ErrConflict) {
		t.Fatalf("idempotency collision: %v", err)
	}
	if _, err = s.Dispatch(ctx, task.ID, w.ID, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("target project mismatch: %v", err)
	}
	allowed, _ := s.CreateTask(ctx, testSpec("allowed"), "")
	first, err := s.Dispatch(ctx, allowed.ID, w.ID, "dispatch")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.Dispatch(ctx, allowed.ID, w.ID, "dispatch")
	if err != nil || first.ID != second.ID {
		t.Fatalf("dispatch receipt: %+v %v", second, err)
	}
	if _, err = s.Dispatch(ctx, allowed.ID, "", "dispatch"); !errors.Is(err, ErrConflict) {
		t.Fatalf("dispatch key collision: %v", err)
	}
	third, err := s.Dispatch(ctx, allowed.ID, w.ID, "")
	if err != nil || first.ID != third.ID {
		t.Fatalf("active dispatch duplicate: %+v %v", third, err)
	}
}

func TestPostgresTrialSurvivesRestartAndCredentialReplacement(t *testing.T) {
	s, dsn := integrationStore(t)
	ctx := context.Background()
	client, _, err := s.CreateClient(ctx, "campaign", []string{"allowed"})
	if err != nil {
		t.Fatal(err)
	}
	op, err := client.TrialOperation("allowed", "trial-A")
	if err != nil {
		t.Fatal(err)
	}
	wrongWorker, _ := mustWorker(t, s, "foreign")
	input := TrialInput{Task: testSpec("allowed"), WorkerID: wrongWorker.ID}
	if _, err := s.EnsureTrialRun(ctx, op, input); !errors.Is(err, ErrForbidden) {
		t.Fatalf("ineligible dispatch: %v", err)
	}
	if _, err := s.TrialReceipt(ctx, op); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed dispatch committed a receipt: %v", err)
	}
	if page, err := s.ClientTasks(ctx, &client, "", 50); err != nil || len(page.Tasks) != 0 {
		t.Fatalf("failed dispatch left a draft: %+v %v", page, err)
	}
	worker, _ := mustWorker(t, s, "allowed")
	input.WorkerID = worker.ID
	original, err := s.EnsureTrialRun(ctx, op, input)
	if err != nil || original.Run == nil {
		t.Fatalf("initial trial: %+v %v", original, err)
	}
	const credentialID = "replacement-desktop"
	const token = credentialID + ".test-replacement"
	digest := sha256.Sum256([]byte(token))
	if _, err := s.pool.Exec(ctx, `INSERT INTO desktop_credentials (id,client_id,token_hash) VALUES ($1,$2,$3)`, credentialID, client.ID, digest[:]); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(ctx, dsn, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reopened.Close)
	signedIn, err := reopened.AuthenticateClient(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	retry, err := signedIn.TrialOperation("allowed", "trial-A")
	if err != nil {
		t.Fatal(err)
	}
	if receipt, err := reopened.EnsureTrialRun(ctx, retry, input); err != nil || receipt.Run == nil || *receipt.Run != *original.Run {
		t.Fatalf("resume changed dispatch identity: %+v %v", receipt, err)
	}
}

func TestPostgresTrialSubmitAndCancelConverge(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	client, _, err := s.CreateClient(ctx, "campaign", []string{"allowed"})
	if err != nil {
		t.Fatal(err)
	}
	op, err := client.TrialOperation("allowed", "contested-trial")
	if err != nil {
		t.Fatal(err)
	}
	input := TrialInput{Task: testSpec("allowed")}
	start := make(chan struct{})
	results := make(chan error, 2)
	go func() {
		<-start
		_, err := s.EnsureTrialRun(ctx, op, input)
		results <- err
	}()
	go func() {
		<-start
		_, err := s.CancelTrial(ctx, op)
		results <- err
	}()
	close(start)
	for range 2 {
		if err := <-results; err != nil {
			t.Fatal(err)
		}
	}
	receipt, err := s.TrialReceipt(ctx, op)
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Run == nil {
		if receipt.Status != TrialCancelledBeforeDispatch {
			t.Fatalf("missing cancellation receipt: %+v", receipt)
		}
		if page, err := s.ClientTasks(ctx, &client, "", 50); err != nil || len(page.Tasks) != 0 {
			t.Fatalf("cancellation left a draft or Run: %+v %v", page, err)
		}
		return
	}
	if run, err := s.ClientRun(ctx, &client, *receipt.Run); err != nil || run.Status != "cancelled" {
		t.Fatalf("concurrent cancellation missed the committed Run: %+v %v", run, err)
	}
}

func TestPostgresLeaseExpiresWhileWaitingForRowLock(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	w, _ := mustWorker(t, s, "p")
	_, run := taskRun(t, s, "p", w.ID)
	if _, err := s.Claim(ctx, w.ID, "instance", "claim"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE runs SET lease_expires_at=clock_timestamp()+interval '250 milliseconds' WHERE id=$1`, run.ID); err != nil {
		t.Fatal(err)
	}
	lock, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err = lock.Exec(ctx, `SELECT id FROM runs WHERE id=$1 FOR UPDATE`, run.ID); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		_, _, err := s.Renew(ctx, run.ID, w.ID, "instance", run.Generation)
		done <- err
	}()
	<-started
	// The lease expires while the renewal waits on this transaction's row lock.
	time.Sleep(350 * time.Millisecond)
	if err = lock.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err = <-done; !errors.Is(err, ErrLease) {
		t.Fatalf("row-lock delay resurrected expired lease: %v", err)
	}
}
