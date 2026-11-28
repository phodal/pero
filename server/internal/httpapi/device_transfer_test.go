package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/devicetransfer"
	"github.com/phodal/pero/server/internal/store"
)

var samplePDF = []byte("%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")

type countingImport struct {
	mu       sync.Mutex
	n        int
	id       string
	revision string
}

func (c *countingImport) ImportPDF(context.Context, string, []byte, string) (string, string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.n++
	return c.id, c.revision, true
}

func TestPaperPDFImportIsIdempotent(t *testing.T) {
	sum := sha256.Sum256(samplePDF)
	digest := hex.EncodeToString(sum[:])
	importer := &countingImport{id: "doc-1", revision: digest}
	desk := newImportingDesk(importer)
	desk.Register("lab", devicetransfer.Handle{ID: "handle-1", Provider: "desktop", MediaType: "application/pdf", Size: uint64(len(samplePDF)), Name: "note.pdf"})
	api := &API{files: desk}
	code, received := postBytes(t, api, "lab", []string{"lab"}, "upload-1", "handle-1", samplePDF)
	if code != 202 || received["received"] != float64(len(samplePDF)) || importer.n != 0 {
		t.Fatalf("upload %d %#v imports %d", code, received, importer.n)
	}
	first := postFinalize(t, api, "lab", []string{"lab"}, "upload-1", digest, uint64(len(samplePDF)))
	second := postFinalize(t, api, "lab", []string{"lab"}, "upload-1", digest, uint64(len(samplePDF)))
	if first["created"] != true || second["created"] != false || first["paperId"] != "doc-1" || first["paperId"] == "paper-"+digest[:12] || second["paperId"] != first["paperId"] || importer.n != 1 {
		t.Fatalf("first %#v second %#v imports %d", first, second, importer.n)
	}
	kept, _, remembered, ok := desk.Get("lab", "upload-1")
	if !ok || len(kept) != 0 || remembered == nil || remembered.PaperID != "doc-1" {
		t.Fatalf("retained %d %#v", len(kept), remembered)
	}
	code, body := postFinalizeStatus(t, api, "lab", []string{"lab"}, "upload-1", "ab", uint64(len(samplePDF)))
	if code != 409 || body["error"] != "conflict" {
		t.Fatalf("digest %d %#v", code, body)
	}
	code, body = postFinalizeStatus(t, api, "lab", []string{"lab"}, "upload-1", digest, 0)
	if code != 409 || body["error"] != "interrupted" {
		t.Fatalf("replay size %d %#v", code, body)
	}
	code, _ = postBytes(t, api, "lab", []string{"lab"}, "partial", "handle-1", samplePDF[:4])
	if code != 202 {
		t.Fatal(code)
	}
	code, body = postFinalizeStatus(t, api, "lab", []string{"lab"}, "partial", digest, uint64(len(samplePDF)))
	if code != 409 || body["error"] != "interrupted" {
		t.Fatalf("partial %d %#v", code, body)
	}
	code, _ = postBytes(t, api, "lab", []string{"lab"}, "drop", "handle-1", samplePDF)
	postCancel(t, api, "lab", "drop")
	code, body = postFinalizeStatus(t, api, "lab", []string{"lab"}, "drop", digest, uint64(len(samplePDF)))
	if code != 409 || body["error"] != "cancelled_transfer" || importer.n != 1 {
		t.Fatalf("cancel %d %#v imports %d", code, body, importer.n)
	}
	before := importer.n
	code, body = postBytes(t, api, "lab", []string{"lab"}, "walk", "../secret", samplePDF)
	if code != 400 || body["error"] != "traversal" || importer.n != before {
		t.Fatalf("walk %d %#v imports %d", code, body, importer.n)
	}
	code, body = postBytes(t, api, "lab", []string{"lab"}, "missing", "other-handle", samplePDF)
	if code != 404 || body["error"] != "foreign" {
		t.Fatalf("foreign %d %#v", code, body)
	}
	desk.Expire("lab", "handle-1")
	code, body = postBytes(t, api, "lab", []string{"lab"}, "old", "handle-1", samplePDF)
	if code != 409 || body["error"] != "expired" {
		t.Fatalf("expired %d %#v", code, body)
	}
	code, body = postFinalizeStatus(t, api, "other", []string{"lab", "other"}, "upload-1", digest, uint64(len(samplePDF)))
	if code != 409 || body["error"] != "interrupted" {
		t.Fatalf("project %d %#v", code, body)
	}
	code, body = postBytes(t, api, "lab", nil, "revoked", "handle-1", samplePDF)
	if code != 403 || body["error"] != "revoked" {
		t.Fatalf("revoked %d %#v", code, body)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/lab/device-transfers/huge", bytes.NewReader(samplePDF))
	req.SetPathValue("project", "lab")
	req.SetPathValue("upload", "huge")
	req.ContentLength = devicetransfer.MaxBytes + 1
	req.Header.Set("X-Pero-Handle", "handle-1")
	req = req.WithContext(context.WithValue(req.Context(), clientContextKey{}, &store.Client{Projects: []string{"lab"}, Role: "client"}))
	rec := httptest.NewRecorder()
	api.acceptDeviceBytes(rec, req)
	if rec.Code != 413 {
		t.Fatalf("limit %d %s", rec.Code, rec.Body.String())
	}
	swapped := map[string]any{"app": "paper-agent", "digest": digest, "mediaType": "application/pdf", "size": len(samplePDF), "handle": "handle-2"}
	encoded, _ := json.Marshal(swapped)
	swapReq := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/lab/device-transfers/upload-1/finalize", bytes.NewReader(encoded))
	swapReq.SetPathValue("project", "lab")
	swapReq.SetPathValue("upload", "upload-1")
	swapReq = swapReq.WithContext(context.WithValue(swapReq.Context(), clientContextKey{}, &store.Client{Projects: []string{"lab"}, Role: "client"}))
	swapRec := httptest.NewRecorder()
	api.finalizeDeviceTransfer(swapRec, swapReq)
	if swapRec.Code != 409 || !strings.Contains(swapRec.Body.String(), "conflict") {
		t.Fatalf("swap %d %s", swapRec.Code, swapRec.Body.String())
	}
}

func TestDeviceRoutesFollowTheImporter(t *testing.T) {
	mux := http.NewServeMux()
	(&API{}).registerClients(mux)
	req := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/lab/device-transfers/up", nil)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	if rec.Code != 404 || strings.Contains(rec.Body.String(), "foreign") {
		t.Fatalf("unmounted %d %s", rec.Code, rec.Body.String())
	}
	importer := &countingImport{id: "doc-9", revision: "rev-domain"}
	api := &API{}
	mountDeviceDesk(api, importer)
	if api.files == nil {
		t.Fatal("importer did not mount a desk")
	}
	desk := api.files.(*importingDesk)
	desk.Register("lab", devicetransfer.Handle{ID: "handle-1", Provider: "browser", MediaType: "application/pdf", Size: uint64(len(samplePDF)), Name: "note.pdf"})
	desk.Register("other", devicetransfer.Handle{ID: "handle-1", Provider: "browser", MediaType: "application/pdf", Size: uint64(len(samplePDF)), Name: "note.pdf"})
	if code, _ := postBytes(t, api, "lab", []string{"lab"}, "same", "handle-1", samplePDF); code != 202 {
		t.Fatal(code)
	}
	if code, _ := postBytes(t, api, "other", []string{"other"}, "same", "handle-1", samplePDF); code != 202 {
		t.Fatal(code)
	}
	sum := sha256.Sum256(samplePDF)
	digest := hex.EncodeToString(sum[:])
	got := postFinalize(t, api, "lab", []string{"lab"}, "same", digest, uint64(len(samplePDF)))
	if got["paperId"] != "doc-9" || got["revision"] != "rev-domain" || got["paperId"] == "paper-"+digest[:12] {
		t.Fatalf("%#v", got)
	}
	outsider := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/lab/device-transfers/same/cancel", strings.NewReader("{}"))
	outsider.SetPathValue("project", "lab")
	outsider.SetPathValue("upload", "same")
	outsider = outsider.WithContext(context.WithValue(outsider.Context(), clientContextKey{}, &store.Client{Projects: []string{"other"}, Role: "client"}))
	denied := httptest.NewRecorder()
	api.cancelDeviceTransfer(denied, outsider)
	if denied.Code != 403 || strings.Contains(denied.Body.String(), "traversal") {
		t.Fatalf("cancel %d %s", denied.Code, denied.Body.String())
	}
	if _, transfer, _, ok := desk.Get("lab", "same"); !ok || transfer.Cancelled {
		t.Fatal("project A cancel changed project B's knowledge of the lab upload")
	}
	walk := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/../lab/device-transfers/same/cancel", strings.NewReader("{}"))
	walk.SetPathValue("project", "../lab")
	walk.SetPathValue("upload", "same")
	walk = walk.WithContext(context.WithValue(walk.Context(), clientContextKey{}, &store.Client{Projects: []string{"lab"}, Role: "client"}))
	walked := httptest.NewRecorder()
	api.cancelDeviceTransfer(walked, walk)
	if walked.Code != 403 {
		t.Fatalf("path before auth %d %s", walked.Code, walked.Body.String())
	}
}

