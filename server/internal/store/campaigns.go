package store

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/phodal/pero/server/internal/campaign"
)

var ErrCampaignInput = errors.New("campaign requires one to eight manual trials in the path project")

type CampaignRecord struct {
	Plan            campaign.PlanRef   `json:"plan"`
	WorkflowRunID   string             `json:"workflow_run_id,omitempty"`
	CancelRequested bool               `json:"cancel_requested"`
	Result          *campaign.Progress `json:"result,omitempty"`
	Decision        *campaign.Decision `json:"decision,omitempty"`
	trials          []TrialInput
	checkerDigest   string
}

const campaignColumns = `id,project_id,plan_digest,plan,COALESCE(workflow_run_id,''),cancel_requested,result,mode,checker_digest,decision`

func scanCampaign(row pgx.Row) (CampaignRecord, error) {
	var c CampaignRecord
	var plan, result, decision []byte
	if err := row.Scan(&c.Plan.ID, &c.Plan.Project, &c.Plan.Digest, &plan, &c.WorkflowRunID, &c.CancelRequested, &result, &c.Plan.Mode, &c.checkerDigest, &decision); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c, ErrNotFound
		}
		return c, err
	}
	if err := json.Unmarshal(plan, &c.trials); err != nil {
		return c, err
	}
	c.Plan.TrialCount = len(c.trials)
	if decision != nil {
		if err := json.Unmarshal(decision, &c.Decision); err != nil {
			return c, err
		}
	}
	if result != nil {
		return c, json.Unmarshal(result, &c.Result)
	}
	return c, nil
}

