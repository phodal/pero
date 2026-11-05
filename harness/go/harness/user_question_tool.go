package harness

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	point "github.com/phodal/pero/harness/go/runtime"
)

const userQuestionSchema = `{"type":"object","additionalProperties":false,"properties":{"questions":{"type":"array","minItems":1,"maxItems":4,"items":{"type":"object","additionalProperties":false,"properties":{"question":{"type":"string","minLength":1,"maxLength":4096},"header":{"type":"string","minLength":1,"maxLength":12},"options":{"type":"array","minItems":2,"maxItems":4,"items":{"type":"object","additionalProperties":false,"properties":{"label":{"type":"string","minLength":1,"maxLength":512},"description":{"type":"string","maxLength":4096},"preview":{"type":"string","maxLength":16384}},"required":["label","description"]}},"multiSelect":{"type":"boolean"}},"required":["question","header","options","multiSelect"]}}},"required":["questions"]}`

// Register exposes AskUserQuestion only to this exact root agent. Descendants
// do not inherit an interactive channel; other sessions own their own brokers.
// This is an ordinary registry-owned tool, with one hook/output/receipt path.
func (b *UserQuestionBroker) Register(run *point.Run, registry *ToolRegistry, agent *Agent) error {
	if b == nil || b.handler == nil || registry == nil || agent == nil || agent.Parent() != nil || agent.Delegated() {
		return errors.New("harness: user question registration requires a broker, registry and root agent")
	}
	if run == nil || !run.Active() {
		return point.ErrInactiveRun
	}
	tool, err := prepareTool(b.tool(agent))
	if err != nil {
		return err
	}
	owner := newToolOwner(registry, run)
	tool = owner.wrap(tool)
	if err := run.BeforeCleanup("tool-owner:AskUserQuestion", owner.drain); err != nil {
		return err
	}
	_, err = registry.RegisterCatalogProvider(run, "user-questions", ToolCatalogProvider{
		Schemas: func(_ context.Context, caller *Agent) ([]ToolSchema, error) {
			if caller != agent {
				return nil, nil
			}
			return []ToolSchema{tool.Schema}, nil
		},
		Resolve: func(_ context.Context, caller *Agent, name string) (Tool, bool, error) {
			if caller != agent || name != tool.Schema.Name {
				return Tool{}, false, nil
			}
			return tool, true, nil
		},
	})
	return err
}

func (b *UserQuestionBroker) tool(agent *Agent) Tool {
	return Tool{Schema: ToolSchema{Name: "AskUserQuestion", Description: "Ask the user 1-4 clarifying questions with 2-4 choices each. Users may select Other and enter their own text. multiSelect allows several choices. Waits for actual user input; cancellation never chooses an option. Use this only for decisions that need the user's input.", InputSchema: json.RawMessage(userQuestionSchema)}, ExecuteRequest: func(ctx context.Context, request ToolRequest) (ToolResult, error) {
		if request.Agent != agent {
			return ToolResult{}, errors.New("harness: user question belongs to another agent")
		}
		var input struct {
			Questions []UserQuestion `json:"questions"`
		}
		if err := json.Unmarshal(request.Arguments, &input); err != nil {
			return ToolResult{}, err
		}
		reply, err := b.Ask(ctx, UserQuestionRequest{Agent: agent, CallID: request.CallID, Questions: input.Questions})
		if err != nil {
			return ToolResult{}, err
		}
		if reply.Outcome == UserQuestionCancelled {
			return ToolResult{IsError: true, Content: []ContentBlock{{Type: BlockText, Text: "The user cancelled the question without answering. Do not infer an answer."}}}, nil
		}
		// The Claude response shape is a boundary projection, not a domain map.
		answers := make(map[string]string, len(reply.Answers))
		for _, answer := range reply.Answers {
			question := input.Questions[answer.QuestionIndex]
			labels := make([]string, 0, len(answer.SelectedOptions)+1)
			for _, index := range answer.SelectedOptions {
				labels = append(labels, question.Options[index].Label)
			}
			if strings.TrimSpace(answer.Text) != "" {
				labels = append(labels, answer.Text)
			}
			answers[question.Question] = strings.Join(labels, ", ")
		}
		raw, err := json.Marshal(struct {
			Questions []UserQuestion    `json:"questions"`
			Answers   map[string]string `json:"answers"`
		}{input.Questions, answers})
		return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: string(raw)}}}, err
	}}
}
