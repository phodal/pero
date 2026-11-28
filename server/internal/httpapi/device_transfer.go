package httpapi

import (
	"io"
	"net/http"
	"strings"

	"github.com/phodal/pero/server/internal/devicetransfer"
)

// DeviceDesk keeps an in-flight upload and asks the domain to import it once.
type DeviceDesk interface {
	Lookup(handle string) (devicetransfer.Handle, bool, bool)
	Put(upload string, body []byte, transfer devicetransfer.Transfer)
	Get(upload string) (body []byte, transfer devicetransfer.Transfer, commit *devicetransfer.Commit, ok bool)
	Remember(upload string, commit devicetransfer.Commit)
	Imported(digest string) (devicetransfer.Commit, bool)
	Cancel(upload string)
}

func (a *API) acceptDeviceBytes(w http.ResponseWriter, r *http.Request) {
	project, upload, ok := devicePath(w, r)
	if !ok {
		return
	}
	if !deviceMember(r, project) {
		deviceError(w, devicetransfer.Revoked)
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
	if a.files == nil {
		deviceError(w, devicetransfer.Foreign)
		return
	}
	handle, known, expired := a.files.Lookup(handleID)
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
	a.files.Put(upload, body, transfer)
	respond(w, 202, map[string]any{"received": len(body), "uploadId": upload})
}

func (a *API) finalizeDeviceTransfer(w http.ResponseWriter, r *http.Request) {
	project, upload, ok := devicePath(w, r)
	if !ok {
		return
	}
	member := deviceMember(r, project)
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
	if a.files == nil {
		deviceError(w, devicetransfer.Foreign)
		return
	}
	body, stored, prior, found := a.files.Get(upload)
	if !found {
		deviceError(w, devicetransfer.Interrupted)
		return
	}
	stored.Digest = request.Digest
	stored.MediaType = request.MediaType
	stored.Size = request.Size
	stored.App = request.App
	stored.HandleID = request.Handle
	_, known, expired := a.files.Lookup(request.Handle)
	imported, seen := a.files.Imported(request.Digest)
	revision := ""
	if seen {
		revision = imported.Revision
	}
	var priorCommit *devicetransfer.Commit
	if prior != nil {
		priorCommit = prior
	}
	commit, failure := devicetransfer.Finalize(member, project, stored, body, known, expired, priorCommit, revision)
	if failure != "" {
		deviceError(w, failure)
		return
	}
	a.files.Remember(upload, commit)
	respond(w, 200, commit)
}

func (a *API) cancelDeviceTransfer(w http.ResponseWriter, r *http.Request) {
	_, upload, ok := devicePath(w, r)
	if !ok || a.files == nil {
		deviceError(w, devicetransfer.Foreign)
		return
	}
	a.files.Cancel(upload)
	respond(w, 200, map[string]string{"outcome": devicetransfer.CancelledTransfer})
}

func devicePath(w http.ResponseWriter, r *http.Request) (string, string, bool) {
	project, upload := r.PathValue("project"), r.PathValue("upload")
	if strings.Contains(project, "..") || strings.Contains(upload, "..") || strings.ContainsAny(project+upload, "/\\") {
		deviceError(w, devicetransfer.Traversal)
		return "", "", false
	}
	if project == "" || upload == "" {
		deviceError(w, devicetransfer.Foreign)
		return "", "", false
	}
	return project, upload, true
}

func deviceMember(r *http.Request, project string) bool {
	for _, allowed := range clientIdentity(r).Projects {
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
	case devicetransfer.Foreign:
		status = 404
	}
	respond(w, status, map[string]string{"error": code})
}
