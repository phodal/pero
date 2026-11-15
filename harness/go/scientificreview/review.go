// Package scientificreview defines a bounded evidence-consistency review. A model
// assessment never establishes mechanical verification or scientific acceptance.
package scientificreview

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

const MaxSnapshotBytes = 64 * 1024
const MaxFindings = 12

type Message struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

// Evidence is an observed record, not an assertion that its content is true.
// Artifact references identify the exact saved version used by this review.
type Evidence struct {
	ID              string `json:"id"`
	Kind            string `json:"kind"`
	Text            string `json:"text"`
	ArtifactID      string `json:"artifactId,omitempty"`
	ArtifactVersion int    `json:"artifactVersion,omitempty"`
	SHA256          string `json:"sha256,omitempty"`
}

type Snapshot struct {
	SessionID  string     `json:"sessionId"`
	ThroughSeq int64      `json:"throughSeq"`
	Messages   []Message  `json:"messages"`
	Evidence   []Evidence `json:"evidence"`
	Truncated  bool       `json:"truncated"`
}

// NewSnapshot is the input boundary. The shell records any omitted/truncated
// material explicitly; the core never silently trims an observation.
func NewSnapshot(value Snapshot) (Snapshot, error) {
	if strings.TrimSpace(value.SessionID) == "" || value.ThroughSeq < 0 || len(value.Messages) == 0 {
		return Snapshot{}, errors.New("scientific review requires a session, sequence and answer")
	}
	ids := make(map[string]bool)
	for _, message := range value.Messages {
		if message.ID == "" || strings.TrimSpace(message.Text) == "" || ids[message.ID] {
			return Snapshot{}, errors.New("scientific review messages require unique IDs and text")
		}
		ids[message.ID] = true
	}
	for _, item := range value.Evidence {
		if item.ID == "" || item.Kind == "" || strings.TrimSpace(item.Text) == "" || ids[item.ID] {
			return Snapshot{}, errors.New("scientific review evidence requires unique IDs, kind and text")
		}
		ids[item.ID] = true
		if item.ArtifactID != "" && (item.ArtifactVersion < 1 || !isDigest(item.SHA256)) || item.ArtifactID == "" && (item.ArtifactVersion != 0 || item.SHA256 != "") {
			return Snapshot{}, errors.New("artifact evidence requires its exact ID, version and SHA-256")
		}
	}
	encoded, _ := json.Marshal(value)
	if len(encoded) > MaxSnapshotBytes {
		return Snapshot{}, errors.New("scientific review snapshot exceeds 64 KiB; bound it and mark truncated")
	}
	value.Messages = append([]Message(nil), value.Messages...)
	value.Evidence = append([]Evidence(nil), value.Evidence...)
	return value, nil
}

func isDigest(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, ch := range value {
		if !(ch >= '0' && ch <= '9' || ch >= 'a' && ch <= 'f') {
			return false
		}
	}
	return true
}

func (s Snapshot) Hash() string {
	encoded, _ := json.Marshal(s)
	return fmt.Sprintf("%x", sha256.Sum256(encoded))
}

type Category string

const (
	MissingExecution    Category = "missing_execution"
	NumericConflict     Category = "numeric_conflict"
	UnsupportedCitation Category = "unsupported_citation"
	PlanOmission        Category = "plan_omission"
)

type Certainty string

const (
	PossibleIssue        Certainty = "possible_issue"
	InsufficientEvidence Certainty = "insufficient_evidence"
)

type FindingState string

const (
	Open          FindingState = "open"
	Resolved      FindingState = "resolved"
	NotApplicable FindingState = "not_applicable"
)

type Candidate struct {
	Category    Category  `json:"category"`
	MessageID   string    `json:"messageId"`
	Quote       string    `json:"quote"`
	EvidenceIDs []string  `json:"evidenceIds"`
	Rationale   string    `json:"rationale"`
	Suggestion  string    `json:"suggestion"`
	Certainty   Certainty `json:"certainty"`
}

type Finding struct {
	Candidate
	ID                string       `json:"id"`
	Assessment        string       `json:"assessment"`
	State             FindingState `json:"state"`
	DispositionReason string       `json:"dispositionReason,omitempty"`
}

type Report struct {
	Snapshot     Snapshot  `json:"snapshot"`
	SnapshotHash string    `json:"snapshotHash"`
	Status       string    `json:"status"`
	Assessment   string    `json:"assessment"`
	Conclusion   string    `json:"conclusion"`
	Findings     []Finding `json:"findings"`
	Diagnostic   string    `json:"diagnostic,omitempty"`
}

