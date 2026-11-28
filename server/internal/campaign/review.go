package campaign

import (
	"errors"
	"time"

	"github.com/phodal/pero/server/internal/runref"
)

const ReviewedPyBaMM = "pybamm_reviewed_v1"
const ReviewWindow = 24 * time.Hour
const (
	Verifying          Phase   = "verifying"
	AwaitingReview     Phase   = "awaiting_review"
	VerificationFailed Outcome = "verification_failed"
	ReviewRejected     Outcome = "review_rejected"
	ReviewExpired      Outcome = "review_expired"
)

type Verification struct {
	Status            string `json:"status"`
	Experiment        string `json:"experiment"`
	MethodDigest      string `json:"method_digest"`
	EnvironmentDigest string `json:"environment_digest,omitempty"`
	ResultDigest      string `json:"result_digest,omitempty"`
	CheckerDigest     string `json:"checker_digest"`
	Reason            string `json:"reason,omitempty"`
}

type Evidence struct {
	Verification
	Run      runref.Ref `json:"run"`
	WorkerID string     `json:"worker_id"`
	Digest   string     `json:"digest"`
}

type ReviewGate struct {
	ID             string    `json:"id"`
	PlanDigest     string    `json:"plan_digest"`
	EvidenceDigest string    `json:"evidence_digest"`
	ExpiresAt      time.Time `json:"expires_at"`
}

type DecisionInput struct {
	GateID         string `json:"gate_id"`
	PlanDigest     string `json:"plan_digest"`
	EvidenceDigest string `json:"evidence_digest"`
	Choice         string `json:"choice"`
}

type Decision struct {
	DecisionInput
	RequestID  string    `json:"request_id"`
	ReviewerID string    `json:"reviewer_id"`
	DecidedAt  time.Time `json:"decided_at"`
}

type ReviewedEvidence struct {
	Evidence Evidence    `json:"evidence"`
	Gate     *ReviewGate `json:"review_gate,omitempty"`
}

func (p *Progress) RecordVerification(observed ReviewedEvidence) {
	p.Evidence = append(p.Evidence, observed.Evidence)
	p.Current++
	switch {
	case p.CancelRequested:
		p.finish(CampaignCancelled)
	case observed.Evidence.Status != "consistent":
		p.finish(VerificationFailed)
	case p.Current == len(p.Trials):
		p.finish(ExecutionCompleted)
	default:
		p.Gate = observed.Gate
		p.Phase = AwaitingReview
	}
}

func (p *Progress) CancelVerification() {
	p.Current++
	p.finish(CampaignCancelled)
}

func (p Progress) CheckDecision(d DecisionInput, now time.Time) error {
	switch {
	case p.Phase != AwaitingReview || p.CancelRequested || p.Gate == nil || p.Decision != nil:
		return errors.New("review gate is no longer active")
	case d.GateID != p.Gate.ID || d.PlanDigest != p.Gate.PlanDigest || d.EvidenceDigest != p.Gate.EvidenceDigest:
		return errors.New("review gate, plan or evidence has changed")
	case !now.Before(p.Gate.ExpiresAt):
		return errors.New("review gate has expired")
	case d.Choice != "approve" && d.Choice != "reject":
		return errors.New("review choice must be approve or reject")
	}
	return nil
}

func (p *Progress) CloseReview(now time.Time) {
	switch {
	case p.CancelRequested:
		p.finish(CampaignCancelled)
	case p.Decision != nil && p.Decision.Choice == "approve":
		p.Phase = Dispatching
	case p.Decision != nil:
		p.finish(ReviewRejected)
	case !now.Before(p.Gate.ExpiresAt):
		p.finish(ReviewExpired)
	}
}
