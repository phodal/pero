package runtimegateway

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"sync"
	"time"

	"github.com/phodal/pero/server/internal/runtimechannel"
)

const (
	maxBrowserRequest = 16 << 10
	maxBrowserReply   = 8 << 20
	browserCallLimit  = 25 * time.Second
)

var errBrowserBusy = errors.New("the shared browser already has a call in progress")

// This carrier is a child of the live ACP pair. It forwards semantic Browser Use
// requests to the Desktop, which owns the browser, its grant and input admission.
type browserCarrier struct {
	scope   runtimechannel.Scope
	pending chan browserExchange
	slot    chan struct{}
	done    chan struct{}
	stop    sync.Once
}

type browserExchange struct {
	ctx       context.Context
	arguments json.RawMessage
	completed chan json.RawMessage
}

type browserFrame struct {
	ID    uint64          `json:"id"`
	Value json.RawMessage `json:"value"`
}

func (b *browserCarrier) close() { b.stop.Do(func() { close(b.done) }) }

func (b *browserCarrier) call(ctx context.Context, authorityDone <-chan struct{}, arguments json.RawMessage) (json.RawMessage, error) {
	select {
	case b.slot <- struct{}{}:
		defer func() { <-b.slot }()
	default:
		return nil, errBrowserBusy
	}
	request := browserExchange{ctx: ctx, arguments: arguments, completed: make(chan json.RawMessage, 1)}
	select {
	case <-b.done:
		return nil, io.ErrClosedPipe
	case <-authorityDone:
		return nil, runtimechannel.ErrAuthority
	case <-ctx.Done():
		return nil, ctx.Err()
	case b.pending <- request:
	}
	select {
	case <-b.done:
		return nil, io.ErrClosedPipe
	case <-authorityDone:
		return nil, runtimechannel.ErrAuthority
	case <-ctx.Done():
		// The Desktop may already have acted. Close this grant and discard
		// late responses. A new grant always requires a fresh attachment.
		b.close()
		return nil, ctx.Err()
	case result := <-request.completed:
		return result, nil
	}
}

func validBrowserObject(raw json.RawMessage) bool {
	value := bytes.TrimSpace(raw)
	return len(value) > 0 && value[0] == '{' && json.Valid(value)
}

func (g *Gateway) admitBrowserDesktop(ctx context.Context, runID, token string) (*pair, runtimechannel.Scope, error) {
	p := g.livePair(runID)
	if p == nil {
		return nil, runtimechannel.Scope{}, runtimechannel.ErrAuthority
	}
	admit, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	client, err := g.db.AuthenticateClient(admit, token)
	if err != nil {
		return nil, runtimechannel.Scope{}, err
	}
	session, err := g.db.AuthorizeRuntimeBrowserOwner(admit, runID, client)
	return p, session.Scope, err
}

