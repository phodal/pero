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
	project  string
	owner    runlifecycle.Owner
	ledger   []runlifecycle.Receipt
	applies  int
	cancels  int
	approves int
}

func (m *memoryRun) Decide(_ context.Context, _ *store.Client, project string, member bool, binding runlifecycle.Binding, request runlifecycle.Request) (runlifecycle.Observation, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.project != project {
		return runlifecycle.Observation{}, false
	}
	owner := m.owner
	owner.Project = m.project
	owner.ApprovalRecorded = m.approves > 0
	ledger := append([]runlifecycle.Receipt(nil), m.ledger...)
	observation := runlifecycle.Observe(member, project, binding, request, owner, ledger)
	if observation.Effect != runlifecycle.EffectNone {
		m.ledger = append(m.ledger, runlifecycle.Receipt{RequestID: request.RequestID, Operation: request.Operation, InputHash: request.InputHash, Outcome: observation.Outcome})
		switch observation.Effect {
		case runlifecycle.EffectApply:
			m.applies++
			m.owner.Known = true
		case runlifecycle.EffectCancel:
			m.cancels++
		case runlifecycle.EffectApprove:
			m.approves++
		}
	}
	return observation, true
}

func TestTwoClientsObserveOneRun(t *testing.T) {
	source := &memoryRun{project: "lab", owner: runlifecycle.Owner{
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
	forgedProject := runBody("status", "watch-3", "hash-a", false)
	forgedProject["binding"].(map[string]any)["project"] = "nope"
	code, body = postRunStatus(t, api, "lab", []string{"lab"}, forgedProject)
	if code != 403 || body["outcome"] != "wrong_project" || body["status"] != nil {
		t.Fatalf("project %d %#v", code, body)
	}
	code, body = postRunStatus(t, api, "lab", nil, runBody("cancel", "close-outsider", "hash-a", true))
	if code != 403 || body["outcome"] != "revoked" || body["status"] != nil || body["cursor"] != nil || source.cancels != 1 {
		t.Fatalf("closed outsider %d %#v cancels %d", code, body, source.cancels)
	}
	foreign := &memoryRun{project: "other", owner: source.owner}
	foreignAPI := &API{runs: foreign}
	forged := runBody("cancel", "steal", "hash-a", false)
	forged["binding"].(map[string]any)["project"] = "lab"
	code, body = postRunStatus(t, foreignAPI, "lab", []string{"lab"}, forged)
	if code != 404 || body["status"] != nil || foreign.cancels != 0 {
		t.Fatalf("forged %d %#v", code, body)
	}
	stale := runBody("cancel", "stale-gen", "hash-a", false)
	stale["binding"].(map[string]any)["generation"] = 0
	code, body = postRunStatus(t, api, "lab", []string{"lab"}, stale)
	if code != 409 || body["outcome"] != "generation_changed" || body["status"] != nil || source.cancels != 1 {
		t.Fatalf("generation %d %#v cancels %d", code, body, source.cancels)
	}
	raceSource := &memoryRun{project: "lab", owner: runlifecycle.Owner{
		OwnerHost: "host-a", Live: true, Status: "running", Events: []uint64{1, 2, 3},
		RetainedFrom: 1, Generation: 2, SupportsCancel: true,
	}}
	raceAPI := &API{runs: raceSource}
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			postRunStatus(t, raceAPI, "lab", []string{"lab"}, runBody("start", "race-1", "hash-a", false))
		}()
	}
	wg.Wait()
	if raceSource.applies != 1 {
		t.Fatalf("applies %d", raceSource.applies)
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
