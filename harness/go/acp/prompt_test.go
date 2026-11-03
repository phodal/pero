package acp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestNativePromptPreparationAndCleanup(t *testing.T) {
	for _, test := range []struct {
		name             string
		rejected, cancel bool
	}{{name: "admitted"}, {name: "rejected", rejected: true}, {name: "cancelled", cancel: true}} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			preparedID := ""
			cleaned, calls := 0, 0
			h, err := harness.Boot(ctx, harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				calls++
				found := false
				for _, message := range request.Messages {
					found = found || message.ID == preparedID && preparedID != ""
				}
				if !found || cleaned != 0 {
					t.Error("prompt was dispatched without its live native preparation")
				}
				return harness.Completion{Finish: harness.FinishStop}, nil
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
			disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			deny := errors.New("native preparation denied")
			server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture", PreparePrompt: func(_ context.Context, agent *harness.Agent, message *harness.Message) (func(), error) {
				if agent == nil || message.ID == "" || message.Role != harness.RoleUser {
					t.Fatal("native preparation did not receive a fresh attributable message")
				}
				preparedID = message.ID
				cleanup := func() { cleaned++ }
				if test.rejected {
					return cleanup, deny
				}
				if test.cancel {
					cancel()
				}
				return cleanup, nil
			}})
			if err != nil {
				t.Fatal(err)
			}
			server.writer = &wireWriter{encoder: json.NewEncoder(io.Discard)}
			defer server.closeAll(context.Background())
			id, err := server.newSession(ctx, NewSessionParams{CWD: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			_, err = server.prompt(ctx, PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "inspect the source"}}})
			if test.rejected && !errors.Is(err, deny) || test.cancel && !errors.Is(err, context.Canceled) || !test.rejected && !test.cancel && err != nil {
				t.Fatal(err)
			}
			wantCalls := 1
			if test.rejected || test.cancel {
				wantCalls = 0
			}
			if calls != wantCalls || cleaned != 1 {
				t.Fatalf("provider=%d cleanup=%d", calls, cleaned)
			}
		})
	}
}
