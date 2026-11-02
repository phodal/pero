package pluginruntime

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
)

type transcriptRecord struct {
	Type      string            `json:"type"`
	SessionID string            `json:"sessionId"`
	Message   transcriptMessage `json:"message"`
}

type transcriptMessage struct {
	Role    string            `json:"role"`
	Content []transcriptBlock `json:"content"`
}

type transcriptBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func directUserMessage(message harness.Message) bool {
	var source struct {
		Kind string `json:"kind"`
	}
	return message.Role == harness.RoleUser && json.Unmarshal(message.Source, &source) == nil && source.Kind == "user"
}

func messageText(message harness.Message) string {
	var text []string
	for _, block := range message.Content {
		if block.Type == harness.BlockText && block.Text != "" {
			text = append(text, block.Text)
		}
	}
	return strings.Join(text, "\n")
}

// writeTranscript projects committed messages, never synthetic hook context,
// into a private Claude-shaped JSONL file. The journal remains authoritative.
func (app *HookApp) writeTranscript(agent *harness.Agent) (string, error) {
	messages, err := agent.Session().DeriveMessages()
	if err != nil {
		return "", err
	}
	identity := sha256.Sum256([]byte(agent.ID()))
	directory := app.transcriptDirectory
	name := hex.EncodeToString(identity[:]) + ".jsonl"
	if agent.Parent() != nil {
		root := agent.Parent()
		for root.Parent() != nil {
			root = root.Parent()
		}
		parent := sha256.Sum256([]byte(root.ID()))
		directory = filepath.Join(directory, hex.EncodeToString(parent[:]), "subagents")
		if err := os.MkdirAll(directory, 0700); err != nil {
			return "", fmt.Errorf("plugin-runtime: create subagent transcript directory: %w", err)
		}
		name = "agent-" + name
	}
	path := filepath.Join(directory, name)
	file, err := os.CreateTemp(directory, ".transcript-*")
	if err != nil {
		return "", fmt.Errorf("plugin-runtime: create hook transcript: %w", err)
	}
	temporary := file.Name()
	defer os.Remove(temporary)
	defer file.Close()
	encoder := json.NewEncoder(file)
	for _, message := range messages {
		if message.Role != harness.RoleAssistant && !directUserMessage(message) {
			continue
		}
		var content []transcriptBlock
		for _, block := range message.Content {
			if block.Type == harness.BlockText && block.Text != "" {
				content = append(content, transcriptBlock{Type: "text", Text: block.Text})
			}
		}
		if len(content) == 0 {
			continue
		}
		record := transcriptRecord{Type: string(message.Role), SessionID: string(agent.ID()), Message: transcriptMessage{Role: string(message.Role), Content: content}}
		if err := encoder.Encode(record); err != nil {
			return "", fmt.Errorf("plugin-runtime: write hook transcript: %w", err)
		}
	}
	if err := file.Close(); err != nil {
		return "", fmt.Errorf("plugin-runtime: close hook transcript: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		return "", fmt.Errorf("plugin-runtime: publish hook transcript: %w", err)
	}
	return path, nil
}
