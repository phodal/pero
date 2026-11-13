package scienceenv

import (
	"errors"
	"testing"
)

func TestComputationJournal(t *testing.T) {
	for _, test := range []struct {
		name, before, after, cell string
		out                       Output
		err                       error
		interrupted, reject       bool
	}{
		{name: "complete", before: "idle", after: "idle", cell: "completed", out: Output{Stdout: "42\n"}},
		{name: "exception retains process", before: "idle", after: "idle", cell: "failed", out: Output{Error: "ValueError: sample"}},
		{name: "cancel discards state", before: "idle", after: "closed", cell: "interrupted", err: contextCanceled, interrupted: true},
		{name: "process failure", before: "idle", after: "closed", cell: "failed", err: errors.New("process exited")},
		{name: "busy", before: "running", reject: true},
		{name: "closed", before: "closed", reject: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			before := Journal{Status: KernelStatus(test.before), Generation: 3}
			started, err := before.begin("result = 42", UserCell)
			if (err != nil) != test.reject {
				t.Fatalf("begin: %v", err)
			}
			if test.reject {
				return
			}
			after := started.finish(test.out, test.err, test.interrupted)
			if after.Status != KernelStatus(test.after) || len(after.History) != 1 || after.History[0].Status != CellStatus(test.cell) {
				t.Fatalf("receipt: %+v", after)
			}
			if before.Status != KernelStatus(test.before) || len(before.History) != 0 || started.History[0].Status != "running" {
				t.Fatal("transition mutated its input")
			}
			if after.History[0].Origin != UserCell || after.History[0].Generation != 3 {
				t.Fatal("execution identity lost")
			}
		})
	}
}

var contextCanceled = errors.New("context canceled; its state was discarded")
