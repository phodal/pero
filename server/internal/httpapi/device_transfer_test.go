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

	"github.com/phodal/pero/server/internal/devicetransfer"
	"github.com/phodal/pero/server/internal/store"
)

var samplePDF = []byte("%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")

type fileDesk struct {
	mu      sync.Mutex
	handles map[string]devicetransfer.Handle
	expired map[string]bool
	uploads map[string]storedUpload
	imports int
	lookups int
}

type storedUpload struct {
	body     []byte
	transfer devicetransfer.Transfer
	commit   *devicetransfer.Commit
}

func (d *fileDesk) Lookup(handle string) (devicetransfer.Handle, bool, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.lookups++
	value, ok := d.handles[handle]
	return value, ok, d.expired[handle]
}

func (d *fileDesk) Put(upload string, body []byte, transfer devicetransfer.Transfer) {
	d.mu.Lock()
	defer d.mu.Unlock()
	current := d.uploads[upload]
	current.body = append([]byte(nil), body...)
	current.transfer = transfer
	d.uploads[upload] = current
}

func (d *fileDesk) Get(upload string) ([]byte, devicetransfer.Transfer, *devicetransfer.Commit, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	value, ok := d.uploads[upload]
	if !ok {
		return nil, devicetransfer.Transfer{}, nil, false
	}
	return append([]byte(nil), value.body...), value.transfer, value.commit, true
}

func (d *fileDesk) Remember(upload string, commit devicetransfer.Commit) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, value := range d.uploads {
		if value.commit != nil && value.commit.Digest == commit.Digest {
			d.uploads[upload] = storedUpload{body: d.uploads[upload].body, transfer: d.uploads[upload].transfer, commit: value.commit}
			return
		}
	}
	d.imports++
	stored := commit
	current := d.uploads[upload]
	current.commit = &stored
	d.uploads[upload] = current
}

func (d *fileDesk) Imported(digest string) (devicetransfer.Commit, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, value := range d.uploads {
		if value.commit != nil && value.commit.Digest == digest {
			return *value.commit, true
		}
	}
	return devicetransfer.Commit{}, false
}

func (d *fileDesk) Cancel(upload string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	current := d.uploads[upload]
	current.transfer.Cancelled = true
	current.body = nil
	d.uploads[upload] = current
}

func TestPaperPDFImportIsIdempotent(t *testing.T) {
	sum := sha256.Sum256(samplePDF)
	digest := hex.EncodeToString(sum[:])
	desk := &fileDesk{
		handles: map[string]devicetransfer.Handle{"handle-1": {ID: "handle-1", Provider: "desktop", MediaType: "application/pdf", Size: uint64(len(samplePDF)), Name: "note.pdf"}},
		expired: map[string]bool{}, uploads: map[string]storedUpload{},
	}
	api := &API{files: desk}
	code, received := postBytes(t, api, "lab", []string{"lab"}, "upload-1", "handle-1", samplePDF)
	if code != 202 || received["received"] != float64(len(samplePDF)) || desk.imports != 0 {
		t.Fatalf("upload %d %#v imports %d", code, received, desk.imports)
	}
	first := postFinalize(t, api, "lab", []string{"lab"}, "upload-1", digest, uint64(len(samplePDF)))
	second := postFinalize(t, api, "lab", []string{"lab"}, "upload-1", digest, uint64(len(samplePDF)))
	if first["created"] != true || second["created"] != false || first["revision"] != digest || second["paperId"] != first["paperId"] || desk.imports != 1 {
		t.Fatalf("first %#v second %#v imports %d", first, second, desk.imports)
	}
	code, body := postFinalizeStatus(t, api, "lab", []string{"lab"}, "upload-1", "ab", uint64(len(samplePDF)))
	if code != 409 || body["error"] != "digest_mismatch" {
		t.Fatalf("digest %d %#v", code, body)
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
	if code != 409 || body["error"] != "cancelled_transfer" || desk.imports != 1 {
		t.Fatalf("cancel %d %#v imports %d", code, body, desk.imports)
	}
	before := desk.lookups
	code, body = postBytes(t, api, "lab", []string{"lab"}, "walk", "../secret", samplePDF)
	if code != 400 || body["error"] != "traversal" || desk.lookups != before {
		t.Fatalf("walk %d %#v lookups %d", code, body, desk.lookups)
	}
	code, body = postBytes(t, api, "lab", []string{"lab"}, "missing", "other-handle", samplePDF)
	if code != 404 || body["error"] != "foreign" {
		t.Fatalf("foreign %d %#v", code, body)
	}
	desk.expired["handle-1"] = true
	code, body = postBytes(t, api, "lab", []string{"lab"}, "old", "handle-1", samplePDF)
	if code != 409 || body["error"] != "expired" {
		t.Fatalf("expired %d %#v", code, body)
	}
	desk.expired["handle-1"] = false
	code, body = postFinalizeStatus(t, api, "other", []string{"lab", "other"}, "upload-1", digest, uint64(len(samplePDF)))
	if code != 403 || body["error"] != "wrong_project" {
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
