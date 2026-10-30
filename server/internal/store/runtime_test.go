package store

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/runtimebinding"
)

func runtimeConfig(worker string) runtimebinding.Config {
	return runtimebinding.Config{ClusterID: "test-cluster", Namespace: "pero-test", WarmPool: "trusted-worker", WorkerID: worker, ProjectID: "p", WorkspaceKey: "repo", AgentID: "fixture", ImageDigest: "sha256:" + strings.Repeat("a", 64), TemplateDigest: "sha256:" + strings.Repeat("b", 64), WorkspaceRevision: strings.Repeat("c", 40), TTLSeconds: 3600}
}

func runtimeTask(t *testing.T, s *Store, config runtimebinding.Config, key string) (*Run, runtimebinding.Binding) {
	t.Helper()
	task, err := s.CreateTask(context.Background(), testSpec(config.ProjectID), "")
	if err != nil {
		t.Fatal(err)
	}
	run, binding, created, err := s.DispatchRuntime(context.Background(), task.ID, key, config)
	if err != nil || !created {
		t.Fatalf("dispatch runtime: created=%v err=%v", created, err)
	}
	return run, *binding
}

func readyRuntime(t *testing.T, s *Store, binding runtimebinding.Binding, podUID string) runtimebinding.Binding {
	t.Helper()
	now := time.Now().UTC()
	expiry := now.Add(time.Duration(binding.Config.TTLSeconds) * time.Second)
	resource := model.ResourceRef{Owner: model.Owner{Kind: "kubernetes", ID: binding.Config.ClusterID}, Kind: "kubernetes.sandboxclaim", Scope: binding.Config.Namespace, ID: "claim-a", Incarnation: "claim-uid"}
	var err error
	binding, err = binding.WithResource(resource)
	if err != nil {
		t.Fatal(err)
	}
	binding = binding.Observe(model.Observation{Resource: resource, Runtime: &model.Ref{Kind: "kubernetes-runtime", ID: podUID, Digest: "sha256:" + strings.Repeat("d", 64)}, Receipt: model.Ref{Kind: "kubernetes-observation", ID: resource.Incarnation, Revision: "1"}, ObservedAt: now, Ready: model.Condition{Status: "True", Reason: "OwnerReady"}, Artifacts: []model.Ref{{Kind: "container-image", ID: "repo@" + binding.Config.ImageDigest, Revision: "worker", Digest: binding.Config.ImageDigest}}, LeaseExpiresAt: &expiry}, now)
	if binding.Phase != runtimebinding.Ready {
		t.Fatalf("observation rejected: %#v", binding)
	}
	binding, err = s.SaveRuntimeBinding(context.Background(), binding.Version, binding)
	if err != nil {
		t.Fatal(err)
	}
	return binding
}

