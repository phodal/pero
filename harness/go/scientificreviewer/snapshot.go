package scientificreviewer

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/scientificreview"
)

// freeze observes the committed session once. Answers are selected before tool
// evidence so large results cannot displace the answer being reviewed. Budgets
// count encoded JSON bytes, including escaping and artifact reference metadata.
func freeze(session *harness.Session) (scientificreview.Snapshot, error) {
	snapshot := scientificreview.Snapshot{SessionID: string(session.Header().ID)}
	events := session.Events()
	if len(events) > 0 {
		snapshot.ThroughSeq = int64(events[len(events)-1].Seq)
	}
	remaining := 48000
	artifactCalls := make(map[harness.ToolCallID]bool)
	for i := len(events) - 1; i >= 0; i-- {
		event := events[i]
		if event.Type == "tool/call" {
			var call struct {
				CallID harness.ToolCallID `json:"callId"`
				Name   string             `json:"name"`
			}
			if err := json.Unmarshal(event.Data, &call); err != nil {
				return snapshot, err
			}
			if call.Name == harness.PublicMCPToolName("pero-app-use", "deliver_artifact") {
				artifactCalls[call.CallID] = true
			}
		}
		if event.Type != "assistant/message" {
			continue
		}
		var payload struct {
			Message harness.Message `json:"message"`
		}
		if err := json.Unmarshal(event.Data, &payload); err != nil {
			return snapshot, err
		}
		var text strings.Builder
		for _, block := range payload.Message.Content {
			if block.Type == harness.BlockText {
				text.WriteString(block.Text)
				text.WriteByte('\n')
			}
		}
		answer := strings.TrimSpace(text.String())
		if answer == "" {
			continue
		}
		if len(snapshot.Messages) >= 6 {
			snapshot.Truncated = true
			continue
		}
		id := payload.Message.ID
		if id == "" {
			id = fmt.Sprintf("event:%d", event.Seq)
		}
		message := scientificreview.Message{ID: id}
		base, _ := json.Marshal(message)
		message.Text = boundedJSONText(answer, min(4000, remaining)-len(base)+2, &snapshot.Truncated)
		if message.Text == "" {
			snapshot.Truncated = true
			continue
		}
		encoded, _ := json.Marshal(message)
		snapshot.Messages = append(snapshot.Messages, message)
		remaining -= len(encoded)
	}
	for i := len(events) - 1; i >= 0; i-- {
		event := events[i]
		id := fmt.Sprintf("event:%d", event.Seq)
		kind, text := "", ""
		switch event.Type {
		case "user/message":
			var message harness.Message
			if err := json.Unmarshal(event.Data, &message); err != nil {
				return snapshot, err
			}
			for _, block := range message.Content {
				if block.Type == harness.BlockText {
					text += block.Text + "\n"
				}
			}
			kind = "user_requirement"
		case "tool/call":
			kind, text = "tool_call", string(event.Data)
		case "tool/result":
			kind, text = "tool_result", string(event.Data)
			var block harness.ContentBlock
			if err := json.Unmarshal(event.Data, &block); err != nil {
				return snapshot, err
			}
			// Only an observed Host deliver_artifact call can supply this typed
			// receipt. Arbitrary tool text with the same JSON shape stays data.
			if !block.IsError && artifactCalls[block.ToolCallID] {
				for _, content := range block.Content {
					if content.Type != harness.BlockText {
						continue
					}
					var receipt struct {
						Artifact struct {
							ID       string `json:"id"`
							Versions []struct {
								Version int    `json:"version"`
								SHA256  string `json:"sha256"`
							} `json:"versions"`
						} `json:"artifact"`
					}
					if json.Unmarshal([]byte(content.Text), &receipt) != nil || receipt.Artifact.ID == "" {
						continue
					}
					for _, version := range receipt.Artifact.Versions {
						item := scientificreview.Evidence{ID: fmt.Sprintf("%s:artifact:%s:v%d", id, receipt.Artifact.ID, version.Version), Kind: "artifact_version", Text: "Retained Host delivery receipt. Content is available only if present in other retained tool results; this metadata is not proof of values or execution.", ArtifactID: receipt.Artifact.ID, ArtifactVersion: version.Version, SHA256: version.SHA256}
						encoded, _ := json.Marshal(item)
						if len(snapshot.Evidence) >= 40 || len(encoded) > remaining {
							snapshot.Truncated = true
							break
						}
						snapshot.Evidence = append(snapshot.Evidence, item)
						remaining -= len(encoded)
					}
				}
			}
		case "todo/write", "approval/asked", "approval/decided", "plan/mode", "permission/claude-mode":
			kind, text = event.Type, string(event.Data)
		default:
			continue
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if remaining < 256 || len(snapshot.Evidence) >= 40 {
			snapshot.Truncated = true
			continue
		}
		item := scientificreview.Evidence{ID: id, Kind: kind}
		base, _ := json.Marshal(item)
		item.Text = boundedJSONText(text, min(4000, remaining)-len(base)+2, &snapshot.Truncated)
		if item.Text == "" {
			snapshot.Truncated = true
			continue
		}
		encoded, _ := json.Marshal(item)
		snapshot.Evidence = append(snapshot.Evidence, item)
		remaining -= len(encoded)
	}
	// Keep quoted anchors in chronological order.
	for left, right := 0, len(snapshot.Messages)-1; left < right; left, right = left+1, right-1 {
		snapshot.Messages[left], snapshot.Messages[right] = snapshot.Messages[right], snapshot.Messages[left]
	}
	for left, right := 0, len(snapshot.Evidence)-1; left < right; left, right = left+1, right-1 {
		snapshot.Evidence[left], snapshot.Evidence[right] = snapshot.Evidence[right], snapshot.Evidence[left]
	}
	return scientificreview.NewSnapshot(snapshot)
}

func boundedJSONText(text string, limit int, truncated *bool) string {
	encoded, _ := json.Marshal(text)
	if len(encoded) <= limit {
		return text
	}
	*truncated = true
	if limit < 2 {
		return ""
	}
	runes := []rune(text)
	low, high := 0, len(runes)
	for low < high {
		mid := (low + high + 1) / 2
		encoded, _ := json.Marshal(string(runes[:mid]))
		if len(encoded) <= limit {
			low = mid
		} else {
			high = mid - 1
		}
	}
	return string(runes[:low])
}
