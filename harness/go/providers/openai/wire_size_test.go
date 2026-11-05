package openai

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestPreparedWireMeasurementMatchesHTTPBody(t *testing.T) {
	var body []byte
	a, _ := fixture(t, func(w http.ResponseWriter, r *http.Request) {
		body, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "text/event-stream")
		event(w, `{"choices":[{"index":0,"delta":{"content":"done"},"finish_reason":"stop"}]}`)
		event(w, "[DONE]")
	})
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: a})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) })
	agent, err := h.Agents().Create(t.Context(), harness.AgentOptions{CWD: t.TempDir(), Provider: "fixture", Model: "fixture-model"})
	if err != nil {
		t.Fatal(err)
	}
	// Auxiliary requests have no turn coordinate and must not break resume.
	req := request()
	req.Agent = agent
	req.Tools = []harness.ToolSchema{{Name: "Read", InputSchema: json.RawMessage(`{"type":"object"}`)}}
	req.Messages = append(req.Messages, harness.Message{Role: harness.RoleTool, Content: []harness.ContentBlock{{Type: harness.BlockToolResult, ToolCallID: "observed", Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "saved result"}}}}})
	if _, err := a.Generate(t.Context(), req, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().LastTurn(); err != nil {
		t.Fatal(err)
	}
	for _, observed := range agent.Session().Events() {
		if observed.Type != "request/wire-size" {
			continue
		}
		var measurement struct {
			Stage        string
			PayloadBytes int    `json:"payload_bytes"`
			ToolsBytes   int    `json:"tools_bytes"`
			ResultBytes  int    `json:"tool_result_message_bytes"`
			SHA          string `json:"payload_sha256"`
		}
		if err := json.Unmarshal(observed.Data, &measurement); err != nil {
			t.Fatal(err)
		}
		hash := sha256.Sum256(body)
		if measurement.Stage != "prepared_for_http" || measurement.PayloadBytes != len(body) || measurement.SHA != hex.EncodeToString(hash[:]) || measurement.ToolsBytes == 0 || measurement.ResultBytes == 0 {
			t.Fatalf("measurement=%+v actual body bytes=%d", measurement, len(body))
		}
		return
	}
	t.Fatal("missing wire measurement")
}
