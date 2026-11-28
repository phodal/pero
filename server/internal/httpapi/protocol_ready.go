package httpapi

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/phodal/pero/server/internal/resourceref"
	"github.com/phodal/pero/server/internal/runlifecycle"
	"github.com/phodal/pero/server/internal/store"
)

// ProtocolSlice is the paper and run the browser harness is allowed to use.
// The bytes stay on this owner. The control plane does not copy them elsewhere.
type ProtocolSlice struct {
	Project      string
	Token        string
	OwnerHost    string
	LocalProject string
	AppInstance  string
	AppVersion   string
	PaperID      string
	Revision     string
	Evidence     []byte
	RunID        string
	RunOwner     string
	Root         string
}

type sliceOwner struct {
	mu     sync.Mutex
	spec   ProtocolSlice
	papers map[string]PaperRecord
	ledger map[string][]runlifecycle.Receipt
	run    runlifecycle.Owner
}

func newSliceOwner(spec ProtocolSlice) *sliceOwner {
	record := sliceRecord(spec, spec.PaperID, spec.Revision, "text/plain", spec.Evidence)
	owner := &sliceOwner{
		spec:   spec,
		papers: map[string]PaperRecord{sliceKey(spec.OwnerHost, spec.Project, spec.PaperID): record},
		ledger: map[string][]runlifecycle.Receipt{},
		run: runlifecycle.Owner{
			Project: spec.Project, OwnerHost: spec.RunOwner, Live: true, Known: true,
			Status: "running", Events: []uint64{1, 3}, RetainedFrom: 1, Generation: 1,
		},
	}
	return owner
}

func sliceRecord(spec ProtocolSlice, id, revision, media string, body []byte) PaperRecord {
	return PaperRecord{
		Resource: resourceref.Qualified{
			OwnerHost: spec.OwnerHost, SharedProject: spec.Project, LocalProject: spec.LocalProject,
			App: "paper-agent", AppInstance: spec.AppInstance, AppVersion: spec.AppVersion,
			Kind: "paper", ID: id, Revision: revision, Class: resourceref.ClassImmutable,
		},
		MediaType: media, Body: append([]byte(nil), body...), Enabled: true, Granted: true, Available: true,
	}
}

func sliceKey(owner, project, id string) string {
	return owner + "\x00" + project + "\x00" + id
}

func (o *sliceOwner) Paper(_ context.Context, owner, project, id string) (PaperRecord, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	record, ok := o.papers[sliceKey(owner, project, id)]
	if !ok {
		return PaperRecord{}, false
	}
	record.Body = append([]byte(nil), record.Body...)
	return record, true
}

func (o *sliceOwner) ImportPDF(_ context.Context, project string, body []byte, digest string) (string, string, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	sum := sha256.Sum256(body)
	if project != o.spec.Project || hex.EncodeToString(sum[:]) != digest {
		return "", "", false
	}
	id := "doc-" + digest[:12]
	o.papers[sliceKey(o.spec.OwnerHost, project, id)] = sliceRecord(o.spec, id, digest, "application/pdf", body)
	return id, digest, true
}

type sliceRuns struct{ owner *sliceOwner }

func (s *sliceRuns) Decide(_ context.Context, _ *store.Client, project string, member bool, binding runlifecycle.Binding, request runlifecycle.Request) (runlifecycle.Observation, bool) {
	return s.owner.decide(project, member, binding, request)
}

func (o *sliceOwner) decide(project string, member bool, binding runlifecycle.Binding, request runlifecycle.Request) (runlifecycle.Observation, bool) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if binding.ID != o.spec.RunID {
		return runlifecycle.Observation{}, false
	}
	observation := runlifecycle.Observe(member, project, binding, request, o.run, o.ledger[binding.ID])
	if observation.Effect != runlifecycle.EffectNone {
		return runlifecycle.Observation{Outcome: runlifecycle.OutcomeUnsupported, Effect: runlifecycle.EffectNone, Continuation: observation.Continuation}, true
	}
	if observation.Outcome == runlifecycle.OutcomeObserved || observation.Outcome == runlifecycle.OutcomeAbort || observation.Outcome == runlifecycle.OutcomeGap {
		o.ledger[binding.ID] = append(o.ledger[binding.ID], runlifecycle.Receipt{
			RequestID: request.RequestID, Operation: request.Operation, InputHash: request.InputHash, Outcome: observation.Outcome,
		})
	}
	return observation, true
}

// ProtocolReadyHandler serves the selected client routes for one project token.
// It does not accept an operator credential and it does not mount any other client route.
func ProtocolReadyHandler(spec ProtocolSlice) http.Handler {
	owner := newSliceOwner(spec)
	api := &API{paper: owner, runs: &sliceRuns{owner: owner}}
	mountDeviceDesk(api, owner)
	mux := http.NewServeMux()
	api.registerClients(mux)
	token := spec.Token
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet {
			if file, ok := harnessFile(spec.Root, r.URL.Path); ok {
				serveHarnessFile(w, file)
				return
			}
		}
		if !protocolRoute(r.Method, r.URL.Path) {
			respond(w, 404, map[string]string{"error": "absent"})
			return
		}
		header, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || header == "" || subtle.ConstantTimeCompare([]byte(header), []byte(token)) != 1 {
			respond(w, 401, map[string]string{"error": "authentication required"})
			return
		}
		client := &store.Client{ID: "browser", Name: "Browser", Role: "client", Projects: []string{spec.Project}}
		r = r.WithContext(context.WithValue(r.Context(), clientContextKey{}, client))
		mux.ServeHTTP(w, r)
	})
}

func harnessFile(root, urlPath string) (string, bool) {
	if root == "" || !strings.HasPrefix(urlPath, "/") || strings.Contains(urlPath, "..") {
		return "", false
	}
	rel := strings.TrimPrefix(urlPath, "/")
	switch rel {
	case "web/protocol-harness/index.html",
		"web/protocol-harness/session.mjs",
		"packages/app-sdk/src/capability-client.mjs",
		"packages/app-sdk/src/device-files.mjs",
		"packages/app-sdk/src/resource-read.mjs",
		"packages/app-sdk/src/run-lifecycle.mjs":
	default:
		return "", false
	}
	full := filepath.Join(root, filepath.FromSlash(rel))
	prefix := filepath.Clean(root) + string(os.PathSeparator)
	if !strings.HasPrefix(full, prefix) {
		return "", false
	}
	return full, true
}

func serveHarnessFile(w http.ResponseWriter, file string) {
	body, err := os.ReadFile(file)
	if err != nil {
		respond(w, 404, map[string]string{"error": "absent"})
		return
	}
	if strings.HasSuffix(file, ".mjs") {
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
	} else {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(200)
	_, _ = w.Write(body)
}

func protocolRoute(method, path string) bool {
	if method == http.MethodGet && path == "/api/client/v1/me" {
		return true
	}
	if method != http.MethodPost || !strings.HasPrefix(path, "/api/client/v1/projects/") {
		return false
	}
	rest := strings.TrimPrefix(path, "/api/client/v1/projects/")
	_, action, ok := strings.Cut(rest, "/")
	if !ok || strings.Contains(rest, "..") {
		return false
	}
	switch action {
	case "app-resources/paper", "runs/observe", "device-handles":
		return true
	}
	if strings.HasPrefix(action, "device-transfers/") {
		return !strings.Contains(action, "..")
	}
	return false
}
