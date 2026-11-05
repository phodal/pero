package acp

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

// liveStream is transport-only state for one provider attempt. Durable replay
// deliberately projects committed messages, not these provisional chunks.
type liveStream struct {
	turn, step    int
	text, thought string
}

func (s *Server) projectLive(record *activeSession, event harness.Event) {
	record.projectionMu.Lock()
	defer record.projectionMu.Unlock()
	record.mu.Lock()
	closing, cancelled := record.closing, record.cancelRequested
	record.mu.Unlock()
	if closing || (cancelled && (event.Type == "assistant/chunk" || event.Type == "assistant/message")) {
		return
	}
	switch event.Type {
	case "assistant/chunk":
		var payload struct {
			Turn, Step int
			Chunk      harness.StreamChunk
		}
		if json.Unmarshal(event.Data, &payload) != nil {
			return
		}
		if record.stream.turn != payload.Turn || record.stream.step != payload.Step {
			record.stream = liveStream{turn: payload.Turn, step: payload.Step}
		}
		for _, block := range payload.Chunk.Content {
			kind := "agent_message_chunk"
			switch block.Type {
			case harness.BlockText:
				record.stream.text += block.Text
				if s.holdAssistantText != nil && s.holdAssistantText(record.agent) {
					continue
				}
			case harness.BlockReasoning:
				record.stream.thought += block.Text
				kind = "agent_thought_chunk"
			default:
				// Tool arguments/results, opaque reasoning metadata and usage are not
				// assistant text. Tools retain the existing call/result projection.
				continue
			}
			if block.Text == "" {
				continue
			}
			_ = s.writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
				"sessionId": record.agent.ID(), "update": map[string]any{"sessionUpdate": kind, "content": map[string]any{"type": "text", "text": block.Text}},
			}})
		}
	case "assistant/message":
		var payload struct {
			Turn, Step int
			Message    harness.Message `json:"message"`
		}
		if json.Unmarshal(event.Data, &payload) != nil {
			return
		}
		if s.holdAssistantText != nil && s.holdAssistantText(record.agent) {
			var full strings.Builder
			for _, block := range payload.Message.Content {
				if block.Type == harness.BlockText {
					full.WriteString(block.Text)
				}
			}
			if text := full.String(); text != "" {
				shown := text
				if s.renderAssistantText != nil {
					shown = s.renderAssistantText(context.Background(), record.agent, text)
				}
				if shown != "" {
					_ = s.writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": map[string]any{
						"sessionId": record.agent.ID(), "update": map[string]any{"sessionUpdate": "agent_message_chunk", "content": map[string]any{"type": "text", "text": shown}},
					}})
				}
				record.stream.text = text
			}
		}
		stream := record.stream
		record.stream = liveStream{}
		if stream.turn == payload.Turn && stream.step == payload.Step {
			// Compare whole text lanes before consuming across content blocks. If a
			// provider revises an emitted prefix ACP cannot retract it; do not append
			// a contradictory full message. The durable completion remains canonical.
			totals := map[harness.BlockType]string{}
			for _, block := range payload.Message.Content {
				totals[block.Type] += block.Text
			}
			prefixes := map[harness.BlockType]string{harness.BlockText: stream.text, harness.BlockReasoning: stream.thought}
			content := make([]harness.ContentBlock, 0, len(payload.Message.Content))
			for _, block := range payload.Message.Content {
				prefix := prefixes[block.Type]
				if prefix != "" {
					if !strings.HasPrefix(totals[block.Type], prefix) {
						continue
					}
					n := min(len(prefix), len(block.Text))
					block.Text = block.Text[n:]
					prefixes[block.Type] = prefix[n:]
					// totals must track the same remaining lane as prefixes.
					totals[block.Type] = totals[block.Type][n:]
					if block.Text == "" {
						continue
					}
				}
				content = append(content, block)
			}
			payload.Message.Content = content
			event.Data, _ = json.Marshal(payload)
		}
		s.project(record, event)
	case "assistant/attempt", "turn/start", "turn/end":
		record.stream = liveStream{}
	default:
		s.project(record, event)
	}
}