func postBytes(t *testing.T, api *API, project string, projects []string, upload, handle string, body []byte) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/"+project+"/device-transfers/"+upload, bytes.NewReader(body))
	req.SetPathValue("project", project)
	req.SetPathValue("upload", upload)
	req.Header.Set("X-Pero-Handle", handle)
	req.Header.Set("Content-Type", "application/pdf")
	req.ContentLength = int64(len(body))
	req = req.WithContext(context.WithValue(req.Context(), clientContextKey{}, &store.Client{Projects: projects, Role: "client"}))
	rec := httptest.NewRecorder()
	api.acceptDeviceBytes(rec, req)
	payload := map[string]any{}
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
			t.Fatal(rec.Body.String())
		}
	}
	return rec.Code, payload
}

func postFinalize(t *testing.T, api *API, project string, projects []string, upload, digest string, size uint64) map[string]any {
	t.Helper()
	code, payload := postFinalizeStatus(t, api, project, projects, upload, digest, size)
	if code != 200 {
		t.Fatalf("finalize %d %#v", code, payload)
	}
	return payload
}

func postFinalizeStatus(t *testing.T, api *API, project string, projects []string, upload, digest string, size uint64) (int, map[string]any) {
	t.Helper()
	body := map[string]any{"app": "paper-agent", "digest": digest, "mediaType": "application/pdf", "size": size, "handle": "handle-1"}
	encoded, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/"+project+"/device-transfers/"+upload+"/finalize", bytes.NewReader(encoded))
	req.SetPathValue("project", project)
	req.SetPathValue("upload", upload)
	req = req.WithContext(context.WithValue(req.Context(), clientContextKey{}, &store.Client{Projects: projects, Role: "client"}))
	rec := httptest.NewRecorder()
	api.finalizeDeviceTransfer(rec, req)
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(rec.Body.String())
	}
	return rec.Code, payload
}

