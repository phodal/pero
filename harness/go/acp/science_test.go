package acp

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestScienceCommandsRemainBoundToLiveSession(t *testing.T) {
	ctx := t.Context()
	h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("science command called model")
		return harness.Completion{}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture", Science: func(_ context.Context, agent *harness.Agent, raw json.RawMessage) (any, error) {
		if string(raw) != `{"action":"status","language":"python"}` {
			return nil, errors.New("invalid computation command")
		}
		return agent.ID(), nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer s.closeAll(context.Background())
	a, err := s.newSession(ctx, NewSessionParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.newSession(ctx, NewSessionParams{CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	command := func(id harness.SessionID, body string) (any, *rpcError) {
		raw, _ := json.Marshal(struct {
			SessionID harness.SessionID `json:"sessionId"`
			Request   json.RawMessage   `json:"request"`
		}{id, json.RawMessage(body)})
		return s.handle(ctx, request{Method: ScienceSessionMethod, Params: raw})
	}
	for _, id := range []harness.SessionID{a, b} {
		got, rpcErr := command(id, `{"action":"status","language":"python"}`)
		if rpcErr != nil || got != id {
			t.Fatalf("session %s: %v %v", id, got, rpcErr)
		}
	}
	if _, rpcErr := command(a, `{}`); rpcErr == nil {
		t.Fatal("computation owner error lost")
	}
	if err := s.closeSession(ctx, a); err != nil {
		t.Fatal(err)
	}
	for _, id := range []harness.SessionID{a, "unknown"} {
		if _, rpcErr := command(id, `{"action":"status","language":"python"}`); rpcErr == nil {
			t.Fatalf("inactive session %s reached computation", id)
		}
	}
}
