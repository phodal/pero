// Package runtimegateway is the trusted, single-relay I/O boundary. Durable
// channel authority remains in Store; in-memory pipes can never resume a prompt.
package runtimegateway

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/phodal/pero/server/internal/runtimeauth"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"github.com/phodal/pero/server/internal/store"
)

type Gateway struct {
	db       *store.Store
	reviewer *runtimeauth.Reviewer
	provider ProviderConfig
	client   *http.Client
	mu       sync.Mutex
	pairs    map[string]*pair
	ingress  chan struct{}
}
type pair struct {
	ready           chan struct{}
	done            chan struct{}
	once            sync.Once
	workerR, agentR *io.PipeReader
	workerW, agentW *io.PipeWriter
	count           int
	bytes           atomic.Int64
}

func New(db *store.Store, reviewer *runtimeauth.Reviewer, provider ProviderConfig) (*Gateway, error) {
	if db == nil || reviewer == nil || provider.Validate() != nil {
		return nil, runtimechannel.ErrAuthority
	}
	return &Gateway{db: db, reviewer: reviewer, provider: provider, client: provider.client(), pairs: make(map[string]*pair), ingress: make(chan struct{}, 8)}, nil
}
func (g *Gateway) Budget() runtimechannel.ProviderBudget { return g.provider.Budget }
func (g *Gateway) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/runtime/v1/runs/{id}/channel/{role}", g.attach)
	mux.HandleFunc("POST /api/runtime/v1/runs/{id}/provider/v1/chat/completions", g.proxy)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		mux.ServeHTTP(w, r)
	})
}
func bearer(r *http.Request) (string, bool) {
	s, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	return s, ok && s != "" && len(s) <= 16<<10 && !strings.ContainsAny(s, "\r\n")
}
func deny(w http.ResponseWriter, status int) { http.Error(w, "runtime authority unavailable", status) }
func (g *Gateway) attach(w http.ResponseWriter, r *http.Request) {
	// Must precede even a known 425: the client has an unfinished duplex body.
	if r.ProtoMajor == 1 {
		w.Header().Set("Connection", "close")
	}
	rc := http.NewResponseController(w)
	if rc.SetReadDeadline(time.Now().Add(runtimechannel.MaxDuration)) != nil || rc.SetWriteDeadline(time.Now().Add(runtimechannel.MaxDuration)) != nil {
		deny(w, 500)
		return
	}
	if err := rc.EnableFullDuplex(); err != nil && r.ProtoMajor == 1 {
		deny(w, 500)
		return
	}
	token, ok := bearer(r)
	if !ok {
		deny(w, 401)
		return
	}
	role, runID, sessionID := r.PathValue("role"), r.PathValue("id"), r.URL.Query().Get("session_id")
	if r.Header.Get("Content-Type") != "application/x-ndjson" || sessionID != runID || len(r.URL.Query()) != 1 || role != "worker" && role != "agent" {
		deny(w, 400)
		return
	}
	var identity runtimechannel.PodIdentity
	secret := ""
	if role == "agent" {
		var err error
		identity, err = g.reviewer.Review(r.Context(), token, runtimechannel.Audience)
		if err != nil {
			deny(w, 403)
			return
		}
		// Known pre-admission only. An absent grant is not authorization, and cannot
		// consume the single attachment. Failed/terminal bindings never return 425.
		if _, err = g.db.RuntimeChannel(r.Context(), runID); errors.Is(err, store.ErrNotFound) {
			b, e := g.db.RuntimeBinding(r.Context(), runID)
			if e == nil && b.Config.IsIsolated() && !b.ReleaseRequested && b.Snapshot == nil && b.Phase == "pending" || e == nil && b.Config.IsIsolated() && !b.ReleaseRequested && b.Phase == "ready" {
				if identity.Namespace == b.Config.Namespace && identity.ServiceAccount == b.Config.ServiceAccount && identity.ServiceAccountUID == b.Config.ServiceAccountUID {
					w.Header().Set("Retry-After", "1")
					deny(w, 425)
					return
				}
			}
			deny(w, 403)
			return
		}
	} else {
		var prefix string
		prefix, secret, ok = strings.Cut(token, ".")
		if !ok || prefix != sessionID {
			deny(w, 403)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), runtimechannel.MaxDuration)
	defer cancel()
	admit, stop := context.WithTimeout(ctx, 4*time.Second)
	_, err := g.db.AttachRuntimeChannel(admit, runID, sessionID, role, secret, identity)
	stop()
	if err != nil {
		status := 409
		if errors.Is(err, store.ErrForbidden) || errors.Is(err, store.ErrLease) {
			status = 403
		}
		deny(w, status)
		return
	}
	g.mu.Lock()
	p := g.pairs[runID]
	if p == nil {
		p = &pair{ready: make(chan struct{}), done: make(chan struct{})}
		p.workerR, p.workerW = io.Pipe()
		p.agentR, p.agentW = io.Pipe()
		g.pairs[runID] = p
	}
	p.count++
	if p.count == 2 {
		close(p.ready)
	}
	g.mu.Unlock()
	defer func() { g.end(runID, p); r.Body.Close() }()
	go func() {
		select {
		case <-p.done:
		case <-ctx.Done():
		}
		_ = rc.SetWriteDeadline(time.Now())
		_ = rc.SetReadDeadline(time.Now())
	}()
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.WriteHeader(200)
	if rc.Flush() != nil {
		return
	}
	select {
	case <-p.ready:
	case <-p.done:
		return
	case <-ctx.Done():
		return
	}
	go g.watch(ctx, runID, p)
	input, output := p.workerR, p.agentW
	if role == "agent" {
		input, output = p.agentR, p.workerW
	}
	go func() { _ = copyJSONLines(output, r.Body, &p.bytes); g.end(runID, p) }()
	_ = copyJSONLines(flushWriter{w, rc}, input, &atomic.Int64{})
}

