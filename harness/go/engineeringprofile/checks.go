package engineeringprofile

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"github.com/phodal/pero/harness/go/fstools"
	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/nativetools"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/shell"
)

type checkExecutionKey struct{}
type checkExecution struct {
	agent     *harness.Agent
	spec      CheckSpec
	workspace string
}

func (a *App) checkTool() harness.Tool {
	return harness.Tool{
		Schema:         harness.ToolSchema{Name: "engineering_check", Description: "Execute one check from the active host-bound engineering contract by checkId. Its exact command and input files are host configuration, not model arguments. The underlying shell/Bash keeps its existing permissions and approval. A running or failed result is not acceptance. Without an active contract this tool refuses execution.", InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{"checkId":{"type":"string","minLength":1,"maxLength":128}},"required":["checkId"]}`)},
		ExecutionMode:  harness.ExecutionSerial,
		ExecuteRequest: a.executeCheck,
	}
}

func (a *App) guardCheck(ctx context.Context, request harness.ToolRequest) error {
	bound, ok := ctx.Value(checkExecutionKey{}).(checkExecution)
	if !ok {
		return nil
	}
	var input struct {
		Command string `json:"command"`
	}
	if request.Agent != bound.agent || request.Name != bound.spec.Tool || json.Unmarshal(request.Arguments, &input) != nil || input.Command != bound.spec.Command || request.Agent.Session().WorkingDirectory() != bound.workspace {
		return errors.New("engineeringprofile: check dispatch changed its bound command, owner or workspace")
	}
	return nil
}

func (a *App) executeCheck(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
	if !a.accepts(request.Agent) || !a.active.Load() || request.CallID == "" {
		return harness.ToolResult{}, errors.New("engineeringprofile: check requires an active root tool call")
	}
	callSeq, err := checkCallSequence(request.Agent.Session(), request)
	if err != nil {
		return harness.ToolResult{}, err
	}
	input, err := point.DecodeJSON[struct {
		CheckID string `json:"checkId"`
	}](request.Arguments)
	if err != nil {
		return harness.ToolResult{}, err
	}
	c, ok, err := Current(request.Agent.Session())
	if err != nil {
		return harness.ToolResult{}, err
	}
	if !ok {
		return harness.ToolResult{}, errors.New("engineeringprofile: no active host-bound contract")
	}
	var selected *CheckSpec
	for i := range c.Checks {
		if c.Checks[i].ID == input.CheckID {
			selected = &c.Checks[i]
			break
		}
	}
	if selected == nil {
		return harness.ToolResult{}, errors.New("engineeringprofile: unknown contract check")
	}
	cwd := request.Agent.Session().WorkingDirectory()
	workspace, err := fstools.OpenWorkspace(cwd)
	if err != nil {
		return harness.ToolResult{}, err
	}
	defer workspace.Close()
	before, err := inputDigest(ctx, workspace, selected.Files)
	if err != nil {
		return harness.ToolResult{}, fmt.Errorf("engineeringprofile: cannot snapshot check inputs: %w", err)
	}
	args, _ := json.Marshal(struct {
		Command string `json:"command"`
	}{selected.Command})
	bound := context.WithValue(ctx, checkExecutionKey{}, checkExecution{request.Agent, *selected, cwd})
	bound = nativetools.WithSessionWorkingDirectory(bound)
	outcome, runErr := a.h.Tools().Execute(bound, harness.ToolRequest{Agent: request.Agent, Name: selected.Tool, Arguments: args})
	if ctx.Err() != nil {
		return harness.ToolResult{}, ctx.Err()
	}
	p := proof{Version: 1, ContractID: c.ID, Revision: c.Revision, CheckID: selected.ID, SpecDigest: checkDigest(*selected), CallID: request.CallID, CallSeq: callSeq, BeforeDigest: before, Status: Unverified}
	p.AfterDigest, err = inputDigest(ctx, workspace, selected.Files)
	if err != nil {
		p.Reason = "check inputs could not be read after execution"
	}
	// Value is canonical where available. Native Bash's supported presentation
	// is a JSON RunResult; plain text or a background handle lacks an exitCode.
	raw := outcome.Result.Value
	if len(raw) == 0 && len(outcome.Result.Content) == 1 && outcome.Result.Content[0].Type == harness.BlockText {
		raw = json.RawMessage(outcome.Result.Content[0].Text)
	}
	var result shell.RunResult
	decoded := json.Unmarshal(raw, &result) == nil
	p.ExitCode = result.ExitCode
	switch {
	case runErr != nil || outcome.Result.IsError:
		p.Status = Failed
		p.Reason = "the underlying check execution failed"
	case err != nil:
		p.Status = Unverified
	case p.BeforeDigest != p.AfterDigest || request.Agent.Session().WorkingDirectory() != cwd:
		p.Status = Stale
		p.Reason = "check inputs or workspace changed during execution"
	case !decoded || result.ExitCode == nil:
		p.Reason = "no settled exit status; background or unrecognized results remain unverified"
	case result.TimedOut || result.Aborted || result.CleanupUncertain || result.Signal != "" || *result.ExitCode != 0:
		p.Status = Failed
		p.Reason = "check did not finish successfully"
	default:
		p.Status = Passed
	}
	if _, err = request.Agent.Session().Append(evidenceEvent, p); err != nil {
		return harness.ToolResult{}, err
	}
	if err = request.Agent.Session().Flush(ctx); err != nil {
		return harness.ToolResult{}, err
	}
	raw, err = json.Marshal(struct {
		CheckID        string      `json:"checkId"`
		ObservedStatus CheckStatus `json:"observedStatus"`
		ExitCode       *int        `json:"exitCode,omitempty"`
		Reason         string      `json:"reason,omitempty"`
		InputDigest    string      `json:"inputDigest"`
	}{selected.ID, p.Status, p.ExitCode, p.Reason, p.BeforeDigest})
	if err != nil {
		return harness.ToolResult{}, err
	}
	return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}, IsError: p.Status == Failed}, nil
}

func inputDigest(ctx context.Context, workspace *fstools.Workspace, files []string) (string, error) {
	names := append([]string(nil), files...)
	sort.Strings(names)
	type input struct {
		Path   string `json:"path"`
		Digest string `json:"digest"`
	}
	rows := make([]input, 0, len(names))
	for _, name := range names {
		text, err := workspace.Read(ctx, name)
		if err != nil {
			return "", err
		}
		rows = append(rows, input{name, text.Digest})
	}
	// Equal bytes in another retained worktree do not settle this workspace.
	raw, _ := json.Marshal(struct {
		Workspace string  `json:"workspace"`
		Files     []input `json:"files"`
	}{workspace.Path(), rows})
	return digest(raw), nil
}

func evaluateChecks(ctx context.Context, agent *harness.Agent, c Contract) ([]CheckAssessment, error) {
	checks := make([]CheckAssessment, 0, len(c.Checks))
	for _, spec := range c.Checks {
		check := CheckAssessment{ID: spec.ID, Status: Missing}
		p, seq, ok, err := settledProof(agent.Session(), c, spec.ID)
		if err != nil {
			return nil, err
		}
		if ok {
			check.Status, check.ResultSeq, check.Reason = p.Status, seq, p.Reason
			if check.Status == Passed {
				workspace, err := fstools.OpenWorkspace(agent.Session().WorkingDirectory())
				if err != nil {
					check.Status = Unverified
					check.Reason = "workspace is unavailable"
				} else {
					current, readErr := inputDigest(ctx, workspace, spec.Files)
					_ = workspace.Close()
					if readErr != nil || current != p.AfterDigest {
						check.Status = Stale
						check.Reason = "the declared inputs or workspace differ from the checked version"
					}
				}
			}
		}
		checks = append(checks, check)
	}
	return checks, nil
}