type gateImport struct {
	mu       sync.Mutex
	n        int
	id       string
	revision string
	entered  chan struct{}
	release  chan struct{}
	once     sync.Once
}

func (g *gateImport) ImportPDF(context.Context, string, []byte, string) (string, string, bool) {
	g.mu.Lock()
	g.n++
	g.mu.Unlock()
	g.once.Do(func() { close(g.entered) })
	<-g.release
	return g.id, g.revision, true
}

func TestConcurrentFinalizeImportsOnceAndCancelDoesNotWin(t *testing.T) {
	sum := sha256.Sum256(samplePDF)
	digest := hex.EncodeToString(sum[:])
	gate := &gateImport{id: "rev_gate", revision: digest, entered: make(chan struct{}), release: make(chan struct{})}
	desk := newImportingDesk(gate)
	desk.Register("lab", devicetransfer.Handle{ID: "handle-1", Provider: "browser", MediaType: "application/pdf", Size: uint64(len(samplePDF)), Name: "note.pdf"})
	api := &API{files: desk}
	if code, _ := postBytes(t, api, "lab", []string{"lab"}, "upload-1", "handle-1", samplePDF); code != 202 {
		t.Fatal(code)
	}
	type finish struct {
		code int
		body map[string]any
	}
	done := make(chan finish, 2)
	go func() {
		code, body := postFinalizeStatus(t, api, "lab", []string{"lab"}, "upload-1", digest, uint64(len(samplePDF)))
		done <- finish{code, body}
	}()
	<-gate.entered
	go func() {
		code, body := postFinalizeStatus(t, api, "lab", []string{"lab"}, "upload-1", digest, uint64(len(samplePDF)))
		done <- finish{code, body}
	}()
	cancelCode := make(chan int, 1)
	go func() {
		req := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/lab/device-transfers/upload-1/cancel", strings.NewReader("{}"))
		req.SetPathValue("project", "lab")
		req.SetPathValue("upload", "upload-1")
		req = req.WithContext(context.WithValue(req.Context(), clientContextKey{}, &store.Client{Projects: []string{"lab"}, Role: "client"}))
		rec := httptest.NewRecorder()
		api.cancelDeviceTransfer(rec, req)
		cancelCode <- rec.Code
	}()
	close(gate.release)
	first, second := <-done, <-done
	if cancel := <-cancelCode; cancel == 200 {
		t.Fatalf("cancel won %d", cancel)
	}
	if first.code != 200 || second.code != 200 || gate.n != 1 || first.body["paperId"] != "rev_gate" || second.body["paperId"] != "rev_gate" {
		t.Fatalf("imports %d %#v %#v", gate.n, first, second)
	}
	created := 0
	if first.body["created"] == true {
		created++
	}
	if second.body["created"] == true {
		created++
	}
	if created != 1 {
		t.Fatalf("created %#v %#v", first, second)
	}
	kept, _, _, ok := desk.Get("lab", "upload-1")
	if !ok || len(kept) != 0 {
		t.Fatalf("bytes %d", len(kept))
	}
}