type flushWriter struct {
	w  io.Writer
	rc *http.ResponseController
}

func (f flushWriter) Write(b []byte) (int, error) {
	n, err := f.w.Write(b)
	if err == nil {
		err = f.rc.Flush()
	}
	return n, err
}
func copyJSONLines(dst io.Writer, src io.Reader, budget *atomic.Int64) error {
	reader := bufio.NewReaderSize(src, runtimechannel.MaxLineBytes+1)
	for {
		line, err := reader.ReadSlice('\n')
		if err != nil {
			return err
		}
		if len(line) > runtimechannel.MaxLineBytes || budget.Add(int64(len(line))) > runtimechannel.MaxStreamBytes || !json.Valid(line) {
			return runtimechannel.ErrAuthority
		}
		if _, err = dst.Write(line); err != nil {
			return err
		}
	}
}
func (g *Gateway) end(runID string, p *pair) {
	p.once.Do(func() {
		close(p.done)
		p.workerR.Close()
		p.workerW.Close()
		p.agentR.Close()
		p.agentW.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		// EOF revokes capability; only the trusted Worker's durable execution receipt
		// decides normal completion vs reconciliation. Reattachment remains impossible.
		_ = g.db.CloseRuntimeTransport(ctx, runID)
		g.mu.Lock()
		delete(g.pairs, runID)
		g.mu.Unlock()
	})
}
func (g *Gateway) watch(ctx context.Context, runID string, p *pair) {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			g.end(runID, p)
			return
		case <-p.done:
			return
		case <-ticker.C:
			if _, err := g.db.AuthorizeRuntimeChannel(ctx, runID); err != nil {
				g.end(runID, p)
				return
			}
		}
	}
}

func (g *Gateway) livePair(runID string) *pair {
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.pairs[runID]
	if p == nil || p.count != 2 {
		return nil
	}
	select {
	case <-p.done:
		return nil
	default:
		return p
	}
}
