package runlifecycle

import "testing"

func binding(kind Kind) Binding {
	return Binding{Kind: kind, OwnerHost: "host-a", Project: "lab", ID: "run-1", Generation: 2, Scope: "lab"}
}

func request(operation string) Request {
	return Request{Operation: operation, RequestID: "req-1", InputHash: "hash-a", Generation: 2}
}

func owner() Owner {
	return Owner{Project: "lab", OwnerHost: "host-a", Live: true, Status: "running", Events: []uint64{1, 2, 3}, RetainedFrom: 1, Generation: 2, SupportsCancel: true, SupportsApprove: true}
}

func see(operation string, view Owner) Observation {
	return Observe(true, "lab", binding(KindControlPlane), request(operation), view, nil)
}

func TestSameRunIsOnlyObserved(t *testing.T) {
	left, right := see(OpStatus, owner()), see(OpLookup, owner())
	if left.Status != right.Status || left.Effect != EffectNone || left.Status != "running" {
		t.Fatalf("%+v %+v", left, right)
	}
}

func TestReconnectRetryAndReplayStayDistinct(t *testing.T) {
	closed := request(OpCancel)
	closed.ConsumerClosed = true
	if outsider := Observe(false, "lab", binding(KindControlPlane), closed, owner(), nil); outsider.Outcome != OutcomeRevoked || outsider.Status != "" || outsider.Cursor != 0 || outsider.Effect != EffectNone {
		t.Fatalf("closed outsider %+v", outsider)
	}
	abort := Observe(true, "lab", binding(KindControlPlane), closed, owner(), nil)
	if abort.Outcome != OutcomeAbort || abort.Effect != EffectNone || abort.Status != "running" {
		t.Fatalf("%+v", abort)
	}
	timed := request(OpStatus)
	timed.TimedOut = true
	if Observe(true, "lab", binding(KindControlPlane), timed, owner(), nil).Outcome != OutcomeTimeout {
		t.Fatal("timeout")
	}
	failed := owner()
	failed.Status = "failed"
	if see(OpStatus, failed).Outcome != OutcomeFailure {
		t.Fatal("failure")
	}
	known := owner()
	known.Known = true
	if see(OpStart, known).Effect != EffectNone || see(OpStart, owner()).Effect != EffectApply {
		t.Fatal("start")
	}
	if see(OpRetry, owner()).Outcome != OutcomeUnknown || see(OpRetry, known).Effect != EffectApply {
		t.Fatal("retry")
	}
	cursor := uint64(1)
	replay := request(OpReplay)
	replay.Cursor = &cursor
	gapped := owner()
	gapped.Events = []uint64{1, 1, 3}
	gap := Observe(true, "lab", binding(KindControlPlane), replay, gapped, nil)
	if gap.Outcome != OutcomeGap || len(gap.Events) != 0 {
		t.Fatalf("%+v", gap)
	}
	ordered := request(OpEvents)
	ordered.Cursor = &cursor
	if events := Observe(true, "lab", binding(KindControlPlane), ordered, owner(), nil).Events; len(events) != 2 || events[0] != 2 || events[1] != 3 {
		t.Fatalf("%v", events)
	}
	expired := request(OpEvents)
	zero := uint64(0)
	expired.Cursor = &zero
	dropped := owner()
	dropped.RetainedFrom = 3
	if Observe(true, "lab", binding(KindControlPlane), expired, dropped, nil).Outcome != OutcomeExpired {
		t.Fatal("expired")
	}
}

func TestDuplicatesRestartsAndApprovalsDoNotInventWork(t *testing.T) {
	stored := []Receipt{{RequestID: "req-1", Operation: OpStart, InputHash: "hash-a", Outcome: OutcomeApplied}}
	if Observe(true, "lab", binding(KindControlPlane), request(OpStart), owner(), stored).Outcome != OutcomeDuplicate {
		t.Fatal("duplicate")
	}
	changed := request(OpStart)
	changed.InputHash = "hash-b"
	if Observe(true, "lab", binding(KindControlPlane), changed, owner(), stored).Outcome != OutcomeConflict {
		t.Fatal("conflict")
	}
	down := owner()
	down.Live = false
	down.Restarted = true
	restarted := see(OpStatus, down)
	if restarted.Outcome != OutcomeInterrupted || restarted.Effect != EffectNone {
		t.Fatalf("%+v", restarted)
	}
	if see(OpCancel, owner()).Effect != EffectCancel {
		t.Fatal("cancel")
	}
	quiet := owner()
	quiet.SupportsCancel = false
	if see(OpCancel, quiet).Outcome != OutcomeUnsupported {
		t.Fatal("no cancel")
	}
	if see(OpApprove, owner()).Effect != EffectApprove {
		t.Fatal("approve")
	}
	decided := owner()
	decided.ApprovalRecorded = true
	if see(OpApprove, decided).Effect != EffectNone {
		t.Fatal("second approval")
	}
	stale := request(OpStatus)
	stale.Generation = 1
	if got := Observe(true, "lab", binding(KindControlPlane), stale, owner(), nil); got.Outcome != OutcomeGeneration || got.Status != "" || got.Effect != EffectNone {
		t.Fatalf("generation %+v", got)
	}
	old := binding(KindControlPlane)
	old.Generation = 1
	blind := request(OpCancel)
	blind.Generation = 0
	if got := Observe(true, "lab", old, blind, owner(), nil); got.Outcome != OutcomeGeneration || got.Effect != EffectNone || got.Status != "" {
		t.Fatalf("stale binding %+v", got)
	}
	if Observe(false, "lab", binding(KindControlPlane), request(OpStatus), owner(), nil).Outcome != OutcomeRevoked {
		t.Fatal("revoked")
	}
	if Observe(true, "other", binding(KindControlPlane), request(OpStatus), owner(), nil).Outcome != OutcomeProject {
		t.Fatal("project")
	}
	acp := Observe(true, "lab", binding(KindACP), request(OpStart), owner(), nil)
	if acp.Outcome != OutcomeUnsupported || acp.Continuation != "unsupported" {
		t.Fatalf("%+v", acp)
	}
	watched := Observe(true, "lab", binding(KindACP), request(OpStatus), owner(), nil)
	if watched.Continuation != "unsupported" || watched.Effect != EffectNone {
		t.Fatalf("%+v", watched)
	}
}
