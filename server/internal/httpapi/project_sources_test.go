package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func webSourceClient(t *testing.T, server *httptest.Server, name string, projects ...string) string {
	t.Helper()
	reply := request(t, server, http.MethodPost, "/api/v1/clients", "test-operator",
		map[string]any{"name": name, "projects": projects}, "", http.StatusCreated)
	return parse[struct{ Token string }](t, reply).Token
}

func TestSharedWebSourcesNativeChromeToMaterials(t *testing.T) {
	fixture := os.Getenv("PERO_TEST_SHARED_SOURCES_NATIVE")
	if fixture == "" {
		t.Skip("set PERO_TEST_SHARED_SOURCES_NATIVE to the Native Chrome fixture")
	}
	if !filepath.IsAbs(fixture) {
		t.Fatal("PERO_TEST_SHARED_SOURCES_NATIVE must be an absolute fixture path")
	}
	server := testAPI(t)
	writer := webSourceClient(t, server, "first profile", "lab")
	reader := webSourceClient(t, server, "second profile", "lab")
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", fixture)
	cmd.Env = append(os.Environ(), "PERO_SHARED_SOURCES_ORIGIN="+server.URL,
		"PERO_SHARED_SOURCES_WRITER="+writer, "PERO_SHARED_SOURCES_READER="+reader)
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("Native shared Project fixture: %v\n%s", err, output)
	}
	t.Log(string(output))
}

func TestSharedWebSourcesFreezeTheReviewedCaptureWithinItsProject(t *testing.T) {
	server := testAPI(t)
	writer := webSourceClient(t, server, "first device", "lab")
	reader := webSourceClient(t, server, "second device", "lab", "control")
	outsider := webSourceClient(t, server, "different project", "control")
	const path = "/api/client/v1/projects/lab/web-sources"
	const capture = "12345678-1234-1234-1234-123456789abc"
	var source map[string]any
	if err := json.Unmarshal([]byte(`{
		"id":"12345678-1234-1234-1234-123456789abc","url":"https://example.test/source",
		"title":"Portable source","content":"retained excerpt","reason":"evidence","question":"why?",
		"scope":"selection","truncated":false,"capturedAt":1234567890
	}`), &source); err != nil {
		t.Fatal(err)
	}
	request(t, server, "GET", path, outsider, nil, "", http.StatusForbidden)
	request(t, server, "POST", path, outsider, source, "", http.StatusForbidden)
	first := request(t, server, "POST", path, writer, source, "", http.StatusOK)
	again := request(t, server, "POST", path, reader, source, "", http.StatusOK)
	if string(first) != string(again) {
		t.Fatal("a second device received a different receipt after retry")
	}
	saved := parse[struct {
		Receipt struct{ ID, SHA256 string } `json:"sourceReceipt"`
	}](t, first)
	listed := parse[struct{ Sources []struct{ ID, SHA256 string } }](t,
		request(t, server, "GET", path, reader, nil, "", http.StatusOK))
	if len(listed.Sources) != 1 || listed.Sources[0] != saved.Receipt {
		t.Fatal("the second device did not see the original receipt")
	}
	item := parse[struct {
		Source struct {
			ProjectID string
			Source    map[string]any
		}
	}](t,
		request(t, server, "GET", path+"/"+capture, reader, nil, "", http.StatusOK))
	if item.Source.ProjectID != "lab" || item.Source.Source["content"] != "retained excerpt" {
		t.Fatal("the shared source lost its scope or reviewed text")
	}
	request(t, server, "GET", "/api/client/v1/projects/control/web-sources/"+capture, reader, nil, "", http.StatusNotFound)
	request(t, server, "GET", path+"/"+capture, outsider, nil, "", http.StatusForbidden)
	source["content"] = "different content"
	request(t, server, "POST", path, reader, source, "", http.StatusConflict)
}
