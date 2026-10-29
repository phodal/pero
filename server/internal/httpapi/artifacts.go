package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"mime"
	"net/http"
	"path"
	"strconv"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/store"
)

// ArtifactReader is a trusted storage boundary. It reads only the immutable key
// from an authorized manifest, with a bounded result; it never resolves URLs or
// filesystem paths from HTTP input. The S3 adapter and test fixture implement it.
type ArtifactReader interface {
	Read(context.Context, artifacts.Entry) ([]byte, error)
}

// HandlerWithArtifacts enables authenticated file reads without enabling a
// workload, collector admission, or any public object-storage URL.
func HandlerWithArtifacts(db *store.Store, operatorToken string, reader ArtifactReader) http.Handler {
	return handler(db, operatorToken, nil, reader)
}

// registerArtifacts is called inside the existing operator/client auth router.
// No public community, Worker, or Agent publication route is registered here.
func (a *API) registerArtifacts(mux *http.ServeMux, reader ArtifactReader) {
	// Bound aggregate buffering independently of request concurrency. The first
	// profile does not render active content or expose storage URLs.
	downloads := make(chan struct{}, 2)
	for _, prefix := range []string{"/api/v1", "/api/client/v1"} {
		client := prefix == "/api/client/v1"
		mux.HandleFunc("GET "+prefix+"/runs/{id}/artifacts", func(w http.ResponseWriter, r *http.Request) {
			exports, err := a.authorizedArtifacts(r, client)
			if err != nil {
				failure(w, err)
				return
			}
			views := []artifactView{}
			for _, e := range exports {
				views = append(views, viewArtifact(e))
			}
			respond(w, 200, map[string]any{"artifacts": views})
		})
		mux.HandleFunc("GET "+prefix+"/runs/{id}/artifacts/{export}/files/{file}", func(w http.ResponseWriter, r *http.Request) {
			exports, err := a.authorizedArtifacts(r, client)
			if err != nil {
				failure(w, err)
				return
			}
			var entry *artifacts.Entry
			for _, e := range exports {
				if e.ID == r.PathValue("export") && e.Phase == artifacts.Committed && e.Manifest != nil {
					for _, f := range e.Manifest.Entries {
						if f.ID == r.PathValue("file") {
							copy := f
							entry = &copy
						}
					}
				}
			}
			if entry == nil {
				failure(w, store.ErrNotFound)
				return
			}
			if reader == nil {
				respond(w, 503, map[string]string{"error": "artifact storage is not configured"})
				return
			}
			select {
			case downloads <- struct{}{}:
				defer func() { <-downloads }()
			default:
				respond(w, 429, map[string]string{"error": "artifact download capacity exhausted"})
				return
			}
			body, err := reader.Read(r.Context(), *entry)
			if err != nil {
				failure(w, err)
				return
			}
			hash := sha256.Sum256(body)
			if int64(len(body)) != entry.Bytes || "sha256:"+hex.EncodeToString(hash[:]) != entry.SHA256 {
				failure(w, errors.New("stored artifact integrity mismatch"))
				return
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": path.Base(entry.Path)}))
			w.Header().Set("Content-Length", strconv.Itoa(len(body)))
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
			w.Header().Set("Cache-Control", "private, no-store")
			_, _ = w.Write(body)
		})
	}
}

func (a *API) authorizedArtifacts(r *http.Request, client bool) ([]artifacts.Export, error) {
	if client {
		return a.db.ClientArtifactExports(r.Context(), clientIdentity(r), r.PathValue("id"))
	}
	return a.db.RunArtifactExports(r.Context(), r.PathValue("id"))
}

// HTTP projection intentionally omits private bucket keys and storage identities.
type artifactView struct {
	ID             string             `json:"id"`
	RunID          string             `json:"run_id"`
	Generation     int64              `json:"generation"`
	Phase          string             `json:"phase"`
	ManifestDigest string             `json:"manifest_digest,omitempty"`
	Outcome        string             `json:"outcome,omitempty"`
	Files          []artifactFileView `json:"files"`
	Missing        []string           `json:"missing"`
}
type artifactFileView struct {
	ID     string `json:"id"`
	Path   string `json:"path"`
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
}

func viewArtifact(e artifacts.Export) artifactView {
	v := artifactView{ID: e.ID, RunID: e.Source.RunID, Generation: e.Source.Generation, Phase: e.Phase, Files: []artifactFileView{}, Missing: []string{}}
	if e.Manifest != nil {
		v.ManifestDigest = e.Manifest.Digest
		v.Outcome = e.Manifest.Outcome
		v.Missing = e.Manifest.Missing
		for _, f := range e.Manifest.Entries {
			v.Files = append(v.Files, artifactFileView{ID: f.ID, Path: f.Path, Bytes: f.Bytes, SHA256: f.SHA256})
		}
	}
	return v
}
