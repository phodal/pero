package engineeringprofile

import (
	"encoding/json"
	"errors"

	"github.com/phodal/pero/harness/go/harness"
	harnesssession "github.com/phodal/pero/harness/go/session"
)

const (
	contractEvent    = "engineering/contract"
	humanClaimEvent  = "engineering/human-claimed"
	evidenceEvent    = "engineering/evidence"
	attemptEvent     = "engineering/feedback-attempt"
	measurementEvent = "engineering/measurement"
)

type humanClaim struct {
	Version   int    `json:"version"`
	Turn      int    `json:"turn"`
	MessageID string `json:"messageId"`
}

type binding struct {
	Version  int      `json:"version"`
	Turn     int      `json:"turn"`
	Contract Contract `json:"contract"`
}

type proof struct {
	Version      int                `json:"version"`
	ContractID   string             `json:"contractId"`
	Revision     int                `json:"revision"`
	CheckID      string             `json:"checkId"`
	SpecDigest   string             `json:"specDigest"`
	CallID       harness.ToolCallID `json:"callId"`
	CallSeq      uint64             `json:"callSeq"`
	BeforeDigest string             `json:"beforeDigest"`
	AfterDigest  string             `json:"afterDigest"`
	ExitCode     *int               `json:"exitCode,omitempty"`
	Status       CheckStatus        `json:"status"`
	Reason       string             `json:"reason,omitempty"`
}

type attempt struct {
	Version     int    `json:"version"`
	ContractID  string `json:"contractId"`
	Revision    int    `json:"revision"`
	Fingerprint string `json:"fingerprint"`
	MessageID   string `json:"messageId"`
}

// Current ignores inherited contracts and suspends a previous contract when a
// new human turn has not been explicitly bound. Plugin continuations retain it.
func Current(session *harness.Session) (Contract, bool, error) {
	b, ok, err := currentBinding(session)
	return cloneContract(b.Contract), ok, err
}

func latestRevision(session *harness.Session, id string) (int, error) {
	revision := 0
	for _, event := range session.Events() {
		if event.Seq <= session.Header().SeedLength || event.Type != contractEvent {
			continue
		}
		var b binding
		if err := json.Unmarshal(event.Data, &b); err != nil {
			return 0, err
		}
		if b.Version != 1 {
			return 0, errors.New("engineeringprofile: unsupported contract version")
		}
		if b.Contract.ID == id && b.Contract.Revision > revision {
			revision = b.Contract.Revision
		}
	}
	return revision, nil
}

func currentBinding(session *harness.Session) (binding, bool, error) {
	if session == nil {
		return binding{}, false, errors.New("engineeringprofile: session required")
	}
	var latest binding
	var humanTurn int
	var humanMessageID string
	var turn int
	sources := make(map[string]int)
	foundSource := false
	for _, event := range session.Events() {
		if event.Seq <= session.Header().SeedLength {
			continue
		}
		switch event.Type {
		case "turn/start":
			var start struct {
				Turn   int                `json:"turn"`
				Source harness.TurnSource `json:"source"`
			}
			if err := json.Unmarshal(event.Data, &start); err != nil {
				return binding{}, false, err
			}
			if start.Source == harness.TurnSourceHuman {
				humanTurn = start.Turn
				humanMessageID = ""
			}
			turn = start.Turn
		case humanClaimEvent:
			var claim humanClaim
			if err := json.Unmarshal(event.Data, &claim); err != nil {
				return binding{}, false, err
			}
			if claim.Version != 1 || claim.Turn < 1 || claim.MessageID == "" {
				return binding{}, false, errors.New("engineeringprofile: unsupported human claim")
			}
			humanTurn, humanMessageID = claim.Turn, claim.MessageID
		case "user/message":
			message, err := harnesssession.DecodeSurfaceMessage(event)
			if err != nil {
				return binding{}, false, err
			}
			if message.ID != "" && turn == humanTurn {
				sources[message.ID] = turn
			}
		case contractEvent:
			if err := json.Unmarshal(event.Data, &latest); err != nil {
				return binding{}, false, err
			}
			if latest.Version != 1 {
				return binding{}, false, errors.New("engineeringprofile: unsupported contract version")
			}
			if err := latest.Contract.Validate(); err != nil {
				return binding{}, false, err
			}
			// Binding is committed after admission of its exact source message.
			foundSource = latest.Contract.MessageID != "" && sources[latest.Contract.MessageID] == latest.Turn
		}
	}
	return latest, foundSource && latest.Turn == humanTurn && latest.Contract.MessageID == humanMessageID && humanTurn != 0, nil
}

