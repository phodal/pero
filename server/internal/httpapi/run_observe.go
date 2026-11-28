package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/phodal/pero/server/internal/runlifecycle"
	"github.com/phodal/pero/server/internal/store"
)

// RunSource decides one observation under a single lock. The run's project comes from the source.
type RunSource interface {
	Decide(ctx context.Context, client *store.Client, project string, member bool, binding runlifecycle.Binding, request runlifecycle.Request) (runlifecycle.Observation, bool)
}

func (a *API) observeRun(w http.ResponseWriter, r *http.Request) {
	for _, header := range []string{"X-Pero-Owner", "X-Pero-Prompt", "X-Worker-Token", "X-Operator-Token"} {
		if r.Header.Get(header) != "" {
			respond(w, 400, map[string]string{"outcome": runlifecycle.OutcomeStale, "effect": runlifecycle.EffectNone})
			return
		}
	}
	project := r.PathValue("project")
	if strings.Contains(project, "..") || strings.ContainsAny(project, "/\\") {
		respond(w, 400, map[string]string{"outcome": runlifecycle.OutcomeTraversal, "effect": runlifecycle.EffectNone})
		return
	}
	call, ok := decodeRun(w, r)
	if !ok {
		return
	}
	client := clientIdentity(r)
	member := false
	for _, allowed := range client.Projects {
		if allowed == project {
			member = true
		}
	}
	if !member || a.runs == nil {
		code := runlifecycle.OutcomeRevoked
		status := 403
		if member {
			code = runlifecycle.OutcomeUnknown
			status = 404
		}
		respond(w, status, map[string]string{"outcome": code, "effect": runlifecycle.EffectNone})
		return
	}
	observation, found := a.runs.Decide(r.Context(), client, project, member, call.Binding, call.Request)
	if !found {
		respond(w, 404, map[string]string{"outcome": runlifecycle.OutcomeUnknown, "effect": runlifecycle.EffectNone})
		return
	}
	respond(w, runStatus(observation.Outcome), scrubRun(observation))
}

type persistedRuns struct {
	db *store.Store
	mu sync.Mutex
}

func (p *persistedRuns) Decide(ctx context.Context, client *store.Client, project string, member bool, binding runlifecycle.Binding, request runlifecycle.Request) (runlifecycle.Observation, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !member || p.db == nil {
		return runlifecycle.Observe(false, project, binding, request, runlifecycle.Owner{Project: project}, nil), true
	}
	run, err := p.db.ClientProjectRun(ctx, client, project, binding.ID)
	if errors.Is(err, store.ErrNotFound) {
		return runlifecycle.Observation{}, false
	}
	if err != nil {
		return runlifecycle.Observation{Outcome: runlifecycle.OutcomeUnknown, Effect: runlifecycle.EffectNone}, true
	}
	tail, err := p.db.Events(ctx, run.ID)
	if err != nil {
		return runlifecycle.Observation{Outcome: runlifecycle.OutcomeUnknown, Effect: runlifecycle.EffectNone}, true
	}
	seqs := []uint64{}
	var retained uint64 = 1
	if tail != nil {
		for _, event := range tail.Events {
			if event.Seq > 0 {
				seqs = append(seqs, uint64(event.Seq))
			}
		}
		if tail.FirstSeq != nil && *tail.FirstSeq > 0 {
			retained = uint64(*tail.FirstSeq)
		}
	}
	owner := runlifecycle.Owner{
		Project: run.Spec.ProjectID, OwnerHost: "control-plane", Live: run.Status != "reconcile", Known: true,
		Status: run.Status, Events: seqs, RetainedFrom: retained, Generation: uint64(run.Generation),
		SupportsCancel: run.Status == "queued" || run.Status == "running" || run.Status == "cancel_requested",
	}
	receipts, err := p.db.ObservationReceipts(ctx, project, run.ID)
	if err != nil {
		return runlifecycle.Observation{Outcome: runlifecycle.OutcomeUnknown, Effect: runlifecycle.EffectNone}, true
	}
	observation := runlifecycle.Observe(true, project, binding, request, owner, receipts)
	if observation.Effect == runlifecycle.EffectApply || observation.Effect == runlifecycle.EffectApprove {
		return runlifecycle.Observation{Outcome: runlifecycle.OutcomeUnsupported, Effect: runlifecycle.EffectNone, Continuation: observation.Continuation}, true
	}
	if observation.Effect == runlifecycle.EffectCancel {
		if _, err = p.db.ClientCancelRun(ctx, client, run.Ref()); err != nil {
			return runlifecycle.Observation{Outcome: runlifecycle.OutcomeUnknown, Effect: runlifecycle.EffectNone}, true
		}
	}
	if observation.Effect != runlifecycle.EffectNone {
		err = p.db.SaveObservationReceipt(ctx, project, run.ID, runlifecycle.Receipt{
			RequestID: request.RequestID, Operation: request.Operation, InputHash: request.InputHash, Outcome: observation.Outcome,
		})
		if errors.Is(err, store.ErrConflict) {
			receipts, err = p.db.ObservationReceipts(ctx, project, run.ID)
			if err != nil {
				return runlifecycle.Observation{Outcome: runlifecycle.OutcomeUnknown, Effect: runlifecycle.EffectNone}, true
			}
			observation = runlifecycle.Observe(true, project, binding, request, owner, receipts)
		} else if err != nil {
			return runlifecycle.Observation{Outcome: runlifecycle.OutcomeUnknown, Effect: runlifecycle.EffectNone}, true
		}
	}
	return observation, true
}

func scrubRun(observation runlifecycle.Observation) any {
	switch observation.Outcome {
	case runlifecycle.OutcomeRevoked, runlifecycle.OutcomeProject, runlifecycle.OutcomeGeneration, runlifecycle.OutcomeConflict, runlifecycle.OutcomeStale, runlifecycle.OutcomeTraversal, runlifecycle.OutcomeUnknown:
		return map[string]string{"outcome": observation.Outcome, "effect": runlifecycle.EffectNone}
	default:
		return observation
	}
}

type runCall struct {
	Binding runlifecycle.Binding `json:"binding"`
	Request runlifecycle.Request `json:"request"`
}

func decodeRun(w http.ResponseWriter, r *http.Request) (runCall, bool) {
	var call runCall
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	body, err := io.ReadAll(r.Body)
	if err != nil || len(bytes.TrimSpace(body)) == 0 || bytes.TrimSpace(body)[0] != '{' {
		respond(w, 400, map[string]string{"error": "expected a bounded JSON object"})
		return call, false
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(body, &raw) != nil {
		respond(w, 400, map[string]string{"error": "invalid JSON request or request exceeds limit"})
		return call, false
	}
	for _, key := range []string{"prompt", "token", "path", "ownerHost"} {
		if _, present := raw[key]; present {
			respond(w, 400, map[string]string{"outcome": runlifecycle.OutcomeStale, "effect": runlifecycle.EffectNone})
			return call, false
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&call) != nil {
		respond(w, 400, map[string]string{"error": "invalid JSON request or request exceeds limit"})
		return call, false
	}
	return call, true
}

func runStatus(outcome string) int {
	switch outcome {
	case runlifecycle.OutcomeRevoked, runlifecycle.OutcomeProject:
		return 403
	case runlifecycle.OutcomeConflict, runlifecycle.OutcomeStale, runlifecycle.OutcomeGeneration:
		return 409
	case runlifecycle.OutcomeTraversal:
		return 400
	case runlifecycle.OutcomeUnsupported, runlifecycle.OutcomeUnknown:
		return 404
	default:
		return 200
	}
}
