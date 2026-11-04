package skills

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

const (
	reattachmentSkillTokens = 5000
	reattachmentTotalTokens = 25000
)

type retainedSkill struct {
	invocation skillInvocation
	body       string
	seq        uint64
}

type activationKey struct {
	name, digest, arguments string
}

type skillCall struct {
	arguments string
}

type retainedActivation struct {
	key  activationKey
	body string
}

func mountSkillReattachment(run *point.Run, hooks *harness.AgentHooks, catalog *Catalog, registration harness.ToolRegistration) error {
	_, err := hooks.PostCompact.Use(run, func(ctx context.Context, input harness.CompactionHookInput, next point.Next[harness.CompactionHookInput]) (harness.CompactionHookInput, error) {
		input, err := next(input)
		if err != nil || input.Agent == nil {
			return input, err
		}
		visible, err := registration.Available(ctx, input.Agent)
		if err != nil || !visible {
			return input, err
		}
		messages, err := reattachSkills(catalog, input.Agent.Session().Events())
		if err != nil {
			return input, err
		}
		input.Messages = append(input.Messages, messages...)
		return input, nil
	})
	return err
}

// reattachSkills derives previously rendered instructions from committed
// records. It never reads the skill file or reruns its argument preprocessing.
func reattachSkills(catalog *Catalog, events []harness.Event) ([]harness.Message, error) {
	catalog.mu.Lock()
	definitions := make(map[string]Definition)
	for name, entry := range catalog.entries {
		if entry.definition.Claude && entry.definition.Context != "fork" {
			definitions[name] = entry.definition
		}
	}
	catalog.mu.Unlock()
	latest, err := retainedSkills(events, definitions)
	if err != nil {
		return nil, err
	}
	remaining := reattachmentTotalTokens
	var messages []harness.Message
	for _, skill := range latest {
		budget := min(reattachmentSkillTokens, remaining)
		if budget <= 0 {
			break
		}
		message, tokens := boundedReattachment(skill, budget)
		if tokens == 0 {
			continue
		}
		messages = append(messages, message)
		remaining -= tokens
	}
	return messages, nil
}

func retainedSkills(events []harness.Event, definitions map[string]Definition) ([]retainedSkill, error) {
	calls := make(map[harness.ToolCallID]skillCall)
	activations := make(map[harness.ToolCallID]retainedActivation)
	latest := make(map[string]retainedSkill)
	for _, event := range events {
		switch event.Type {
		case "tool/call":
			var call struct {
				ID        harness.ToolCallID `json:"callId"`
				Name      string             `json:"name"`
				Arguments json.RawMessage    `json:"arguments"`
			}
			if err := json.Unmarshal(event.Data, &call); err != nil {
				return nil, fmt.Errorf("skills: decode activation call at %d: %w", event.Seq, err)
			}
			delete(calls, call.ID)
			delete(activations, call.ID)
			if call.Name != "Skill" {
				continue
			}
			var input struct {
				Skill    string `json:"skill"`
				Args     string `json:"args"`
				Resource string `json:"resource"`
			}
			if json.Unmarshal(call.Arguments, &input) == nil && input.Skill != "" && input.Resource == "" {
				calls[call.ID] = skillCall{arguments: input.Args}
			}
		case "tool/result":
			var result harness.ContentBlock
			if err := json.Unmarshal(event.Data, &result); err != nil {
				return nil, fmt.Errorf("skills: decode activation result at %d: %w", event.Seq, err)
			}
			call, known := calls[result.ToolCallID]
			if !known || result.IsError {
				continue
			}
			for _, block := range result.Content {
				if block.Type != harness.BlockText {
					continue
				}
				var definition Definition
				if json.Unmarshal([]byte(block.Text), &definition) != nil || definition.Content == "" {
					continue
				}
				known, exists := definitions[definition.Name]
				if !exists || known.Digest != definition.Digest {
					continue
				}
				body := "Base directory for this skill: " + filepath.Join(known.ResourceBase, filepath.FromSlash(known.Directory)) + "\nPlugin root: " + known.ResourceBase + "\n\n" + definition.Content
				activations[result.ToolCallID] = retainedActivation{key: activationKey{definition.Name, definition.Digest, call.arguments}, body: body}
			}
		case "user/message":
			var message harness.Message
			if err := json.Unmarshal(event.Data, &message); err != nil {
				return nil, fmt.Errorf("skills: decode invocation receipt at %d: %w", event.Seq, err)
			}
			var invocation skillInvocation
			if message.Role != harness.RoleUser || json.Unmarshal(message.Source, &invocation) != nil || invocation.Kind != "skill-invocation" {
				continue
			}
			definition, exists := definitions[invocation.Name]
			if !exists || definition.Digest != invocation.Digest {
				continue
			}
			var body string
			switch invocation.Form {
			case "instructions":
				var texts []string
				for _, block := range message.Content {
					if block.Type == harness.BlockText {
						texts = append(texts, block.Text)
					}
				}
				body = strings.Join(texts, "\n")
				body = strings.TrimPrefix(body, "<skill_content name=\""+invocation.Name+"\">\n")
				body = strings.TrimSuffix(body, "\n</skill_content>")
			case "activation":
				activation, found := activations[harness.ToolCallID(invocation.ID)]
				if found && invocation.ID != "" && activation.key == (activationKey{invocation.Name, invocation.Digest, invocation.Arguments}) {
					body = activation.body
				}
			default:
				continue // A truncated reattachment never replaces the original receipt.
			}
			if body != "" {
				latest[invocation.Name] = retainedSkill{invocation: invocation, body: body, seq: event.Seq}
			}
		}
	}
	result := make([]retainedSkill, 0, len(latest))
	for _, skill := range latest {
		result = append(result, skill)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].seq > result[j].seq })
	return result, nil
}

func boundedReattachment(skill retainedSkill, budget int) (harness.Message, int) {
	invocation := skill.invocation
	invocation.Form = "reattached"
	source, _ := json.Marshal(invocation)
	wrap := func(body string) harness.Message {
		return harness.Message{Role: harness.RoleUser, Source: source, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "<skill_content name=\"" + invocation.Name + "\">\n" + body + "\n</skill_content>"}}}
	}
	message := wrap(skill.body)
	if tokens := harness.EstimateMessageTokens(message); tokens <= budget {
		return message, tokens
	}
	const omission = "\n[Skill instructions truncated after compaction.]"
	if harness.EstimateMessageTokens(wrap(omission)) > budget {
		return harness.Message{}, 0
	}
	runes := []rune(skill.body)
	low, high := 0, len(runes)
	for low < high {
		middle := (low + high + 1) / 2
		if harness.EstimateMessageTokens(wrap(string(runes[:middle])+omission)) <= budget {
			low = middle
		} else {
			high = middle - 1
		}
	}
	message = wrap(string(runes[:low]) + omission)
	return message, harness.EstimateMessageTokens(message)
}
