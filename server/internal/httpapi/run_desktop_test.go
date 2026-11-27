package httpapi_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/store"
)

func TestRunDesktopHandoffAndEvidenceStayWithOriginalRun(t *testing.T) {
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
	owner := parse[credential](t, request(t, api, "POST", "/api/v1/clients", operator, map[string]any{"name": "Run requester", "projects": []string{"research"}}, "", 201))
	task := parse[store.Task](t, request(t, api, "POST", "/api/v1/tasks", operator, store.Spec{Title: "Blender scene", Prompt: "Save model", Acceptance: "Model", ProjectID: "research", WorkspaceKey: "repo", AgentID: "codex"}, "", 201))
	selectWorker := map[string]any{"worker_id": worker.Worker.ID, "desktop_profile": "blender"}
	path := "/api/v1/tasks/" + task.ID + "/dispatch"
	taskPath := "/api/client/v1/tasks/" + task.ID
	request(t, api, "POST", path, operator, map[string]any{"desktop_profile": "blender"}, "missing-worker", 400)
	request(t, api, "POST", taskPath+"/claim", owner.Token, map[string]any{}, "", 200)
	run := parse[store.Run](t, request(t, api, "POST", taskPath+"/dispatch", owner.Token, selectWorker, "first", 200))
	request(t, api, "POST", "/api/worker/v1/claims", worker.Token, map[string]string{"request_id": "claim", "instance_id": "active"}, "", 200)
	desktopPath := "/api/worker/v1/runs/" + run.ID + "/desktop"
	clientDesktop := "/api/client/v1/runs/" + run.ID + "/desktop"
	const reason = "Finish Blender Quick Setup"
	handoff := map[string]any{"instance_id": "active", "generation": run.Generation, "id": "setup", "reason": reason}
	request(t, api, "POST", desktopPath+"/handoff", other.Token, handoff, "", 403)
	request(t, api, "POST", desktopPath+"/handoff", worker.Token, handoff, "", 200)
	readHandoff := func() *store.RunDesktopHandoff {
		t.Helper()
		detail := parse[struct {
			Run store.Run `json:"run"`
		}](t, request(t, api, "GET", taskPath, owner.Token, nil, "", 200))
		return detail.Run.DesktopHandoff
	}
	if got := readHandoff(); !got.Requested("setup") || got.Reason != reason {
		t.Fatalf("Run did not expose the Agent request: %+v", got)
	}
	request(t, api, "POST", clientDesktop, foreign.Token, map[string]string{"id": "denied", "mode": "return", "handoff_id": "setup"}, "", 404)
	request(t, api, "POST", clientDesktop, owner.Token, map[string]string{"id": "stale", "mode": "return", "handoff_id": "other"}, "", 409)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "POST", api.URL+clientDesktop, bytes.NewBufferString(`{"id":"done","mode":"return","handoff_id":"setup"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+owner.Token)
	req.Header.Set("Content-Type", "application/json")
	returned := make(chan error, 1)
	go func() {
		reply, err := api.Client().Do(req)
		if err == nil {
			defer reply.Body.Close()
			if reply.StatusCode != 200 {
				err = fmt.Errorf("return request: %s", reply.Status)
			}
		}
		returned <- err
	}()
	execution := map[string]any{"instance_id": "active", "generation": run.Generation}
	ticks := time.NewTicker(10 * time.Millisecond)
	defer ticks.Stop()
	for {
		pending := parse[struct {
			Command *struct {
				ID        string `json:"id"`
				HandoffID string `json:"handoff_id"`
			} `json:"command"`
		}](t, request(t, api, "POST", desktopPath+"/poll", worker.Token, execution, "", 200))
		if pending.Command != nil {
			if pending.Command.ID != "done" || pending.Command.HandoffID != "setup" {
				t.Fatalf("Worker received the wrong return: %+v", pending.Command)
			}
			break
		}
		select {
		case <-ticks.C:
		case err := <-returned:
			t.Fatal(errors.Join(errors.New("return finished before Worker acknowledgement"), err))
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		}
	}
	if got := readHandoff(); !got.Requested("setup") {
		t.Fatalf("Run changed before Worker acknowledgement: %+v", got)
	}
	execution["id"] = "done"
	request(t, api, "POST", desktopPath, worker.Token, execution, "", 200)
	if err := <-returned; err != nil {
		t.Fatal(err)
	}
	if got := readHandoff(); got == nil || got.State != "returned" || got.RequestID != "setup" || got.Reason != reason {
		t.Fatalf("Run did not preserve the acknowledged request: %+v", got)
	}

	file := desktopPath + "/files/result.blend"
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
