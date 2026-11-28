package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/phodal/pero/server/internal/resourceref"
	"github.com/phodal/pero/server/internal/store"
)

type paperMap struct{ records []PaperRecord }

type countingPaper struct {
	paperMap
	calls int
}

func (c *countingPaper) Paper(owner, project, id string) (PaperRecord, bool) {
	c.calls++
	return c.paperMap.Paper(owner, project, id)
}

func (m paperMap) Paper(owner, project, id string) (PaperRecord, bool) {
	for _, record := range m.records {
		if record.Resource.OwnerHost == owner && record.Resource.SharedProject == project && record.Resource.ID == id {
			return record, true
		}
	}
	return PaperRecord{}, false
}

func paperRecord(owner, body string, available, enabled, granted bool) PaperRecord {
	raw := []byte(body)
	sum := sha256.Sum256(raw)
	return PaperRecord{
		Resource: resourceref.Qualified{
			OwnerHost: owner, SharedProject: "lab", LocalProject: "local-lab", App: "paper-agent",
			AppInstance: "paper-agent@" + owner, AppVersion: "1", Kind: "paper", ID: "paper-1",
			Revision: hex.EncodeToString(sum[:]), Class: resourceref.ClassImmutable,
		},
		MediaType: "text/plain", Body: raw, Enabled: enabled, Granted: granted, Available: available,
	}
}

func TestPaperRouteReadsTheOwningEvidence(t *testing.T) {
	const secret = "operator-secret-worker-token-/var/pero/papers"
	api := &API{paper: paperMap{records: []PaperRecord{
		paperRecord("local", resourceref.PaperEvidence, true, true, true),
		paperRecord("host-b", resourceref.PaperEvidence, true, true, true),
		paperRecord("host-c", "other-host-evidence", true, true, true), // revision is this body's own digest
	}}}
	local := postPaper(t, api, "lab", []string{"lab"}, paperBody("local", resourceref.PaperDigest), nil)
	remote := postPaper(t, api, "lab", []string{"lab"}, paperBody("host-b", resourceref.PaperDigest), nil)
	if local["body"] != remote["body"] || local["digest"] != resourceref.PaperDigest || remote["ownerHost"] != "host-b" || remote["provenance"] != resourceref.DomainProvenance {
		t.Fatalf("local %#v remote %#v", local, remote)
	}
	raw, _ := base64.StdEncoding.DecodeString(local["body"])
	if string(raw) != resourceref.PaperEvidence || strings.Contains(local["body"], secret) {
		t.Fatalf("body %q", raw)
	}
	other := sha256.Sum256([]byte("other-host-evidence"))
	separate := postPaper(t, api, "lab", []string{"lab"}, paperBody("host-c", hex.EncodeToString(other[:])), nil)
	if separate["body"] == local["body"] || separate["ownerHost"] != "host-c" {
		t.Fatalf("hosts collapsed %#v", separate)
	}
	down := paperMap{records: []PaperRecord{paperRecord("host-b", resourceref.PaperEvidence, false, true, true), paperRecord("host-c", "other-host-evidence", true, true, true)}}
	api.paper = down
	status, payload := postPaperStatus(t, api, "lab", []string{"lab"}, paperBody("host-b", resourceref.PaperDigest), nil)
	if status != 409 || payload["error"] != "owner_unavailable" || strings.Contains(payload["error"], "other-host") {
		t.Fatalf("fallback status %d %#v", status, payload)
	}
	api.paper = paperMap{records: []PaperRecord{paperRecord("host-b", resourceref.PaperEvidence, true, true, true)}}
	stale, staleBody := postPaperStatus(t, api, "lab", []string{"lab"}, paperBody("host-b", strings.Repeat("ab", 32)), nil)
	if stale != 409 || staleBody["error"] != "stale" {
		t.Fatalf("stale %d %#v", stale, staleBody)
	}
	wrongBodyInput := paperBody("host-b", resourceref.PaperDigest)
	wrongBodyInput["sharedProject"] = "nope"
	wrong, wrongBody := postPaperStatus(t, api, "lab", []string{"lab"}, wrongBodyInput, nil)
	if wrong != 403 || wrongBody["error"] != "wrong_project" {
		t.Fatalf("project %d %#v", wrong, wrongBody)
	}
	disabled := paperMap{records: []PaperRecord{paperRecord("host-b", resourceref.PaperEvidence, true, false, true)}}
	api.paper = disabled
	code, body := postPaperStatus(t, api, "lab", []string{"lab"}, paperBody("host-b", resourceref.PaperDigest), nil)
	if code != 403 || body["error"] != "disabled_app" {
		t.Fatalf("disabled %d %#v", code, body)
	}
	api.paper = paperMap{records: []PaperRecord{paperRecord("host-b", resourceref.PaperEvidence, true, true, false)}}
	code, body = postPaperStatus(t, api, "lab", []string{"lab"}, paperBody("host-b", resourceref.PaperDigest), nil)
	if code != 403 || body["error"] != "ungranted" {
		t.Fatalf("grant %d %#v", code, body)
	}
	code, body = postPaperStatus(t, api, "lab", nil, paperBody("host-b", resourceref.PaperDigest), nil)
	if code != 403 || body["error"] != "revoked" {
		t.Fatalf("revoked %d %#v", code, body)
	}
	counted := &countingPaper{paperMap: paperMap{records: []PaperRecord{paperRecord("host-b", resourceref.PaperEvidence, true, true, true)}}}
	api.paper = counted
	bad := paperBody("host-b", resourceref.PaperDigest)
	bad["id"] = "../secret"
	code, body = postPaperStatus(t, api, "lab", []string{"lab"}, bad, nil)
	if code != 400 || body["error"] != "traversal" || counted.calls != 0 {
		t.Fatalf("traversal %d %#v calls %d", code, body, counted.calls)
	}
	code, body = postPaperStatus(t, api, "lab", []string{"lab"}, paperBody("host-b", resourceref.PaperDigest), map[string]string{"X-Pero-Owner": "host-c", "X-Worker-Token": secret})
	if code != 400 || body["error"] != "spoofed" || strings.Contains(strings.Join([]string{body["error"]}, ""), secret) {
		t.Fatalf("spoof %d %#v", code, body)
	}
	missing, missingBody := postPaperStatus(t, api, "lab", []string{"lab"}, paperBody("host-missing", resourceref.PaperDigest), nil)
	if missing != 404 || missingBody["error"] != "missing" {
		t.Fatalf("missing %d %#v", missing, missingBody)
	}
	withPath := paperBody("host-b", resourceref.PaperDigest)
	withPath["path"] = "/var/pero/papers/paper-1"
	code, body = postPaperStatus(t, api, "lab", []string{"lab"}, withPath, nil)
	if code != 400 || body["error"] != "spoofed" {
		t.Fatalf("path %d %#v", code, body)
	}
	code, body = postPaperStatus(t, api, "../lab", []string{"../lab"}, paperBody("host-b", resourceref.PaperDigest), nil)
	if code != 400 || body["error"] != "traversal" {
		t.Fatalf("project path %d %#v", code, body)
	}
	for _, field := range []string{"localProject", "appInstance", "appVersion"} {
		changed := paperBody("host-b", resourceref.PaperDigest)
		changed[field] = changed[field] + "-other"
		code, body = postPaperStatus(t, api, "lab", []string{"lab"}, changed, nil)
		if code != 404 || body["error"] != "missing" {
			t.Fatalf("%s %d %#v", field, code, body)
		}
	}
	unwired := &API{}
	code, body = postPaperStatus(t, unwired, "lab", []string{"lab"}, paperBody("host-b", resourceref.PaperDigest), nil)
	if code != 409 || body["error"] != "owner_unavailable" {
		t.Fatalf("unwired %d %#v", code, body)
	}
	study := paperBody("host-b", resourceref.PaperDigest)
	study["kind"] = "study"
	code, body = postPaperStatus(t, api, "lab", []string{"lab"}, study, nil)
	if code != 400 || body["error"] != "unsupported" {
		t.Fatalf("study %d %#v", code, body)
	}
}

