package httpapi

import (
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/store"
	"net/http"
)

func (a *API) registerSandbox(mux *http.ServeMux) {
	// /api/v1 is operator-only in the existing authentication middleware. Tasks
	// cannot supply a pool, image, command, workspace path, credential or TTL.
	mux.HandleFunc("POST /api/v1/tasks/{id}/runtime-dispatch", a.runtimeDispatch)
	mux.HandleFunc("GET /api/v1/runs/{id}/runtime", a.runtimeBinding)
	mux.HandleFunc("POST /api/v1/runs/{id}/runtime/reconcile", a.runtimeReconcile)
	mux.HandleFunc("POST /api/v1/runs/{id}/runtime/release", a.runtimeRelease)
}
func (a *API) hasSandbox(w http.ResponseWriter) bool {
	if a.sandbox == nil {
		respond(w, 503, map[string]string{"error": "sandbox runtime is not configured"})
		return false
	}
	return true
}
func (a *API) runtimeDispatch(w http.ResponseWriter, r *http.Request) {
	if !a.hasSandbox(w) {
		return
	}
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	key, ok := idempotency(w, r)
	if !ok {
		return
	}
	if key == "" {
		invalid(w)
		return
	}
	run, binding, err := a.sandbox.Dispatch(r.Context(), r.PathValue("id"), key)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 202, struct {
		Run     *store.Run             `json:"run"`
		Runtime runtimebinding.Binding `json:"runtime"`
	}{run, binding})
}
func (a *API) runtimeBinding(w http.ResponseWriter, r *http.Request) {
	if !a.hasSandbox(w) {
		return
	}
	binding, err := a.sandbox.Binding(r.Context(), r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, binding)
}
func (a *API) runtimeReconcile(w http.ResponseWriter, r *http.Request) {
	if !a.hasSandbox(w) {
		return
	}
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	binding, err := a.sandbox.Reconcile(r.Context(), r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, binding)
}
func (a *API) runtimeRelease(w http.ResponseWriter, r *http.Request) {
	if !a.hasSandbox(w) {
		return
	}
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	binding, err := a.sandbox.Release(r.Context(), r.PathValue("id"))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 202, binding)
}
