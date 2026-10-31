package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"net"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

type catalogFixture struct {
	mu       sync.Mutex
	capacity int
	uneven   bool
	calls    []string
	entered  chan struct{}
	release  chan struct{}
}

func (a *catalogFixture) ListModels(context.Context, string) ([]harness.ModelCatalogEntry, error) {
	return []harness.ModelCatalogEntry{{Provider: "test", ID: "a", Name: "A"}, {Provider: "test", ID: "b", Name: "B"}}, nil
}
func (a *catalogFixture) ResolveModelInfo(_ context.Context, p, m string) (harness.ModelInfo, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if p != "test" || (m != "a" && m != "b") {
		return harness.ModelInfo{}, errors.New("unknown")
	}
	capacity := a.capacity
	if a.uneven && m == "b" {
		capacity /= 2
	}
	return harness.ModelInfo{Provider: p, Model: m, ContextWindow: capacity, DefaultMaxTokens: 128}, nil
}
func (a *catalogFixture) Generate(ctx context.Context, r harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
	a.mu.Lock()
	a.calls = append(a.calls, r.Model)
	entered, release := a.entered, a.release
	a.mu.Unlock()
	if entered != nil {
		close(entered)
		select {
		case <-release:
		case <-ctx.Done():
			return harness.Completion{}, ctx.Err()
		}
	}
	return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: r.Model}}}}, nil
}
func modelServer(t *testing.T, enabled bool) (*Server, *catalogFixture) {
	t.Helper()
	ctx := context.Background()
	a := &catalogFixture{capacity: 8192}
	h, err := harness.Boot(ctx, harness.Options{Adapter: a, ModelInfo: a, AdapterProviders: []string{"test"}})
	if err != nil {
		t.Fatal(err)
	}
	p, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewServer(Options{Harness: h, Persistence: p, Provider: "test", Model: "a", ModelSelection: enabled})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.closeAll(ctx); _ = h.Dispose(ctx); _ = h.Drain(ctx) })
	return s, a
}

func TestModelSelectionWireRestoreAndRejection(t *testing.T) {
	s, a := modelServer(t, true)
	client, peer := net.Pipe()
	_ = client.SetDeadline(time.Now().Add(10 * time.Second))
	done := make(chan error, 1)
	go func() { done <- s.Serve(context.Background(), peer, peer); _ = peer.Close() }()
	defer func() {
		_ = client.Close()
		if err := <-done; err != nil {
			t.Error(err)
		}
	}()
	enc := json.NewEncoder(client)
	scan := bufio.NewScanner(client)
	seq := 0
	rpc := func(method string, p any, wantError bool) map[string]any {
		t.Helper()
		seq++
		if err := enc.Encode(map[string]any{"jsonrpc": "2.0", "id": seq, "method": method, "params": p}); err != nil {
			t.Fatal(err)
		}
		for scan.Scan() {
			var v map[string]any
			if err := json.Unmarshal(scan.Bytes(), &v); err != nil {
				t.Fatal(err)
			}
			if v["id"] != float64(seq) {
				continue
			}
			if (v["error"] != nil) != wantError {
				t.Fatalf("%s: %v", method, v)
			}
			if wantError {
				return nil
			}
			return v["result"].(map[string]any)
		}
		t.Fatalf("wire EOF: %v", scan.Err())
		return nil
	}
	current := func(r map[string]any) string {
		t.Helper()
		return r["configOptions"].([]any)[0].(map[string]any)["currentValue"].(string)
	}
	cwd := t.TempDir()
	created := rpc("session/new", map[string]any{"cwd": cwd, "mcpServers": []any{}}, false)
	id := created["sessionId"].(string)
	if current(created) != "a" {
		t.Fatal(created)
	}
	for _, params := range []any{map[string]any{"sessionId": id, "configId": "model", "value": "unknown"}, map[string]any{"sessionId": "unknown", "configId": "model", "value": "b"}, map[string]any{"sessionId": id, "configId": "future", "value": "b"}, map[string]any{"sessionId": id, "configId": "model", "value": true}, map[string]any{"sessionId": id, "configId": "model", "value": "b", "unsupported": true}} {
		rpc("session/set_config_option", params, true)
	}
	changed := rpc("session/set_config_option", map[string]any{"sessionId": id, "configId": "model", "value": "b"}, false)
	if current(changed) != "b" {
		t.Fatal(changed)
	}
	// No generation/discovery HTTP is caused by changing a selection.
	a.mu.Lock()
	n := len(a.calls)
	a.mu.Unlock()
	if n != 0 {
		t.Fatalf("selection generated %d calls", n)
	}
	rpc("session/close", map[string]any{"sessionId": id}, false)
	restored := rpc("session/load", map[string]any{"sessionId": id, "cwd": cwd, "mcpServers": []any{}}, false)
	if current(restored) != "b" {
		t.Fatal(restored)
	}
	rpc("session/prompt", map[string]any{"sessionId": id, "prompt": []any{map[string]any{"type": "text", "text": "hi"}}}, false)
	a.mu.Lock()
	calls := append([]string(nil), a.calls...)
	a.mu.Unlock()
	if len(calls) != 1 || calls[0] != "b" {
		t.Fatal(calls)
	}
	rpc("session/close", map[string]any{"sessionId": id}, false)
	resumed := rpc("session/resume", map[string]any{"sessionId": id, "cwd": cwd, "mcpServers": []any{}}, false)
	if current(resumed) != "b" {
		t.Fatal(resumed)
	}
}

