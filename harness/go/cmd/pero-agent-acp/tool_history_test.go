package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"strings"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestToolHistoryLaunchAndRequestBoundary(t *testing.T) {
	flags := flag.NewFlagSet("history", flag.ContinueOnError)
	o := bindToolHistory(flags)
	if err := flags.Parse([]string{"--tool-history-chars=1800", "--tool-history-keep-recent=1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := o.config(""); err == nil {
		t.Fatal("enabled clearing without readback workspace")
	}
	config, err := o.config(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	requests := 0
	adapter := harness.AdapterFunc(func(_ context.Context, r harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
		requests++
		if requests <= 5 {
			return harness.Completion{Finish: harness.FinishToolCalls, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockToolCall, Name: "Read", ToolCallID: harness.ToolCallID(fmt.Sprint(requests)), Arguments: json.RawMessage(`{}`)}}}}, nil
		}
		found := false
		for _, message := range r.Messages {
			for _, block := range message.Content {
				for _, text := range block.Content {
					found = found || strings.Contains(text.Text, "session-tool-result:")
				}
			}
		}
		if !found {
			t.Fatal("history clearing did not run without model compaction")
		}
		return harness.Completion{Finish: harness.FinishStop, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}}, nil
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
	if err := mountToolHistory(t.Context(), h, config); err != nil {
		t.Fatal(err)
	}
	_, err = h.RegisterTool(t.Context(), "test/read", harness.Tool{Schema: harness.ToolSchema{Name: "Read", InputSchema: json.RawMessage(`{"type":"object"}`)}, Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
		return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: strings.Repeat("result", 100)}}}, nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "history", CWD: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "read"}}}); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range agent.Session().Events() {
		found = found || event.Type == "tool-history/config"
	}
	if !found {
		t.Fatal("effective policy was absent from the native trace")
	}
}
