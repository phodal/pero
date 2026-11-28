package httpapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/phodal/pero/server/internal/runlifecycle"
	"github.com/phodal/pero/server/internal/store"
)

type memoryRun struct {
	mu       sync.Mutex
	owner    runlifecycle.Owner
	ledger   []runlifecycle.Receipt
	applies  int
	cancels  int
	approves int
}

func (m *memoryRun) View(string) (runlifecycle.Owner, []runlifecycle.Receipt, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	owner := m.owner
	owner.ApprovalRecorded = m.approves > 0
	ledger := append([]runlifecycle.Receipt(nil), m.ledger...)
	return owner, ledger, true
}

func (m *memoryRun) Commit(_ string, receipt runlifecycle.Receipt, effect string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ledger = append(m.ledger, receipt)
	switch effect {
	case runlifecycle.EffectApply:
		m.applies++
		m.owner.Known = true
	case runlifecycle.EffectCancel:
		m.cancels++
	case runlifecycle.EffectApprove:
		m.approves++
	}
}

func TestTwoClientsObserveOneRun(t *testing.T) {
	source := &memoryRun{owner: runlifecycle.Owner{
		OwnerHost: "host-a", Live: true, Status: "running", Events: []uint64{1, 2, 3},
		RetainedFrom: 1, Generation: 2, SupportsCancel: true, SupportsApprove: true,
	}}
	api := &API{runs: source}
	desktop := postRun(t, api, "lab", []string{"lab"}, runBody("status", "watch-1", "hash-a", false))
	other := postRun(t, api, "lab", []string{"lab"}, runBody("lookup", "watch-2", "hash-a", false))
	if desktop["status"] != "running" || other["status"] != desktop["status"] || desktop["effect"] != "none" || source.applies != 0 {
		t.Fatalf("desktop %#v other %#v applies %d", desktop, other, source.applies)
	}
	first := postRun(t, api, "lab", []string{"lab"}, runBody("start", "submit-1", "hash-a", false))
	second := postRun(t, api, "lab", []string{"lab"}, runBody("start", "submit-1", "hash-a", false))
	if first["effect"] != "apply_once" || second["outcome"] != "duplicate" || source.applies != 1 {
		t.Fatalf("first %#v second %#v applies %d", first, second, source.applies)
	}
	changed := runBody("start", "submit-1", "hash-b", false)
	code, body := postRunStatus(t, api, "lab", []string{"lab"}, changed)
	if code != 409 || body["outcome"] != "conflict" || source.applies != 1 {
		t.Fatalf("conflict %d %#v", code, body)
	}
	closed := runBody("cancel", "close-1", "hash-a", true)
	code, body = postRunStatus(t, api, "lab", []string{"lab"}, closed)
	if code != 200 || body["outcome"] != "transport_abort" || body["status"] != "running" || source.cancels != 0 {
		t.Fatalf("closed %d %#v cancels %d", code, body, source.cancels)
	}
	cancelled := postRun(t, api, "lab", []string{"lab"}, runBody("cancel", "cancel-1", "hash-a", false))
	again := postRun(t, api, "lab", []string{"lab"}, runBody("cancel", "cancel-1", "hash-a", false))
	if cancelled["effect"] != "cancel_owner" || again["outcome"] != "duplicate" || source.cancels != 1 || source.owner.Status != "running" {
		t.Fatalf("cancel %#v again %#v count %d", cancelled, again, source.cancels)
	}
	approved := postRun(t, api, "lab", []string{"lab"}, runBody("approve", "approve-1", "hash-a", false))
	repeat := postRun(t, api, "lab", []string{"lab"}, runBody("approve", "approve-2", "hash-a", false))
	if approved["effect"] != "approve_owner" || repeat["outcome"] != "duplicate" || source.approves != 1 {
		t.Fatalf("approve %#v repeat %#v count %d", approved, repeat, source.approves)
	}
	code, body = postRunStatus(t, api, "other", []string{"lab", "other"}, runBody("status", "watch-3", "hash-a", false))
	if code != 403 || body["outcome"] != "wrong_project" {
		t.Fatalf("project %d %#v", code, body)
	}
	code, body = postRunStatus(t, api, "lab", nil, runBody("status", "watch-4", "hash-a", false))
	if code != 403 || body["outcome"] != "revoked" {
		t.Fatalf("revoked %d %#v", code, body)
	}
}

func runBody(operation, requestID, hash string, closed bool) map[string]any {
	return map[string]any{
		"binding": map[string]any{"kind": "control_plane_run", "ownerHost": "host-a", "project": "lab", "id": "run-1", "generation": 2, "scope": "lab"},
		"request": map[string]any{"operation": operation, "requestId": requestID, "inputHash": hash, "generation": 2, "consumerClosed": closed},
	}
}

func postRun(t *testing.T, api *API, project string, projects []string, body map[string]any) map[string]any {
	t.Helper()
	code, payload := postRunStatus(t, api, project, projects, body)
	if code != 200 {
		t.Fatalf("status %d %#v", code, payload)
	}
	return payload
}

func postRunStatus(t *testing.T, api *API, project string, projects []string, body map[string]any) (int, map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/"+project+"/runs/observe", strings.NewReader(string(encoded)))
	req.SetPathValue("project", project)
	req = req.WithContext(context.WithValue(req.Context(), clientContextKey{}, &store.Client{ID: "client", Projects: projects, Role: "client"}))
	rec := httptest.NewRecorder()
	api.observeRun(rec, req)
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(rec.Body.String())
	}
	return rec.Code, payload
}
