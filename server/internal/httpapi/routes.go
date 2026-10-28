package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	gh "github.com/phodal/pero/server/internal/github"
	"github.com/phodal/pero/server/internal/store"
)

type API struct {
	db           *store.Store
	operatorHash [32]byte
	github       *gh.Service
}
type contextKey struct{}

func Handler(db *store.Store, operatorToken string, services ...*gh.Service) http.Handler {
	a := &API{db: db, operatorHash: sha256.Sum256([]byte(operatorToken))}
	if len(services) > 0 {
		a.github = services[0]
	}
	mux := http.NewServeMux()
	a.registerClients(mux)
	a.registerContributions(mux)
	a.registerGitHub(mux)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(r.Context()); err != nil {
			respond(w, 503, map[string]string{"status": "unavailable"})
			return
		}
		respond(w, 200, map[string]string{"status": "ok", "scope": "remote-dispatch"})
	})
	mux.HandleFunc("GET /api/v1/tasks", a.tasks)
	mux.HandleFunc("POST /api/v1/tasks", a.createTask)
	mux.HandleFunc("GET /api/v1/tasks/{id}", a.task)
	mux.HandleFunc("POST /api/v1/tasks/{id}/dispatch", a.dispatch)
	mux.HandleFunc("POST /api/v1/tasks/{id}/cancel", a.cancel)
	mux.HandleFunc("GET /api/v1/workers", a.workers)
	mux.HandleFunc("POST /api/v1/workers", a.createWorker)
	mux.HandleFunc("POST /api/worker/v1/claims", a.claim)
	mux.HandleFunc("GET /api/worker/v1/runs/{id}", a.workerRun)
	mux.HandleFunc("POST /api/worker/v1/runs/{id}/renew", a.renew)
	mux.HandleFunc("POST /api/worker/v1/runs/{id}/events", a.events)
	mux.HandleFunc("POST /api/worker/v1/runs/{id}/complete", a.complete)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		r = r.WithContext(ctx)
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if r.URL.Path == "/healthz" {
			mux.ServeHTTP(w, r)
			return
		}
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || token == "" || len(token) > 512 {
			respond(w, 401, map[string]string{"error": "authentication required"})
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/client/") {
			client, err := db.AuthenticateClient(ctx, token)
			if err != nil {
				respond(w, 401, map[string]string{"error": "invalid client credentials"})
				return
			}
			r = r.WithContext(context.WithValue(ctx, clientContextKey{}, client))
		} else if strings.HasPrefix(r.URL.Path, "/api/worker/") {
			worker, err := db.AuthenticateWorker(ctx, token)
			if err != nil {
				respond(w, 401, map[string]string{"error": "invalid worker credentials"})
				return
			}
			r = r.WithContext(context.WithValue(ctx, contextKey{}, worker))
		} else {
			hash := sha256.Sum256([]byte(token))
			if subtle.ConstantTimeCompare(hash[:], a.operatorHash[:]) != 1 {
				respond(w, 401, map[string]string{"error": "invalid operator credentials"})
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	e := json.NewEncoder(w)
	e.SetEscapeHTML(false)
	_ = e.Encode(value)
}
func failure(w http.ResponseWriter, err error) {
	status := 500
	message := "request failed"
	var pgError *pgconn.PgError
	switch {
	case errors.As(err, &pgError) && strings.HasPrefix(pgError.Code, "22"):
		status = 400
		message = "request contains a value that cannot be stored"
	case errors.Is(err, store.ErrNotFound):
		status = 404
		message = err.Error()
	case errors.Is(err, store.ErrContributionInput):
		status = 400
		message = err.Error()
	case errors.Is(err, store.ErrForbidden):
		status = 403
		message = err.Error()
	case errors.Is(err, store.ErrConflict), errors.Is(err, store.ErrLease):
		status = 409
		message = err.Error()
	case errors.Is(err, context.DeadlineExceeded):
		status = 504
		message = "request timed out"
	default:
		log.Printf("control-plane request: %v", err)
	}
	respond(w, status, map[string]string{"error": message})
}
func decode(w http.ResponseWriter, r *http.Request, target any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 512*1024)
	body, err := io.ReadAll(r.Body)
	if err != nil || len(bytes.TrimSpace(body)) == 0 || bytes.TrimSpace(body)[0] != '{' {
		respond(w, 400, map[string]string{"error": "expected a bounded JSON object"})
		return false
	}
	d := json.NewDecoder(bytes.NewReader(body))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		respond(w, 400, map[string]string{"error": "invalid JSON request or request exceeds limit"})
		return false
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		respond(w, 400, map[string]string{"error": "expected one JSON object"})
		return false
	}
	return true
}
func invalid(w http.ResponseWriter) {
	respond(w, 400, map[string]string{"error": "required fields are missing or exceed limits"})
}
func bounded(value string, max int) bool {
	return strings.TrimSpace(value) != "" && utf8.RuneCountInString(value) <= max && !strings.ContainsRune(value, 0)
}
func idempotency(w http.ResponseWriter, r *http.Request) (string, bool) {
	key := r.Header.Get("Idempotency-Key")
	if len(key) > 128 {
		invalid(w)
		return "", false
	}
	return key, true
}
func workerID(r *http.Request) string { return r.Context().Value(contextKey{}).(string) }

func (a *API) tasks(w http.ResponseWriter, r *http.Request) {
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
	page, err := a.db.Tasks(r.Context(), cursor, limit, filter)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, page)
}
func (a *API) createTask(w http.ResponseWriter, r *http.Request) {
	var spec store.Spec
	if !decode(w, r, &spec) {
		return
	}
	if !bounded(spec.Title, 240) || !bounded(spec.Prompt, 64000) || !bounded(spec.Acceptance, 16000) || !bounded(spec.ProjectID, 128) || !bounded(spec.WorkspaceKey, 128) || !bounded(spec.AgentID, 128) {
		invalid(w)
		return
	}
	key, ok := idempotency(w, r)
	if !ok {
		return
	}
	task, err := a.db.CreateTask(r.Context(), spec, key)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 201, task)
}
func (a *API) task(w http.ResponseWriter, r *http.Request) {
	task, err := a.db.Task(r.Context(), r.PathValue("id"))
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
func (a *API) dispatch(w http.ResponseWriter, r *http.Request) {
	var in struct {
		WorkerID string `json:"worker_id"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.WorkerID) > 128 {
		invalid(w)
		return
	}
	key, ok := idempotency(w, r)
	if !ok {
		return
	}
	run, err := a.db.Dispatch(r.Context(), r.PathValue("id"), in.WorkerID, key)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, run)
}
func (a *API) cancel(w http.ResponseWriter, r *http.Request) {
	run, err := a.db.Cancel(r.Context(), r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, run)
}
func (a *API) workers(w http.ResponseWriter, r *http.Request) {
	workers, err := a.db.Workers(r.Context())
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, map[string]any{"workers": workers})
}
func (a *API) createWorker(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name     string   `json:"name"`
		Projects []string `json:"projects"`
		Labels   []string `json:"labels"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !bounded(in.Name, 128) || len(in.Projects) == 0 || len(in.Projects) > 64 || len(in.Labels) > 64 {
		invalid(w)
		return
	}
	for _, v := range append(append([]string{}, in.Projects...), in.Labels...) {
		if !bounded(v, 128) {
			invalid(w)
			return
		}
	}
	worker, token, err := a.db.CreateWorker(r.Context(), in.Name, in.Projects, in.Labels)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 201, map[string]any{"worker": worker, "token": token})
}
