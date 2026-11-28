package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/store"
)

func TestProductionHandlerObservesPersistentRun(t *testing.T) {
	var lab, other string
	var runID string
	var generation int64
	var foreignID string
	server := testAPI(t, func(db *store.Store) http.Handler {
		ctx := context.Background()
		_, token, err := db.CreateClient(ctx, "Lab", []string{"lab"})
		if err != nil {
			t.Fatal(err)
		}
		lab = token
		_, token, err = db.CreateClient(ctx, "Other", []string{"other"})
		if err != nil {
			t.Fatal(err)
		}
		other = token
		worker, _, err := db.CreateWorker(ctx, "worker", []string{"lab", "other"}, nil)
		if err != nil {
			t.Fatal(err)
		}
		spec := store.Spec{Title: "Watch", Prompt: "Watch the run", Acceptance: "Seen", ProjectID: "lab", WorkspaceKey: "lab", AgentID: "fixture"}
		task, err := db.CreateTask(ctx, spec, "watch")
		if err != nil {
			t.Fatal(err)
		}
		run, err := db.Dispatch(ctx, task.ID, worker.ID, "watch")
		if err != nil {
			t.Fatal(err)
		}
		runID, generation = run.ID, run.Generation
		spec.ProjectID = "other"
		spec.WorkspaceKey = "other"
		foreignTask, err := db.CreateTask(ctx, spec, "foreign")
		if err != nil {
			t.Fatal(err)
		}
		foreign, err := db.Dispatch(ctx, foreignTask.ID, worker.ID, "foreign")
		if err != nil {
			t.Fatal(err)
		}
		foreignID = foreign.ID
		return httpapi.Handler(db, "test-operator")
	})
	body := func(id string, generation int64, operation, project string, closed bool) map[string]any {
		return map[string]any{
			"binding": map[string]any{"kind": "control_plane_run", "ownerHost": "control-plane", "project": project, "id": id, "generation": generation, "scope": project},
			"request": map[string]any{"operation": operation, "requestId": operation + "-" + id, "inputHash": "hash-a", "generation": generation, "consumerClosed": closed},
		}
	}
	first := decodeRun(t, request(t, server, "POST", "/api/client/v1/projects/lab/runs/observe", lab, body(runID, generation, "status", "lab", false), "", 200))
	second := decodeRun(t, request(t, server, "POST", "/api/client/v1/projects/lab/runs/observe", lab, body(runID, generation, "lookup", "lab", false), "", 200))
	if first["status"] == "" || first["status"] == "unknown" || first["status"] != second["status"] || first["effect"] != "none" {
		t.Fatalf("production observation %#v %#v", first, second)
	}
	forged := body(foreignID, generation, "cancel", "lab", false)
	missing := decodeRun(t, request(t, server, "POST", "/api/client/v1/projects/lab/runs/observe", lab, forged, "", 404))
	if missing["status"] != nil || missing["outcome"] != "unknown" {
		t.Fatalf("forged %#v", missing)
	}
	closed := decodeRun(t, request(t, server, "POST", "/api/client/v1/projects/lab/runs/observe", other, body(runID, generation, "cancel", "lab", true), "", 403))
	if closed["outcome"] != "revoked" || closed["status"] != nil || closed["cursor"] != nil {
		t.Fatalf("closed %#v", closed)
	}
	staleBody := body(runID, 0, "cancel", "lab", false)
	stale := decodeRun(t, request(t, server, "POST", "/api/client/v1/projects/lab/runs/observe", lab, staleBody, "", 409))
	if stale["outcome"] != "generation_changed" || stale["status"] != nil {
		t.Fatalf("stale %#v", stale)
	}
	cancelled := decodeRun(t, request(t, server, "POST", "/api/client/v1/projects/lab/runs/observe", lab, body(runID, generation, "cancel", "lab", false), "", 200))
	if cancelled["effect"] != "cancel_owner" {
		t.Fatalf("cancel %#v", cancelled)
	}
}

func decodeRun(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatal(err)
	}
	return payload
}