func paperBody(owner, revision string) map[string]string {
	return map[string]string{
		"ownerHost": owner, "sharedProject": "lab", "localProject": "local-lab", "app": "paper-agent",
		"appInstance": "paper-agent@" + owner, "appVersion": "1", "kind": "paper", "id": "paper-1",
		"revision": revision, "class": "immutable",
	}
}

func postPaper(t *testing.T, api *API, project string, projects []string, body map[string]string, headers map[string]string) map[string]string {
	t.Helper()
	status, payload := postPaperStatus(t, api, project, projects, body, headers)
	if status != 200 {
		t.Fatalf("status %d %#v", status, payload)
	}
	for _, forbidden := range []string{"path", "token", "backend", "workerToken", "operatorToken"} {
		if _, ok := payload[forbidden]; ok {
			t.Fatalf("response exposed %s", forbidden)
		}
	}
	return payload
}

func postPaperStatus(t *testing.T, api *API, project string, projects []string, body map[string]string, headers map[string]string) (int, map[string]string) {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/"+project+"/app-resources/paper", strings.NewReader(string(encoded)))
	req.SetPathValue("project", project)
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	req = req.WithContext(context.WithValue(req.Context(), clientContextKey{}, &store.Client{ID: "client", Projects: projects, Role: "client"}))
	rec := httptest.NewRecorder()
	api.readPaperResource(rec, req)
	var payload map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	return rec.Code, payload
}
