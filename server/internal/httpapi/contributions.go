package httpapi

import (
	"net/http"
	"strconv"

	"github.com/phodal/pero/server/internal/store"
)

func (a *API) registerContributions(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/client/v1/contributions", func(w http.ResponseWriter, r *http.Request) {
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
		page, err := a.db.Contributions(r.Context(), clientIdentity(r), cursor, limit)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, page)
	})
	mux.HandleFunc("GET /api/client/v1/contributions/{id}", func(w http.ResponseWriter, r *http.Request) {
		c, err := a.db.Contribution(r.Context(), clientIdentity(r), r.PathValue("id"))
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, c)
	})
	mux.HandleFunc("POST /api/client/v1/contributions/{id}/claim", func(w http.ResponseWriter, r *http.Request) {
		var in struct{}
		if !decode(w, r, &in) {
			return
		}
		c, err := a.db.ClaimContribution(r.Context(), clientIdentity(r), r.PathValue("id"))
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, c)
	})
	mux.HandleFunc("POST /api/client/v1/contributions/{id}/release", func(w http.ResponseWriter, r *http.Request) {
		var in struct{}
		if !decode(w, r, &in) {
			return
		}
		c, err := a.db.ReleaseContribution(r.Context(), clientIdentity(r), r.PathValue("id"))
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, c)
	})
	mux.HandleFunc("POST /api/client/v1/contributions/{id}/pull-request", func(w http.ResponseWriter, r *http.Request) {
		var in struct {
			URL            string `json:"url"`
			Branch         string `json:"branch"`
			HeadSHA        string `json:"head_sha"`
			SourceRevision string `json:"source_revision"`
		}
		if !decode(w, r, &in) {
			return
		}
		pr, err := store.ParsePullRequest(in.URL, in.Branch, in.HeadSHA, in.SourceRevision)
		if err != nil {
			respond(w, 400, map[string]string{"error": err.Error()})
			return
		}
		c, err := a.db.SubmitContribution(r.Context(), clientIdentity(r), r.PathValue("id"), pr)
		if err != nil {
			failure(w, err)
			return
		}
		respond(w, 200, c)
	})
}