func (g *Gateway) browserDesktopReady(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("id")
	token, ok := bearer(r)
	if !ok || r.URL.Query().Get("session_id") != runID || len(r.URL.Query()) != 1 {
		deny(w, http.StatusBadRequest)
		return
	}
	if _, _, err := g.admitBrowserDesktop(r.Context(), runID, token); err != nil {
		deny(w, http.StatusForbidden)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = io.WriteString(w, `{"available":true}`)
}

func (g *Gateway) attachBrowser(w http.ResponseWriter, r *http.Request) {
	if r.ProtoMajor == 1 {
		w.Header().Set("Connection", "close")
	}
	ctx, cancel := context.WithTimeout(r.Context(), runtimechannel.MaxDuration)
	defer cancel()
	deadline, _ := ctx.Deadline()
	rc := http.NewResponseController(w)
	if rc.SetReadDeadline(deadline) != nil || rc.SetWriteDeadline(deadline) != nil ||
		(rc.EnableFullDuplex() != nil && r.ProtoMajor == 1) {
		deny(w, http.StatusInternalServerError)
		return
	}
	runID := r.PathValue("id")
	token, ok := bearer(r)
	if !ok || r.Header.Get("Content-Type") != "application/x-ndjson" ||
		r.URL.Query().Get("session_id") != runID || len(r.URL.Query()) != 1 {
		deny(w, http.StatusBadRequest)
		return
	}
	p, scope, err := g.admitBrowserDesktop(ctx, runID, token)
	if err != nil {
		deny(w, http.StatusForbidden)
		return
	}
	carrier := &browserCarrier{scope: scope, pending: make(chan browserExchange), slot: make(chan struct{}, 1), done: make(chan struct{})}
	g.mu.Lock()
	accepted := g.pairs[runID] == p && p.browser == nil
	select {
	case <-p.done:
		accepted = false
	default:
	}
	if accepted {
		p.browser = carrier
	}
	g.mu.Unlock()
	if !accepted {
		deny(w, http.StatusConflict)
		return
	}
	defer func() {
		carrier.close()
		g.mu.Lock()
		p.browser = nil
		g.mu.Unlock()
	}()
	go func() {
		select {
		case <-p.done:
		case <-ctx.Done():
		case <-carrier.done:
		}
		carrier.close()
		_ = rc.SetReadDeadline(time.Now())
		_ = rc.SetWriteDeadline(time.Now())
	}()
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(http.StatusOK)
	if rc.Flush() != nil {
		return
	}
	// Read replies even when idle so Desktop EOF releases the grant immediately.
	replies := make(chan browserFrame)
	go func() {
		defer close(replies)
		reader := bufio.NewReaderSize(r.Body, maxBrowserReply+1)
		for {
			line, readErr := reader.ReadSlice('\n')
			if readErr != nil || len(line) > maxBrowserReply || !json.Valid(line) {
				return
			}
			var reply browserFrame
			decoder := json.NewDecoder(bytes.NewReader(line))
			decoder.DisallowUnknownFields()
			if decoder.Decode(&reply) != nil || !validBrowserObject(reply.Value) {
				return
			}
			select {
			case <-carrier.done:
				return
			case replies <- reply:
			}
		}
	}()
	writer := json.NewEncoder(flushWriter{w, rc})
	for sequence := uint64(1); ; sequence++ {
		select {
		case <-carrier.done:
			return
		case <-replies:
			return // EOF or unsolicited reply
		case request := <-carrier.pending:
			select {
			case <-p.done:
				return
			case <-carrier.done:
				return
			default:
			}
			if request.ctx.Err() != nil {
				return
			}
			if writer.Encode(browserFrame{ID: sequence, Value: request.arguments}) != nil {
				return
			}
			select {
			case <-carrier.done:
				return
			case reply, open := <-replies:
				if !open || reply.ID != sequence {
					return
				}
				request.completed <- reply.Value
			}
		}
	}
}

func (g *Gateway) callBrowser(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), browserCallLimit)
	defer cancel()
	rc := http.NewResponseController(w)
	deadline, _ := ctx.Deadline()
	if rc.SetReadDeadline(deadline) != nil || rc.SetWriteDeadline(deadline.Add(time.Second)) != nil {
		deny(w, http.StatusInternalServerError)
		return
	}
	runID := r.PathValue("id")
	token, ok := bearer(r)
	if !ok || r.Header.Get("Content-Type") != "application/json" ||
		r.URL.Query().Get("session_id") != runID || len(r.URL.Query()) != 1 {
		deny(w, http.StatusBadRequest)
		return
	}
	p := g.livePair(runID)
	if p == nil {
		deny(w, http.StatusForbidden)
		return
	}
	select {
	case g.ingress <- struct{}{}:
		defer func() { <-g.ingress }()
	default:
		deny(w, http.StatusTooManyRequests)
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxBrowserRequest))
	if err != nil || !validBrowserObject(raw) {
		deny(w, http.StatusBadRequest)
		return
	}
	identity, err := g.reviewer.Review(ctx, token, runtimechannel.Audience)
	if err != nil {
		deny(w, http.StatusForbidden)
		return
	}
	session, err := g.db.AuthorizeRuntimeChannel(ctx, runID)
	if err != nil || session.State != runtimechannel.Started || !session.Scope.Accepts(identity) {
		deny(w, http.StatusForbidden)
		return
	}
	g.mu.Lock()
	carrier := p.browser
	g.mu.Unlock()
	if carrier == nil {
		http.Error(w, "No Desktop browser is shared with this Run", http.StatusConflict)
		return
	}
	if session.Scope != carrier.scope {
		deny(w, http.StatusForbidden)
		return
	}
	result, err := carrier.call(ctx, p.done, raw)
	if err != nil {
		if errors.Is(err, errBrowserBusy) {
			http.Error(w, err.Error(), http.StatusConflict)
		} else {
			http.Error(w, "Browser result unavailable. Verify the page before retrying.", http.StatusBadGateway)
		}
		return
	}
	session, err = g.db.AuthorizeRuntimeChannel(ctx, runID)
	if err != nil || session.State != runtimechannel.Started || session.Scope != carrier.scope {
		deny(w, http.StatusForbidden)
		return
	}
	select {
	case <-p.done:
		deny(w, http.StatusForbidden)
		return
	case <-carrier.done:
		http.Error(w, "Browser result unavailable. Verify the page before retrying.", http.StatusBadGateway)
		return
	default:
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(result)
}
