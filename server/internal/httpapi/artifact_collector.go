package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/store"
)

type ArtifactObjectStore interface {
	ArtifactReader
	Put(context.Context, artifacts.Entry, io.Reader) error
}

// CollectorAuthenticator must perform online TokenReview for pero-export and
// compare Namespace/SA name+UID/Pod UID with Export.Collector. It is supplied by
// trusted composition, never by an Agent or collector request. Runtime-channel
// credentials and an unsigned/self-decoded JWT are not sufficient authority.
type CollectorAuthenticator func(context.Context, string, string) error
type artifactExportContextKey struct{}

// ArtifactCollectorHandler has its own bounded binary transport; it must be
// mounted before the general client/operator router. Storage credentials stay in
// this trusted process. The collector has only its projected Pod-bound token.
func ArtifactCollectorHandler(db *store.Store, objects ArtifactObjectStore, authenticate CollectorAuthenticator) http.Handler {
	mux := http.NewServeMux()
	uploads := make(chan struct{}, 2)
	exportFor := func(w http.ResponseWriter, r *http.Request) (artifacts.Export, bool) {
		e, ok := r.Context().Value(artifactExportContextKey{}).(artifacts.Export)
		if !ok || e.ID != r.PathValue("id") {
			respond(w, 403, map[string]string{"error": "collector authority unavailable"})
			return e, false
		}
		return e, true
	}
	mux.HandleFunc("GET /api/artifact-export/v1/{id}", func(w http.ResponseWriter, r *http.Request) {
		e, ok := exportFor(w, r)
		if ok {
			respond(w, 200, e)
		}
	})
	mux.HandleFunc("PUT /api/artifact-export/v1/{id}/files/{file}", func(w http.ResponseWriter, r *http.Request) {
		e, ok := exportFor(w, r)
		if !ok {
			return
		}
		if e.Phase != artifacts.Collecting {
			artifactFailure(w, artifacts.ErrNotReady)
			return
		}
		if r.ContentLength < 0 || r.ContentLength > e.Policy.MaxFileBytes {
			artifactFailure(w, artifacts.ErrInvalid)
			return
		}
		select {
		case uploads <- struct{}{}:
			defer func() { <-uploads }()
		default:
			respond(w, 429, map[string]string{"error": "artifact upload capacity exhausted"})
			return
		}
		entry, err := db.ReserveArtifactObject(r.Context(), e.ID, r.PathValue("file"), r.ContentLength, r.Header.Get("X-Artifact-Sha256"))
		if err != nil {
			artifactFailure(w, err)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, e.Policy.MaxFileBytes)
		if err = objects.Put(r.Context(), entry, r.Body); err != nil {
			artifactFailure(w, err)
			return
		}
		if err = db.VerifyArtifactObject(r.Context(), e.ID, entry); err != nil {
			artifactFailure(w, err)
			return
		}
		respond(w, 200, entry)
	})
	mux.HandleFunc("POST /api/artifact-export/v1/{id}/commit", func(w http.ResponseWriter, r *http.Request) {
		e, ok := exportFor(w, r)
		if !ok {
			return
		}
		var m artifacts.Manifest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, artifacts.MaxManifestBytes))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&m) != nil {
			artifactFailure(w, artifacts.ErrInvalid)
			return
		}
		var extra any
		if decoder.Decode(&extra) != io.EOF {
			artifactFailure(w, artifacts.ErrInvalid)
			return
		}
		next, err := db.CommitArtifactManifest(r.Context(), e.ID, e.Version, m)
		if err != nil {
			artifactFailure(w, err)
			return
		}
		respond(w, 200, next)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if db == nil || objects == nil || authenticate == nil {
			respond(w, 503, map[string]string{"error": "artifact collector is not configured"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Minute)
		defer cancel()
		r = r.WithContext(ctx)
		_, pattern := mux.Handler(r)
		if pattern == "" {
			respond(w, 404, map[string]string{"error": "not found"})
			return
		}
		// Match the export ID without decoding untrusted body content. ServeMux
		// sets PathValue only when serving, so a small authenticated wrapper is
		// installed as the dispatch target rather than trusting a header ID.
		parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/artifact-export/v1/"), "/")
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || len(token) == 0 || len(token) > 32<<10 || len(parts) == 0 || parts[0] == "" {
			respond(w, 401, map[string]string{"error": "collector authentication required"})
			return
		}
		if err := authenticate(ctx, token, parts[0]); err != nil {
			respond(w, 403, map[string]string{"error": "collector authority unavailable"})
			return
		}
		e, err := db.ArtifactExport(ctx, parts[0])
		if err != nil {
			artifactFailure(w, err)
			return
		}
		if e.Collector == nil || !e.Collector.ExpiresAt.After(time.Now()) || e.GC != nil {
			respond(w, 403, map[string]string{"error": "collector authority unavailable"})
			return
		}
		// The upload cannot retain authority beyond the original grant merely
		// by starting a long request just before expiration.
		ctx, expire := context.WithDeadline(ctx, e.Collector.ExpiresAt)
		defer expire()
		// A context deadline alone does not interrupt a stalled socket body read
		// or response write. Enforce the same authority limit at the transport.
		deadline, _ := ctx.Deadline()
		controller := http.NewResponseController(w)
		if controller.SetReadDeadline(deadline) != nil || controller.SetWriteDeadline(deadline) != nil {
			respond(w, 503, map[string]string{"error": "bounded artifact transport unavailable"})
			return
		}
		defer controller.SetReadDeadline(time.Time{})
		defer controller.SetWriteDeadline(time.Time{})
		r = r.WithContext(context.WithValue(ctx, artifactExportContextKey{}, e))
		mux.ServeHTTP(w, r)
	})
}

func artifactFailure(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, artifacts.ErrInvalid):
		respond(w, 400, map[string]string{"error": "invalid artifact request"})
	case errors.Is(err, artifacts.ErrConflict), errors.Is(err, artifacts.ErrNotReady):
		respond(w, 409, map[string]string{"error": err.Error()})
	default:
		failure(w, err)
	}
}
