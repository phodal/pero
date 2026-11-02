package skills

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"sync/atomic"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

type forkOutput struct {
	messages []harness.Message
	status   harness.SubagentStatus
}

// ConfigureFork grants only the newly created child's first turn. It installs
// metadata beside the existing prompt, without copying or evaluating its body.
func ConfigureFork(ctx context.Context, h *harness.Harness, run *point.Run, child *harness.Agent, definition Definition) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if h == nil || run == nil || child == nil || !run.Active() || definition.Context != "fork" {
		return errors.New("skills: fork configuration requires a live child run and fork definition")
	}
	firstTurn := child.CurrentTurn() + 1
	var granted atomic.Bool
	_, err := h.Hooks().PreStep.Use(run, func(_ context.Context, input harness.StepInput, next point.Next[harness.StepInput]) (harness.StepInput, error) {
		input, err := next(input)
		if err != nil || input.Reject || input.Agent != child || input.Turn != firstTurn || input.Step != 1 || !granted.CompareAndSwap(false, true) {
			return input, err
		}
		source, _ := json.Marshal(skillInvocation{Kind: "skill-invocation", Form: "fork-grant", Name: definition.Name, Digest: definition.Digest, Context: "fork", Turn: input.Turn, ID: "fork-grant:" + string(child.ID())})
		input.Messages = append(input.Messages, harness.Message{Role: harness.RoleUser, Source: source, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Activated isolated workflow " + definition.Name + "."}}})
		return input, nil
	})
	return err
}

func validateSkillForks(catalog *Catalog, options MountOptions) error {
	catalog.mu.Lock()
	defer catalog.mu.Unlock()
	for _, entry := range catalog.entries {
		if entry.definition.Context != "" && entry.definition.Context != "fork" {
			return errors.New("skills: selected context must be fork or omitted")
		}
		if entry.definition.Context == "fork" && options.Fork == nil {
			return errors.New("skills: context: fork requires a configured subagent executor")
		}
	}
	return nil
}

// forkInvocation emits activation metadata and the child result, never its
// instructions. The existing composition-owned subagent service owns execution.
func forkInvocation(ctx context.Context, options MountOptions, parent *harness.Agent, definition Definition, arguments, id string) (forkOutput, error) {
	if options.Fork == nil {
		return forkOutput{}, errors.New("skills: context: fork requires a configured subagent executor")
	}
	if parent == nil {
		return forkOutput{}, errors.New("skills: context: fork requires a parent agent")
	}
	if err := ctx.Err(); err != nil {
		return forkOutput{}, err
	}
	if definition.Agent == "" {
		definition.Agent = "general-purpose"
	}
	if definition.Claude {
		definition.Content = "Base directory for this skill: " + filepath.Join(definition.ResourceBase, filepath.FromSlash(definition.Directory)) + "\nPlugin root: " + definition.ResourceBase + "\n\n" + definition.Content
	}
	output, err := options.Fork(ctx, parent, definition)
	if err != nil {
		return forkOutput{}, err
	}
	if err := ctx.Err(); err != nil {
		return forkOutput{}, err
	}
	if output.ChildID == "" || output.Status != harness.SubagentCompleted && output.Status != harness.SubagentFailed && output.Status != harness.SubagentAborted {
		return forkOutput{}, errors.New("skills: fork executor must return a child identity and terminal status")
	}
	invocation := skillInvocation{Kind: "skill-invocation", Form: "activation", Name: definition.Name, Digest: definition.Digest, Arguments: arguments, Turn: parent.CurrentTurn(), ID: id, Context: "fork", ChildID: output.ChildID, Status: output.Status}
	activation, _ := json.Marshal(invocation)
	invocation.Form = "fork-result"
	result, _ := json.Marshal(invocation)
	data, err := json.Marshal(struct {
		ChildID    harness.SessionID      `json:"childId"`
		Status     harness.SubagentStatus `json:"status"`
		Output     []harness.ContentBlock `json:"output,omitempty"`
		Diagnostic string                 `json:"diagnostic,omitempty"`
	}{output.ChildID, output.Status, output.Output, output.Diagnostic})
	if err != nil {
		return forkOutput{}, err
	}
	return forkOutput{status: output.Status, messages: []harness.Message{
		{Role: harness.RoleUser, Source: activation, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "Forked workflow " + definition.Name + " finished in an isolated subagent."}}},
		{Role: harness.RoleUser, Source: result, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(data)}}},
	}}, nil
}
