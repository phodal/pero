package httpapi_test

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/paperdomain"
	"github.com/phodal/pero/server/internal/store"
)

func TestProductionServerKeepsAPaperAndARunReceipt(t *testing.T) {
	const pdf = "%PDF-1.1\nproduction\n%%EOF\n"
	sum := sha256.Sum256([]byte(pdf))
	digest := hex.EncodeToString(sum[:])
	var token string
	var runID string
	var generation int64
	var db *store.Store
	server := testAPI(t, func(opened *store.Store) http.Handler {
		db = opened
		papers := &httpapi.PersistedPaper{DB: db}
		client, clientToken, err := db.CreateClient(t.Context(), "Lab", []string{"lab"})
		if err != nil {
			t.Fatal(err)
		}
		token = clientToken
		worker, _, err := db.CreateWorker(t.Context(), "worker", []string{"lab"}, nil)
		if err != nil {
			t.Fatal(err)
		}
		task, err := db.CreateTask(t.Context(), store.Spec{Title: "Watch", Prompt: "Watch the run", Acceptance: "Seen", ProjectID: "lab", WorkspaceKey: "lab", AgentID: "fixture"}, "production-paper-task")
		if err != nil {
			t.Fatal(err)
		}
		// Claim before dispatch. A queued run is busy, so a later claim is rejected,
		// and ClientCancelRun accepts only the client that owns the task.
		// The create and dispatch receipts are different keys: one key cannot name both operations.
		if _, err = db.ClaimTask(t.Context(), &client, task.ID); err != nil {
			t.Fatal(err)
		}
		run, err := db.Dispatch(t.Context(), task.ID, worker.ID, "production-paper-run")
		if err != nil {
			t.Fatal(err)
		}
		runID, generation = run.ID, run.Generation
		return httpapi.ServerHandler(db, "operator-token", httpapi.ServerOptions{Paper: papers, Importer: papers})
	})
	request(t, server, "POST", "/api/client/v1/projects/lab/device-handles", token, map[string]any{
		"id": "handle-prod", "provider": "browser", "mediaType": "application/pdf", "size": len(pdf), "name": "note.pdf",
	}, "", 201)
	upload, err := http.NewRequest(http.MethodPost, server.URL+"/api/client/v1/projects/lab/device-transfers/upload-prod", strings.NewReader(pdf))
	if err != nil {
		t.Fatal(err)
	}
	upload.Header.Set("Authorization", "Bearer "+token)
	upload.Header.Set("X-Pero-Handle", "handle-prod")
	upload.Header.Set("Content-Type", "application/pdf")
	uploaded, err := server.Client().Do(upload)
	if err != nil {
		t.Fatal(err)
	}
	uploaded.Body.Close()
	if uploaded.StatusCode != 202 {
		t.Fatalf("upload %d", uploaded.StatusCode)
	}
	finalized := parse[map[string]any](t, request(t, server, "POST", "/api/client/v1/projects/lab/device-transfers/upload-prod/finalize", token, map[string]any{
		"app": "paper-agent", "digest": digest, "mediaType": "application/pdf", "size": len(pdf), "handle": "handle-prod",
	}, "", 200))
	paperID, _ := finalized["paperId"].(string)
	revision, _ := finalized["revision"].(string)
	if !strings.HasPrefix(paperID, "rev_") || strings.HasPrefix(paperID, "paper-") || strings.HasPrefix(paperID, "doc-") || revision != digest {
		t.Fatalf("identity %#v", finalized)
	}
	read := parse[map[string]any](t, request(t, server, "POST", "/api/client/v1/projects/lab/app-resources/paper", token, map[string]any{
		"ownerHost": paperdomain.Host, "sharedProject": "lab", "localProject": "lab", "app": "paper-agent",
		"appInstance": "paper-agent@" + paperdomain.Host, "appVersion": "1", "kind": "paper", "id": paperID,
		"revision": revision, "class": "immutable",
	}, "", 200))
	if read["ownerHost"] != paperdomain.Host || read["digest"] != digest {
		t.Fatalf("read %#v", read)
	}
	observe := map[string]any{
		"binding": map[string]any{"kind": "control_plane_run", "ownerHost": "control-plane", "project": "lab", "id": runID, "generation": generation, "scope": "lab"},
		"request": map[string]any{"operation": "cancel", "requestId": "cancel-" + runID, "inputHash": "hash-a", "generation": generation},
	}
	first := parse[map[string]any](t, request(t, server, "POST", "/api/client/v1/projects/lab/runs/observe", token, observe, "", 200))
	if first["effect"] != "cancel_owner" {
		t.Fatalf("cancel %#v", first)
	}
	restarted := httptest.NewServer(httpapi.ServerHandler(db, "operator-token", httpapi.ServerOptions{Paper: &httpapi.PersistedPaper{DB: db}}))
	t.Cleanup(restarted.Close)
	reread := parse[map[string]any](t, request(t, restarted, "POST", "/api/client/v1/projects/lab/app-resources/paper", token, map[string]any{
		"ownerHost": paperdomain.Host, "sharedProject": "lab", "localProject": "lab", "app": "paper-agent",
		"appInstance": "paper-agent@" + paperdomain.Host, "appVersion": "1", "kind": "paper", "id": paperID,
		"revision": revision, "class": "immutable",
	}, "", 200))
	if reread["digest"] != digest || reread["ownerHost"] != paperdomain.Host {
		t.Fatalf("reread %#v", reread)
	}
	again := parse[map[string]any](t, request(t, restarted, "POST", "/api/client/v1/projects/lab/runs/observe", token, observe, "", 200))
	if again["outcome"] != "duplicate" || again["effect"] != "none" {
		t.Fatalf("restart %#v", again)
	}
}
