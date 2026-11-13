package scientificreview

import (
	"encoding/json"
	"strings"
	"testing"
)

func packet(t *testing.T) Snapshot {
	t.Helper()
	value, err := NewSnapshot(Snapshot{
		SessionID: "research-session", ThroughSeq: 20,
		Messages: []Message{{ID: "answer-1", Text: "I ran the simulation. The yield was 90%. Paper A proves that this is safe. The approved plan is complete."}},
		Evidence: []Evidence{
			{ID: "result-v2", Kind: "artifact", Text: "yield_percent,12", ArtifactID: "result", ArtifactVersion: 2, SHA256: strings.Repeat("a", 64)},
			{ID: "paper-p4", Kind: "citation", Text: "Observed passage: efficacy only; safety has not been investigated."},
			{ID: "plan-approval", Kind: "plan", Text: "User approved: run simulation, measure yield, and perform a safety assay. Safety assay remains pending."},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func assessment(t *testing.T, findings ...Candidate) []byte {
	t.Helper()
	if findings == nil {
		findings = []Candidate{}
	}
	raw, err := json.Marshal(struct {
		Findings []Candidate `json:"findings"`
	}{findings})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestAssessment(t *testing.T) {
	snapshot := packet(t)
	for _, row := range []struct {
		name      string
		candidate *Candidate
		invalid   bool
	}{
		{name: "correct record has no findings"},
		{name: "saved number contradicts answer", candidate: &Candidate{Category: NumericConflict, MessageID: "answer-1", Quote: "The yield was 90%.", EvidenceIDs: []string{"result-v2"}, Rationale: "Saved result v2 records 12%, but the answer reports 90%.", Suggestion: "Correct the yield or supply the saved version that supports 90%.", Certainty: PossibleIssue}},
		{name: "execution not observed remains uncertain", candidate: &Candidate{Category: MissingExecution, MessageID: "answer-1", Quote: "I ran the simulation.", EvidenceIDs: []string{}, Rationale: "The packet includes no execution record; a run outside this packet is unknown.", Suggestion: "Supply the execution receipt or qualify the claim as unverified.", Certainty: InsufficientEvidence}},
		{name: "citation passage does not establish claim", candidate: &Candidate{Category: UnsupportedCitation, MessageID: "answer-1", Quote: "Paper A proves that this is safe.", EvidenceIDs: []string{"paper-p4"}, Rationale: "The observed passage excludes safety evaluation.", Suggestion: "Qualify the safety claim and cite the source's scope.", Certainty: PossibleIssue}},
		{name: "approved plan has pending work", candidate: &Candidate{Category: PlanOmission, MessageID: "answer-1", Quote: "The approved plan is complete.", EvidenceIDs: []string{"plan-approval"}, Rationale: "The user-approved safety assay is still pending in the saved plan.", Suggestion: "Report the pending assay instead of calling the plan complete.", Certainty: PossibleIssue}},
		{name: "unknown message", invalid: true, candidate: &Candidate{Category: MissingExecution, MessageID: "invented", Quote: "I ran the simulation.", EvidenceIDs: []string{}, Rationale: "Missing execution.", Suggestion: "Supply receipt.", Certainty: InsufficientEvidence}},
		{name: "invented quote", invalid: true, candidate: &Candidate{Category: MissingExecution, MessageID: "answer-1", Quote: "The GPU run succeeded.", EvidenceIDs: []string{}, Rationale: "Missing execution.", Suggestion: "Supply receipt.", Certainty: InsufficientEvidence}},
		{name: "invented evidence", invalid: true, candidate: &Candidate{Category: NumericConflict, MessageID: "answer-1", Quote: "The yield was 90%.", EvidenceIDs: []string{"nonexistent"}, Rationale: "Conflict.", Suggestion: "Correct.", Certainty: PossibleIssue}},
		{name: "missing evidence cannot become observed contradiction", invalid: true, candidate: &Candidate{Category: MissingExecution, MessageID: "answer-1", Quote: "I ran the simulation.", EvidenceIDs: []string{}, Rationale: "No receipt.", Suggestion: "Supply receipt.", Certainty: PossibleIssue}},
		{name: "model cannot assign scientific pass", invalid: true, candidate: &Candidate{Category: NumericConflict, MessageID: "answer-1", Quote: "The yield was 90%.", EvidenceIDs: []string{"result-v2"}, Rationale: "Conflict.", Suggestion: "Correct.", Certainty: "scientific_pass"}},
		{name: "unsupported check category", invalid: true, candidate: &Candidate{Category: "scientific_validity", MessageID: "answer-1", Quote: "The yield was 90%.", EvidenceIDs: []string{"result-v2"}, Rationale: "Conflict.", Suggestion: "Correct.", Certainty: PossibleIssue}},
	} {
		t.Run(row.name, func(t *testing.T) {
			var raw []byte
			if row.candidate == nil {
				raw = assessment(t)
			} else {
				raw = assessment(t, *row.candidate)
			}
			report, err := ParseAssessment(raw, snapshot)
			if (err != nil) != row.invalid {
				t.Fatalf("error = %v, invalid = %v", err, row.invalid)
			}
			if row.invalid {
				return
			}
			if report.SnapshotHash != snapshot.Hash() || report.Assessment != "model_review" || report.Status != "completed" {
				t.Fatalf("incorrect assessment provenance: %#v", report)
			}
			if row.candidate == nil {
				if report.Conclusion != "no_issues_identified" || !strings.Contains(report.Markdown(), "does not verify the science") {
					t.Fatal("empty findings were promoted to scientific acceptance")
				}
				return
			}
			finding := report.Findings[0]
			if finding.State != Open || finding.Assessment != "model_review" || finding.MessageID != "answer-1" {
				t.Fatalf("finding lost origin or state: %#v", finding)
			}
			if finding.Category == NumericConflict && !strings.Contains(report.Markdown(), "artifact `result` v2") {
				t.Fatal("saved version missing from presentation")
			}
			again, _ := ParseAssessment(raw, snapshot)
			if again.Findings[0].ID != finding.ID {
				t.Fatal("finding identity changed for the same frozen assessment")
			}
		})
	}
}

func TestAssessmentOutputBoundary(t *testing.T) {
	snapshot := packet(t)
	for _, raw := range []string{`{}`, `{"findings":null}`, `{"findings":[],"scientificPass":true}`, `{"findings":[]} {}`, `{"findings":[],"extra":0}`, strings.Repeat("x", 32*1024+1)} {
		if _, err := ParseAssessment([]byte(raw), snapshot); err == nil {
			t.Fatalf("accepted malformed or unbounded assessment: %.100s", raw)
		}
	}
}

func TestSnapshotBoundary(t *testing.T) {
	for _, row := range []struct {
		name   string
		change func(*Snapshot)
	}{
		{"missing session", func(s *Snapshot) { s.SessionID = "" }},
		{"unknown sequence", func(s *Snapshot) { s.ThroughSeq = -1 }},
		{"missing answer", func(s *Snapshot) { s.Messages = nil }},
		{"duplicate evidence", func(s *Snapshot) { s.Evidence = append(s.Evidence, s.Evidence[0]) }},
		{"unpinned artifact", func(s *Snapshot) { s.Evidence[0].ArtifactVersion = 0 }},
		{"missing digest", func(s *Snapshot) { s.Evidence[0].SHA256 = "" }},
		{"oversized snapshot", func(s *Snapshot) { s.Messages[0].Text = strings.Repeat("x", MaxSnapshotBytes) }},
	} {
		t.Run(row.name, func(t *testing.T) {
			snapshot := packet(t)
			row.change(&snapshot)
			if _, err := NewSnapshot(snapshot); err == nil {
				t.Fatal("accepted invalid input")
			}
		})
	}
	snapshot := packet(t)
	snapshot.Truncated = true
	report := Unavailable(snapshot, "provider request budget exhausted")
	snapshot.Messages[0].Text = "newer answer"
	snapshot.Evidence[0].ArtifactVersion = 3
	if report.Snapshot.Messages[0].Text == "newer answer" || report.Snapshot.Evidence[0].ArtifactVersion != 2 || report.Conclusion != "review_unavailable" || !strings.Contains(report.Markdown(), "Absence is inconclusive") {
		t.Fatal("unavailable review lost the frozen scope or uncertainty")
	}
	if !strings.Contains(Prompt(report.Snapshot), report.SnapshotHash) || !json.Valid(OutputSchema) {
		t.Fatal("review request lost its packet binding or schema")
	}
}

func TestFindingDisposition(t *testing.T) {
	candidate := Candidate{Category: NumericConflict, MessageID: "answer-1", Quote: "The yield was 90%.", EvidenceIDs: []string{"result-v2"}, Rationale: "Saved value differs.", Suggestion: "Correct the answer.", Certainty: PossibleIssue}
	report, err := ParseAssessment(assessment(t, candidate), packet(t))
	if err != nil {
		t.Fatal(err)
	}
	id := report.Findings[0].ID
	for _, row := range []struct {
		name, id, reason string
		state            FindingState
		invalid          bool
	}{
		{"resolved with reason", id, "Corrected the next answer to 12%; result v2 remains unchanged.", Resolved, false},
		{"not applicable with reason", id, "90% refers to a different cohort, explained in the correction.", NotApplicable, false},
		{"missing reason", id, " ", Resolved, true},
		{"unknown finding", "invented", "Corrected.", Resolved, true},
		{"invalid state", id, "Accepted.", "scientific_pass", true},
	} {
		t.Run(row.name, func(t *testing.T) {
			next, err := report.Disposition(row.id, row.state, row.reason)
			if (err != nil) != row.invalid {
				t.Fatalf("disposition error = %v", err)
			}
			if row.invalid {
				return
			}
			if next.Findings[0].State != row.state || report.Findings[0].State != Open || next.SnapshotHash != report.SnapshotHash || next.Findings[0].Quote != candidate.Quote || next.NextRoundContext() != "" || !strings.Contains(next.Markdown(), row.reason) {
				t.Fatal("disposition rewrote the source or failed to record its reason")
			}
			if _, err := next.Disposition(id, Resolved, "Another reason"); err == nil {
				t.Fatal("overwrote an existing disposition")
			}
		})
	}
	if !strings.Contains(report.NextRoundContext(), id) || !strings.Contains(report.NextRoundContext(), "not scientific verdicts") {
		t.Fatal("open findings missing from next user turn context")
	}
}