func TestModelSelectionRejectsActiveCommandPromptAndCapacityDrift(t *testing.T) {
	s, a := modelServer(t, true)
	ctx := context.Background()
	id, err := s.newSession(ctx, NewSessionParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	// Direct API fixture has no transport; discard projected messages.
	s.writer = &wireWriter{encoder: json.NewEncoder(discardWriter{})}
	set := func() *rpcError {
		_, err := s.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "model", Value: "b"})
		return err
	}
	_, finish, err := s.beginCommandRecord(string(id))
	if err != nil {
		t.Fatal(err)
	}
	if set() == nil {
		t.Fatal("active command accepted")
	}
	finish()
	a.mu.Lock()
	a.entered = make(chan struct{})
	a.release = make(chan struct{})
	entered, release := a.entered, a.release
	a.mu.Unlock()
	done := make(chan error, 1)
	go func() {
		_, e := s.prompt(ctx, PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "hello"}}})
		done <- e
	}()
	<-entered
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if set() == nil {
				t.Error("active prompt accepted")
			}
		}()
	}
	wg.Wait()
	close(release)
	if e := <-done; e != nil {
		t.Fatal(e)
	}
	if set() != nil {
		t.Fatal("idle switch rejected")
	}
	a.mu.Lock()
	a.capacity = 4096
	a.mu.Unlock()
	if set() == nil {
		t.Fatal("capacity drift accepted")
	}
	if err := s.closeSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := s.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: s.closedSessions[id].agent.Session().Header().CWD}); err == nil {
		t.Fatal("restore accepted changed capacity")
	}
}

type discardWriter struct{}

func (discardWriter) Write(p []byte) (int, error) { return len(p), nil }

func TestModelSelectionDefaultDisabled(t *testing.T) {
	s, _ := modelServer(t, false)
	id, err := s.newSession(context.Background(), NewSessionParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	r, e := s.sessionConfiguration(id, true)
	options, _ := r.(map[string]any)["configOptions"].([]any)
	if e != nil || len(options) != 1 || options[0].(map[string]any)["id"] != "permission" || options[0].(map[string]any)["currentValue"] != "auto-review" {
		t.Fatal(r, e)
	}
	if _, e := s.setConfigOption(context.Background(), setConfigOptionParams{SessionID: string(id), ConfigID: "model", Value: "b"}); e == nil {
		t.Fatal("disabled selection accepted")
	}
}

func TestModelSelectionRestoreFailsClosedUnknownAndMalformed(t *testing.T) {
	for _, data := range []any{harness.AgentModelSelection{Provider: "test", Model: "removed"}, map[string]any{"provider": 42, "model": "b"}} {
		s, _ := modelServer(t, true)
		ctx := context.Background()
		cwd := t.TempDir()
		id, err := s.newSession(ctx, NewSessionParams{CWD: cwd})
		if err != nil {
			t.Fatal(err)
		}
		record, err := s.currentRecord(id)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := record.agent.Session().Append("session/model-selected", data); err != nil {
			t.Fatal(err)
		}
		if err := s.closeSession(ctx, id); err != nil {
			t.Fatal(err)
		}
		if err := s.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: cwd}); err == nil {
			t.Fatal("invalid recorded model admitted")
		}
	}
}

type failedSelectionStore struct{ harness.SessionPersistence }

