package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

// ToolOptions is trusted composition, never model input. The bounded native
// tool exposes only the task prompt and description; route, workspace, budgets,
// permissions, depth and provider selection are not model-controlled.
type ToolOptions struct {
	EntryID, Provider, ToolName   string
	MaxDepth, MaxSteps, MaxTokens int
}

type ToolContribution struct{ instance *point.Instance }

func (c *ToolContribution) Dispose(ctx context.Context) error {
	if c == nil || c.instance == nil {
		return nil
	}
	return c.instance.Dispose(ctx)
}

// MountTool selects the native one-shot StartActivation caller-result branch of
// Point's generic subagent tool, without profile/model/preset or external tools.
func MountTool(ctx context.Context, h *harness.Harness, options ToolOptions) (*ToolContribution, error) {
	if h == nil || h.Runtime() == nil || h.Subagents() == nil || options.Provider == "" {
		return nil, errors.New("subagents: tool requires an explicitly enabled harness and provider")
	}
	if options.EntryID == "" {
		options.EntryID = "subagents/tool/" + options.Provider
	}
	if options.ToolName == "" {
		options.ToolName = "subagent"
	}
	if options.MaxDepth == 0 {
		options.MaxDepth = 1
	}
	if options.MaxDepth < 0 || options.MaxSteps < 0 || options.MaxTokens < 0 {
		return nil, errors.New("subagents: limits must not be negative")
	}
	definition := point.Define(point.Descriptor{ID: "harness/contribution/subagent-tool/" + options.EntryID, Requires: []point.Requirement{point.Require(harness.SubagentRegistryKey), point.Require(harness.ToolRegistryKey), point.Require(harness.PromptRegistryKey)}}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		registry, err := point.Resolve(run, harness.SubagentRegistryKey)
		if err != nil {
			return nil, err
		}
		provider, err := registry.Provider(run.Scope, options.Provider)
		if err != nil {
			return nil, err
		}
		// Only this bounded native provider can be selected by the copied frontend.
		if _, ok := provider.(*inProcessProvider); !ok {
			return nil, errors.New("subagents: bounded tool requires native in-process provider")
		}
		tools, err := point.Resolve(run, harness.ToolRegistryKey)
		if err != nil {
			return nil, err
		}
		if _, err := tools.Register(run, delegationTool(registry, options)); err != nil {
			return nil, err
		}
		prompts, err := point.Resolve(run, harness.PromptRegistryKey)
		if err != nil {
			return nil, err
		}
		_, err = prompts.Register(run, harness.PromptSection{ID: "subagent/guidance/" + options.ToolName, Order: 650, Content: func(_ context.Context, agent *harness.Agent) (string, error) {
			if agent == nil {
				return "", nil
			}
			if depth := registry.Depth(agent); depth >= options.MaxDepth {
				return fmt.Sprintf("Delegation depth for `%s`: current %d, maximum %d. Do not delegate further.", options.ToolName, depth, options.MaxDepth), nil
			}
			if provider.InheritsParentContext() {
				return "Use " + options.ToolName + " for focused delegated work. The child sees completed parent turns, not the current turn. It waits for and returns the child result; canceling this call stops the child. Child operations requiring approval are denied (ApprovalNever); children cannot request escalation.", nil
			}
			return "Use " + options.ToolName + " for focused independent work. Give a complete standalone prompt. It waits for and returns the child result; canceling this call stops the child. Child operations requiring approval are denied (ApprovalNever); children cannot request escalation.", nil
		}})
		return nil, err
	})
	instance, err := h.Runtime().Mount(nil, options.EntryID, definition, nil)
	if err != nil {
		return nil, err
	}
	if err := instance.WaitStable(ctx); err != nil {
		_ = instance.Dispose(context.Background())
		return nil, err
	}
	if snapshot := instance.Snapshot(); snapshot.State == point.Failed {
		_ = instance.Dispose(context.Background())
		return nil, fmt.Errorf("subagents: tool activation failed: %s", snapshot.LastError)
	}
	return &ToolContribution{instance: instance}, nil
}

func delegationTool(registry *harness.SubagentRegistry, options ToolOptions) harness.Tool {
	return harness.Tool{
		Schema:            harness.ToolSchema{Name: options.ToolName, Description: "Delegate a task to a managed subagent and wait for its result. Canceling this call stops the child. Child operations requiring approval are denied (ApprovalNever); children cannot request escalation.", InputSchema: json.RawMessage(`{"type":"object","properties":{"description":{"type":"string","minLength":1},"prompt":{"type":"string","minLength":1}},"required":["description","prompt"],"additionalProperties":false}`)},
		IsConcurrencySafe: func(context.Context, harness.ToolRequest) bool { return true },
		ExecuteRequest: func(ctx context.Context, toolRequest harness.ToolRequest) (harness.ToolResult, error) {
			if toolRequest.Agent == nil {
				return harness.ToolResult{}, errors.New("subagents: tool requires a calling agent")
			}
			// Exact keys and types remain validated even for a direct tool body call.
			var raw map[string]json.RawMessage
			if err := json.Unmarshal(toolRequest.Arguments, &raw); err != nil {
				return harness.ToolResult{}, err
			}
			if len(raw) != 2 {
				return harness.ToolResult{}, errors.New("subagents: only description and prompt are accepted")
			}
			var description, prompt string
			if err := json.Unmarshal(raw["description"], &description); err != nil {
				return harness.ToolResult{}, err
			}
			if err := json.Unmarshal(raw["prompt"], &prompt); err != nil {
				return harness.ToolResult{}, err
			}
			if strings.TrimSpace(description) == "" || strings.TrimSpace(prompt) == "" {
				return harness.ToolResult{}, errors.New("subagents: prompt and description must not be blank")
			}
			request := harness.SubagentRequest{Parent: toolRequest.Agent, Label: description, Prompt: prompt, MaxDepth: options.MaxDepth, MaxSteps: options.MaxSteps, MaxTokens: options.MaxTokens}
			run, err := registry.StartActivation(ctx, options.Provider, request, "caller")
			if err != nil {
				return harness.ToolResult{}, err
			}
			select {
			case result, ok := <-run.Result:
				if !ok {
					return harness.ToolResult{}, errors.Join(errors.New("subagents: child closed without a result"), run.Dispose(ctx))
				}
				cleanupErr := run.Dispose(ctx)
				content := []harness.ContentBlock{{Type: harness.BlockText, Text: fmt.Sprintf("Subagent %s finished with status %s.", run.ChildID, result.Status)}}
				content = append(content, result.Output...)
				if result.Diagnostic != "" {
					content = append(content, harness.ContentBlock{Type: harness.BlockText, Text: result.Diagnostic})
				}
				return harness.ToolResult{Content: content, IsError: result.Status != harness.SubagentCompleted}, cleanupErr
			case <-ctx.Done():
				// RequestDispose synchronously revokes authority; registry retains final
				// teardown receipts even when this canceled callback cannot join cleanup.
				_ = run.RequestDispose()
				return harness.ToolResult{}, ctx.Err()
			}
		},
	}
}
