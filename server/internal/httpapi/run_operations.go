package httpapi

import (
	"net/http"
	"strconv"

	"github.com/phodal/pero/server/internal/store"
)

func (a *API) registerRunOperations(mux *http.ServeMux) {
	const run = "/api/client/v1/tasks/{task}/runs/{run}"
	const trial = "/api/client/v1/projects/{project}/trial-submissions/{operation}"
	mux.HandleFunc("GET "+run, a.clientExactRun)
	mux.HandleFunc("POST "+run+"/cancel", a.clientCancelExactRun)
	mux.HandleFunc("GET "+run+"/reconciliation", a.clientRunReconciliation)
	mux.HandleFunc("PUT /api/v1/tasks/{task}/runs/{run}/reconciliation", a.resolveRun)
	mux.HandleFunc("PUT "+trial, a.ensureTrialRun)
	mux.HandleFunc("GET "+trial, a.trialReceipt)
	mux.HandleFunc("POST "+trial+"/cancel", a.cancelTrial)
}

func exactRunRef(w http.ResponseWriter, r *http.Request) (store.RunRef, bool) {
	task, run := r.PathValue("task"), r.PathValue("run")
	generation, err := strconv.ParseInt(r.URL.Query().Get("generation"), 10, 64)
	if !bounded(task, 128) || !bounded(run, 128) || err != nil || generation < 1 {
		invalid(w)
		return store.RunRef{}, false
	}
	return store.RunRef{TaskID: task, RunID: run, Generation: generation}, true
}

func (a *API) clientExactRun(w http.ResponseWriter, r *http.Request) {
	ref, ok := exactRunRef(w, r)
	if !ok {
		return
	}
	run, err := a.db.ClientRun(r.Context(), clientIdentity(r), ref)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, run)
}

func (a *API) clientCancelExactRun(w http.ResponseWriter, r *http.Request) {
	ref, ok := exactRunRef(w, r)
	if !ok || !decode(w, r, &struct{}{}) {
		return
	}
	run, err := a.db.ClientCancelRun(r.Context(), clientIdentity(r), ref)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, run)
}

func (a *API) clientRunReconciliation(w http.ResponseWriter, r *http.Request) {
	ref, ok := exactRunRef(w, r)
	if !ok {
		return
	}
	run, err := a.db.ClientRun(r.Context(), clientIdentity(r), ref)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, struct {
		Reconciliation *store.RunReconciliation `json:"reconciliation"`
	}{Reconciliation: run.Reconciliation()})
}

func (a *API) resolveRun(w http.ResponseWriter, r *http.Request) {
	ref, ok := exactRunRef(w, r)
	var decision store.RunReconciliationDecision
	if !ok || !decode(w, r, &decision) {
		return
	}
	receipt, err := a.db.ResolveRun(r.Context(), ref, decision)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, receipt)
}

func trialOperation(w http.ResponseWriter, r *http.Request) (store.TrialOperation, bool) {
	project, operation := r.PathValue("project"), r.PathValue("operation")
	if !bounded(project, 128) || !bounded(operation, 128) {
		invalid(w)
		return store.TrialOperation{}, false
	}
	op, err := clientIdentity(r).TrialOperation(project, operation)
	if err != nil {
		failure(w, err)
		return store.TrialOperation{}, false
	}
	return op, true
}

func (a *API) ensureTrialRun(w http.ResponseWriter, r *http.Request) {
	op, ok := trialOperation(w, r)
	var input store.TrialInput
	if !ok || !decode(w, r, &input) {
		return
	}
	if input.WorkerID != "" && !bounded(input.WorkerID, 128) {
		invalid(w)
		return
	}
	receipt, err := a.db.EnsureTrialRun(r.Context(), op, input)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, receipt)
}

func (a *API) trialReceipt(w http.ResponseWriter, r *http.Request) {
	op, ok := trialOperation(w, r)
	if !ok {
		return
	}
	receipt, err := a.db.TrialReceipt(r.Context(), op)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, receipt)
}

func (a *API) cancelTrial(w http.ResponseWriter, r *http.Request) {
	op, ok := trialOperation(w, r)
	if !ok || !decode(w, r, &struct{}{}) {
		return
	}
	receipt, err := a.db.CancelTrial(r.Context(), op)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, receipt)
}
