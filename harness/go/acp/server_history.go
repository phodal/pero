// Adapted from server.go: declarations split by responsibility without behavior changes.
package acp

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"sort"

	"github.com/phodal/pero/harness/go/harness"
)

func (s *Server) listSessions(ctx context.Context, params ListSessionParams) (map[string]any, error) {
	cursor, err := decodeSessionListCursor(params.Cursor)
	if err != nil {
		return nil, invalidError(err.Error())
	}
	if params.CWD != nil {
		if err := validateCWD(*params.CWD); err != nil {
			return nil, err
		}
	}
	headers, err := s.persistence.List(ctx)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	active := make(map[harness.SessionID]struct{}, len(s.sessions)+len(s.activating))
	for id := range s.sessions {
		active[id] = struct{}{}
	}
	for id := range s.activating {
		active[id] = struct{}{}
	}
	s.mu.Unlock()
	type summary struct {
		SessionID harness.SessionID `json:"sessionId"`
		CWD       string            `json:"cwd"`
		createdAt int64
	}
	items := make([]summary, 0, len(headers))
	for _, header := range headers {
		_, globallyActive := s.h.Agents().Get(header.ID)
		if _, ok := active[header.ID]; ok || globallyActive || header.CWD == "" || !filepath.IsAbs(header.CWD) {
			continue
		}
		if params.CWD != nil && !sameDirectory(header.CWD, *params.CWD) {
			continue
		}
		createdAt := header.CreatedAt.UnixMilli()
		if createdAt < 0 || uint64(createdAt) > maxJSONSafeInteger {
			return nil, fmt.Errorf("acp: persisted session %q has an invalid createdAt", header.ID)
		}
		items = append(items, summary{SessionID: header.ID, CWD: header.CWD, createdAt: createdAt})
	}
	sort.Slice(items, func(left, right int) bool {
		if items[left].createdAt != items[right].createdAt {
			return items[left].createdAt > items[right].createdAt
		}
		return string(items[left].SessionID) < string(items[right].SessionID)
	})
	if cursor != nil {
		filtered := items[:0]
		for _, item := range items {
			if item.createdAt < cursor.createdAt ||
				(item.createdAt == cursor.createdAt && string(item.SessionID) > cursor.sessionID) {
				filtered = append(filtered, item)
			}
		}
		items = filtered
	}
	pageSize := min(s.sessionListPageSize, len(items))
	page := items[:pageSize]
	result := map[string]any{"sessions": page}
	if len(items) > len(page) {
		last := page[len(page)-1]
		result["nextCursor"] = encodeSessionListCursor(sessionListCursor{createdAt: last.createdAt, sessionID: string(last.SessionID)})
	}
	return result, nil
}

type sessionListCursor struct {
	createdAt int64
	sessionID string
}

func decodeSessionListCursor(value *string) (*sessionListCursor, error) {
	if value == nil {
		return nil, nil
	}
	decoded, err := base64.RawURLEncoding.Strict().DecodeString(*value)
	if err != nil {
		return nil, errors.New("session/list cursor is invalid")
	}
	var tuple []json.RawMessage
	if err := json.Unmarshal(decoded, &tuple); err != nil || len(tuple) != 2 {
		return nil, errors.New("session/list cursor is invalid")
	}
	var number json.Number
	var sessionID string
	if err := json.Unmarshal(tuple[0], &number); err != nil {
		return nil, errors.New("session/list cursor is invalid")
	}
	createdAt, err := number.Int64()
	if err != nil || createdAt < 0 || uint64(createdAt) > maxJSONSafeInteger ||
		json.Unmarshal(tuple[1], &sessionID) != nil || sessionID == "" {
		return nil, errors.New("session/list cursor is invalid")
	}
	cursor := sessionListCursor{createdAt: createdAt, sessionID: sessionID}
	if encodeSessionListCursor(cursor) != *value {
		return nil, errors.New("session/list cursor is invalid")
	}
	return &cursor, nil
}

func encodeSessionListCursor(cursor sessionListCursor) string {
	encoded, _ := json.Marshal([]any{cursor.createdAt, cursor.sessionID})
	return base64.RawURLEncoding.EncodeToString(encoded)
}

