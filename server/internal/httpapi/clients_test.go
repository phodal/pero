package httpapi_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/store"
)

func TestTrialSubmissionRecoversOriginalRun(t *testing.T) {
	server := testAPI(t, func(db *store.Store) http.Handler {
		api := httpapi.Handler(db, "test-operator")
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("lose_reply") != "1" {
				api.ServeHTTP(w, r)
				return
			}
			recorded := httptest.NewRecorder()
			api.ServeHTTP(recorded, r)
			if recorded.Code != http.StatusOK {
				http.Error(w, recorded.Body.String(), recorded.Code)
				return
			}
			conn, _, err := http.NewResponseController(w).Hijack()
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			_ = conn.Close()
		})
	})
	credential := func(project string) string {
		return parse[struct{ Token string }](t, request(t, server, "POST", "/api/v1/clients", "test-operator", map[string]any{"name": project, "projects": []string{project}}, "", 201)).Token
	}
	owner, teammate, outsider := credential("team"), credential("team"), credential("foreign")
	const trial = "/api/client/v1/projects/team/trial-submissions/first"
	input := store.TrialInput{Task: store.Spec{Title: "Frozen trial", Prompt: "Run case A", Acceptance: "Result available", ProjectID: "team", WorkspaceKey: "lab", AgentID: "pybamm"}}
	request(t, server, "GET", trial, owner, nil, "", 404)
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	put, err := http.NewRequest("PUT", server.URL+trial+"?lose_reply=1", bytes.NewReader(encoded))
	if err != nil {
		t.Fatal(err)
	}
	put.Header.Set("Authorization", "Bearer "+owner)
	if response, err := server.Client().Do(put); err == nil {
		response.Body.Close()
		t.Fatalf("committed dispatch reply was delivered: %s", response.Status)
	}
	read := func(path string) store.TrialReceipt {
		return parse[store.TrialReceipt](t, request(t, server, "GET", path, owner, nil, "", 200))
	}
	first := read(trial)
	if first.Status != store.TrialDispatched || first.Run == nil {
		t.Fatalf("missing original submission: %+v", first)
	}
	if replay := parse[store.TrialReceipt](t, request(t, server, "PUT", trial, owner, input, "", 200)); replay.Run == nil || *replay.Run != *first.Run {
		t.Fatalf("retry changed original execution: %+v", replay)
	}
	wrong := input
	wrong.Task.Prompt = "Run case B"
	request(t, server, "PUT", trial, owner, wrong, "", 409)
	request(t, server, "GET", trial, teammate, nil, "", 404)
	request(t, server, "GET", trial, outsider, nil, "", 404)
	request(t, server, "PUT", trial, outsider, input, "", 404)
	request(t, server, "POST", trial+"/cancel", outsider, struct{}{}, "", 404)

	pathFor := func(ref store.RunRef, suffix string) string {
		return fmt.Sprintf("/api/client/v1/tasks/%s/runs/%s%s?generation=%d", ref.TaskID, ref.RunID, suffix, ref.Generation)
	}
	request(t, server, "GET", pathFor(*first.Run, ""), outsider, nil, "", 404)
	request(t, server, "POST", pathFor(*first.Run, "/cancel"), teammate, struct{}{}, "", 403)
	if cancel := parse[store.TrialReceipt](t, request(t, server, "POST", trial+"/cancel", owner, struct{}{}, "", 200)); cancel.Run == nil || *cancel.Run != *first.Run {
		t.Fatalf("late cancellation lost original identity: %+v", cancel)
	}
	later := parse[store.Run](t, request(t, server, "POST", "/api/client/v1/tasks/"+first.Run.TaskID+"/dispatch", owner, struct{}{}, "next-generation", 200))
	if later.Generation <= first.Run.Generation {
		t.Fatalf("test requires a later Run: %+v", later)
	}
	if old := parse[store.Run](t, request(t, server, "GET", pathFor(*first.Run, ""), owner, nil, "", 200)); old.Ref() != *first.Run || old.Status != "cancelled" {
		t.Fatalf("historical observation followed the current Run: %+v", old)
	}
	wrongGeneration := *first.Run
	wrongGeneration.Generation = later.Generation
	request(t, server, "POST", pathFor(wrongGeneration, "/cancel"), owner, struct{}{}, "", 404)
	if old := parse[store.Run](t, request(t, server, "POST", pathFor(*first.Run, "/cancel"), owner, struct{}{}, "", 200)); old.Ref() != *first.Run || old.Status != "cancelled" {
		t.Fatalf("historical Run changed: %+v", old)
	}
	request(t, server, "POST", trial+"/cancel", owner, struct{}{}, "", 200)
	if observed := parse[store.Run](t, request(t, server, "GET", pathFor(later.Ref(), ""), owner, nil, "", 200)); observed.Status != "queued" {
		t.Fatalf("historical cancellation touched the current Run: %+v", observed)
	}
	if replay := parse[store.TrialReceipt](t, request(t, server, "PUT", trial, owner, input, "", 200)); replay.Run == nil || *replay.Run != *first.Run {
		t.Fatalf("retry followed the newer generation: %+v", replay)
	}

	const before = "/api/client/v1/projects/team/trial-submissions/stop-first"
	request(t, server, "POST", before+"/cancel", owner, struct{}{}, "", 200)
	if blocked := parse[store.TrialReceipt](t, request(t, server, "PUT", before, owner, input, "", 200)); blocked.Status != store.TrialCancelledBeforeDispatch || blocked.Run != nil || read(before) != blocked {
		t.Fatalf("late dispatch escaped the cancellation fence: %+v", blocked)
	}
	const repeat = "/api/client/v1/projects/team/trial-submissions/explicit-repeat"
	if rerun := parse[store.TrialReceipt](t, request(t, server, "PUT", repeat, owner, input, "", 200)); rerun.Run == nil || rerun.Run.TaskID == first.Run.TaskID {
		t.Fatalf("intentional repeat reused previous trial: %+v", rerun)
	}
	if page := parse[store.TaskPage](t, request(t, server, "GET", "/api/client/v1/tasks", owner, nil, "", 200)); len(page.Tasks) != 2 {
		t.Fatalf("retries or cancellation created additional Tasks: %+v", page.Tasks)
	}
}