func (p failedSelectionStore) Attach(_ context.Context, session *harness.Session) (func() error, error) {
	detach, err := session.InstallDurabilityCheckpoint(func(context.Context) error {
		if _, ok := session.LatestEvent("session/model-selected"); ok {
			return errors.New("injected durability failure")
		}
		return nil
	})
	return func() error {
		if detach != nil {
			detach()
		}
		return nil
	}, err
}
func TestModelSelectionDurabilityFailureClosesUncertainSession(t *testing.T) {
	s, _ := modelServer(t, true)
	s.persistence = failedSelectionStore{s.persistence}
	ctx := context.Background()
	id, err := s.newSession(ctx, NewSessionParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	record, err := s.currentRecord(id)
	if err != nil {
		t.Fatal(err)
	}
	if _, e := s.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "model", Value: "b"}); e == nil {
		t.Fatal("durability failure acknowledged")
	}
	record.mu.Lock()
	closing := record.closing
	record.mu.Unlock()
	if !closing {
		t.Fatal("uncertain state remained usable")
	}
	if _, err := s.currentRecord(id); err == nil {
		t.Fatal("uncertain session admitted")
	}
}

func TestModelSwitchInvalidatesPriorUsageForNextRequest(t *testing.T) {
	s, _ := modelServer(t, true)
	ctx := context.Background()
	id, err := s.newSession(ctx, NewSessionParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	record, _ := s.currentRecord(id)
	session := record.agent.Session()
	s.writer = &wireWriter{encoder: json.NewEncoder(discardWriter{})}
	_, err = session.Append("request/header", harness.RequestHeaderEvent{Provider: "test", Model: "a"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = session.Append("assistant/message", map[string]any{"message": harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "previous"}}}, "usage": harness.TokenUsage{InputTokens: 1000, OutputTokens: 10}})
	if err != nil {
		t.Fatal(err)
	}
	before, err := (harness.TokenMeter{}).Measure(session)
	if err != nil || before.Baseline != "usage" {
		t.Fatal(before, err)
	}
	if _, e := s.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "model", Value: "b"}); e != nil {
		t.Fatal(e)
	}
	_, err = session.Append("request/header", harness.RequestHeaderEvent{Provider: "test", Model: "b"})
	if err != nil {
		t.Fatal(err)
	}
	after, err := (harness.TokenMeter{}).Measure(session)
	if err != nil || after.Baseline != "estimated" {
		t.Fatal(after, err)
	}
}

func TestModelSelectionStartupRejectsMismatchedCapacityAndDefault(t *testing.T) {
	s, a := modelServer(t, true)
	opts := Options{Harness: s.h, Persistence: s.persistence, Provider: "test", Model: "a", ModelSelection: true}
	a.mu.Lock()
	a.uneven = true
	a.mu.Unlock()
	if _, err := NewServer(opts); err == nil {
		t.Fatal("mismatched capacity accepted")
	}
	a.mu.Lock()
	a.uneven = false
	a.mu.Unlock()
	opts.Model = "unknown"
	if _, err := NewServer(opts); err == nil {
		t.Fatal("missing default accepted")
	}
	opts.Model = "a"
	opts.Compaction = &harness.BasicCompactionConfig{ContextWindow: 4096}
	if _, err := NewServer(opts); err == nil {
		t.Fatal("mismatched fallback capacity accepted")
	}
}

func TestModelSelectionReentrantProjectionAndAdmissionReservation(t *testing.T) {
	s, _ := modelServer(t, true)
	ctx := context.Background()
	id, err := s.newSession(ctx, NewSessionParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	record, _ := s.currentRecord(id)
	entered, release := make(chan struct{}), make(chan struct{})
	detach := record.agent.Session().Subscribe(func(e harness.Event) {
		if e.Type == "session/model-selected" {
			record.mu.Lock()
			record.mu.Unlock()
			close(entered)
			<-release
		}
	})
	defer detach()
	done := make(chan *rpcError, 1)
	go func() {
		_, e := s.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "model", Value: "b"})
		done <- e
	}()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("model selection held session lock across subscriber")
	}
	if _, err := s.prompt(ctx, PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "hi"}}}); err == nil {
		t.Error("prompt admitted during model change")
	}
	if _, finish, err := s.beginCommandRecord(string(id)); err == nil {
		finish()
		t.Error("command admitted during model change")
	}
	if _, e := s.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "model", Value: "a"}); e == nil {
		t.Error("second model change admitted")
	}
	close(release)
	select {
	case e := <-done:
		if e != nil {
			t.Fatal(e)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("selection failed to drain")
	}
	record.mu.Lock()
	active, changing := record.commandActive, record.modelChanging
	record.mu.Unlock()
	if active != 0 || changing {
		t.Fatal("selection reservation leaked")
	}
}
