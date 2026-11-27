package httpapi_test

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"testing"

	"github.com/phodal/pero/server/internal/store"
)

func TestRunDesktopEvidenceRemainsWithOriginalRun(t *testing.T) {
	api := testAPI(t)
	const operator = "test-operator"
	type credential struct {
		Worker store.Worker `json:"worker"`
		Token  string       `json:"token"`
	}
	create := map[string]any{"name": "Linux Desktop", "projects": []string{"research"}}
	worker := parse[credential](t, request(t, api, "POST", "/api/v1/workers", operator, create, "", 201))
	other := parse[credential](t, request(t, api, "POST", "/api/v1/workers", operator, create, "", 201))
	foreign := parse[credential](t, request(t, api, "POST", "/api/v1/clients", operator, map[string]any{"name": "Other project", "projects": []string{"other"}}, "", 201))
	task := parse[store.Task](t, request(t, api, "POST", "/api/v1/tasks", operator, store.Spec{Title: "Blender scene", Prompt: "Save model", Acceptance: "Model", ProjectID: "research", WorkspaceKey: "repo", AgentID: "codex"}, "", 201))
	selectWorker := map[string]any{"worker_id": worker.Worker.ID, "desktop_profile": "blender"}
	path := "/api/v1/tasks/" + task.ID + "/dispatch"
	request(t, api, "POST", path, operator, map[string]any{"desktop_profile": "blender"}, "missing-worker", 400)
	run := parse[store.Run](t, request(t, api, "POST", path, operator, selectWorker, "first", 200))
	request(t, api, "POST", "/api/worker/v1/claims", worker.Token, map[string]string{"request_id": "claim", "instance_id": "active"}, "", 200)
	file := "/api/worker/v1/runs/" + run.ID + "/desktop/files/result.blend"
	put := func(token, instance, data string, generation int64, want int) {
		t.Helper()
		req, err := http.NewRequest("PUT", api.URL+file, bytes.NewBufferString(data))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("X-Pero-Instance", instance)
		req.Header.Set("X-Pero-Generation", fmt.Sprint(generation))
		response, err := api.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != want {
			body, _ := io.ReadAll(response.Body)
			t.Fatalf("PUT returned %d, want %d: %s", response.StatusCode, want, body)
		}
	}
	for _, c := range []struct {
		token, instance, data string
		generation            int64
		want                  int
	}{
		{other.Token, "active", "foreign", run.Generation, 403},
		{worker.Token, "wrong", "foreign", run.Generation, 403},
		{worker.Token, "active", "stale", run.Generation + 1, 409},
		{worker.Token, "active", "saved-model", run.Generation, 200},
		{worker.Token, "active", "saved-model", run.Generation, 200},
		{worker.Token, "active", "changed", run.Generation, 409},
	} {
		put(c.token, c.instance, c.data, c.generation, c.want)
	}
	request(t, api, "POST", "/api/worker/v1/runs/"+run.ID+"/complete", worker.Token, map[string]any{"instance_id": "active", "generation": run.Generation, "outcome": "succeeded", "summary": "Completed"}, "", 200)
	put(worker.Token, "active", "changed", run.Generation, 409)
	next := parse[store.Run](t, request(t, api, "POST", path, operator, selectWorker, "next", 200))
	if next.ID == run.ID {
		t.Fatal("Retry changed the original Run")
	}
	artifact := "/api/v1/runs/" + run.ID + "/artifacts/desktop/files/result.blend"
	if got := request(t, api, "GET", artifact, operator, nil, "", 200); string(got) != "saved-model" {
		t.Fatalf("Historical model changed: %q", got)
	}
	request(t, api, "GET", "/api/client/v1"+artifact[len("/api/v1"):], foreign.Token, nil, "", 404)
	request(t, api, "POST", "/api/v1/runs/"+run.ID+"/desktop", operator, map[string]string{"id": "old", "mode": "watch"}, "", 409)
}