func TestScopedClientIdentityHumanClaimAndWorkerLease(t *testing.T) {
	server := testAPI(t)
	type credentials struct {
		Client store.Client `json:"client"`
		Token  string       `json:"token"`
	}
	alice := parse[credentials](t, request(t, server, "POST", "/api/v1/clients", "test-operator", map[string]any{"name": "Alice", "projects": []string{"team"}}, "", 201))
	bob := parse[credentials](t, request(t, server, "POST", "/api/v1/clients", "test-operator", map[string]any{"name": "Bob", "projects": []string{"team"}}, "", 201))
	me := parse[store.Client](t, request(t, server, "GET", "/api/client/v1/me", alice.Token, nil, "", 200))
	if me.ID != alice.Client.ID || me.Name != "Alice" || me.Role != "client" || len(me.Projects) != 1 || me.Projects[0] != "team" {
		t.Fatalf("scoped identity: %+v", me)
	}
	operator := parse[map[string]any](t, request(t, server, "GET", "/api/v1/me", "test-operator", nil, "", 200))
	if operator["role"] != "operator" {
		t.Fatalf("operator identity: %+v", operator)
	}
	request(t, server, "GET", "/api/client/v1/me", "test-operator", nil, "", 401)
	request(t, server, "GET", "/api/v1/tasks", alice.Token, nil, "", 401)
	request(t, server, "POST", "/api/v1/clients", alice.Token, map[string]any{"name": "Eve", "projects": []string{"private"}}, "", 401)
	request(t, server, "POST", "/api/worker/v1/claims", alice.Token, map[string]any{"request_id": "x", "instance_id": "x"}, "", 401)
	createTask := func(project string) store.Task {
		return parse[store.Task](t, request(t, server, "POST", "/api/v1/tasks", "test-operator", store.Spec{Title: "Shared goal", Prompt: "Complete fixture", Acceptance: "Fixture completes", ProjectID: project, WorkspaceKey: "repo", AgentID: "fixture"}, "", 201))
	}
	task := createTask("team")
	private := createTask("private")
	page := parse[store.TaskPage](t, request(t, server, "GET", "/api/client/v1/tasks", alice.Token, nil, "", 200))
	if len(page.Tasks) != 1 || page.Tasks[0].ID != task.ID {
		t.Fatalf("private task in scoped list: %+v", page)
	}
	request(t, server, "GET", "/api/client/v1/tasks?cursor="+private.ID, alice.Token, nil, "", 404)
	for _, action := range []string{"claim", "release", "dispatch", "cancel"} {
		request(t, server, "POST", "/api/client/v1/tasks/"+private.ID+"/"+action, alice.Token, map[string]any{}, "shared-receipt", 404)
	}
	request(t, server, "GET", "/api/client/v1/tasks/"+private.ID, alice.Token, nil, "", 404)
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/claim", alice.Token, map[string]any{"owner": bob.Client.ID}, "", 400)
	claimed := parse[store.Task](t, request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/claim", alice.Token, map[string]any{}, "", 200))
	if claimed.ClaimedBy == nil || claimed.ClaimedBy.ID != alice.Client.ID || claimed.ClaimedBy.Name != "Alice" {
		t.Fatalf("human claim: %+v", claimed)
	}
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/claim", alice.Token, map[string]any{}, "", 200)
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/claim", bob.Token, map[string]any{}, "", 409)
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/release", bob.Token, map[string]any{}, "", 403)
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/dispatch", bob.Token, map[string]any{}, "", 403)
	visible := parse[struct {
		Task store.Task `json:"task"`
	}](t, request(t, server, "GET", "/api/v1/tasks/"+task.ID, "test-operator", nil, "", 200))
	if visible.Task.ClaimedBy == nil || visible.Task.ClaimedBy.ID != alice.Client.ID {
		t.Fatalf("operator claim hydration: %+v", visible)
	}
	type workerCredentials struct {
		Worker store.Worker `json:"worker"`
		Token  string       `json:"token"`
	}
	worker := parse[workerCredentials](t, request(t, server, "POST", "/api/v1/workers", "test-operator", map[string]any{"name": "Team Worker", "projects": []string{"team", "hidden"}}, "", 201))
	foreign := parse[workerCredentials](t, request(t, server, "POST", "/api/v1/workers", "test-operator", map[string]any{"name": "Private Worker", "projects": []string{"private"}}, "", 201))
	request(t, server, "GET", "/api/client/v1/tasks", worker.Token, nil, "", 401)
	workers := parse[struct {
		Workers []store.Worker `json:"workers"`
	}](t, request(t, server, "GET", "/api/client/v1/workers", alice.Token, nil, "", 200))
	if len(workers.Workers) != 1 || workers.Workers[0].ID != worker.Worker.ID || len(workers.Workers[0].Projects) != 1 {
		t.Fatalf("private worker metadata leaked: %+v", workers)
	}
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/dispatch", alice.Token, map[string]any{"worker_id": foreign.Worker.ID}, "", 403)
	dispatched := parse[store.Run](t, request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/dispatch", alice.Token, map[string]any{"worker_id": worker.Worker.ID}, "delivery", 200))
	replay := parse[store.Run](t, request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/dispatch", alice.Token, map[string]any{"worker_id": worker.Worker.ID}, "delivery", 200))
	if dispatched.ID != replay.ID {
		t.Fatal("client dispatch replay created another Run")
	}
	lease := parse[struct {
		Run *store.Run `json:"run"`
	}](t, request(t, server, "POST", "/api/worker/v1/claims", worker.Token, map[string]any{"request_id": "worker-delivery", "instance_id": "process"}, "", 200))
	if lease.Run == nil || lease.Run.ID != dispatched.ID {
		t.Fatalf("Worker did not acquire Run: %+v", lease)
	}
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/release", alice.Token, map[string]any{}, "", 409)
	// A human release conflict must not revoke or replace the independent Worker lease.
	request(t, server, "POST", "/api/worker/v1/runs/"+dispatched.ID+"/renew", worker.Token, map[string]any{"generation": lease.Run.Generation, "instance_id": "process"}, "", 200)
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/cancel", bob.Token, map[string]any{}, "", 403)
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/cancel", alice.Token, map[string]any{}, "", 200)
	request(t, server, "POST", "/api/worker/v1/runs/"+dispatched.ID+"/complete", worker.Token, map[string]any{"generation": lease.Run.Generation, "instance_id": "process", "outcome": "cancelled", "summary": "Stopped"}, "", 200)
	released := parse[store.Task](t, request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/release", alice.Token, map[string]any{}, "", 200))
	if released.ClaimedBy != nil {
		t.Fatalf("claim remained after completed cancellation: %+v", released)
	}
	request(t, server, "POST", "/api/client/v1/tasks/"+task.ID+"/release", alice.Token, map[string]any{}, "", 200)
}
