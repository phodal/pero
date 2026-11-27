package httpapi

import (
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"sync"

	"github.com/phodal/pero/server/internal/store"
)

type desktopCommand struct {
	ID   string `json:"id"`
	Mode string `json:"mode"`
}

type desktopOffer struct {
	Invitation string `json:"invitation,omitempty"`
	Error      string `json:"error,omitempty"`
}

// Only an outstanding authenticated viewer request is held here. Invitations
// are single-use and never enter the durable Run log or Artifact list.
type runDesktopRequest struct {
	command desktopCommand
	answer  chan desktopOffer
}

type runDesktopBroker struct {
	mu      sync.Mutex
	pending map[string]*runDesktopRequest
	fileIO  chan struct{}
}

var desktopInvitation = regexp.MustCompile(`^[\w-]{43}\.[\w-]{43}$`)

func (a *API) registerRunDesktops(mux *http.ServeMux) {
	a.runDesktops.pending = make(map[string]*runDesktopRequest)
	a.runDesktops.fileIO = make(chan struct{}, 2)
	for _, prefix := range []string{"/api/v1", "/api/client/v1"} {
		mux.HandleFunc("POST "+prefix+"/runs/{id}/desktop", func(w http.ResponseWriter, r *http.Request) {
			var client *store.Client
			if prefix == "/api/client/v1" {
				client = clientIdentity(r)
			}
			a.openRunDesktop(w, r, client)
		})
	}
	const worker = "/api/worker/v1/runs/{id}/desktop"
	mux.HandleFunc("POST "+worker+"/poll", a.pollRunDesktop)
	mux.HandleFunc("POST "+worker, a.answerRunDesktop)
	mux.HandleFunc("PUT "+worker+"/files/{file}", a.putRunDesktopFile)
}

func (a *API) openRunDesktop(w http.ResponseWriter, r *http.Request, client *store.Client) {
	var command desktopCommand
	if !decode(w, r, &command) {
		return
	}
	if !bounded(command.ID, 128) || (command.Mode != "watch" && command.Mode != "control" && command.Mode != "release") {
		invalid(w)
		return
	}
	id := r.PathValue("id")
	if _, err := a.db.DesktopRun(r.Context(), client, id, true); err != nil {
		failure(w, err)
		return
	}
	broker := &a.runDesktops
	pending := &runDesktopRequest{command: command, answer: make(chan desktopOffer, 1)}
	broker.mu.Lock()
	if broker.pending[id] != nil {
		broker.mu.Unlock()
		failure(w, store.ErrConflict)
		return
	}
	broker.pending[id] = pending
	broker.mu.Unlock()
	defer func() {
		broker.mu.Lock()
		delete(broker.pending, id)
		broker.mu.Unlock()
	}()
	select {
	case offer := <-pending.answer:
		if _, err := a.db.DesktopRun(r.Context(), client, id, true); err != nil {
			failure(w, err)
			return
		}
		if offer.Error != "" {
			respond(w, 409, offer)
			return
		}
		respond(w, 200, offer)
	case <-r.Context().Done():
		respond(w, 504, map[string]string{"error": "The Worker did not answer the desktop request"})
	}
}

func (a *API) pollRunDesktop(w http.ResponseWriter, r *http.Request) {
	var execution executionInput
	if !decode(w, r, &execution) {
		return
	}
	if !a.checkRunDesktopLease(w, r, execution) {
		return
	}
	broker := &a.runDesktops
	broker.mu.Lock()
	var command *desktopCommand
	if pending := broker.pending[r.PathValue("id")]; pending != nil && len(pending.answer) == 0 {
		command = &pending.command
	}
	broker.mu.Unlock()
	respond(w, 200, struct {
		Command *desktopCommand `json:"command"`
	}{command})
}

func (a *API) answerRunDesktop(w http.ResponseWriter, r *http.Request) {
	var data struct {
		executionInput
		ID string `json:"id"`
		desktopOffer
	}
	if !decode(w, r, &data) {
		return
	}
	if !bounded(data.ID, 128) || len(data.Error) > 500 || (data.Invitation != "" && !validRunDesktopInvitation(data.Invitation)) {
		invalid(w)
		return
	}
	if !a.checkRunDesktopLease(w, r, data.executionInput) {
		return
	}
	broker := &a.runDesktops
	broker.mu.Lock()
	defer broker.mu.Unlock()
	pending := broker.pending[r.PathValue("id")]
	if pending == nil || pending.command.ID != data.ID || len(pending.answer) != 0 {
		failure(w, store.ErrConflict)
		return
	}
	if data.Error == "" && (pending.command.Mode == "release") != (data.Invitation == "") {
		invalid(w)
		return
	}
	pending.answer <- data.desktopOffer
	respond(w, 200, struct{}{})
}

func (a *API) checkRunDesktopLease(w http.ResponseWriter, r *http.Request, execution executionInput) bool {
	if !validExecution(execution) {
		invalid(w)
		return false
	}
	if err := a.db.RunDesktopLease(r.Context(), r.PathValue("id"), workerID(r), execution.InstanceID, execution.Generation); err != nil {
		failure(w, err)
		return false
	}
	return true
}

func validRunDesktopInvitation(raw string) bool {
	if len(raw) > 2048 {
		return false
	}
	invite, err := url.Parse(raw)
	if err != nil {
		return false
	}
	base, err := url.Parse(os.Getenv("PERO_DESKTOP_RELAY_URL"))
	return err == nil && (base.Scheme == "https" || (base.Scheme == "http" && base.Hostname() == "127.0.0.1")) &&
		invite.Scheme == base.Scheme && invite.Host == base.Host && invite.User == nil && invite.EscapedPath() == "/" &&
		invite.RawQuery == "" && desktopInvitation.MatchString(invite.Fragment)
}

func (a *API) putRunDesktopFile(w http.ResponseWriter, r *http.Request) {
	file := store.DesktopFile(r.PathValue("file"))
	generation, parseErr := strconv.ParseInt(r.Header.Get("X-Pero-Generation"), 10, 64)
	execution := executionInput{Generation: generation, InstanceID: r.Header.Get("X-Pero-Instance")}
	if parseErr != nil || !file.Valid() || r.ContentLength < 1 || r.ContentLength > store.MaxDesktopFileBytes {
		invalid(w)
		return
	}
	select {
	case a.runDesktops.fileIO <- struct{}{}:
		defer func() { <-a.runDesktops.fileIO }()
	default:
		respond(w, 429, map[string]string{"error": "Desktop evidence storage is busy"})
		return
	}
	data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, store.MaxDesktopFileBytes))
	if err != nil || int64(len(data)) != r.ContentLength {
		invalid(w)
		return
	}
	entry, err := a.db.SaveRunDesktopFile(r.Context(), r.PathValue("id"), workerID(r), execution.InstanceID, execution.Generation, file, data)
	if err != nil {
		failure(w, err)
		return
	}
	respond(w, 200, entry)
}

func (a *API) desktopArtifact(w http.ResponseWriter, r *http.Request, client *store.Client) {
	id := r.PathValue("id")
	if _, err := a.db.DesktopRun(r.Context(), client, id, false); err != nil {
		failure(w, err)
		return
	}
	file := store.DesktopFile(r.PathValue("file"))
	if !file.Valid() {
		failure(w, store.ErrNotFound)
		return
	}
	data, err := a.db.RunDesktopFile(r.Context(), id, file)
	if err != nil {
		failure(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": string(file)}))
	w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
	_, _ = w.Write(data)
}
