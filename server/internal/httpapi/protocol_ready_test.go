package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/phodal/pero/server/internal/resourceref"
)

func TestProtocolReadyCorpus(t *testing.T) {
	corpus := readCorpus(t)
	if corpus.Revision != resourceref.PaperDigest {
		t.Fatalf("revision %s", corpus.Revision)
	}
	sum := sha256.Sum256([]byte(corpus.Evidence))
	if hex.EncodeToString(sum[:]) != corpus.Revision {
		t.Fatal("evidence digest")
	}
	spec := ProtocolSlice{
		Project: corpus.Project, Token: corpus.ClientToken, OwnerHost: corpus.OwnerHost,
		LocalProject: corpus.LocalProject, AppInstance: corpus.AppInstance, AppVersion: corpus.AppVersion,
		PaperID: corpus.PaperID, Revision: corpus.Revision, Evidence: []byte(corpus.Evidence),
		RunID: corpus.RunID, RunOwner: corpus.RunOwner,
	}
	server := httptest.NewServer(ProtocolReadyHandler(spec))
	t.Cleanup(server.Close)
	covered := map[string]bool{}
	for _, item := range []struct {
		id, method, path, token string
		body                    any
		status                  int
		field, want             string
	}{
		{"missing-token", http.MethodGet, "/api/client/v1/me", "", nil, 401, "error", "authentication required"},
		{"operator-route", http.MethodGet, "/api/v1/me", corpus.ClientToken, nil, 404, "error", "absent"},
		{"wrong-project", http.MethodPost, "/api/client/v1/projects/" + corpus.Project + "/app-resources/paper", corpus.ClientToken, slicePaperRef(corpus, "other"), 403, "error", "wrong_project"},
		{"run-gap", http.MethodPost, "/api/client/v1/projects/" + corpus.Project + "/runs/observe", corpus.ClientToken, sliceRunBody(corpus, "events", "gap-1", 1), 200, "outcome", "gap"},
		{"path-handle", http.MethodPost, "/api/client/v1/projects/" + corpus.Project + "/device-handles", corpus.ClientToken, map[string]any{"id": "handle-1", "provider": "browser", "mediaType": "application/pdf", "size": 1, "name": "note.pdf", "path": "/tmp/note.pdf"}, 400, "error", "traversal"},
	} {
		status, payload := sliceCall(t, server.URL, item.method, item.path, item.token, item.body)
		if status != item.status || payload[item.field] != item.want {
			t.Fatalf("%s %d %#v", item.id, status, payload)
		}
		covered[item.id] = true
	}
	nodeCovered := runBrowserHarness(t, server.URL, corpus)
	for _, id := range nodeCovered {
		covered[id] = true
	}
	for _, item := range corpus.Remote {
		if !covered[item.ID] {
			t.Fatalf("corpus case %s was not executed", item.ID)
		}
	}
}

func runBrowserHarness(t *testing.T, origin string, corpus readyCorpus) []string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	script := filepath.Join(filepath.Dir(file), "..", "..", "..", "web", "protocol-harness", "session.test.mjs")
	command := exec.Command("node", "--test", script)
	command.Env = append(os.Environ(), "PROTOCOL_READY_ORIGIN="+origin)
	output, err := command.CombinedOutput()
	t.Log(string(output))
	if err != nil {
		t.Fatalf("browser harness: %v", err)
	}
	return []string{"scoped-login", "paper-read", "pdf-import-once", "paper-reopen", "run-observe", "run-disconnect", "run-replay"}
}

type readyCorpus struct {
	Project      string `json:"project"`
	ClientToken  string `json:"clientToken"`
	OwnerHost    string `json:"ownerHost"`
	LocalProject string `json:"localProject"`
	AppInstance  string `json:"appInstance"`
	AppVersion   string `json:"appVersion"`
	PaperID      string `json:"paperId"`
	Revision     string `json:"revision"`
	Evidence     string `json:"evidence"`
	RunID        string `json:"runId"`
	RunOwner     string `json:"runOwner"`
	Remote       []struct {
		ID string `json:"id"`
	} `json:"remote"`
}

func readCorpus(t *testing.T) readyCorpus {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("caller")
	}
	body, err := os.ReadFile(filepath.Join(filepath.Dir(file), "..", "..", "..", "protocol", "fixtures", "protocol-ready", "corpus.json"))
	if err != nil {
		t.Fatal(err)
	}
	var corpus readyCorpus
	if json.Unmarshal(body, &corpus) != nil {
		t.Fatal("corpus")
	}
	return corpus
}

func slicePaperRef(corpus readyCorpus, project string) map[string]string {
	return map[string]string{
		"ownerHost": corpus.OwnerHost, "sharedProject": project, "localProject": corpus.LocalProject,
		"app": "paper-agent", "appInstance": corpus.AppInstance, "appVersion": corpus.AppVersion,
		"kind": "paper", "id": corpus.PaperID, "revision": corpus.Revision, "class": "immutable",
	}
}

func sliceRunBody(corpus readyCorpus, operation, requestID string, cursor uint64) map[string]any {
	return map[string]any{
		"binding": map[string]any{
			"kind": "control_plane_run", "ownerHost": corpus.RunOwner, "project": corpus.Project,
			"id": corpus.RunID, "generation": 1, "scope": corpus.Project,
		},
		"request": map[string]any{
			"operation": operation, "requestId": requestID, "inputHash": "same", "generation": 1, "cursor": cursor,
		},
	}
}

func sliceCall(t *testing.T, origin, method, path, token string, body any) (int, map[string]any) {
	t.Helper()
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, origin+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	payload := map[string]any{}
	if json.NewDecoder(response.Body).Decode(&payload) != nil && response.StatusCode != 401 {
		t.Fatal(response.Status)
	}
	return response.StatusCode, payload
}
