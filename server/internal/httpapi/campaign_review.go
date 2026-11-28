package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"

	"github.com/phodal/pero/server/internal/campaign"
	"github.com/phodal/pero/server/internal/campaignruntime"
	"github.com/phodal/pero/server/internal/store"
)

type PyBaMMVerifier struct {
	python, root, digest string
}

func NewPyBaMMVerifier(python, root string) (*PyBaMMVerifier, error) {
	if !filepath.IsAbs(root) || !filepath.IsAbs(python) {
		return nil, errors.New("configure absolute Python and PyBaMM method paths")
	}
	v := &PyBaMMVerifier{python: python, root: root}
	digest, err := v.bundleDigest()
	v.digest = digest
	return v, err
}

func (v *PyBaMMVerifier) bundleDigest() (string, error) {
	h := sha256.New()
	for _, name := range []string{"campaign_check.py", "dispatch.py", "check.py", "contract.py", "bundle.py", "manifest.json", "requirements.lock", "run.py", "reference.jsonl"} {
		data, err := os.ReadFile(filepath.Join(v.root, name))
		if err != nil {
			return "", err
		}
		fmt.Fprintf(h, "%s:%x\n", name, sha256.Sum256(data))
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (a *API) verifyCampaign(w http.ResponseWriter, r *http.Request) {
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil {
		invalid(w)
		return
	}
	ctx := r.Context()
	candidate, prior, err := a.db.CampaignCandidate(ctx, clientIdentity(r), r.PathValue("campaign"), index)
	if err != nil {
		failure(w, err)
		return
	}
	if prior != nil {
		respond(w, 200, prior)
		return
	}
	v := a.campaigns.Verifier
	if v == nil {
		respond(w, 503, map[string]string{"error": "frozen PyBaMM checker is unavailable"})
		return
	}
	digest, err := v.bundleDigest()
	if err != nil || digest != candidate.CheckerDigest {
		respond(w, 503, map[string]string{"error": "frozen PyBaMM checker bundle is unavailable"})
		return
	}
	input, err := json.Marshal(struct {
		*store.EventTail
		Trial store.TrialInput `json:"trial"`
		Run   *store.Run       `json:"run"`
	}{candidate.Events, candidate.Trial, candidate.Run})
	if err != nil {
		failure(w, err)
		return
	}
	command := exec.CommandContext(ctx, v.python, "-B", filepath.Join(v.root, "campaign_check.py"))
	command.Stdin = bytes.NewReader(input)
	command.Env = []string{"PYTHONNOUSERSITE=1"}
	output, err := command.Output()
	if err != nil {
		failure(w, fmt.Errorf("PyBaMM checker process: %w", err))
		return
	}
	var verification campaign.Verification
	if err := json.Unmarshal(output, &verification); err != nil {
		failure(w, err)
		return
	}
	verification.CheckerDigest = digest
	receipt, err := a.db.RecordCampaignVerification(ctx, candidate, verification)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, receipt)
}

func (a *API) reviewCampaign(w http.ResponseWriter, r *http.Request) {
	project, id, key := r.PathValue("project"), r.PathValue("campaign"), r.Header.Get("Idempotency-Key")
	if !bounded(project, 128) || !bounded(id, 128) || len(key) > 128 || !bounded(key, 128) {
		invalid(w)
		return
	}
	var input campaign.DecisionInput
	if !decode(w, r, &input) {
		return
	}
	if !bounded(input.GateID, 128) || len(input.EvidenceDigest) != 64 || len(input.PlanDigest) != 64 || (input.Choice != "approve" && input.Choice != "reject") {
		invalid(w)
		return
	}
	ctx, caller := r.Context(), clientIdentity(r)
	record, err := a.db.ReviewableCampaign(ctx, caller, project, id)
	if err != nil {
		failure(w, err)
		return
	}
	requestID := fmt.Sprintf("%x", sha256.Sum256([]byte(caller.ID+"\x00"+key)))
	if prior := record.Decision; prior != nil && prior.RequestID == requestID && prior.DecisionInput == input {
		respond(w, 200, prior)
		return
	}
	if record.Result != nil || record.Decision != nil {
		reason := "review gate is no longer active"
		if record.Result != nil && record.Result.Outcome == campaign.ReviewExpired {
			reason = "review gate has expired"
		}
		respond(w, 409, map[string]string{"error": reason})
		return
	}
	request := campaign.Decision{DecisionInput: input, RequestID: requestID, ReviewerID: caller.ID}
	if err := a.db.ReserveCampaignDecision(ctx, id, request); err != nil {
		failure(w, err)
		return
	}
	receipt, err := a.campaigns.Temporal.Review(ctx, id, request)
	if err != nil {
		var rejection *campaignruntime.ReviewRejection
		if errors.As(err, &rejection) {
			respond(w, 409, map[string]string{"error": rejection.Error()})
			return
		}
		respond(w, 503, map[string]string{"error": "review acknowledgement unavailable; retry with the same decision key"})
		return
	}
	respond(w, 200, receipt)
}

func (a *API) recordCampaignDecision(w http.ResponseWriter, r *http.Request) {
	var decision campaign.Decision
	if !decode(w, r, &decision) {
		return
	}
	if err := a.db.RecordCampaignDecision(r.Context(), clientIdentity(r), r.PathValue("campaign"), decision); err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, struct{}{})
}

func (a *API) readCampaignEvidence(w http.ResponseWriter, r *http.Request) {
	index, err := strconv.Atoi(r.PathValue("index"))
	if err != nil || index < 0 || index > 1 {
		invalid(w)
		return
	}
	ctx, caller, id := r.Context(), clientIdentity(r), r.PathValue("campaign")
	receipt, err := a.db.ClientCampaignEvidence(ctx, caller, r.PathValue("project"), id, index)
	if err != nil {
		failure(w, err)
		return
	}
	events, err := a.db.Events(ctx, receipt.Evidence.Run.RunID)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, struct {
		campaign.ReviewedEvidence
		*store.EventTail
	}{*receipt, events})
}
