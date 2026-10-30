package httpapi

import (
	"net/http"
	"unicode/utf8"

	"github.com/phodal/pero/server/internal/store"
)

type executionInput struct {
	Generation int64  `json:"generation"`
	InstanceID string `json:"instance_id"`
}

func validExecution(in executionInput) bool { return in.Generation > 0 && bounded(in.InstanceID, 128) }

func (a *API) claim(w http.ResponseWriter, r *http.Request) {
	var in struct {
		RequestID     string `json:"request_id"`
		InstanceID    string `json:"instance_id"`
		RuntimePodUID string `json:"runtime_pod_uid,omitempty"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !bounded(in.RequestID, 128) || !bounded(in.InstanceID, 128) || in.RuntimePodUID != "" && !bounded(in.RuntimePodUID, 128) {
		invalid(w)
		return
	}
	run, err := a.db.Claim(r.Context(), workerID(r), in.InstanceID, in.RequestID, in.RuntimePodUID)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, map[string]any{"run": run})
}

func (a *API) workerRun(w http.ResponseWriter, r *http.Request) {
	instance := r.URL.Query().Get("instance_id")
	if !bounded(instance, 128) {
		invalid(w)
		return
	}
	run, err := a.db.WorkerRun(r.Context(), r.PathValue("id"), workerID(r), instance)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, run)
}

func (a *API) renew(w http.ResponseWriter, r *http.Request) {
	var in executionInput
	if !decode(w, r, &in) {
		return
	}
	if !validExecution(in) {
		invalid(w)
		return
	}
	cancelled, expiry, err := a.db.Renew(r.Context(), r.PathValue("id"), workerID(r), in.InstanceID, in.Generation)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, map[string]any{"cancel_requested": cancelled, "lease_expires_at": expiry})
}

func (a *API) events(w http.ResponseWriter, r *http.Request) {
	var in struct {
		executionInput
		Events []store.Event `json:"events"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !validExecution(in.executionInput) || len(in.Events) == 0 || len(in.Events) > 64 {
		invalid(w)
		return
	}
	for _, e := range in.Events {
		if e.Seq <= 0 || !bounded(e.Kind, 128) || len(e.Text) > 64000 || len(e.Data) > 64000 {
			invalid(w)
			return
		}
	}
	last, err := a.db.AppendEvents(r.Context(), r.PathValue("id"), workerID(r), in.InstanceID, in.Generation, in.Events)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, map[string]any{"accepted": len(in.Events), "last_seq": last})
}

func (a *API) complete(w http.ResponseWriter, r *http.Request) {
	var in struct {
		executionInput
		store.Completion
	}
	if !decode(w, r, &in) {
		return
	}
	if !validExecution(in.executionInput) || utf8.RuneCountInString(in.Summary) > 16000 {
		invalid(w)
		return
	}
	switch in.Outcome {
	case "succeeded", "failed", "cancelled", "reconcile":
	default:
		invalid(w)
		return
	}
	run, err := a.db.Complete(r.Context(), r.PathValue("id"), workerID(r), in.InstanceID, in.Generation, in.Completion)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, run)
}
