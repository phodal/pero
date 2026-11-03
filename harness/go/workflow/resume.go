package workflow

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

type resumeStep struct {
	fingerprint string
	started     bool
	ended       bool
	status      harness.SubagentStatus
	text        string
	structured  json.RawMessage
	childID     string
}

func hashArgs(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		raw = []byte("null")
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func callFingerprint(request wireRequest) (string, error) {
	payload, err := json.Marshal(struct {
		ScriptPath string          `json:"scriptPath"`
		Prompt     string          `json:"prompt"`
		Label      string          `json:"label"`
		Phase      string          `json:"phase"`
		Schema     json.RawMessage `json:"schema,omitempty"`
		Isolation  string          `json:"isolation,omitempty"`
	}{request.ScriptPath, request.Prompt, request.Label, request.Phase, request.Schema, request.Isolation})
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

// loadResume reads one run's agent() journal. A completed record can be
// returned again. A start without a terminal record must not be invoked.
func loadResume(parent *harness.Agent, call Call) (map[int]resumeStep, error) {
	if parent == nil || strings.TrimSpace(call.ResumeFrom) == "" {
		return nil, errors.New("workflow: resumeFrom requires a recorded run")
	}
	steps := map[int]resumeStep{}
	var sawStart bool
	var lastEnd string
	for _, event := range parent.Session().Events() {
		switch event.Type {
		case "workflow/start", "workflow/end", "workflow/agent-start", "workflow/agent-end":
		default:
			continue
		}
		var data progress
		if json.Unmarshal(event.Data, &data) != nil || data.RunID != call.ResumeFrom {
			if json.Unmarshal(event.Data, &data) != nil {
				return nil, errors.New("workflow: resume ledger is unreadable")
			}
			continue
		}
		switch event.Type {
		case "workflow/start":
			if sawStart {
				return nil, errors.New("workflow: resume ledger has duplicate workflow start")
			}
			if data.ScriptPath != call.ScriptPath {
				return nil, errors.New("workflow: resumeFrom belongs to a different script")
			}
			if data.ArgsHash != hashArgs(call.Args) {
				return nil, errors.New("workflow: resumeFrom args do not match the recorded run")
			}
			sawStart = true
		case "workflow/end":
			lastEnd = data.StopReason
		case "workflow/agent-start":
			if data.Sequence < 1 || data.Fingerprint == "" {
				return nil, errors.New("workflow: resume ledger has an invalid agent start")
			}
			step := steps[data.Sequence]
			if step.started {
				return nil, errors.New("workflow: resume ledger repeats an agent start")
			}
			step.started = true
			step.fingerprint = data.Fingerprint
			steps[data.Sequence] = step
		case "workflow/agent-end":
			step := steps[data.Sequence]
			if !step.started || step.ended || step.fingerprint != data.Fingerprint {
				return nil, errors.New("workflow: resume ledger has an unmatched agent result")
			}
			step.ended = true
			step.status = data.Status
			step.text = data.Text
			step.structured = append(json.RawMessage(nil), data.Structured...)
			step.childID = string(data.ChildID)
			steps[data.Sequence] = step
		}
	}
	if !sawStart {
		return nil, errors.New("workflow: resumeFrom does not match a recorded workflow")
	}
	if lastEnd == "completed" {
		return nil, errors.New("workflow: completed workflow cannot resume")
	}
	maxSeq := 0
	for seq := range steps {
		if seq > maxSeq {
			maxSeq = seq
		}
	}
	for seq := 1; seq <= maxSeq; seq++ {
		step, ok := steps[seq]
		if !ok || !step.started {
			return nil, errors.New("workflow: resume ledger is missing a recorded step")
		}
	}
	return steps, nil
}

func (run *execution) replay(request wireRequest, fingerprint string, response *wireResponse, member *progress, recorded, writeEnd *bool) (bool, error) {
	if run.ledger == nil {
		return false, nil
	}
	step, ok := run.ledger[request.sequence]
	if !ok {
		return false, nil
	}
	if step.fingerprint != fingerprint {
		return true, errors.New("workflow: resume call does not match the recorded step")
	}
	if !step.ended {
		member.Status = harness.SubagentAborted
		*writeEnd = true
		response.Status = string(harness.SubagentAborted)
		return true, nil
	}
	*recorded = true
	if step.status != harness.SubagentCompleted {
		response.Status = string(harness.SubagentAborted)
		return true, nil
	}
	response.Status = string(harness.SubagentCompleted)
	response.Text = step.text
	response.ChildID = step.childID
	if len(step.structured) > 0 {
		response.Structured = append(json.RawMessage(nil), step.structured...)
	}
	return true, nil
}