func TestRuntimeDispatchReservationAndQueueFence(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	worker, _ := mustWorker(t, s, "p")
	ordinary, _ := mustWorker(t, s, "p")
	config := runtimeConfig(worker.ID)
	if err := s.ConfigureRuntimeWorker(ctx, config); err != nil {
		t.Fatal(err)
	}
	_, ordinaryRun := taskRun(t, s, "p", "")
	if _, err := s.Claim(ctx, worker.ID, "no-uid", "request"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("runtime credential without UID: %v", err)
	}
	if run, err := s.Claim(ctx, worker.ID, "pod", "ordinary", "pod-a"); err != nil || run != nil {
		t.Fatalf("runtime credential drained ordinary queue: %#v %v", run, err)
	}
	if _, err := s.Claim(ctx, ordinary.ID, "normal", "bad-runtime", "pod-a"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("ordinary credential supplied runtime UID: %v", err)
	}
	if run, err := s.Claim(ctx, ordinary.ID, "normal", "ordinary"); err != nil || run == nil || run.ID != ordinaryRun.ID {
		t.Fatalf("ordinary queue regressed: %#v %v", run, err)
	}
	task, err := s.CreateTask(ctx, testSpec("p"), "")
	if err != nil {
		t.Fatal(err)
	}
	// Concurrent retried dispatches reserve one Run and one external create only.
	type outcome struct {
		run     *Run
		binding *runtimebinding.Binding
		created bool
		err     error
	}
	outcomes := make(chan outcome, 8)
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			r, b, c, e := s.DispatchRuntime(ctx, task.ID, "runtime-dispatch", config)
			outcomes <- outcome{r, b, c, e}
		}()
	}
	wg.Wait()
	close(outcomes)
	createdCount := 0
	var run *Run
	var binding runtimebinding.Binding
	for result := range outcomes {
		if result.err != nil {
			t.Fatal(result.err)
		}
		if run != nil && run.ID != result.run.ID {
			t.Fatal("duplicate Run")
		}
		run = result.run
		binding = *result.binding
		if result.created {
			createdCount++
		}
	}
	if createdCount != 1 {
		t.Fatalf("create reservations = %d", createdCount)
	}
	if claimed, err := s.Claim(ctx, worker.ID, "pod", "pending", "pod-a"); err != nil || claimed != nil {
		t.Fatalf("unready binding claimed: %#v %v", claimed, err)
	}
	ready := readyRuntime(t, s, binding, "pod-a")
	if claimed, err := s.Claim(ctx, worker.ID, "pod", "wrong-uid", "pod-b"); err != nil || claimed != nil {
		t.Fatalf("wrong pod claimed: %#v %v", claimed, err)
	}
	claimed, err := s.Claim(ctx, worker.ID, "pod", "ready", "pod-a")
	if err != nil || claimed == nil || claimed.ID != run.ID {
		t.Fatalf("ready claim: %#v %v", claimed, err)
	}
	if claimed.LeaseExpiresAt.After(*ready.ValidUntil) {
		t.Fatal("claim lease outlived observation")
	}
	if _, err = s.Claim(ctx, worker.ID, "pod", "ready", "pod-b"); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed UID receipt accepted: %v", err)
	}
	if _, err = s.Claim(ctx, worker.ID, "pod", "ready"); !errors.Is(err, ErrConflict) {
		t.Fatalf("missing UID receipt accepted: %v", err)
	}
	repeated, err := s.Claim(ctx, worker.ID, "pod", "ready", "pod-a")
	if err != nil || repeated == nil || repeated.ID != run.ID {
		t.Fatalf("original claim receipt: %#v %v", repeated, err)
	}
	second, err := s.CreateTask(ctx, testSpec("p"), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = s.DispatchRuntime(ctx, second.ID, "second-runtime", config); !errors.Is(err, ErrConflict) {
		t.Fatalf("allocated second active environment: %v", err)
	}
	current, err := s.Task(ctx, second.ID)
	if err != nil || current.CurrentRunID != "" {
		t.Fatalf("failed reservation leaked Run: %#v %v", current, err)
	}
	// The credential remains runtime-only after a provider restart/config check.
	if err = s.ConfigureRuntimeWorker(ctx, config); err != nil {
		t.Fatal(err)
	}
	changed := config
	changed.TemplateDigest = "sha256:" + strings.Repeat("f", 64)
	if err = s.ConfigureRuntimeWorker(ctx, changed); !errors.Is(err, ErrConflict) {
		t.Fatalf("changed active configuration accepted: %v", err)
	}
}