// AdmitCampaign freezes the plan before the caller attempts the Temporal RPC.
func (s *Store) AdmitCampaign(ctx context.Context, caller *Client, project, request, runner string, trials []TrialInput, mode, checker string) (CampaignRecord, error) {
	if !slices.Contains(caller.Projects, project) {
		return CampaignRecord{}, ErrNotFound
	}
	if len(trials) == 0 || len(trials) > campaign.MaxTrials {
		return CampaignRecord{}, ErrCampaignInput
	}
	if mode != "" && (mode != campaign.ReviewedPyBaMM || len(trials) != 2 || checker == "") {
		return CampaignRecord{}, ErrCampaignInput
	}
	for _, trial := range trials {
		if trial.Task.ProjectID != project || trial.Task.validateManual() != nil ||
			(trial.WorkerID != "" && strings.TrimSpace(trial.WorkerID) == "") ||
			strings.ContainsRune(trial.WorkerID, 0) || utf8.RuneCountInString(trial.WorkerID) > 128 {
			return CampaignRecord{}, ErrCampaignInput
		}
		if mode == campaign.ReviewedPyBaMM && (trial.Task.AgentID != "pybamm-sweep-v1" || trial.WorkerID == "") {
			return CampaignRecord{}, ErrCampaignInput
		}
	}
	digest, err := inputDigest(trials)
	if err != nil {
		return CampaignRecord{}, err
	}
	plan, err := json.Marshal(trials)
	if err != nil {
		return CampaignRecord{}, err
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO research_campaigns(id,project_id,owner_id,request_id,runner_id,plan_digest,plan,mode,checker_digest)
		SELECT $1,$2,$3,$4,id,$6,$7,$8,$9 FROM clients WHERE id=$5 AND $2=ANY(projects)
		ON CONFLICT (project_id,owner_id,request_id) DO NOTHING`, newID("campaign"), project, caller.ID, request, runner, digest, plan, mode, checker)
	if err != nil {
		return CampaignRecord{}, err
	}
	c, err := scanCampaign(s.pool.QueryRow(ctx, `SELECT `+campaignColumns+` FROM research_campaigns WHERE project_id=$1 AND owner_id=$2 AND request_id=$3`, project, caller.ID, request))
	if errors.Is(err, ErrNotFound) {
		return CampaignRecord{}, ErrForbidden
	}
	if err == nil && (c.Plan.Digest != digest || c.Plan.Mode != mode) {
		return CampaignRecord{}, ErrConflict
	}
	return c, err
}

func (s *Store) ClientCampaign(ctx context.Context, caller *Client, project, id string) (CampaignRecord, error) {
	return scanCampaign(s.pool.QueryRow(ctx, `SELECT `+campaignColumns+` FROM research_campaigns
		WHERE id=$1 AND project_id=$2 AND project_id=ANY($3)`, id, project, caller.Projects))
}

func (s *Store) MarkCampaignStarted(ctx context.Context, id, runID string) (CampaignRecord, error) {
	return scanCampaign(s.pool.QueryRow(ctx, `UPDATE research_campaigns SET workflow_run_id=COALESCE(workflow_run_id,$2)
		WHERE id=$1 RETURNING `+campaignColumns, id, runID))
}

func (s *Store) RequestCampaignCancel(ctx context.Context, caller *Client, project, id string) (CampaignRecord, error) {
	return scanCampaign(s.pool.QueryRow(ctx, `UPDATE research_campaigns SET cancel_requested=cancel_requested OR result IS NULL
		WHERE id=$1 AND project_id=$2 AND project_id=ANY($3) AND owner_id=$4 RETURNING `+campaignColumns, id, project, caller.Projects, caller.ID))
}

func (s *Store) CampaignTrial(ctx context.Context, runner *Client, cmd campaign.TrialCommand) (campaign.Observation, error) {
	var observation campaign.Observation
	c, err := scanCampaign(s.pool.QueryRow(ctx, `SELECT `+campaignColumns+` FROM research_campaigns
		WHERE id=$1 AND runner_id=$2 AND project_id=ANY($3)`, cmd.CampaignID, runner.ID, runner.Projects))
	if err != nil {
		return observation, err
	}
	if cmd.Index < 0 || cmd.Index >= len(c.trials) {
		return observation, ErrCampaignInput
	}
	if cmd.Action != campaign.Ensure && cmd.Action != campaign.Observe && cmd.Action != campaign.Cancel {
		return observation, ErrCampaignInput
	}
	observation.CancelRequested = c.CancelRequested
	if c.Result != nil {
		observation.Trial = c.Result.Trials[cmd.Index]
		return observation, nil
	}
	if c.CancelRequested {
		cmd.Action = campaign.Cancel
	}
	if c.Plan.Mode == campaign.ReviewedPyBaMM && cmd.Index == 1 && cmd.Action == campaign.Ensure &&
		(c.Decision == nil || c.Decision.Choice != "approve") {
		return observation, ErrConflict
	}
	op, err := runner.TrialOperation(c.Plan.Project, cmd.OperationID())
	if err != nil {
		return observation, err
	}
	var receipt TrialReceipt
	switch cmd.Action {
	case campaign.Ensure:
		receipt, err = s.EnsureTrialRun(ctx, op, c.trials[cmd.Index])
	case campaign.Observe:
		receipt, err = s.TrialReceipt(ctx, op)
	case campaign.Cancel:
		receipt, err = s.CancelTrial(ctx, op)
	}
	observation.Trial.OperationID = cmd.OperationID()
	if cmd.Action == campaign.Ensure && (errors.Is(err, ErrWorkerIneligible) || errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound)) {
		receipt, err = s.CancelTrial(ctx, op)
		if err == nil && receipt.Run == nil {
			observation.Trial.Status = campaign.Rejected
			return observation, nil
		}
	}
	if err != nil {
		return observation, err
	}
	observation.Trial.Run = receipt.Run
	if receipt.Run == nil {
		observation.Trial.Status = campaign.Cancelled
		return observation, nil
	}
	run, err := s.ClientRun(ctx, runner, *receipt.Run)
	if err != nil {
		return observation, err
	}
	observation.Trial.Status = campaign.TrialStatus(run.Status)
	if run.Reconciliation() != nil {
		observation.Trial.Status = campaign.Reconciled
	}
	return observation, nil
}

func (s *Store) FinishCampaign(ctx context.Context, runner *Client, id string, result campaign.Progress) error {
	if result.Phase != campaign.Done || result.Plan.ID != id || result.Outcome == "" || len(result.Trials) != result.Plan.TrialCount {
		return ErrCampaignInput
	}
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	var same bool
	err = s.pool.QueryRow(ctx, `UPDATE research_campaigns SET result=COALESCE(result,$4::jsonb)
		WHERE id=$1 AND runner_id=$2 AND project_id=ANY($3) AND project_id=$5 AND plan_digest=$6 AND jsonb_array_length(plan)=$7
		RETURNING result=$4::jsonb`, id, runner.ID, runner.Projects, data, result.Plan.Project, result.Plan.Digest, result.Plan.TrialCount).Scan(&same)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err == nil && !same {
		return ErrConflict
	}
	return err
}
