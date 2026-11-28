package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/phodal/pero/server/internal/devicetransfer"
)

const (
	maxUploadsPerProject = 4
	maxHandlesPerProject = 16
	maxProjectBytes      = 64 * 1024 * 1024
	maxGlobalBytes       = 128 * 1024 * 1024
	uploadTTL            = 15 * time.Minute
)

// PaperImporter is the domain that owns a Paper. The control plane does not mint its id.
type PaperImporter interface {
	ImportPDF(ctx context.Context, project string, body []byte, digest string) (paperID, revision string, ok bool)
}

// DeviceDesk keeps one project's in-flight upload and asks the domain to import it once.
type DeviceDesk interface {
	Register(project string, handle devicetransfer.Handle) string
	Lookup(project, handle string) (devicetransfer.Handle, bool, bool)
	Put(project, upload string, body []byte, transfer devicetransfer.Transfer) string
	Get(project, upload string) (body []byte, transfer devicetransfer.Transfer, commit *devicetransfer.Commit, ok bool)
	Remember(project, upload string, commit devicetransfer.Commit)
	Import(ctx context.Context, project, digest string, body []byte) (devicetransfer.Commit, bool)
	Cancel(project, upload string) string
	Reserve(project, upload string, fn func(body []byte, transfer devicetransfer.Transfer, prior *devicetransfer.Commit) (devicetransfer.Commit, string)) (devicetransfer.Commit, string, bool)
}

func mountDeviceDesk(api *API, importer PaperImporter) {
	if importer == nil {
		return
	}
	api.files = newImportingDesk(importer)
}

type importingDesk struct {
	mu           sync.Mutex
	cond         *sync.Cond
	importer     PaperImporter
	now          func() time.Time
	ttl          time.Duration
	handles      map[string]map[string]deskHandle
	uploads      map[string]map[string]*uploadSlot
	projectBytes map[string]uint64
	globalBytes  uint64
}

type deskHandle struct {
	handle  devicetransfer.Handle
	expired bool
	at      time.Time
}

type uploadSlot struct {
	body      []byte
	accounted uint64
	transfer  devicetransfer.Transfer
	commit    *devicetransfer.Commit
	created   time.Time
	busy      bool
}

func newImportingDesk(importer PaperImporter) *importingDesk {
	desk := &importingDesk{
		importer: importer, now: time.Now, ttl: uploadTTL,
		handles: map[string]map[string]deskHandle{}, uploads: map[string]map[string]*uploadSlot{},
		projectBytes: map[string]uint64{},
	}
	desk.cond = sync.NewCond(&desk.mu)
	return desk
}

func (d *importingDesk) sweepLocked(now time.Time) {
	for project, uploads := range d.uploads {
		for id, slot := range uploads {
			if slot.busy || now.Sub(slot.created) <= d.ttl {
				continue
			}
			d.subtractLocked(project, slot)
			delete(uploads, id)
		}
	}
	for _, handles := range d.handles {
		for id, slot := range handles {
			if !slot.at.IsZero() && now.Sub(slot.at) > d.ttl {
				delete(handles, id)
			}
		}
	}
}

func (d *importingDesk) subtractLocked(project string, slot *uploadSlot) {
	if slot.accounted == 0 {
		return
	}
	if d.projectBytes[project] >= slot.accounted {
		d.projectBytes[project] -= slot.accounted
	} else {
		d.projectBytes[project] = 0
	}
	if d.globalBytes >= slot.accounted {
		d.globalBytes -= slot.accounted
	} else {
		d.globalBytes = 0
	}
	slot.accounted = 0
	slot.body = nil
}

func (d *importingDesk) Register(project string, handle devicetransfer.Handle) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.sweepLocked(d.now())
	if d.handles[project] == nil {
		d.handles[project] = map[string]deskHandle{}
	}
	if _, exists := d.handles[project][handle.ID]; !exists && len(d.handles[project]) >= maxHandlesPerProject {
		return devicetransfer.OverLimit
	}
	d.handles[project][handle.ID] = deskHandle{handle: handle, at: d.now()}
	return ""
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
	d.sweepLocked(d.now())
	slot, ok := d.handles[project][handle]
	return slot.handle, ok, slot.expired
}

func (d *importingDesk) Put(project, upload string, body []byte, transfer devicetransfer.Transfer) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.sweepLocked(d.now())
	if d.uploads[project] == nil {
		d.uploads[project] = map[string]*uploadSlot{}
	}
	slot := d.uploads[project][upload]
	for slot != nil && slot.busy {
		d.cond.Wait()
	}
	fresh := slot == nil
	if fresh {
		if d.liveUploads(project) >= maxUploadsPerProject {
			return devicetransfer.OverLimit
		}
		slot = &uploadSlot{created: d.now()}
	}
	if slot.commit != nil || slot.transfer.Cancelled {
		return ""
	}
	incoming := uint64(len(body))
	nextProject := d.projectBytes[project] - slot.accounted + incoming
	nextGlobal := d.globalBytes - slot.accounted + incoming
	if nextProject > maxProjectBytes || nextGlobal > maxGlobalBytes {
		return devicetransfer.OverLimit
	}
	if fresh {
		d.uploads[project][upload] = slot
	}
	d.projectBytes[project] = nextProject
	d.globalBytes = nextGlobal
	slot.accounted = incoming
	slot.body = append([]byte(nil), body...)
	slot.transfer = transfer
	return ""
}

