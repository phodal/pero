package httpapi

import (
	"context"
	"net/http"
	"strconv"
	"time"

	"github.com/phodal/pero/server/internal/campaign"
	"github.com/phodal/pero/server/internal/campaignruntime"
	"github.com/phodal/pero/server/internal/store"
)

type ResearchCampaigns struct {
	Temporal       campaignruntime.Temporal
	RunnerClientID string
}

type campaignView struct {
	store.CampaignRecord
	Phase    campaign.Phase     `json:"phase"`
	Progress *campaign.Progress `json:"progress,omitempty"`
}

func (a *API) registerCampaigns(mux *http.ServeMux) {
	if a.campaigns == nil {
		return
	}
	const base = "/api/client/v1/projects/{project}/campaigns"
	mux.HandleFunc("POST "+base, a.startCampaign)
	mux.HandleFunc("GET "+base+"/{campaign}", a.readCampaign)
	mux.HandleFunc("POST "+base+"/{campaign}/cancel", a.cancelCampaign)
	const runner = "/api/client/v1/campaign-runtime/{campaign}"
	mux.HandleFunc("POST "+runner+"/trials/{index}/{action}", a.campaignTrial)
	mux.HandleFunc("PUT "+runner+"/result", a.campaignResult)
}

func (a *API) startCampaign(w http.ResponseWriter, r *http.Request) {
	project := r.PathValue("project")
	request := r.Header.Get("Idempotency-Key")
	if !bounded(project, 128) || len(request) > 128 || !bounded(request, 128) {
		invalid(w)
		return
	}
	var input struct {
		Trials []store.TrialInput `json:"trials"`
	}
	if !decode(w, r, &input) {
		return
	}
	ctx := r.Context()
	record, err := a.db.AdmitCampaign(ctx, clientIdentity(r), project, request, a.campaigns.RunnerClientID, input.Trials)
	if err != nil {
		failure(w, err)
		return
	}
	// Keep the committed intent readable even if the caller lost the reply or
	// Temporal could not acknowledge the start.
	if record.WorkflowRunID == "" && record.Result == nil {
		id, err := a.campaigns.Temporal.Start(ctx, record.Plan)
		if err != nil {
			respond(w, 202, campaignView{CampaignRecord: record, Phase: campaign.Starting})
			return
		}
		record, err = a.db.MarkCampaignStarted(ctx, record.Plan.ID, id)
		if err != nil {
			failure(w, err)
			return
		}
	}
	phase := campaign.Accepted
	if record.Result != nil {
		phase = campaign.Done
	}
	respond(w, 200, campaignView{CampaignRecord: record, Phase: phase})
}

func (a *API) readCampaign(w http.ResponseWriter, r *http.Request) {
	project, id := r.PathValue("project"), r.PathValue("campaign")
	if !bounded(project, 128) || !bounded(id, 128) {
		invalid(w)
		return
	}
	record, err := a.db.ClientCampaign(r.Context(), clientIdentity(r), project, id)
	if err != nil {
		failure(w, err)
		return
	}
	view := campaignView{CampaignRecord: record}
	switch {
	case record.Result != nil:
		view.Phase = campaign.Done
	case record.WorkflowRunID == "":
		view.Phase = campaign.Starting
	default:
		view.Phase = campaign.Unavailable
		state, err := a.campaigns.Temporal.Progress(r.Context(), record.Plan.ID)
		if err == nil {
			view.Phase, view.Progress = state.Phase, &state
		}
	}
	respond(w, 200, view)
}

func (a *API) cancelCampaign(w http.ResponseWriter, r *http.Request) {
	project, id := r.PathValue("project"), r.PathValue("campaign")
	if !bounded(project, 128) || !bounded(id, 128) {
		invalid(w)
		return
	}
	if !decode(w, r, &struct{}{}) {
		return
	}
	record, err := a.db.RequestCampaignCancel(r.Context(), clientIdentity(r), project, id)
	if err != nil {
		failure(w, err)
		return
	}
	if record.Result != nil {
		respond(w, 200, campaignView{CampaignRecord: record, Phase: campaign.Done})
		return
	}
	if record.WorkflowRunID != "" {
		// Wake a parked Workflow. Its next Activity will also see the durable
		// cancellation if this signal could not be delivered.
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		_ = a.campaigns.Temporal.Cancel(ctx, record.Plan.ID)
	}
	respond(w, 202, campaignView{CampaignRecord: record, Phase: campaign.Cancelling})
}

func (a *API) campaignTrial(w http.ResponseWriter, r *http.Request) {
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil {
		invalid(w)
		return
	}
	cmd := campaign.TrialCommand{CampaignID: r.PathValue("campaign"), Index: index, Action: campaign.Action(r.PathValue("action"))}
	trial, err := a.db.CampaignTrial(r.Context(), clientIdentity(r), cmd)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, trial)
}

func (a *API) campaignResult(w http.ResponseWriter, r *http.Request) {
	var result campaign.Progress
	if !decode(w, r, &result) {
		return
	}
	if err := a.db.FinishCampaign(r.Context(), clientIdentity(r), r.PathValue("campaign"), result); err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, struct{}{})
}
