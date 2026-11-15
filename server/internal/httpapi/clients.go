package httpapi

import (
	"net/http"
	"strconv"

	"github.com/phodal/pero/server/internal/store"
)

type clientContextKey struct{}

func clientIdentity(r *http.Request) *store.Client {
	return r.Context().Value(clientContextKey{}).(*store.Client)
}

func (a *API) registerClients(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/me", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"id": "operator", "name": "Operator", "role": "operator", "projects": []string{}})
	})
	mux.HandleFunc("POST /api/v1/clients", a.createClient)
	mux.HandleFunc("GET /api/client/v1/me", func(w http.ResponseWriter, r *http.Request) { respond(w, 200, clientIdentity(r)) })
	mux.HandleFunc("GET /api/client/v1/tasks", a.clientTasks)
	mux.HandleFunc("POST /api/client/v1/tasks", a.clientCreateTask)
	mux.HandleFunc("GET /api/client/v1/workers", a.clientWorkers)
	mux.HandleFunc("POST /api/client/v1/workers", a.enrollWorker)
	mux.HandleFunc("POST /api/client/v1/workers/{id}/disable", a.disableOwnedWorker)
	mux.HandleFunc("GET /api/client/v1/tasks/{id}", a.clientTask)
	mux.HandleFunc("POST /api/client/v1/tasks/{id}/claim", a.claimTask)
	mux.HandleFunc("POST /api/client/v1/tasks/{id}/release", a.releaseTask)
	mux.HandleFunc("POST /api/client/v1/tasks/{id}/dispatch", a.clientDispatch)
	mux.HandleFunc("POST /api/client/v1/tasks/{id}/cancel", a.clientCancel)
}

func (a *API) clientWorkers(w http.ResponseWriter, r *http.Request) {
	workers, err := a.db.ClientWorkers(r.Context(), clientIdentity(r))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, map[string]any{"workers": workers})
}

func (a *API) createClient(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name     string   `json:"name"`
		Projects []string `json:"projects"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !bounded(in.Name, 128) || len(in.Projects) == 0 || len(in.Projects) > 64 {
		invalid(w)
		return
	}
	for _, project := range in.Projects {
		if !bounded(project, 128) {
			invalid(w)
			return
		}
	}
	client, token, err := a.db.CreateClient(r.Context(), in.Name, in.Projects)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 201, map[string]any{"client": client, "token": token})
}

func (a *API) clientTasks(w http.ResponseWriter, r *http.Request) {
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 50 {
			invalid(w)
			return
		}
		limit = value
	}
	cursor := r.URL.Query().Get("cursor")
	if len(cursor) > 128 {
		invalid(w)
		return
	}
	filter, ok := taskFilter(w, r)
	if !ok {
		return
	}
	page, err := a.db.ClientTasks(r.Context(), clientIdentity(r), cursor, limit, filter)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, page)
}

func (a *API) clientTask(w http.ResponseWriter, r *http.Request) {
	task, err := a.db.ClientTask(r.Context(), clientIdentity(r), r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	events := &store.EventTail{Events: []store.Event{}}
	if task.Run != nil {
		events, err = a.db.Events(r.Context(), task.Run.ID)
		if err != nil {
			failure(w, err)
			return
		}
	}
	respond(w, 200, map[string]any{"task": task, "run": task.Run, "events": events.Events, "events_truncated": events.Truncated, "events_first_seq": events.FirstSeq, "events_last_seq": events.LastSeq})
}

func (a *API) claimTask(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	task, err := a.db.ClaimTask(r.Context(), clientIdentity(r), r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, task)
}
func (a *API) releaseTask(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	task, err := a.db.ReleaseTask(r.Context(), clientIdentity(r), r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, task)
}
func (a *API) clientDispatch(w http.ResponseWriter, r *http.Request) {
	var in struct {
		WorkerID string `json:"worker_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.WorkerID != "" && !bounded(in.WorkerID, 128) {
		invalid(w)
		return
	}
	key, ok := idempotency(w, r)
	if !ok {
		return
	}
	run, err := a.db.ClientDispatch(r.Context(), clientIdentity(r), r.PathValue("id"), in.WorkerID, key)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, run)
}
func (a *API) clientCancel(w http.ResponseWriter, r *http.Request) {
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	run, err := a.db.ClientCancel(r.Context(), clientIdentity(r), r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, run)
}

func (a *API) clientCreateTask(w http.ResponseWriter, r *http.Request) {
	var spec store.Spec
	if !decode(w, r, &spec) {
		return
	}
	draft, err := spec.ForClient(clientIdentity(r))
	if err != nil {
		failure(w, err)
		return
	}
	key, ok := idempotency(w, r)
	if !ok {
		return
	}
	task, err := a.db.ClientCreateTask(r.Context(), draft, key)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 201, task)
}
