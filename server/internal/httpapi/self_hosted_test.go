package httpapi_test

import (
	"strings"
	"testing"

	"github.com/phodal/pero/server/internal/store"
)

func TestScopedTaskCreationAndWorkerObservation(t *testing.T) {
	api := testAPI(t)
	type clientCredential struct {
		Client store.Client `json:"client"`
		Token  string       `json:"token"`
	}
	alice := parse[clientCredential](t, request(t, api, "POST", "/api/v1/clients", "test-operator", map[string]any{"name": "Alice", "projects": []string{"team", "private"}}, "", 201))
	bob := parse[clientCredential](t, request(t, api, "POST", "/api/v1/clients", "test-operator", map[string]any{"name": "Bob", "projects": []string{"team"}}, "", 201))
	type workerCredential struct {
		Worker store.Worker `json:"worker"`
		Token  string       `json:"token"`
	}
	device := store.WorkerEnrollmentRequest{DeviceID: "device", RequestID: "enroll", Name: "Research machine", Projects: []string{"team", "private"}, EnrollmentSecret: strings.Repeat("ab", 32), Capabilities: []store.WorkerCapability{
		{ProjectID: "team", WorkspaceKey: "repo", AgentID: "fixture"},
		{ProjectID: "private", WorkspaceKey: "secret", AgentID: "fixture"},
	}}
	worker := parse[workerCredential](t, request(t, api, "POST", "/api/client/v1/workers", alice.Token, device, "", 200))
	type workerList struct {
		Workers []store.Worker `json:"workers"`
	}
	listed := parse[workerList](t, request(t, api, "GET", "/api/client/v1/workers", bob.Token, nil, "", 200)).Workers[0]
	if listed.Presence.State != store.WorkerUnknown || len(listed.Capabilities) != 1 || listed.Capabilities[0].ProjectID != "team" || len(listed.Projects) != 1 {
		t.Fatalf("uncontacted/scoped machine: %+v", listed)
	}
	claim := map[string]any{"request_id": "idle", "instance_id": "one"}
	request(t, api, "POST", "/api/worker/v1/claims", worker.Token, claim, "", 200)
	listed = parse[workerList](t, request(t, api, "GET", "/api/client/v1/workers", alice.Token, nil, "", 200)).Workers[0]
	if listed.Presence.State != store.WorkerOnline || listed.Occupied {
		t.Fatalf("idle contact: %+v", listed)
	}
	spec := store.Spec{Title: "Inspect data", Prompt: "Read the granted workspace", Acceptance: "Return evidence", ProjectID: "team", WorkspaceKey: "repo", AgentID: "fixture"}
	for _, tc := range []struct {
		name   string
		change func(*store.Spec)
		status int
	}{
		{"outside grants", func(s *store.Spec) { s.ProjectID = "foreign" }, 403},
		{"forged source", func(s *store.Spec) { s.Source = &store.Source{Kind: "github"} }, 400},
		{"forged hierarchy", func(s *store.Spec) { s.ParentTaskID = "foreign-task" }, 400},
		{"invalid input", func(s *store.Spec) { s.Prompt = "" }, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			bad := spec
			tc.change(&bad)
			request(t, api, "POST", "/api/client/v1/tasks", alice.Token, bad, "", tc.status)
		})
	}
	task := parse[store.Task](t, request(t, api, "POST", "/api/client/v1/tasks", alice.Token, spec, "create", 201))
	repeated := parse[store.Task](t, request(t, api, "POST", "/api/client/v1/tasks", alice.Token, spec, "create", 201))
	if task.ID != repeated.ID || task.ClaimedBy == nil || task.ClaimedBy.ID != alice.Client.ID {
		t.Fatal("creation must atomically claim once for creator")
	}
	other := parse[store.Task](t, request(t, api, "POST", "/api/client/v1/tasks", bob.Token, spec, "create", 201))
	if other.ID == task.ID {
		t.Fatal("creation receipt leaked across principals")
	}
	run := parse[store.Run](t, request(t, api, "POST", "/api/client/v1/tasks/"+task.ID+"/dispatch", alice.Token, map[string]any{"worker_id": worker.Worker.ID}, "dispatch", 200))
	claim["request_id"] = "execute"
	claimed := parse[struct {
		Run store.Run `json:"run"`
	}](t, request(t, api, "POST", "/api/worker/v1/claims", worker.Token, claim, "", 200)).Run
	if claimed.ID != run.ID {
		t.Fatal("chosen compatible Worker did not claim original Run")
	}
	listed = parse[workerList](t, request(t, api, "GET", "/api/client/v1/workers", bob.Token, nil, "", 200)).Workers[0]
	if !listed.Occupied || listed.CurrentRunID != run.ID || listed.CurrentTaskID != task.ID {
		t.Fatalf("active Run observation: %+v", listed)
	}
	request(t, api, "POST", "/api/client/v1/tasks/"+task.ID+"/cancel", alice.Token, map[string]any{}, "", 200)
	request(t, api, "POST", "/api/worker/v1/runs/"+run.ID+"/complete", worker.Token, map[string]any{"instance_id": "one", "generation": run.Generation, "outcome": "cancelled", "summary": "Stopped"}, "", 200)
	privateSpec := spec
	privateSpec.ProjectID = "private"
	privateSpec.WorkspaceKey = "secret"
	privateTask := parse[store.Task](t, request(t, api, "POST", "/api/client/v1/tasks", alice.Token, privateSpec, "private", 201))
	privateRun := parse[store.Run](t, request(t, api, "POST", "/api/client/v1/tasks/"+privateTask.ID+"/dispatch", alice.Token, map[string]any{"worker_id": worker.Worker.ID}, "private-run", 200))
	claim["request_id"] = "private"
	request(t, api, "POST", "/api/worker/v1/claims", worker.Token, claim, "", 200)
	listed = parse[workerList](t, request(t, api, "GET", "/api/client/v1/workers", bob.Token, nil, "", 200)).Workers[0]
	if !listed.Occupied || listed.CurrentRunID != "" || listed.CurrentTaskID != "" || listed.CurrentRunStatus != "" {
		t.Fatalf("private Run should expose only machine occupancy: %+v", listed)
	}
	request(t, api, "POST", "/api/client/v1/tasks/"+privateTask.ID+"/cancel", alice.Token, map[string]any{}, "", 200)
	request(t, api, "POST", "/api/worker/v1/runs/"+privateRun.ID+"/complete", worker.Token, map[string]any{"instance_id": "one", "generation": privateRun.Generation, "outcome": "cancelled", "summary": "Stopped"}, "", 200)
	request(t, api, "POST", "/api/client/v1/workers/"+worker.Worker.ID+"/disable", alice.Token, map[string]any{}, "", 200)
	listed = parse[workerList](t, request(t, api, "GET", "/api/client/v1/workers", alice.Token, nil, "", 200)).Workers[0]
	if listed.Enabled == nil || *listed.Enabled || listed.Occupied {
		t.Fatalf("disabled device: %+v", listed)
	}
}
