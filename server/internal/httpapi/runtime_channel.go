package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	gh "github.com/phodal/pero/server/internal/github"
	"github.com/phodal/pero/server/internal/runtimeauth"
	"github.com/phodal/pero/server/internal/runtimegateway"
	"github.com/phodal/pero/server/internal/sandbox"
	"github.com/phodal/pero/server/internal/store"
)

// HandlerWithIsolatedRuntime keeps streaming transports outside the ordinary
// 10-second JSON middleware. Each transport owns its own narrow auth and limits.
func HandlerWithIsolatedRuntime(db *store.Store, token string, runtime *sandbox.Runtime, gateway *runtimegateway.Gateway, reviewer *runtimeauth.Reviewer, objects ArtifactObjectStore, services ...*gh.Service) http.Handler {
	ordinary := configuredHandler(db, token, runtime, objects, gateway, services...)
	collector := ArtifactCollectorHandler(db, objects, func(ctx context.Context, token, exportID string) error {
		if reviewer == nil {
			return artifacts.ErrNotReady
		}
		identity, err := reviewer.Review(ctx, token, "pero-export")
		if err != nil {
			return err
		}
		e, err := db.ArtifactExport(ctx, exportID)
		if err != nil {
			return err
		}
		a := e.Collector
		if a == nil && e.GC == nil && e.CollectorJob != nil {
			j := e.CollectorJob
			if j.ExpiresAt.After(time.Now()) && j.Namespace == identity.Namespace && j.ServiceAccount == identity.ServiceAccount && j.ServiceAccountUID == identity.ServiceAccountUID && identity.Audience == artifacts.CollectorAudience {
				return ErrCollectorPending
			}
		}
		if a == nil || !a.ExpiresAt.After(time.Now()) || a.Namespace != identity.Namespace || a.ServiceAccount != identity.ServiceAccount || a.ServiceAccountUID != identity.ServiceAccountUID || a.PodUID != identity.PodUID || a.Audience != identity.Audience {
			return artifacts.ErrNotReady
		}
		return nil
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/artifact-export/") {
			collector.ServeHTTP(w, r)
			return
		}
		ordinary.ServeHTTP(w, r)
	})
}
func (a *API) runtimeChannel(w http.ResponseWriter, r *http.Request) {
	if a.gateway == nil {
		respond(w, 503, map[string]string{"error": "isolated runtime disabled"})
		return
	}
	var in struct {
		Generation int64  `json:"generation"`
		InstanceID string `json:"instance_id"`
		SessionID  string `json:"session_id"`
		Secret     string `json:"secret"`
	}
	if !decode(w, r, &in) {
		return
	}
	channel, err := a.db.ReserveRuntimeChannel(r.Context(), r.PathValue("id"), workerID(r), in.InstanceID, in.Generation, in.SessionID, in.Secret, a.gateway.Budget())
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, map[string]string{"session_id": channel.Scope.SessionID})
}