func (s *Server) replaySessionHistory(id harness.SessionID) error {
	s.mu.Lock()
	record := s.sessions[id]
	s.mu.Unlock()
	if record == nil {
		return invalidError("unknown session: " + string(id))
	}
	for _, event := range record.agent.Session().Events() {
		if event.Type == "user/message" {
			s.projectMessage(record, event, true)
		} else {
			s.project(record, event)
		}
		if err := s.writer.currentError(); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) project(record *activeSession, event harness.Event) {
	params := map[string]any{"sessionId": record.agent.ID()}
	var update any
	switch event.Type {
	case "session/title":
		var title harness.SessionTitle
		if json.Unmarshal(event.Data, &title) != nil || title.Title == "" {
			return
		}
		update = map[string]any{"sessionUpdate": "session_info_update", "title": title.Title}
	case "assistant/message":
		s.projectMessage(record, event, false)
		return
	case "tool/call":
		var payload struct {
			CallID    harness.ToolCallID `json:"callId"`
			Name      string             `json:"name"`
			Arguments json.RawMessage    `json:"arguments"`
		}
		if json.Unmarshal(event.Data, &payload) != nil {
			return
		}
		var raw any
		if json.Unmarshal(payload.Arguments, &raw) != nil {
			raw = string(payload.Arguments)
		}
		update = map[string]any{"sessionUpdate": "tool_call", "toolCallId": payload.CallID, "title": payload.Name, "kind": "other", "status": "in_progress", "rawInput": raw}
	case "tool/result":
		var block harness.ContentBlock
		if json.Unmarshal(event.Data, &block) != nil {
			return
		}
		status := "completed"
		if block.IsError {
			status = "failed"
		}
		content := make([]any, 0, len(block.Content))
		for _, child := range block.Content {
			if child.Type == harness.BlockText {
				content = append(content, map[string]any{"type": "content", "content": map[string]any{"type": "text", "text": child.Text}})
			} else if child.Type == harness.BlockImage {
				data, mediaType, ok := s.imageBytes(child)
				if ok {
					content = append(content, map[string]any{"type": "content", "content": map[string]any{
						"type": "image", "data": base64.StdEncoding.EncodeToString(data), "mimeType": mediaType,
					}})
				}
			}
		}
		update = map[string]any{"sessionUpdate": "tool_call_update", "toolCallId": block.ToolCallID, "status": status, "content": content}
	default:
		return
	}
	params["update"] = update
	_ = s.writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": params})
}

func (s *Server) projectMessage(record *activeSession, event harness.Event, user bool) {
	var message harness.Message
	if user {
		if json.Unmarshal(event.Data, &message) != nil {
			return
		}
	} else {
		var payload struct {
			Message harness.Message `json:"message"`
		}
		if json.Unmarshal(event.Data, &payload) != nil {
			return
		}
		message = payload.Message
	}
	for _, block := range message.Content {
		if block.Type != harness.BlockText && block.Type != harness.BlockReasoning && block.Type != harness.BlockImage {
			continue
		}
		kind := "agent_message_chunk"
		if user {
			kind = "user_message_chunk"
		} else if block.Type == harness.BlockReasoning {
			kind = "agent_thought_chunk"
		}
		content := map[string]any{"type": "text", "text": block.Text}
		if block.Type == harness.BlockImage {
			data, mediaType, ok := s.imageBytes(block)
			if !ok {
				continue
			}
			content = map[string]any{"type": "image", "data": base64.StdEncoding.EncodeToString(data), "mimeType": mediaType}
		}
		params := map[string]any{
			"sessionId": record.agent.ID(),
			"update": map[string]any{
				"sessionUpdate": kind,
				"messageId":     fmt.Sprintf("message-%d", event.Seq),
				"content":       content,
			},
		}
		_ = s.writer.write(map[string]any{"jsonrpc": "2.0", "method": "session/update", "params": params})
	}
}

func (s *Server) imageBytes(block harness.ContentBlock) ([]byte, string, bool) {
	if block.Attachment == nil {
		return block.Data, block.MIMEType, len(block.Data) != 0
	}
	if s.h.Attachments() == nil {
		return nil, "", false
	}
	stored, err := s.h.Attachments().ReadImage(context.Background(), *block.Attachment)
	if err != nil {
		return nil, "", false
	}
	return stored.Data, stored.Ref.MediaType, true
}
