package acp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestPromptTermination(t *testing.T) {
	budgetErr := harness.NewProviderError("provider request budget exhausted", harness.RequestBudgetExhaustedCode, nil)
	for _, test := range []struct {
		name   string
		finish harness.FinishKind
		err    error
		stop   string
	}{
		{name: "completed", finish: harness.FinishStop, stop: "end_turn"},
		{name: "output limit", finish: harness.FinishMaxTokens, stop: "max_tokens"},
		{name: "refusal", finish: harness.FinishRefusal, stop: "refusal"},
		{name: "request limit", err: budgetErr, stop: "max_turn_requests"},
		{name: "wrapped request limit", err: fmt.Errorf("request: %w", budgetErr), stop: "max_turn_requests"},
		{name: "transport failure", err: harness.NewProviderError("connection failed", "TRANSPORT", nil)},
		{name: "untyped budget text", err: errors.New(budgetErr.Error())},
	} {
		t.Run(test.name, func(t *testing.T) {
			h, err := harness.Boot(t.Context(), harness.Options{AdapterProviders: []string{"fixture"}, Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
				return harness.Completion{Finish: test.finish}, test.err
			})})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { h.Dispose(context.Background()); h.Drain(context.Background()) }()
			disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "fixture", Model: "fixture"})
			if err != nil {
				t.Fatal(err)
			}
			server.writer = &wireWriter{encoder: json.NewEncoder(io.Discard)}
			defer server.closeAll(context.Background())
			id, err := server.newSession(t.Context(), NewSessionParams{CWD: t.TempDir()})
			if err != nil {
				t.Fatal(err)
			}
			stop, err := server.prompt(t.Context(), PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "run"}}})
			if stop != test.stop || test.stop != "" && err != nil || test.stop == "" && !errors.Is(err, test.err) {
				t.Fatalf("stop=%q error=%v", stop, err)
			}
			if test.err != nil {
				record, err := server.currentRecord(id)
				if err != nil {
					t.Fatal(err)
				}
				preserved := false
				for _, event := range record.agent.Session().Events() {
					preserved = preserved || event.Type == "turn/end" && strings.Contains(string(event.Data), test.err.Error())
				}
				if !preserved {
					t.Fatal("native Session lost the original failure")
				}
			}
		})
	}
}

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
