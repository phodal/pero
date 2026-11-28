package httpapi_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/campaign"
	"github.com/phodal/pero/server/internal/campaignruntime"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/store"
	commonpb "go.temporal.io/api/common/v1"
	enumspb "go.temporal.io/api/enums/v1"
	historypb "go.temporal.io/api/history/v1"
	"go.temporal.io/api/serviceerror"
	workflowservice "go.temporal.io/api/workflowservice/v1"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/worker"
	"go.temporal.io/sdk/workflow"
	"google.golang.org/protobuf/encoding/protojson"
)

type campaignStarter struct {
	client.Client
	fault      atomic.Int32
	faultedRun atomic.Value
}

type blockedDispatch struct {
	committed chan struct{}
	release   chan struct{}
}

func (c *campaignStarter) ExecuteWorkflow(ctx context.Context, options client.StartWorkflowOptions, flow any, args ...any) (client.WorkflowRun, error) {
	fault := c.fault.Swap(0)
	if fault == 1 {
		return nil, errors.New("Temporal unavailable before accepting start")
	}
	run, err := c.Client.ExecuteWorkflow(ctx, options, flow, args...)
	if err == nil && fault == 2 {
		c.faultedRun.Store(run.GetFirstExecutionRunID())
		return nil, errors.New("lost Temporal start reply after commit")
	}
	return run, err
}

