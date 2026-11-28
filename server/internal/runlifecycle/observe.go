// Package runlifecycle projects an existing Run or ACP session.
// It does not advance a Run, a campaign, or a worker attempt.
package runlifecycle

import "strings"

type Kind string

const (
	KindAppAgent       Kind = "app_agent_run"
	KindControlPlane   Kind = "control_plane_run"
	KindACP            Kind = "acp_session"
	OpStatus                = "status"
	OpLookup                = "lookup"
	OpEvents                = "events"
	OpCancel                = "cancel"
	OpApprove               = "approve"
	OpStart                 = "start"
	OpRetry                 = "retry"
	OpReplay                = "replay"
	OpReconnect             = "reconnect"
	OutcomeObserved         = "observed"
	OutcomeApplied          = "applied"
	OutcomeAbort            = "transport_abort"
	OutcomeCancel           = "execution_cancel"
	OutcomeTimeout          = "timeout"
	OutcomeFailure          = "execution_failure"
	OutcomeInterrupted      = "interrupted"
	OutcomeUnknown          = "unknown"
	OutcomeGap              = "gap"
	OutcomeExpired          = "expired_cursor"
	OutcomeGeneration       = "generation_changed"
	OutcomeDuplicate        = "duplicate"
	OutcomeConflict         = "conflict"
	OutcomeStale            = "stale_binding"
	OutcomeRevoked          = "revoked"
	OutcomeProject          = "wrong_project"
	OutcomeTraversal        = "traversal"
	OutcomeUnsupported      = "unsupported"
	OutcomeApproved         = "approved"
	EffectNone              = "none"
	EffectApply             = "apply_once"
	EffectCancel            = "cancel_owner"
	EffectApprove           = "approve_owner"
)

type Binding struct {
	Kind       Kind   `json:"kind"`
	OwnerHost  string `json:"ownerHost"`
	Project    string `json:"project"`
	ID         string `json:"id"`
	Generation uint64 `json:"generation"`
	Scope      string `json:"scope"`
}

type Request struct {
	Operation      string  `json:"operation"`
	RequestID      string  `json:"requestId"`
	InputHash      string  `json:"inputHash"`
	Cursor         *uint64 `json:"cursor,omitempty"`
	Generation     uint64  `json:"generation"`
	ConsumerClosed bool    `json:"consumerClosed,omitempty"`
	TimedOut       bool    `json:"timedOut,omitempty"`
}

type Receipt struct {
	RequestID string
	Operation string
	InputHash string
	Outcome   string
}

type Owner struct {
	OwnerHost        string
	Live             bool
	Known            bool
	Restarted        bool
	Status           string
	Events           []uint64
	RetainedFrom     uint64
	Generation       uint64
	SupportsCancel   bool
	SupportsApprove  bool
	ApprovalRecorded bool
}

type Observation struct {
	Status       string   `json:"status"`
	Outcome      string   `json:"outcome"`
	Effect       string   `json:"effect"`
	Cursor       uint64   `json:"cursor"`
	Events       []uint64 `json:"events"`
	Continuation string   `json:"continuation"`
}

