package engineeringprofile

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
)

// A validationObservation is recorded only after the final tool result and step
// settle. Input identities come from the existing contract digest, not edit counts.
type validationObservation struct {
	ContractID    string `json:"contractId"`
	Revision      int    `json:"revision"`
	CheckID       string `json:"checkId"`
	Turn          int    `json:"turn"`
	ResultSeq     uint64 `json:"resultSeq"`
	Proof         proof  `json:"proof"`
	CurrentDigest string `json:"currentDigest"`
}

func validationFeedback(previous, current validationObservation) string {
	p, c := previous.Proof, current.Proof
	if previous.ResultSeq == 0 || current.ResultSeq == previous.ResultSeq ||
		previous.ContractID != current.ContractID || previous.Revision != current.Revision || previous.CheckID != current.CheckID || p.SpecDigest != c.SpecDigest ||
		p.Status != Failed || c.Status != Failed || p.Diagnostic == nil || c.Diagnostic == nil ||
		!p.Diagnostic.Settled || !c.Diagnostic.Settled || p.Diagnostic.Fingerprint == "" || p.Diagnostic.Fingerprint != c.Diagnostic.Fingerprint ||
		p.BeforeDigest == "" || c.BeforeDigest == "" || p.BeforeDigest != p.AfterDigest || c.BeforeDigest != c.AfterDigest {
		return ""
	}
	if current.CurrentDigest == "" {
		return ""
	}
	if current.CurrentDigest != c.AfterDigest {
		return "The declared inputs now differ from the last failed check. Rerun the bound check on the current version before treating the old diagnostic as current evidence."
	}
	if p.AfterDigest == c.AfterDigest {
		return "The same bound check failed with the same visible diagnostic on identical declared inputs. Repeating it without changing the relevant input or environment has supplied no new validation evidence. Inspect the diagnostic and choose a focused next experiment."
	}
	return "The bound check failed with the same visible diagnostic after the declared input bytes changed. Compare the attempted change with the reported failure and use a focused independent check before another broad edit. Changed files alone do not verify correctness."
}

func (a *App) validationReview(ctx context.Context, agent *harness.Agent, turn, step int) (*harness.Message, error) {
	c, bound, err := Current(agent.Session())
	if err != nil || !bound || c.Kind != Change {
		return nil, err
	}
	events := agent.Session().Events()
	observations := make(map[string]validationObservation)
	notices := 0
	for _, event := range events {
		switch event.Type {
		case "engineering/validation-observation":
			var row validationObservation
			if json.Unmarshal(event.Data, &row) == nil && row.ContractID == c.ID && row.Revision == c.Revision && row.Turn == turn {
				observations[row.CheckID] = row
			}
		case "engineering/validation-review":
			var row struct {
				Turn int `json:"turn"`
			}
			if json.Unmarshal(event.Data, &row) == nil && row.Turn == turn {
				notices++
			}
		}
	}
	for _, spec := range c.Checks {
		p, seq, ok, err := settledProof(agent.Session(), c, spec.ID)
		if err != nil {
			return nil, err
		}
		previous := observations[spec.ID]
		if !ok || seq == previous.ResultSeq {
			continue
		}
		workspace, err := fstools.OpenWorkspace(agent.Session().WorkingDirectory())
		if err != nil {
			continue
		}
		current, readErr := inputDigest(ctx, workspace, spec.Files)
		_ = workspace.Close()
		if readErr != nil {
			current = ""
		}
		row := validationObservation{c.ID, c.Revision, spec.ID, turn, seq, p, current}
		if _, err = agent.Session().Append("engineering/validation-observation", row); err != nil {
			return nil, err
		}
		text := validationFeedback(previous, row)
		if text == "" || notices >= 3 {
			continue
		}
		if _, err = agent.Session().Append("engineering/validation-review", struct {
			Turn              int                   `json:"turn"`
			Step              int                   `json:"step"`
			PreviousResultSeq uint64                `json:"previousResultSeq"`
			Observation       validationObservation `json:"observation"`
		}{turn, step, previous.ResultSeq, row}); err != nil {
			return nil, err
		}
		message := contextMessage(fmt.Sprintf("engineering/validation-review/%d/%d", turn, seq), "Validation progress for check "+spec.ID+": "+text+" This advice does not change the public specification, permissions or request budget.")
		return &message, nil
	}
	return nil, nil
}