// ParseAssessment validates model output once. Unknown or invented anchors
// invalidate the assessment instead of being published as grounded findings.
func ParseAssessment(raw []byte, snapshot Snapshot) (Report, error) {
	if len(raw) > 32*1024 {
		return Report{}, errors.New("scientific review output exceeds 32 KiB")
	}
	var output struct {
		Findings []Candidate `json:"findings"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&output); err != nil {
		return Report{}, fmt.Errorf("invalid scientific review: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return Report{}, errors.New("scientific review must contain one JSON object")
	}
	if output.Findings == nil || len(output.Findings) > MaxFindings {
		return Report{}, errors.New("scientific review requires an array of at most 12 findings")
	}
	messages := make(map[string]string, len(snapshot.Messages))
	for _, message := range snapshot.Messages {
		messages[message.ID] = message.Text
	}
	evidence := make(map[string]bool, len(snapshot.Evidence))
	for _, item := range snapshot.Evidence {
		evidence[item.ID] = true
	}
	report := Report{Snapshot: copySnapshot(snapshot), SnapshotHash: snapshot.Hash(), Status: "completed", Assessment: "model_review", Conclusion: "no_issues_identified", Findings: []Finding{}}
	for _, candidate := range output.Findings {
		switch candidate.Category {
		case MissingExecution, NumericConflict, UnsupportedCitation, PlanOmission:
		default:
			return Report{}, errors.New("unsupported scientific review category")
		}
		if candidate.Certainty != PossibleIssue && candidate.Certainty != InsufficientEvidence {
			return Report{}, errors.New("model review must retain uncertainty")
		}
		text, found := messages[candidate.MessageID]
		if !found || strings.TrimSpace(candidate.Quote) == "" || !strings.Contains(text, candidate.Quote) {
			return Report{}, errors.New("scientific review quote must occur in its original message")
		}
		if strings.TrimSpace(candidate.Rationale) == "" || strings.TrimSpace(candidate.Suggestion) == "" || candidate.EvidenceIDs == nil {
			return Report{}, errors.New("scientific review requires rationale, correction and evidence IDs")
		}
		if candidate.Certainty == PossibleIssue && len(candidate.EvidenceIDs) == 0 {
			return Report{}, errors.New("a possible issue requires evidence; absent evidence is insufficient_evidence")
		}
		seen := make(map[string]bool)
		for _, id := range candidate.EvidenceIDs {
			if !evidence[id] || seen[id] {
				return Report{}, errors.New("scientific review contains an unknown or repeated evidence ID")
			}
			seen[id] = true
		}
		candidate.EvidenceIDs = append([]string{}, candidate.EvidenceIDs...)
		encoded, _ := json.Marshal(candidate)
		digest := sha256.Sum256(append([]byte(report.SnapshotHash), encoded...))
		id := fmt.Sprintf("finding-%x", digest[:8])
		for _, prior := range report.Findings {
			if prior.ID == id {
				return Report{}, errors.New("scientific review repeats the same finding")
			}
		}
		report.Findings = append(report.Findings, Finding{Candidate: candidate, ID: id, Assessment: "model_review", State: Open})
	}
	if len(report.Findings) > 0 {
		report.Conclusion = "issues_identified"
	}
	return report, nil
}

func copySnapshot(snapshot Snapshot) Snapshot {
	snapshot.Messages = append([]Message(nil), snapshot.Messages...)
	snapshot.Evidence = append([]Evidence(nil), snapshot.Evidence...)
	return snapshot
}

func Unavailable(snapshot Snapshot, reason string) Report {
	return Report{Snapshot: copySnapshot(snapshot), SnapshotHash: snapshot.Hash(), Status: "unavailable", Assessment: "model_review", Conclusion: "review_unavailable", Findings: []Finding{}, Diagnostic: reason}
}

// Disposition changes only handling state. The original assessment, source
// quote and frozen evidence stay intact; a reason is not scientific acceptance.
func (r Report) Disposition(id string, state FindingState, reason string) (Report, error) {
	if state != Resolved && state != NotApplicable || strings.TrimSpace(reason) == "" {
		return Report{}, errors.New("resolve or mark not applicable with an explicit reason")
	}
	next := r
	next.Snapshot = copySnapshot(r.Snapshot)
	next.Findings = append([]Finding(nil), r.Findings...)
	for index, finding := range next.Findings {
		if finding.ID != id {
			continue
		}
		if finding.State != Open {
			return Report{}, errors.New("scientific review finding already has a disposition")
		}
		next.Findings[index].State = state
		next.Findings[index].DispositionReason = strings.TrimSpace(reason)
		return next, nil
	}
	return Report{}, errors.New("scientific review finding was not found")
}
