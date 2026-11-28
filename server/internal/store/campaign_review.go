package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/phodal/pero/server/internal/campaign"
)

type CampaignCandidate struct {
	Plan          campaign.PlanRef
	Index         int
	Trial         TrialInput
	Run           *Run
	Events        *EventTail
	CheckerDigest string
}

func readVerification(row pgx.Row) (*campaign.ReviewedEvidence, error) {
	var data []byte
	if err := row.Scan(&data); errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	var observed campaign.ReviewedEvidence
	if err := json.Unmarshal(data, &observed); err != nil {
		return nil, err
	}
	return &observed, nil
}

func (s *Store) CampaignCandidate(ctx context.Context, runner *Client, id string, index int) (CampaignCandidate, *campaign.ReviewedEvidence, error) {
	var candidate CampaignCandidate
	c, err := scanCampaign(s.pool.QueryRow(ctx, `SELECT `+campaignColumns+` FROM research_campaigns
		WHERE id=$1 AND runner_id=$2 AND project_id=ANY($3) AND mode=$4`, id, runner.ID, runner.Projects, campaign.ReviewedPyBaMM))
	if err != nil {
		return candidate, nil, err
	}
	if index < 0 || index >= len(c.trials) {
		return candidate, nil, ErrCampaignInput
	}
	prior, err := readVerification(s.pool.QueryRow(ctx, `SELECT observed FROM campaign_verifications WHERE campaign_id=$1 AND trial_index=$2`, id, index))
	if prior != nil || err != nil {
		return candidate, prior, err
	}
	cmd := campaign.TrialCommand{CampaignID: id, Index: index}
	op, err := runner.TrialOperation(c.Plan.Project, cmd.OperationID())
	if err != nil {
		return candidate, nil, err
	}
	receipt, err := s.TrialReceipt(ctx, op)
	if err != nil {
		return candidate, nil, err
	}
	if receipt.Run == nil {
		return candidate, nil, ErrConflict
	}
	run, err := s.ClientRun(ctx, runner, *receipt.Run)
	if err != nil {
		return candidate, nil, err
	}
	if run.Status != "succeeded" {
		return candidate, nil, ErrConflict
	}
	tail, err := s.Events(ctx, run.ID)
	return CampaignCandidate{Plan: c.Plan, Index: index, Trial: c.trials[index], Run: run, Events: tail, CheckerDigest: c.checkerDigest}, nil, err
}

func (s *Store) RecordCampaignVerification(ctx context.Context, candidate CampaignCandidate, verification campaign.Verification) (*campaign.ReviewedEvidence, error) {
	evidence := campaign.Evidence{Verification: verification, Run: candidate.Run.Ref(), WorkerID: candidate.Run.WorkerID}
	digest, err := inputDigest(evidence)
	if err != nil {
		return nil, err
	}
	evidence.Digest = digest
	observed := campaign.ReviewedEvidence{Evidence: evidence}
	if candidate.Index == 0 && evidence.Status == "consistent" {
		observed.Gate = &campaign.ReviewGate{ID: candidate.Plan.ID + "-round-1", PlanDigest: candidate.Plan.Digest,
			EvidenceDigest: digest, ExpiresAt: time.Now().UTC().Add(campaign.ReviewWindow)}
	}
	data, err := json.Marshal(observed)
	if err != nil {
		return nil, err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO campaign_verifications(campaign_id,trial_index,observed) VALUES($1,$2,$3)
		ON CONFLICT DO NOTHING`, candidate.Plan.ID, candidate.Index, data)
	if err != nil {
		return nil, err
	}
	return readVerification(s.pool.QueryRow(ctx, `SELECT observed FROM campaign_verifications WHERE campaign_id=$1 AND trial_index=$2`, candidate.Plan.ID, candidate.Index))
}

// A project Client may review, except the service Client that executes Activities.
func (s *Store) ReviewableCampaign(ctx context.Context, caller *Client, project, id string) (CampaignRecord, error) {
	return scanCampaign(s.pool.QueryRow(ctx, `SELECT `+campaignColumns+` FROM research_campaigns
		WHERE id=$1 AND project_id=$2 AND project_id=ANY($3) AND runner_id<>$4 AND mode=$5`,
		id, project, caller.Projects, caller.ID, campaign.ReviewedPyBaMM))
}

func (s *Store) RecordCampaignDecision(ctx context.Context, runner *Client, id string, decision campaign.Decision) error {
	data, err := json.Marshal(decision)
	if err != nil {
		return err
	}
	var same bool
	err = s.pool.QueryRow(ctx, `UPDATE research_campaigns c SET decision=COALESCE(decision,$4::jsonb)
		WHERE c.id=$1 AND c.runner_id=$2 AND c.project_id=ANY($3)
		AND (decision IS NOT NULL OR (result IS NULL AND NOT cancel_requested
		  AND EXISTS (SELECT 1 FROM campaign_verifications v JOIN campaign_decision_requests p ON p.campaign_id=v.campaign_id
		  WHERE v.campaign_id=c.id AND v.trial_index=0
		  AND p.request_id=$8 AND p.payload=($4::jsonb - 'decided_at')
		  AND p.received_at < (v.observed->'review_gate'->>'expires_at')::timestamptz
		  AND v.observed->'review_gate'->>'id'=$5 AND v.observed->'review_gate'->>'evidence_digest'=$6)
		  AND c.plan_digest=$7))
		RETURNING decision=$4::jsonb`, id, runner.ID, runner.Projects, data, decision.GateID, decision.EvidenceDigest, decision.PlanDigest, decision.RequestID).Scan(&same)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !same) {
		return ErrConflict
	}
	return err
}

func (s *Store) ReserveCampaignDecision(ctx context.Context, id string, request campaign.Decision) error {
	data, err := json.Marshal(request)
	if err != nil {
		return err
	}
	var same bool
	err = s.pool.QueryRow(ctx, `INSERT INTO campaign_decision_requests(campaign_id,request_id,payload)
		VALUES($1,$2,$3::jsonb-'decided_at')
		ON CONFLICT (campaign_id,request_id) DO UPDATE SET payload=campaign_decision_requests.payload
		RETURNING payload=$3::jsonb-'decided_at'`, id, request.RequestID, data).Scan(&same)
	if err == nil && !same {
		return ErrConflict
	}
	return err
}

func (s *Store) ClientCampaignEvidence(ctx context.Context, caller *Client, project, id string, index int) (*campaign.ReviewedEvidence, error) {
	receipt, err := readVerification(s.pool.QueryRow(ctx, `SELECT v.observed FROM campaign_verifications v
		JOIN research_campaigns c ON c.id=v.campaign_id WHERE c.id=$1 AND c.project_id=$2 AND c.project_id=ANY($3) AND v.trial_index=$4`,
		id, project, caller.Projects, index))
	if err == nil && receipt == nil {
		return nil, ErrNotFound
	}
	return receipt, err
}