func TestRuntimeReadinessLossNeverReplaysExecution(t *testing.T) {
	for _, mode := range []string{"observation_failure", "expired_observation"} {
		t.Run(mode, func(t *testing.T) {
			s, _ := integrationStore(t)
			ctx := context.Background()
			worker, _ := mustWorker(t, s, "p")
			config := runtimeConfig(worker.ID)
			if err := s.ConfigureRuntimeWorker(ctx, config); err != nil {
				t.Fatal(err)
			}
			run, binding := runtimeTask(t, s, config, "dispatch")
			binding = readyRuntime(t, s, binding, "pod-a")
			claimed, err := s.Claim(ctx, worker.ID, "original", "claim", "pod-a")
			if err != nil || claimed == nil {
				t.Fatalf("claim: %v", err)
			}
			if _, expiry, err := s.Renew(ctx, run.ID, worker.ID, "original", run.Generation); err != nil || expiry.After(*binding.ValidUntil) {
				t.Fatalf("renew escaped observation: %s %v", expiry, err)
			}
			if mode == "observation_failure" {
				binding = binding.Failed("RuntimeChanged")
				if _, err = s.SaveRuntimeBinding(ctx, binding.Version, binding); err != nil {
					t.Fatal(err)
				}
			} else {
				// Expire both persisted observation fields; no clock sleeps.
				past := time.Now().Add(-time.Minute)
				binding.ValidUntil = &past
				if _, err = s.SaveRuntimeBinding(ctx, binding.Version, binding); err != nil {
					t.Fatal(err)
				}
			}
			if _, _, err = s.Renew(ctx, run.ID, worker.ID, "original", run.Generation); !errors.Is(err, ErrLease) {
				t.Fatalf("stale runtime renewed: %v", err)
			}
			if _, err = s.AppendEvents(ctx, run.ID, worker.ID, "original", run.Generation, []Event{{Seq: 1, Kind: "text", Text: "late"}}); !errors.Is(err, ErrLease) {
				t.Fatalf("stale runtime wrote events: %v", err)
			}
			if newRun, err := s.Claim(ctx, worker.ID, "restarted", "fresh", "pod-a"); err != nil || newRun != nil {
				t.Fatalf("restart replayed Run: %#v %v", newRun, err)
			}
			recovered, err := s.Claim(ctx, worker.ID, "original", "claim", "pod-a")
			if err != nil || recovered == nil || recovered.ID != run.ID {
				t.Fatalf("lost claim could not reconcile original: %#v %v", recovered, err)
			}
		})
	}
}

func TestRuntimeReleaseRetainsCancellationAndCompletionReceipts(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	worker, _ := mustWorker(t, s, "p")
	config := runtimeConfig(worker.ID)
	if err := s.ConfigureRuntimeWorker(ctx, config); err != nil {
		t.Fatal(err)
	}
	run, binding := runtimeTask(t, s, config, "dispatch")
	binding = readyRuntime(t, s, binding, "pod-a")
	if claimed, err := s.Claim(ctx, worker.ID, "pod", "claim", "pod-a"); err != nil || claimed == nil {
		t.Fatalf("claim: %v", err)
	}
	event := Event{Seq: 1, Kind: "text", Text: "retained before cancellation"}
	if _, err := s.AppendEvents(ctx, run.ID, worker.ID, "pod", run.Generation, []Event{event}); err != nil {
		t.Fatal(err)
	}
	releasing, err := s.ReleaseRuntime(ctx, run.ID)
	if err != nil || !releasing.ReleaseRequested || releasing.Phase != runtimebinding.CleanupPending {
		t.Fatalf("release: %#v %v", releasing, err)
	}
	if cancelled, _, err := s.Renew(ctx, run.ID, worker.ID, "pod", run.Generation); err != nil || !cancelled {
		t.Fatalf("release broke cancellation renewal: %v %v", cancelled, err)
	}
	result := Completion{Outcome: "cancelled", Summary: "Agent and descendants stopped"}
	completed, err := s.Complete(ctx, run.ID, worker.ID, "pod", run.Generation, result)
	if err != nil || completed.Status != "cancelled" {
		t.Fatalf("cancellation receipt: %#v %v", completed, err)
	}
	receipt := model.Ref{Kind: "kubernetes-dispose", ID: run.ID, Digest: "sha256:" + strings.Repeat("e", 64)}
	released, err := s.SaveRuntimeBinding(ctx, releasing.Version, releasing.Cleanup(receipt))
	if err != nil || released.Phase != runtimebinding.Released {
		t.Fatalf("cleanup receipt: %#v %v", released, err)
	}
	completed, err = s.Complete(ctx, run.ID, worker.ID, "pod", run.Generation, result)
	if err != nil || completed.Status != "cancelled" || completed.Summary != result.Summary {
		t.Fatalf("cleanup overwrote completion: %#v %v", completed, err)
	}
	tail, err := s.Events(ctx, run.ID)
	if err != nil || len(tail.Events) != 1 || tail.Events[0].Text != event.Text {
		t.Fatalf("cleanup erased events: %#v %v", tail, err)
	}
	if last, err := s.AppendEvents(ctx, run.ID, worker.ID, "pod", run.Generation, []Event{event}); err != nil || last != 1 {
		t.Fatalf("cleanup broke event receipt recovery: last=%d err=%v", last, err)
	}
	if _, err = s.SaveRuntimeBinding(ctx, binding.Version, binding); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale observation revived released binding: %v", err)
	}
	active, err := s.RuntimeBindings(ctx)
	if err != nil || len(active) != 0 {
		t.Fatalf("released binding still active: %#v %v", active, err)
	}
	// A new explicit task may get a new resource only after settled cleanup.
	next, _ := runtimeTask(t, s, config, "dispatch-next")
	if next.ID == run.ID {
		t.Fatal("new explicit task reused old Run")
	}
}