func attempts(session *harness.Session, c Contract, fingerprint string) (count int, seen bool, err error) {
	for _, event := range session.Events() {
		if event.Seq <= session.Header().SeedLength || event.Type != attemptEvent {
			continue
		}
		var a attempt
		if err = json.Unmarshal(event.Data, &a); err != nil {
			return
		}
		if a.Version != 1 {
			err = errors.New("engineeringprofile: unsupported feedback version")
			return
		}
		if a.ContractID == c.ID && a.Revision == c.Revision {
			count++
			seen = seen || a.Fingerprint == fingerprint
		}
	}
	return
}

// settledProof requires both the native observation and the outer tool's
// committed final receipt. Cleanup/observer failures cannot become a PASS.
func settledProof(session *harness.Session, c Contract, checkID string) (proof, uint64, bool, error) {
	var candidate proof
	var candidateSeq uint64
	events := session.Events()
	var expected string
	for _, spec := range c.Checks {
		if spec.ID == checkID {
			expected = checkDigest(spec)
		}
	}
	for _, event := range events {
		if event.Seq <= session.Header().SeedLength || event.Type != evidenceEvent {
			continue
		}
		var p proof
		if err := json.Unmarshal(event.Data, &p); err != nil {
			return proof{}, 0, false, err
		}
		if p.Version != 1 {
			return proof{}, 0, false, errors.New("engineeringprofile: unsupported evidence version")
		}
		if p.ContractID == c.ID && p.Revision == c.Revision && p.CheckID == checkID && p.SpecDigest == expected {
			candidate, candidateSeq = p, event.Seq
		}
	}
	if candidateSeq == 0 {
		return proof{}, 0, false, nil
	}
	var callCount int
	var exactCall bool
	for _, event := range events {
		if event.Seq >= candidateSeq {
			break
		}
		if event.Type == "step/start" {
			callCount = 0
			exactCall = false
		}
		if event.Type != "tool/call" {
			continue
		}
		var call struct {
			CallID harness.ToolCallID `json:"callId"`
			Name   string             `json:"name"`
		}
		if err := json.Unmarshal(event.Data, &call); err != nil {
			return proof{}, 0, false, err
		}
		if call.CallID == candidate.CallID {
			callCount++
			exactCall = exactCall || event.Seq == candidate.CallSeq && call.Name == "engineering_check"
		}
	}
	if !exactCall || callCount != 1 {
		return candidate, 0, false, nil
	}
	var receipt *harness.ContentBlock
	var receiptSeq uint64
	for _, event := range events {
		if event.Seq <= candidateSeq {
			continue
		}
		if event.Type == "step/end" {
			if receipt != nil {
				if receipt.IsError {
					candidate.Status = Failed
					candidate.Reason = "the final check tool result failed"
				}
				return candidate, receiptSeq, true, nil
			}
			break
		}
		if event.Type == "step/start" || event.Type == "turn/end" || event.Type == "turn/start" || event.Type == "tool/call" {
			break
		}
		if event.Type != "tool/result" {
			continue
		}
		var result harness.ContentBlock
		if err := json.Unmarshal(event.Data, &result); err != nil {
			return proof{}, 0, false, err
		}
		if result.ToolCallID != candidate.CallID {
			continue
		}
		if receipt != nil {
			return candidate, 0, false, nil
		}
		receipt, receiptSeq = &result, event.Seq
	}
	return candidate, 0, false, nil
}

// Call IDs are supplied by the model and need not be unique. Accept only an
// unambiguous call in the currently open batch; a later batch cannot settle it.
func checkCallSequence(session *harness.Session, request harness.ToolRequest) (uint64, error) {
	type call struct {
		CallID harness.ToolCallID `json:"callId"`
		Name   string             `json:"name"`
	}
	var seq uint64
	count := 0
	for _, event := range session.Events() {
		if event.Type == "step/start" {
			seq, count = 0, 0
		}
		if event.Type != "tool/call" {
			continue
		}
		var c call
		if err := json.Unmarshal(event.Data, &c); err != nil {
			return 0, err
		}
		if c.CallID == request.CallID {
			count++
			if c.Name == "engineering_check" {
				seq = event.Seq
			}
		}
	}
	if seq == 0 || count != 1 {
		return 0, errors.New("engineeringprofile: check requires an unambiguous call identity in its current batch")
	}
	return seq, nil
}
