package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/phodal/pero/server/internal/devicetransfer"
)

// PaperImporter is the domain that owns a Paper. The control plane does not mint its id.
type PaperImporter interface {
	ImportPDF(project string, body []byte, digest string) (paperID, revision string, ok bool)
}

// DeviceDesk keeps one project's in-flight upload and asks the domain to import it once.
type DeviceDesk interface {
	Register(project string, handle devicetransfer.Handle)
	Lookup(project, handle string) (devicetransfer.Handle, bool, bool)
	Put(project, upload string, body []byte, transfer devicetransfer.Transfer)
	Get(project, upload string) (body []byte, transfer devicetransfer.Transfer, commit *devicetransfer.Commit, ok bool)
	Remember(project, upload string, commit devicetransfer.Commit)
	Import(project, digest string, body []byte) (devicetransfer.Commit, bool)
	Cancel(project, upload string) bool
	Reserve(project, upload string, fn func(body []byte, transfer devicetransfer.Transfer, prior *devicetransfer.Commit) (devicetransfer.Commit, string)) (devicetransfer.Commit, string, bool)
}

func mountDeviceDesk(api *API, importer PaperImporter) {
	if importer == nil {
		return
	}
	api.files = newImportingDesk(importer)
}

type importingDesk struct {
	mu       sync.Mutex
	importer PaperImporter
	handles  map[string]map[string]deskHandle
	uploads  map[string]map[string]*uploadSlot
}

type deskHandle struct {
	handle  devicetransfer.Handle
	expired bool
}

type uploadSlot struct {
	mu       sync.Mutex
	body     []byte
	transfer devicetransfer.Transfer
	commit   *devicetransfer.Commit
}

func newImportingDesk(importer PaperImporter) *importingDesk {
	return &importingDesk{importer: importer, handles: map[string]map[string]deskHandle{}, uploads: map[string]map[string]*uploadSlot{}}
}

func (d *importingDesk) ensure(project, upload string) *uploadSlot {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.uploads[project] == nil {
		d.uploads[project] = map[string]*uploadSlot{}
	}
	slot := d.uploads[project][upload]
	if slot == nil {
		slot = &uploadSlot{}
		d.uploads[project][upload] = slot
	}
	return slot
}

func (d *importingDesk) find(project, upload string) *uploadSlot {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.uploads[project][upload]
}

func (d *importingDesk) Register(project string, handle devicetransfer.Handle) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.handles[project] == nil {
		d.handles[project] = map[string]deskHandle{}
	}
	d.handles[project][handle.ID] = deskHandle{handle: handle}
}

func (d *importingDesk) Expire(project, handle string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if slot, ok := d.handles[project][handle]; ok {
		slot.expired = true
		d.handles[project][handle] = slot
	}
}

func (d *importingDesk) Lookup(project, handle string) (devicetransfer.Handle, bool, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	slot, ok := d.handles[project][handle]
	return slot.handle, ok, slot.expired
}

func (d *importingDesk) Put(project, upload string, body []byte, transfer devicetransfer.Transfer) {
	slot := d.ensure(project, upload)
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if slot.commit != nil || slot.transfer.Cancelled {
		return
	}
	slot.body = append([]byte(nil), body...)
	slot.transfer = transfer
}

func (d *importingDesk) Get(project, upload string) ([]byte, devicetransfer.Transfer, *devicetransfer.Commit, bool) {
	slot := d.find(project, upload)
	if slot == nil {
		return nil, devicetransfer.Transfer{}, nil, false
	}
	slot.mu.Lock()
	defer slot.mu.Unlock()
	var commit *devicetransfer.Commit
	if slot.commit != nil {
		copy := *slot.commit
		commit = &copy
	}
	return append([]byte(nil), slot.body...), slot.transfer, commit, true
}

func (d *importingDesk) Remember(project, upload string, commit devicetransfer.Commit) {
	slot := d.ensure(project, upload)
	slot.mu.Lock()
	defer slot.mu.Unlock()
	stored := commit
	slot.commit = &stored
	slot.body = nil
}

func (d *importingDesk) Reserve(project, upload string, fn func(body []byte, transfer devicetransfer.Transfer, prior *devicetransfer.Commit) (devicetransfer.Commit, string)) (devicetransfer.Commit, string, bool) {
	slot := d.find(project, upload)
	if slot == nil {
		return devicetransfer.Commit{}, "", false
	}
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if slot.transfer.Cancelled {
		return devicetransfer.Commit{}, devicetransfer.CancelledTransfer, true
	}
	var prior *devicetransfer.Commit
	if slot.commit != nil {
		copy := *slot.commit
		prior = &copy
	}
	commit, code := fn(append([]byte(nil), slot.body...), slot.transfer, prior)
	if code != "" {
		return devicetransfer.Commit{}, code, true
	}
	if slot.commit == nil {
		stored := commit
		slot.commit = &stored
		slot.body = nil
	}
	return commit, "", true
}

