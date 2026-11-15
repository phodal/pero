package acp

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/scientificreviewer"
)

func TestScientificReviewSession(t *testing.T) {
	ctx := t.Context()
	adapter := &catalogFixture{capacity: 8192}
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter, ModelInfo: adapter, AdapterProviders: []string{"test"}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	reviewer, err := scientificreviewer.Mount(ctx, h, disk)
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(Options{Harness: h, Persistence: disk, Provider: "test", Model: "a", ScientificReviewer: reviewer})
	if err != nil {
		t.Fatal(err)
	}
	var wire bytes.Buffer
	server.writer = &wireWriter{encoder: json.NewEncoder(&wire)}
	defer server.closeAll(context.Background())
	cwd := t.TempDir()
	id, err := server.newSession(ctx, NewSessionParams{CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(wire.String(), "available_commands_update") || !strings.Contains(wire.String(), `"name":"review"`) {
		t.Fatal("manual review was not discoverable in the composer")
	}
	record, err := server.currentRecord(id)
	if err != nil {
		t.Fatal(err)
	}
	current := func() string {
		t.Helper()
		options, err := server.configOptions(record.agent)
		if err != nil {
			t.Fatal(err)
		}
		for _, option := range options {
			value := option.(map[string]any)
			if value["id"] == "scientific_review" {
				return value["currentValue"].(string)
			}
		}
		t.Fatal("scientific review choice absent")
		return ""
	}
	if current() != "off" {
		t.Fatal("scientific review must be an explicit opt-in")
	}
	for _, value := range []string{"auto", "off", "auto"} {
		if _, denied := server.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "scientific_review", Value: value}); denied != nil {
			t.Fatal(denied)
		}
		if current() != value {
			t.Fatalf("setting was not acknowledged: %s", current())
		}
	}
	if _, denied := server.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "scientific_review", Value: "unbounded"}); denied == nil {
		t.Fatal("unsupported setting accepted")
	}
	_, finishCommand, err := server.beginCommandRecord(string(id))
	if err != nil {
		t.Fatal(err)
	}
	_, denied := server.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "scientific_review", Value: "off"})
	finishCommand()
	if denied == nil {
		t.Fatal("setting changed during an active command")
	}
	if err := server.closeSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := server.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: cwd}); err != nil {
		t.Fatal(err)
	}
	record, err = server.currentRecord(id)
	if err != nil || current() != "auto" {
		t.Fatalf("automatic setting did not survive restore: %v", err)
	}
	for _, row := range []struct {
		name     string
		extra    []PromptContent
		rejected bool
	}{
		{name: "plain command"},
		{name: "Host workflow text", extra: []PromptContent{{Type: "text", Text: "Host App Use workflow instructions appended to the prompt."}}},
		{name: "image attachment", extra: []PromptContent{{Type: "image", Data: "invalid-image-data", MIMEType: "image/png"}}, rejected: true},
		{name: "resource attachment", extra: []PromptContent{{Type: "resource", URI: "file:///new-evidence"}}, rejected: true},
		{name: "resource link", extra: []PromptContent{{Type: "resource_link", URI: "file:///new-evidence", Name: "New evidence"}}, rejected: true},
	} {
		t.Run(row.name, func(t *testing.T) {
			wire.Reset()
			blocks := append([]PromptContent{{Type: "text", Text: "/review status"}}, row.extra...)
			stop, err := server.prompt(ctx, PromptParams{SessionID: string(id), Prompt: blocks})
			if row.rejected {
				if err == nil || !strings.Contains(err.Error(), "Remove attachments") {
					t.Fatalf("attached evidence was not rejected with an actionable error: %v", err)
				}
			} else if err != nil || stop != "end_turn" || !strings.Contains(wire.String(), "agent_message_chunk") {
				t.Fatalf("manual command stop=%q err=%v wire=%s", stop, err, wire.String())
			}
			adapter.mu.Lock()
			calls := len(adapter.calls)
			adapter.mu.Unlock()
			if calls != 0 {
				t.Fatalf("manual command or rejected attachment used %d provider calls", calls)
			}
		})
	}
	adapter.mu.Lock()
	calls := len(adapter.calls)
	adapter.mu.Unlock()
	if calls != 0 {
		t.Fatalf("configuration or status command used %d provider calls", calls)
	}
	wire.Reset()
	if _, err := server.prompt(ctx, PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "/review auto off"}}}); err != nil {
		t.Fatal(err)
	}
	if current() != "off" || !strings.Contains(wire.String(), "config_option_update") {
		t.Fatal("manual mode change did not refresh the composer setting")
	}
	wire.Reset()
	if err := server.replaySessionHistory(id); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(wire.String(), "agent_message_chunk") {
		t.Fatal("saved review status was lost during replay")
	}
	if _, denied := server.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "scientific_review", Value: "off"}); denied != nil {
		t.Fatal(denied)
	}
	if _, err := server.prompt(ctx, PromptParams{SessionID: string(id), Prompt: []PromptContent{{Type: "text", Text: "/reviewer please"}}}); err != nil {
		t.Fatal(err)
	}
	adapter.mu.Lock()
	calls = len(adapter.calls)
	adapter.mu.Unlock()
	if calls != 1 {
		t.Fatalf("a different command prefix bypassed normal prompting: %d calls", calls)
	}
}