func (d *importingDesk) Get(project, upload string) ([]byte, devicetransfer.Transfer, *devicetransfer.Commit, bool) {
	d.mu.Lock()
	defer d.mu.Unlock()
	slot := d.uploads[project][upload]
	if slot == nil {
		return nil, devicetransfer.Transfer{}, nil, false
	}
	var commit *devicetransfer.Commit
	if slot.commit != nil {
		copy := *slot.commit
		commit = &copy
	}
	return append([]byte(nil), slot.body...), slot.transfer, commit, true
}

func (d *importingDesk) Remember(project, upload string, commit devicetransfer.Commit) {
	d.mu.Lock()
	defer d.mu.Unlock()
	slot := d.uploads[project][upload]
	if slot == nil {
		return
	}
	stored := commit
	slot.commit = &stored
	d.subtractLocked(project, slot)
}

func (d *importingDesk) Reserve(project, upload string, fn func(body []byte, transfer devicetransfer.Transfer, prior *devicetransfer.Commit) (devicetransfer.Commit, string)) (devicetransfer.Commit, string, bool) {
	d.mu.Lock()
	d.sweepLocked(d.now())
	slot := d.uploads[project][upload]
	if slot == nil {
		d.mu.Unlock()
		return devicetransfer.Commit{}, "", false
	}
	for slot.busy {
		d.cond.Wait()
	}
	if slot.transfer.Cancelled {
		d.mu.Unlock()
		return devicetransfer.Commit{}, devicetransfer.CancelledTransfer, true
	}
	var prior *devicetransfer.Commit
	if slot.commit != nil {
		copy := *slot.commit
		prior = &copy
	}
	body := append([]byte(nil), slot.body...)
	transfer := slot.transfer
	slot.busy = true
	d.mu.Unlock()
	commit, code := fn(body, transfer, prior)
	d.mu.Lock()
	slot.busy = false
	if code != "" && slot.commit == nil {
		d.subtractLocked(project, slot)
		delete(d.uploads[project], upload)
	} else if code == "" && slot.commit == nil {
		stored := commit
		slot.commit = &stored
		d.subtractLocked(project, slot)
	}
	d.cond.Broadcast()
	d.mu.Unlock()
	if code != "" {
		return devicetransfer.Commit{}, code, true
	}
	return commit, "", true
}

func (d *importingDesk) Import(ctx context.Context, project, digest string, body []byte) (devicetransfer.Commit, bool) {
	if d.importer == nil {
		return devicetransfer.Commit{}, false
	}
	id, revision, ok := d.importer.ImportPDF(ctx, project, body, digest)
	if !ok || id == "" || revision == "" || id == "paper-"+digest[:12] {
		return devicetransfer.Commit{}, false
	}
	return devicetransfer.Commit{PaperID: id, Revision: revision, Digest: digest}, true
}

func (d *importingDesk) Cancel(project, upload string) string {
	d.mu.Lock()
	defer d.mu.Unlock()
	slot := d.uploads[project][upload]
	if slot == nil {
		return devicetransfer.Foreign
	}
	for slot.busy {
		d.cond.Wait()
	}
	if slot.commit != nil {
		return devicetransfer.Conflict
	}
	slot.transfer.Cancelled = true
	d.subtractLocked(project, slot)
	return ""
}

func (d *importingDesk) liveUploads(project string) int {
	count := 0
	for _, slot := range d.uploads[project] {
		if slot.commit == nil && !slot.transfer.Cancelled {
			count++
		}
	}
	return count
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
	if code := a.files.Register(project, devicetransfer.Handle{
		ID: request.ID, Provider: request.Provider, MediaType: request.MediaType, Size: request.Size, Name: request.Name,
	}); code != "" {
		deviceError(w, code)
		return
	}
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
	if code := a.files.Put(project, upload, body, transfer); code != "" {
		deviceError(w, code)
		return
	}
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
		stored.Digest = request.Digest
		stored.Size = request.Size
		stored.App = request.App
		_, known, expired := a.files.Lookup(project, stored.HandleID)
		sum := sha256.Sum256(body)
		domainID, domainRevision := "", ""
		if prior == nil && known && !expired && hex.EncodeToString(sum[:]) == request.Digest && uint64(len(body)) == request.Size {
			imported, ok := a.files.Import(r.Context(), project, request.Digest, body)
			if ok {
				domainID, domainRevision = imported.PaperID, imported.Revision
			}
		}
		return devicetransfer.Finalize(true, project, stored, body, known, expired, prior, domainID, domainRevision)
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
	if code := a.files.Cancel(project, upload); code != "" {
		deviceError(w, code)
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
