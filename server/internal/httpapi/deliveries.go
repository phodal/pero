package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"unicode/utf8"

	"github.com/phodal/pero/server/internal/store"
)

func (a *API) registerDeliveries(mux *http.ServeMux, reader ArtifactReader) {
	const route = "/api/client/v1/projects/{project}/coding-deliveries"
	mux.HandleFunc("GET "+route, a.listDeliveries)
	mux.HandleFunc("POST "+route, a.writeDelivery)
	mux.HandleFunc("GET "+route+"/{delivery}", a.readDelivery)
	mux.HandleFunc("PUT "+route+"/{delivery}", a.writeDelivery)
	downloads := make(chan struct{}, 2)
	mux.HandleFunc("GET "+route+"/{delivery}/evidence/{kind}", func(w http.ResponseWriter, r *http.Request) {
		entry, err := a.db.ClientDeliveryEvidence(r.Context(), clientIdentity(r), r.PathValue("project"), r.PathValue("delivery"), r.PathValue("kind"))
		if err != nil {
			failure(w, err)
			return
		}
		const maxPreview = 128 * 1024
		if entry.Bytes > maxPreview {
			respond(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "evidence exceeds the text preview limit"})
			return
		}
		if reader == nil {
			respond(w, http.StatusServiceUnavailable, map[string]string{"error": "artifact storage is not configured"})
			return
		}
		select {
		case downloads <- struct{}{}:
			defer func() { <-downloads }()
		default:
			respond(w, http.StatusTooManyRequests, map[string]string{"error": "artifact download capacity exhausted"})
			return
		}
		body, err := reader.Read(r.Context(), entry)
		if err != nil {
			failure(w, err)
			return
		}
		digest := sha256.Sum256(body)
		if int64(len(body)) != entry.Bytes || "sha256:"+hex.EncodeToString(digest[:]) != entry.SHA256 {
			respond(w, http.StatusBadGateway, map[string]string{"error": "artifact size or digest mismatch"})
			return
		}
		if !utf8.Valid(body) {
			respond(w, http.StatusUnsupportedMediaType, map[string]string{"error": "evidence is not UTF-8 text"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		respond(w, 200, struct {
			Path    string `json:"path"`
			SHA256  string `json:"sha256"`
			Content string `json:"content"`
		}{entry.Path, entry.SHA256, string(body)})
	})
}

func (a *API) listDeliveries(w http.ResponseWriter, r *http.Request) {
	before := r.URL.Query().Get("before")
	result, err := a.db.ClientDeliveries(r.Context(), clientIdentity(r), r.PathValue("project"), before)
	if err != nil {
		failure(w, err)
		return
	}
	if before != "" {
		respond(w, 200, result)
		return
	}
	choices, err := a.db.ClientDeliveryRunChoices(r.Context(), clientIdentity(r), r.PathValue("project"))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, struct {
		store.DeliveryPage
		Runs []store.DeliveryRunChoice `json:"runs"`
	}{result, choices})
}

func (a *API) readDelivery(w http.ResponseWriter, r *http.Request) {
	result, err := a.db.ClientDelivery(r.Context(), clientIdentity(r), r.PathValue("project"), r.PathValue("delivery"))
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, result)
}

func (a *API) writeDelivery(w http.ResponseWriter, r *http.Request) {
	var manifest store.DeliveryManifest
	if !decode(w, r, &manifest) {
		return
	}
	request, ok := idempotency(w, r)
	if !ok {
		return
	}
	result, err := a.db.ClientWriteDelivery(r.Context(), clientIdentity(r), r.PathValue("project"), r.PathValue("delivery"), request, manifest)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, result)
}