func TestUploadCapAndExpiry(t *testing.T) {
	importer := &countingImport{id: "rev_cap", revision: "abc"}
	desk := newImportingDesk(importer)
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	current := base
	desk.now = func() time.Time { return current }
	handle := devicetransfer.Handle{ID: "handle-1", Provider: "browser", MediaType: "application/pdf", Size: uint64(len(samplePDF)), Name: "note.pdf"}
	if code := desk.Register("lab", handle); code != "" {
		t.Fatal(code)
	}
	for i := 0; i < maxHandlesPerProject; i++ {
		if code := desk.Register("handles", devicetransfer.Handle{ID: string(rune('a' + i)), Provider: "browser", MediaType: "application/pdf", Size: 1, Name: "n"}); code != "" {
			t.Fatal(code)
		}
	}
	if code := desk.Register("handles", devicetransfer.Handle{ID: "overflow", Provider: "browser", MediaType: "application/pdf", Size: 1, Name: "n"}); code != devicetransfer.OverLimit {
		t.Fatalf("handles %s", code)
	}
	api := &API{files: desk}
	for i := 0; i < maxUploadsPerProject; i++ {
		code, _ := postBytes(t, api, "lab", []string{"lab"}, string(rune('a'+i)), "handle-1", samplePDF)
		if code != 202 {
			t.Fatalf("upload %d %d", i, code)
		}
	}
	code, payload := postBytes(t, api, "lab", []string{"lab"}, "extra", "handle-1", samplePDF)
	if code != 413 || payload["error"] != devicetransfer.OverLimit {
		t.Fatalf("cap %d %#v", code, payload)
	}
	current = base.Add(uploadTTL + time.Second)
	if _, known, _ := desk.Lookup("lab", "handle-1"); known {
		t.Fatal("handle lived past the ttl")
	}
	if code := desk.Register("lab", handle); code != "" {
		t.Fatal(code)
	}
	code, _ = postBytes(t, api, "lab", []string{"lab"}, "later", "handle-1", samplePDF)
	if code != 202 {
		t.Fatalf("expired %d", code)
	}
}

func postCancel(t *testing.T, api *API, project, upload string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/client/v1/projects/"+project+"/device-transfers/"+upload+"/cancel", strings.NewReader("{}"))
	req.SetPathValue("project", project)
	req.SetPathValue("upload", upload)
	req = req.WithContext(context.WithValue(req.Context(), clientContextKey{}, &store.Client{Projects: []string{project}, Role: "client"}))
	rec := httptest.NewRecorder()
	api.cancelDeviceTransfer(rec, req)
	if rec.Code != 200 {
		t.Fatalf("cancel %d %s", rec.Code, rec.Body.String())
	}
}
