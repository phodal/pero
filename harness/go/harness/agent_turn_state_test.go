package harness

import "testing"

func TestCurrentTurnInterruptionCorrelation(t *testing.T) {
	for _, row := range []struct {
		name           string
		current, ended int
		reason         FinishKind
		want           bool
	}{
		{"aborted", 2, 2, FinishAborted, true}, {"failed", 2, 2, FinishError, true}, {"normal", 2, 2, FinishStop, false}, {"older aborted", 3, 2, FinishAborted, false},
	} {
		t.Run(row.name, func(t *testing.T) {
			session := NewSession("turn-correlation", "")
			_, err := session.Append("turn/end", struct {
				Turn   int        `json:"turn"`
				Reason FinishKind `json:"reason"`
			}{row.ended, row.reason})
			if err != nil {
				t.Fatal(err)
			}
			agent := &Agent{session: session, turn: row.current}
			if agent.CurrentTurnInterrupted() != row.want {
				t.Fatal("terminal from a different turn changed current interruption state")
			}
		})
	}
}