func TestRuntimeCancelledBeforeReadyDoesNotAcquire(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	worker, _ := mustWorker(t, s, "p")
	config := runtimeConfig(worker.ID)
	if err := s.ConfigureRuntimeWorker(ctx, config); err != nil {
		t.Fatal(err)
	}
	run, _ := runtimeTask(t, s, config, "dispatch")
	if _, err := s.ReleaseRuntime(ctx, run.ID); err != nil {
		t.Fatal(err)
	}
	current, err := s.RuntimeRun(ctx, run.ID)
	if err != nil || current.Status != "cancelled" {
		t.Fatalf("queued cancellation: %#v %v", current, err)
	}
	if claimed, err := s.Claim(ctx, worker.ID, "pod", "request", "pod-a"); err != nil || claimed != nil {
		t.Fatalf("cancelled runtime acquired: %#v %v", claimed, err)
	}
}

func TestRuntimeWorkerFenceDoesNotDisruptAnExistingExecution(t *testing.T) {
	s, _ := integrationStore(t)
	ctx := context.Background()
	worker, _ := mustWorker(t, s, "p")
	_, run := taskRun(t, s, "p", worker.ID)
	if claimed, err := s.Claim(ctx, worker.ID, "normal", "request"); err != nil || claimed == nil {
		t.Fatalf("ordinary claim: %#v %v", claimed, err)
	}
	config := runtimeConfig(worker.ID)
	if err := s.ConfigureRuntimeWorker(ctx, config); !errors.Is(err, ErrConflict) {
		t.Fatalf("converted active ordinary execution: %v", err)
	}
	if _, _, err := s.Renew(ctx, run.ID, worker.ID, "normal", run.Generation); err != nil {
		t.Fatalf("failed configuration changed authority: %v", err)
	}
	if _, err := s.Complete(ctx, run.ID, worker.ID, "normal", run.Generation, Completion{Outcome: "succeeded", Summary: "Finished before runtime migration"}); err != nil {
		t.Fatal(err)
	}
	if err := s.ConfigureRuntimeWorker(ctx, config); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Claim(ctx, worker.ID, "normal", "new-request"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("missing UID bypassed persisted fence: %v", err)
	}
	wrongSpec := testSpec("p")
	wrongSpec.AgentID = "unconfigured-agent"
	task, err := s.CreateTask(ctx, wrongSpec, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err = s.DispatchRuntime(ctx, task.ID, "wrong-agent", config); !errors.Is(err, ErrForbidden) {
		t.Fatalf("Task chose an unconfigured agent: %v", err)
	}
	task, err = s.Task(ctx, task.ID)
	if err != nil || task.CurrentRunID != "" {
		t.Fatalf("rejected configuration leaked a Run: %#v %v", task, err)
	}
}
