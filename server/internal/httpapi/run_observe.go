package httpapi

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	"github.com/phodal/pero/server/internal/runlifecycle"
)

// RunSource is the existing owner of one persistent Run. The projection does not store a second copy.
type RunSource interface {
	View(id string) (runlifecycle.Owner, []runlifecycle.Receipt, bool)
	Commit(id string, receipt runlifecycle.Receipt, effect string)
}

func (a *API) observeRun(w http.ResponseWriter, r *http.Request) {
	for _, header := range []string{"X-Pero-Owner", "X-Pero-Prompt", "X-Worker-Token", "X-Operator-Token"} {
		if r.Header.Get(header) != "" {
			respond(w, 400, map[string]string{"error": runlifecycle.OutcomeStale})
			return
		}
	}
	project := r.PathValue("project")
	if strings.Contains(project, "..") || strings.ContainsAny(project, "/\\") {
		respond(w, 400, map[string]string{"error": runlifecycle.OutcomeTraversal})
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
	if a.runs == nil {
		respond(w, 409, map[string]string{"error": runlifecycle.OutcomeUnknown, "effect": runlifecycle.EffectNone})
		return
	}
	owner, ledger, found := a.runs.View(call.Binding.ID)
	if !found {
		owner = runlifecycle.Owner{OwnerHost: call.Binding.OwnerHost, Status: "unknown"}
	}
	observation := runlifecycle.Observe(member, project, call.Binding, call.Request, owner, ledger)
	if observation.Effect != runlifecycle.EffectNone {
		a.runs.Commit(call.Binding.ID, runlifecycle.Receipt{
			RequestID: call.Request.RequestID, Operation: call.Request.Operation,
			InputHash: call.Request.InputHash, Outcome: observation.Outcome,
		}, observation.Effect)
	}
	respond(w, runStatus(observation.Outcome), observation)
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
			respond(w, 400, map[string]string{"error": runlifecycle.OutcomeStale})
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
	case runlifecycle.OutcomeUnsupported:
		return 404
	default:
		return 200
	}
}