func Observe(member bool, project string, binding Binding, request Request, owner Owner, ledger []Receipt) Observation {
	continuation := "not_applicable"
	if binding.Kind == KindACP {
		continuation = "unsupported"
	}
	status := owner.Status
	if request.ConsumerClosed {
		return done(status, OutcomeAbort, EffectNone, owner, continuation)
	}
	if request.TimedOut {
		return done(status, OutcomeTimeout, EffectNone, owner, continuation)
	}
	if !member {
		return done(status, OutcomeRevoked, EffectNone, owner, continuation)
	}
	if binding.Project != project || traversed(binding.Project) {
		outcome := OutcomeProject
		if traversed(binding.Project) {
			outcome = OutcomeTraversal
		}
		return done(status, outcome, EffectNone, owner, continuation)
	}
	for _, value := range []string{binding.OwnerHost, binding.ID, binding.Scope, request.RequestID, request.InputHash} {
		if traversed(value) {
			return done(status, OutcomeTraversal, EffectNone, owner, continuation)
		}
	}
	if binding.OwnerHost != owner.OwnerHost {
		return done(status, OutcomeStale, EffectNone, owner, continuation)
	}
	if request.Generation != 0 && request.Generation != owner.Generation {
		shown := status
		if !owner.Live {
			shown = OutcomeInterrupted
		}
		return done(shown, OutcomeGeneration, EffectNone, owner, continuation)
	}
	if binding.Kind == KindACP && (request.Operation == OpStart || request.Operation == OpRetry || request.Operation == OpCancel || request.Operation == OpApprove) {
		return done(status, OutcomeUnsupported, EffectNone, owner, continuation)
	}
	for _, stored := range ledger {
		if stored.RequestID != request.RequestID {
			continue
		}
		outcome := OutcomeConflict
		if stored.InputHash == request.InputHash && stored.Operation == request.Operation {
			outcome = OutcomeDuplicate
		}
		return done(status, outcome, EffectNone, owner, continuation)
	}
	if !owner.Live && (owner.Restarted || !owner.Known) {
		outcome := OutcomeUnknown
		if owner.Restarted {
			outcome = OutcomeInterrupted
		}
		return done(OutcomeInterrupted, outcome, EffectNone, owner, continuation)
	}
	if request.Operation == OpStart && owner.Known {
		return done(status, OutcomeObserved, EffectNone, owner, continuation)
	}
	switch request.Operation {
	case OpStatus, OpLookup, OpReconnect:
		outcome := OutcomeObserved
		if owner.Status == "failed" {
			outcome = OutcomeFailure
		}
		return done(status, outcome, EffectNone, owner, continuation)
	case OpEvents, OpReplay:
		return events(status, request, owner, continuation)
	case OpStart:
		return done(status, OutcomeApplied, EffectApply, owner, continuation)
	case OpRetry:
		if owner.Known {
			return done(status, OutcomeApplied, EffectApply, owner, continuation)
		}
		return done(status, OutcomeUnknown, EffectNone, owner, continuation)
	case OpCancel:
		if owner.SupportsCancel {
			return done(status, OutcomeCancel, EffectCancel, owner, continuation)
		}
		return done(status, OutcomeUnsupported, EffectNone, owner, continuation)
	case OpApprove:
		if !owner.SupportsApprove {
			return done(status, OutcomeUnsupported, EffectNone, owner, continuation)
		}
		if owner.ApprovalRecorded {
			return done(status, OutcomeDuplicate, EffectNone, owner, continuation)
		}
		return done(status, OutcomeApproved, EffectApprove, owner, continuation)
	default:
		return done(status, OutcomeUnsupported, EffectNone, owner, continuation)
	}
}

func events(status string, request Request, owner Owner, continuation string) Observation {
	cursor := uint64(0)
	if request.Cursor != nil {
		cursor = *request.Cursor
	}
	if owner.RetainedFrom > 1 && cursor+1 < owner.RetainedFrom {
		return done(status, OutcomeExpired, EffectNone, owner, continuation)
	}
	seqs := []uint64{}
	previous := cursor
	gap := false
	for _, seq := range owner.Events {
		if seq <= cursor {
			continue
		}
		if seq > previous+1 {
			gap = true
			break
		}
		if len(seqs) > 0 && seqs[len(seqs)-1] == seq {
			continue
		}
		seqs = append(seqs, seq)
		previous = seq
	}
	outcome := OutcomeObserved
	if gap {
		outcome = OutcomeGap
	}
	observation := done(status, outcome, EffectNone, owner, continuation)
	observation.Events = seqs
	if len(seqs) > 0 {
		observation.Cursor = seqs[len(seqs)-1]
	} else {
		observation.Cursor = cursor
	}
	return observation
}

func done(status, outcome, effect string, owner Owner, continuation string) Observation {
	cursor := uint64(0)
	if len(owner.Events) > 0 {
		cursor = owner.Events[len(owner.Events)-1]
	}
	return Observation{Status: status, Outcome: outcome, Effect: effect, Cursor: cursor, Events: []uint64{}, Continuation: continuation}
}

func traversed(value string) bool {
	return strings.Contains(value, "..") || strings.ContainsAny(value, "/\\\x00")
}
