package httpapi

import (
	"net/http"

	"github.com/phodal/pero/server/internal/projectsource"
)

func (a *API) saveProjectWebSource(w http.ResponseWriter, r *http.Request) {
	project := r.PathValue("project")
	if !projectsource.ValidProjectID(project) {
		invalid(w)
		return
	}
	var draft projectsource.Draft
	if !decode(w, r, &draft) {
		return
	}
	source, err := projectsource.Review(draft)
	if err != nil {
		respond(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	saved, err := a.db.ClientSaveWebSource(r.Context(), clientIdentity(r), project, source)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, http.StatusOK, struct {
		ProjectID string                `json:"projectId"`
		Receipt   projectsource.Summary `json:"sourceReceipt"`
	}{project, saved})
}

func (a *API) listProjectWebSources(w http.ResponseWriter, r *http.Request) {
	project := r.PathValue("project")
	if !projectsource.ValidProjectID(project) {
		invalid(w)
		return
	}
	sources, err := a.db.ClientWebSources(r.Context(), clientIdentity(r), project)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, http.StatusOK, struct {
		Sources []projectsource.Summary `json:"sources"`
	}{sources})
}

func (a *API) readProjectWebSource(w http.ResponseWriter, r *http.Request) {
	project := r.PathValue("project")
	id, valid := projectsource.ParseCaptureID(r.PathValue("capture"))
	if !valid || !projectsource.ValidProjectID(project) {
		invalid(w)
		return
	}
	source, err := a.db.ClientWebSource(r.Context(), clientIdentity(r), project, id)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, http.StatusOK, struct {
		Source projectsource.Snapshot `json:"source"`
	}{source})
}