func (d *importingDesk) Import(project, digest string, body []byte) (devicetransfer.Commit, bool) {
	if d.importer == nil {
		return devicetransfer.Commit{}, false
	}
	id, revision, ok := d.importer.ImportPDF(project, body, digest)
	if !ok || id == "" || revision == "" || id == "paper-"+digest[:12] {
		return devicetransfer.Commit{}, false
	}
	return devicetransfer.Commit{PaperID: id, Revision: revision, Digest: digest}, true
}

func (d *importingDesk) Cancel(project, upload string) bool {
	slot := d.find(project, upload)
	if slot == nil {
		return false
	}
	slot.mu.Lock()
	defer slot.mu.Unlock()
	if slot.commit != nil {
		return false
	}
	slot.transfer.Cancelled = true
	slot.body = nil
	return true
}

func (a *API) acceptDeviceHandle(w http.ResponseWriter, r *http.Request) {
	project := r.PathValue("project")
	if !deviceMember(r, project) {
		deviceError(w, devicetransfer.Revoked)
		return
	}
	if strings.Contains(project, "..") || strings.ContainsAny(project, "/\\") {
		deviceError(w, devicetransfer.Traversal)
		return
	}
	var request struct {
		ID        string `json:"id"`
		Provider  string `json:"provider"`
		MediaType string `json:"mediaType"`
		Size      uint64 `json:"size"`
		Name      string `json:"name"`
	}
	raw, ok := decodeDeviceObject(w, r)
	if !ok {
		return
	}
	for _, key := range []string{"path", "absolutePath", "url", "token"} {
		if _, present := raw[key]; present {
			deviceError(w, devicetransfer.Traversal)
			return
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(mustJSON(raw)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&request) != nil {
		deviceError(w, devicetransfer.Conflict)
		return
	}
	if request.Provider != "browser" && request.Provider != "desktop" {
		deviceError(w, devicetransfer.Foreign)
		return
	}
	if request.MediaType != "application/pdf" || request.Size == 0 || request.Size > devicetransfer.MaxBytes {
		deviceError(w, devicetransfer.OverLimit)
		return
	}
	if request.ID == "" || request.Name == "" || strings.Contains(request.ID, "..") || strings.Contains(request.Name, "..") || strings.ContainsAny(request.ID+request.Name, "/\\") {
		deviceError(w, devicetransfer.Traversal)
		return
	}
	a.files.Register(project, devicetransfer.Handle{
		ID: request.ID, Provider: request.Provider, MediaType: request.MediaType, Size: request.Size, Name: request.Name,
	})
	respond(w, 201, map[string]string{"id": request.ID, "project": project})
}

func decodeDeviceObject(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 64*1024)
	body, err := io.ReadAll(r.Body)
	if err != nil || len(bytes.TrimSpace(body)) == 0 || bytes.TrimSpace(body)[0] != '{' {
		respond(w, 400, map[string]string{"error": "expected a bounded JSON object"})
		return nil, false
	}
	var raw map[string]json.RawMessage
	if json.Unmarshal(body, &raw) != nil {
		respond(w, 400, map[string]string{"error": "invalid JSON request or request exceeds limit"})
		return nil, false
	}
	return raw, true
}

func mustJSON(raw map[string]json.RawMessage) []byte {
	body, err := json.Marshal(raw)
	if err != nil {
		return []byte("{}")
	}
	return body
}

func (a *API) acceptDeviceBytes(w http.ResponseWriter, r *http.Request) {
	project, upload, ok := deviceAuthorized(a, w, r)
	if !ok {
		return
	}
	if declared := r.ContentLength; declared > devicetransfer.MaxBytes {
		deviceError(w, devicetransfer.OverLimit)
		return
	}
	handleID := r.Header.Get("X-Pero-Handle")
	if strings.Contains(handleID, "..") || strings.ContainsAny(handleID, "/\\") {
		deviceError(w, devicetransfer.Traversal)
		return
	}
	handle, known, expired := a.files.Lookup(project, handleID)
	if !known {
		deviceError(w, devicetransfer.Foreign)
		return
	}
	if expired {
		deviceError(w, devicetransfer.Expired)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, devicetransfer.MaxBytes+1)
	body, err := io.ReadAll(r.Body)
	if err != nil || uint64(len(body)) > devicetransfer.MaxBytes {
		deviceError(w, devicetransfer.OverLimit)
		return
	}
	transfer := devicetransfer.Transfer{
		UploadID: upload, Project: project, App: "paper-agent", HandleID: handle.ID,
		Digest: r.Header.Get("X-Pero-Digest"), Size: uint64(len(body)), MediaType: handle.MediaType, Received: uint64(len(body)),
	}
	a.files.Put(project, upload, body, transfer)
	respond(w, 202, map[string]any{"received": len(body), "uploadId": upload})
}

func (a *API) finalizeDeviceTransfer(w http.ResponseWriter, r *http.Request) {
	project, upload, ok := deviceAuthorized(a, w, r)
	if !ok {
		return
	}
	var request struct {
		App       string `json:"app"`
		Digest    string `json:"digest"`
		MediaType string `json:"mediaType"`
		Size      uint64 `json:"size"`
		Handle    string `json:"handle"`
		Path      string `json:"path,omitempty"`
	}
	if !decode(w, r, &request) {
		return
	}
	if request.Path != "" {
		deviceError(w, devicetransfer.Traversal)
		return
	}
	commit, failure, found := a.files.Reserve(project, upload, func(body []byte, stored devicetransfer.Transfer, prior *devicetransfer.Commit) (devicetransfer.Commit, string) {
		if request.Handle != stored.HandleID || request.MediaType != stored.MediaType {
			return devicetransfer.Commit{}, devicetransfer.Conflict
		}
		if request.App != "paper-agent" {
			return devicetransfer.Commit{}, devicetransfer.WrongApp
		}
		if prior != nil {
			if prior.Digest == request.Digest {
				copy := *prior
				copy.Created = false
				return copy, ""
			}
			return devicetransfer.Commit{}, devicetransfer.Conflict
		}
		stored.Digest = request.Digest
		stored.Size = request.Size
		stored.App = request.App
		_, known, expired := a.files.Lookup(project, stored.HandleID)
		sum := sha256.Sum256(body)
		domainID, domainRevision := "", ""
		if known && !expired && hex.EncodeToString(sum[:]) == request.Digest && uint64(len(body)) == request.Size {
			imported, ok := a.files.Import(project, request.Digest, body)
			if ok {
				domainID, domainRevision = imported.PaperID, imported.Revision
			}
		}
		return devicetransfer.Finalize(true, project, stored, body, known, expired, nil, domainID, domainRevision)
	})
	if !found {
		deviceError(w, devicetransfer.Interrupted)
		return
	}
	if failure != "" {
		deviceError(w, failure)
		return
	}
	respond(w, 200, commit)
}

func (a *API) cancelDeviceTransfer(w http.ResponseWriter, r *http.Request) {
	project, upload, ok := deviceAuthorized(a, w, r)
	if !ok {
		return
	}
	if !a.files.Cancel(project, upload) {
		deviceError(w, devicetransfer.Foreign)
		return
	}
	respond(w, 200, map[string]string{"outcome": devicetransfer.CancelledTransfer})
}

func deviceAuthorized(a *API, w http.ResponseWriter, r *http.Request) (string, string, bool) {
	project, upload := r.PathValue("project"), r.PathValue("upload")
	if !deviceMember(r, project) {
		deviceError(w, devicetransfer.Revoked)
		return "", "", false
	}
	if strings.Contains(project, "..") || strings.Contains(upload, "..") || strings.ContainsAny(project+upload, "/\\") {
		deviceError(w, devicetransfer.Traversal)
		return "", "", false
	}
	if a == nil || a.files == nil {
		deviceError(w, devicetransfer.Foreign)
		return "", "", false
	}
	return project, upload, true
}

func deviceMember(r *http.Request, project string) bool {
	client := clientIdentity(r)
	for _, allowed := range client.Projects {
		if allowed == project {
			return true
		}
	}
	return false
}

func deviceError(w http.ResponseWriter, code string) {
	status := 400
	switch code {
	case devicetransfer.Revoked, devicetransfer.WrongProject, devicetransfer.WrongApp:
		status = 403
	case devicetransfer.OverLimit:
		status = 413
	case devicetransfer.Conflict, devicetransfer.DigestMismatch, devicetransfer.Interrupted, devicetransfer.CancelledTransfer, devicetransfer.Expired:
		status = 409
	case devicetransfer.Foreign, devicetransfer.Unavailable:
		status = 404
	}
	respond(w, status, map[string]string{"error": code})
}
