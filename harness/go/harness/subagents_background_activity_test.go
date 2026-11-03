package harness

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestBackgroundActivityRetainsExactOwnershipAndBlocksCapture(t *testing.T) {
	gate, r, record := structuredGateFixture(t)
	record.activation.retainActivities = true
	activity, err := r.RetainBackgroundActivity(record.child)
	if err != nil || activity == nil {
		t.Fatalf("retain: %v", err)
	}
	if _, err := gate.BeginCapture(); !errors.Is(err, ErrSubagentCannotComplete) {
		t.Fatalf("capture passed unfinished tool work: %v", err)
	}
	// Archive must see an idle child that still owns a live process.
	r.parentRecords = map[*Agent]map[*subagentRecord]struct{}{record.parent: {record: {}}}
	if snapshot := r.CaptureSessionActivity(record.parent.ID()); !snapshot.Active {
		t.Fatal("idle background owner disappeared from activity snapshot")
	}
	waiting, cancel := context.WithTimeout(t.Context(), 50*time.Millisecond)
	defer cancel()
	if observed, err := r.WaitForChildren(waiting, record.parent); !observed || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unfinished process was not joined: observed=%v err=%v", observed, err)
	}
	activity.Release(nil)
	activity.Release(nil)
	release, err := gate.BeginCapture()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.RetainBackgroundActivity(record.child); !errors.Is(err, ErrSubagentInputClosed) {
		t.Fatalf("committed capture allowed new background effects: %v", err)
	}
	release()
	old, err := r.RetainBackgroundActivity(record.child)
	if err != nil {
		t.Fatal(err)
	}
	// Releasing old work must never decrement a replacement activation's work.
	replacement := newSubagentActivation("caller")
	replacement.activities = 1
	r.records[record.child.ID()] = &subagentRecord{snapshot: record.snapshot, child: record.child, activation: replacement}
	if err := old.Deliver(t.Context(), dshInboxMessage("stale-process", false)); err == nil {
		t.Fatal("old process delivered into a replacement activation")
	}
	old.Release(nil)
	if replacement.activities != 1 || record.activation.activities != 0 {
		t.Fatal("activity release followed a session-ID replacement")
	}
}

func TestBackgroundActivityFailureCannotReturnEarlierSuccess(t *testing.T) {
	_, r, record := structuredGateFixture(t)
	record.activation.retainActivities = true
	activity, err := r.RetainBackgroundActivity(record.child)
	if err != nil {
		t.Fatal(err)
	}
	failure := errors.New("completion persistence failed")
	activity.Release(failure)
	result := activationResult(record, TurnOutcome{})
	if result.Status != SubagentFailed || result.Diagnostic != failure.Error() {
		t.Fatalf("activity failure was hidden: %+v", result)
	}
}
