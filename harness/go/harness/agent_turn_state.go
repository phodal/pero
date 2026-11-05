package harness

import "encoding/json"

// CurrentTurnInterrupted correlates the last terminal fact with this generation's
// current turn. An older aborted turn must not cancel newly admitted work.
func (agent *Agent) CurrentTurnInterrupted() bool {
	if agent == nil {
		return false
	}
	events := agent.Session().Events()
	for i := len(events) - 1; i >= 0; i-- {
		if events[i].Type != "turn/end" {
			continue
		}
		var end struct {
			Turn   int        `json:"turn"`
			Reason FinishKind `json:"reason"`
		}
		return json.Unmarshal(events[i].Data, &end) == nil && end.Turn == agent.CurrentTurn() && (end.Reason == FinishAborted || end.Reason == FinishError)
	}
	return false
}