func TestResearchCampaignTemporal(t *testing.T) {
	if os.Getenv("PERO_TEST_TEMPORAL") != "1" {
		t.Skip("set PERO_TEST_TEMPORAL=1 for real Temporal and PostgreSQL acceptance")
	}
	if os.Getenv("PERO_TEST_DATABASE_URL") == "" {
		t.Fatal("PERO_TEST_DATABASE_URL is required for Temporal acceptance")
	}
	startup, stopStartup := context.WithTimeout(t.Context(), 2*time.Minute)
	defer stopStartup()
	temporalServer, err := testsuite.StartDevServer(startup, testsuite.DevServerOptions{
		ExistingPath:   os.Getenv("PERO_TEST_TEMPORAL_CLI"),
		CachedDownload: testsuite.CachedDownload{Version: "v1.10.1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer temporalServer.Stop()
	ctx, stop := context.WithTimeout(t.Context(), 90*time.Second)
	defer stop()
	worker.SetStickyWorkflowCacheSize(0)
	temporal := temporalServer.Client()
	starter := &campaignStarter{Client: temporal}
	var runnerToken string
	var dropDispatch atomic.Bool
	var blockDispatch atomic.Pointer[blockedDispatch]
	api := testAPI(t, func(db *store.Store) http.Handler {
		runner, token, err := db.CreateClient(ctx, "Campaign runner", []string{"lab"})
		if err != nil {
			t.Fatal(err)
		}
		runnerToken = token
		handler := httpapi.ServerHandler(db, "test-operator", httpapi.ServerOptions{Campaigns: &httpapi.ResearchCampaigns{
			Temporal:       campaignruntime.Temporal{Client: starter, PollInterval: 200 * time.Millisecond},
			RunnerClientID: runner.ID,
		}})
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !strings.HasSuffix(r.URL.Path, "/trials/0/ensure") {
				handler.ServeHTTP(w, r)
				return
			}
			drop, block := dropDispatch.CompareAndSwap(true, false), blockDispatch.Swap(nil)
			if !drop && block == nil {
				handler.ServeHTTP(w, r)
				return
			}
			result := httptest.NewRecorder()
			handler.ServeHTTP(result, r)
			if result.Code == 200 {
				if drop {
					// Close the connection after the actual PostgreSQL commit.
					conn, _, err := http.NewResponseController(w).Hijack()
					if err == nil {
						conn.Close()
						return
					}
					w.WriteHeader(502)
					return
				}
				close(block.committed)
				select {
				case <-block.release:
				case <-r.Context().Done():
					return
				}
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(result.Code)
			_, _ = w.Write(result.Body.Bytes())
		})
	})
	startWorker := func() worker.Worker {
		a, err := campaignruntime.NewActivities(api.URL, runnerToken)
		if err != nil {
			t.Fatal(err)
		}
		w := worker.New(temporal, campaignruntime.TaskQueue, worker.Options{})
		a.Register(w)
		if err := w.Start(); err != nil {
			t.Fatal(err)
		}
		return w
	}
	workerProcess := startWorker()
	defer func() { workerProcess.Stop() }()

	type credentials struct{ Token string }
	newClient := func(project string) string {
		return parse[credentials](t, request(t, api, "POST", "/api/v1/clients", "test-operator", map[string]any{
			"name": project, "projects": []string{project},
		}, "", 201)).Token
	}
	owner, peer, foreign := newClient("lab"), newClient("lab"), newClient("other")
	device := parse[struct {
		Worker store.Worker
		Token  string
	}](t, request(t, api, "POST", "/api/v1/workers", "test-operator", map[string]any{"name": "Test executor", "projects": []string{"lab"}}, "", 201))
	spec := store.Spec{Title: "First", Prompt: "Frozen fixture", Acceptance: "Record observed execution", ProjectID: "lab", WorkspaceKey: "workspace", AgentID: "fixture"}
	first, second := store.TrialInput{Task: spec, WorkerID: device.Worker.ID}, store.TrialInput{Task: spec, WorkerID: device.Worker.ID}
	second.Task.Title = "Second"
	plan := map[string]any{"trials": []store.TrialInput{first, second}}
	const base = "/api/client/v1/projects/lab/campaigns"
	type view struct {
		store.CampaignRecord
		Phase    campaign.Phase
		Progress *campaign.Progress
	}
	get := func(id string) view { return parse[view](t, request(t, api, "GET", base+"/"+id, owner, nil, "", 200)) }
	start := func(key string, code int) view {
		return parse[view](t, request(t, api, "POST", base, owner, plan, key, code))
	}
	waitFor := func(id string, ready func(view) bool) view {
		t.Helper()
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for {
			v := get(id)
			if ready(v) {
				return v
			}
			select {
			case <-ctx.Done():
				t.Fatalf("campaign %s did not reach expected state: %+v", id, v)
			case <-ticker.C:
			}
		}
	}
	claim := func(ref store.RunRef) store.Run {
		t.Helper()
		cl := parse[struct{ Run *store.Run }](t, request(t, api, "POST", "/api/worker/v1/claims", device.Token, map[string]string{
			"instance_id": "fixture", "request_id": "fixture-" + ref.RunID,
		}, "", 200)).Run
		if cl == nil || cl.Ref() != ref {
			t.Fatalf("Worker claim %+v, want %+v", cl, ref)
		}
		return *cl
	}
	complete := func(r store.Run, outcome string) {
		request(t, api, "POST", "/api/worker/v1/runs/"+r.ID+"/complete", device.Token, map[string]any{
			"generation": r.Generation, "instance_id": r.InstanceID, "outcome": outcome,
		}, "", 200)
	}
	verifyReplay := func(v view) *historypb.History {
		t.Helper()
		var result campaign.Progress
		if err := temporal.GetWorkflow(ctx, v.Plan.ID, v.WorkflowRunID).Get(ctx, &result); err != nil {
			t.Fatal(err)
		}
		history := &historypb.History{}
		iter := temporal.GetWorkflowHistory(ctx, v.Plan.ID, v.WorkflowRunID, false, enumspb.HISTORY_EVENT_FILTER_TYPE_ALL_EVENT)
		for iter.HasNext() {
			event, err := iter.Next()
			if err != nil {
				t.Fatal(err)
			}
			history.Events = append(history.Events, event)
		}
		replayer := worker.NewWorkflowReplayer()
		replayer.RegisterWorkflowWithOptions(campaignruntime.Workflow, workflow.RegisterOptions{Name: campaignruntime.WorkflowName})
		if err := replayer.ReplayWorkflowHistory(nil, history); err != nil {
			t.Fatal(err)
		}
		if v.Result == nil || result.Outcome != v.Result.Outcome {
			t.Fatalf("Workflow and Pero result disagree: %+v %+v", result, v.Result)
		}
		return history
	}

	starter.fault.Store(2)
	dropDispatch.Store(true)
	pending := start("lost-start", 202)
	if pending.Phase != campaign.Starting || pending.WorkflowRunID != "" || get(pending.Plan.ID).Phase != campaign.Starting {
		t.Fatalf("missing pending start intent: %+v", pending)
	}
	active := start("lost-start", 200)
	if active.Plan != pending.Plan || active.WorkflowRunID != starter.faultedRun.Load() {
		t.Fatalf("retry forked start: %+v, original %+v", active, pending)
	}
	request(t, api, "GET", base+"/"+active.Plan.ID, foreign, nil, "", 404)
	request(t, api, "POST", base+"/"+active.Plan.ID+"/cancel", peer, struct{}{}, "", 404)
	request(t, api, "POST", base, owner, map[string]any{"trials": []store.TrialInput{second}}, "lost-start", 409)
	withFirst := waitFor(active.Plan.ID, func(v view) bool {
		return v.Progress != nil && v.Progress.Trials[0].Run != nil
	})
	ref := *withFirst.Progress.Trials[0].Run
	if dropDispatch.Load() || withFirst.Progress.Trials[1].Status != campaign.NotStarted {
		t.Fatal("missing lost dispatch or single-flight observation")
	}
	laterOperation := (campaign.TrialCommand{CampaignID: active.Plan.ID, Index: 1}).OperationID()
	request(t, api, "GET", "/api/client/v1/projects/lab/trial-submissions/"+laterOperation, runnerToken, nil, "", 404)
	run := claim(ref)
	workerProcess.Stop()
	workerProcess = startWorker()
	recovered := waitFor(active.Plan.ID, func(v view) bool {
		return v.Progress != nil && v.Progress.Trials[0].Status == campaign.Running
	})
	if *recovered.Progress.Trials[0].Run != ref || recovered.Plan != active.Plan {
		t.Fatalf("recovery changed the original execution: %+v", recovered)
	}
	complete(run, "succeeded")
	withSecond := waitFor(active.Plan.ID, func(v view) bool {
		return v.Progress != nil && v.Progress.Trials[1].Run != nil
	})
	complete(claim(*withSecond.Progress.Trials[1].Run), "succeeded")
	finished := waitFor(active.Plan.ID, func(v view) bool { return v.Result != nil })
	if finished.Result.Outcome != campaign.ExecutionCompleted {
		t.Fatalf("unexpected result: %+v", finished.Result)
	}
	verifyReplay(finished)

	starter.fault.Store(1)
	notStarted := start("cancel-before-start", 202)
	request(t, api, "POST", base+"/"+notStarted.Plan.ID+"/cancel", owner, struct{}{}, "", 202)
	startedToCancel := start("cancel-before-start", 200)
	cancelled := waitFor(startedToCancel.Plan.ID, func(v view) bool { return v.Result != nil })
	if cancelled.Result.Outcome != campaign.CampaignCancelled || cancelled.Result.Trials[0].Run != nil || cancelled.Result.Trials[1].Status != campaign.Skipped {
		t.Fatalf("cancelled intent dispatched a trial: %+v", cancelled.Result)
	}
	verifyReplay(cancelled)

	block := &blockedDispatch{committed: make(chan struct{}), release: make(chan struct{})}
	blockDispatch.Store(block)
	inFlight := start("cancel-during-dispatch", 200)
	select {
	case <-block.committed:
	case <-ctx.Done():
		t.Fatal("dispatch never reached its commit")
	}
	firstOperation := (campaign.TrialCommand{CampaignID: inFlight.Plan.ID, Index: 0}).OperationID()
	admitted := parse[store.TrialReceipt](t, request(t, api, "GET", "/api/client/v1/projects/lab/trial-submissions/"+firstOperation, runnerToken, nil, "", 200))
	request(t, api, "POST", base+"/"+inFlight.Plan.ID+"/cancel", owner, struct{}{}, "", 202)
	close(block.release)
	cancelledInFlight := waitFor(inFlight.Plan.ID, func(v view) bool { return v.Result != nil })
	recorded := cancelledInFlight.Result.Trials[0]
	if admitted.Run == nil || recorded.Run == nil || *admitted.Run != *recorded.Run || recorded.Status != campaign.Cancelled ||
		cancelledInFlight.Result.Outcome != campaign.CampaignCancelled || cancelledInFlight.Result.Trials[1].Status != campaign.Skipped {
		t.Fatalf("cancel did not settle the original in-flight dispatch: %+v", cancelledInFlight.Result)
	}
	history := verifyReplay(cancelledInFlight)
	if path := os.Getenv("PERO_TEST_TEMPORAL_HISTORY"); path != "" {
		data, err := protojson.MarshalOptions{Indent: "  "}.Marshal(history)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(data, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}

	uncertain := start("review-original-execution", 200)
	withRun := waitFor(uncertain.Plan.ID, func(v view) bool {
		return v.Progress != nil && v.Progress.Trials[0].Run != nil
	})
	r := claim(*withRun.Progress.Trials[0].Run)
	complete(r, "reconcile")
	waitFor(uncertain.Plan.ID, func(v view) bool { return v.Phase == campaign.PendingReconciliation })
	request(t, api, "POST", base+"/"+uncertain.Plan.ID+"/cancel", owner, struct{}{}, "", 202)
	stillPending := waitFor(uncertain.Plan.ID, func(v view) bool {
		return v.Phase == campaign.PendingReconciliation && v.Progress.CancelRequested
	})
	if *stillPending.Progress.Trials[0].Run != r.Ref() || stillPending.Progress.Trials[1].Status != campaign.NotStarted {
		t.Fatalf("unknown effect changed execution identity or advanced the plan: %+v", stillPending)
	}
	request(t, api, "PUT", fmt.Sprintf("/api/v1/tasks/%s/runs/%s/reconciliation?generation=%d", r.TaskID, r.ID, r.Generation), "test-operator",
		store.RunReconciliationDecision{Disposition: store.RunConfirmedStopped, Evidence: "fixture owner confirmed stop"}, "", 200)
	resolved := waitFor(uncertain.Plan.ID, func(v view) bool { return v.Result != nil })
	if resolved.Result.Outcome != campaign.CampaignCancelled || resolved.Result.Trials[0].Status != campaign.Reconciled {
		t.Fatalf("unexpected resolution: %+v", resolved.Result)
	}
	verifyReplay(resolved)
	// Deleting closed history leaves the independently persisted project result.
	if _, err := temporal.WorkflowService().DeleteWorkflowExecution(ctx, &workflowservice.DeleteWorkflowExecutionRequest{
		Namespace:         "default",
		WorkflowExecution: &commonpb.WorkflowExecution{WorkflowId: resolved.Plan.ID, RunId: resolved.WorkflowRunID},
	}); err != nil {
		t.Fatal(err)
	}
	deletion := time.NewTicker(50 * time.Millisecond)
	defer deletion.Stop()
	for {
		_, err := temporal.DescribeWorkflowExecution(ctx, resolved.Plan.ID, resolved.WorkflowRunID)
		var notFound *serviceerror.NotFound
		if errors.As(err, &notFound) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		select {
		case <-deletion.C:
		case <-ctx.Done():
			t.Fatal("closed Temporal history was not removed")
		}
	}
	if get(resolved.Plan.ID).Result == nil {
		t.Fatal("campaign result depended on Temporal history")
	}
}
