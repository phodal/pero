package subagents

import (
	"context"
	"encoding/json"
	"errors"
	"sync"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

const structuredOutputToolName = "structured_output"

const structuredOutputInstruction = "When you have your final answer, you MUST report it by calling the `structured_output` tool with arguments matching its parameter schema exactly. Do not finish with a plain text answer: only the tool call counts as your result."

type structuredCapture struct {
	mu               sync.Mutex
	staged           map[harness.ToolExecutionToken]structuredStage
	admission        *harness.SubagentStructuredAdmission
	pending          *structuredPending
	captured         any
	committed        harness.ToolExecutionToken
	committedRelease func()
}

type structuredStage struct {
	value   any
	release func()
}

type structuredPending struct {
	origin  harness.ToolExecutionToken
	parent  harness.ToolExecutionToken
	value   any
	release func()
}

func attachStructuredCapture(h *harness.Harness, run *point.Run, agent *harness.Agent, schema json.RawMessage, admissions ...*harness.SubagentStructuredAdmission) (*structuredCapture, error) {
	if h == nil || run == nil || agent == nil {
		return nil, errors.New("subagents: structured capture requires a child scope")
	}
	capture := &structuredCapture{staged: make(map[harness.ToolExecutionToken]structuredStage)}
	if len(admissions) != 0 {
		capture.admission = admissions[0]
	}
	tool := harness.Tool{
		Schema: harness.ToolSchema{
			Name:        structuredOutputToolName,
			Description: "Report your final structured result. Call this exactly once when your answer is complete.",
			InputSchema: append(json.RawMessage(nil), schema...),
		},
		ExecuteRequest: func(_ context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
			if request.Agent != agent {
				return harness.ToolResult{}, errors.New("subagents: structured capture requires its exact child agent")
			}
			var value any
			if err := json.Unmarshal(request.Arguments, &value); err != nil {
				return harness.ToolResult{}, err
			}
			release := func() {}
			if capture.admission != nil {
				var err error
				release, err = capture.admission.BeginCapture()
				if err != nil {
					return harness.ToolResult{}, err
				}
			}
			capture.mu.Lock()
			capture.staged[request.ExecutionToken()] = structuredStage{value: value, release: release}
			capture.mu.Unlock()
			return harness.ToolResult{
				Content:       []harness.ContentBlock{{Type: harness.BlockText, Text: "Structured output recorded."}},
				ConcludesTurn: true,
			}, nil
		},
	}
	if _, err := h.Tools().Register(run, tool); err != nil {
		return nil, err
	}
	if _, err := h.Tools().Results.On(run, func(_ context.Context, outcome harness.ToolOutcome) error {
		if outcome.Request.Agent == agent {
			capture.observe(outcome)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if _, err := h.Tools().Finalized.On(run, func(_ context.Context, outcome harness.ToolOutcome) error {
		if outcome.Request.Agent == agent {
			capture.finalize(outcome.Request.ExecutionToken(), outcome.Result.IsError)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	if _, err := h.Prompts().Register(run, harness.PromptSection{
		ID: "subagent/structured-output/" + string(agent.ID()), Order: 8_900,
		Content: func(context.Context, *harness.Agent) (string, error) { return structuredOutputInstruction, nil },
	}); err != nil {
		return nil, err
	}
	if _, err := h.Tools().Guard(run, func(_ context.Context, request harness.ToolRequest) error {
		if request.Agent != agent || !capture.terminal() {
			return nil
		}
		return errors.New("structured output already recorded: the run is complete")
	}); err != nil {
		return nil, err
	}
	return capture, nil
}

func (c *structuredCapture) observe(outcome harness.ToolOutcome) {
	var releases []func()
	c.mu.Lock()
	token := outcome.Request.ExecutionToken()
	if c.pending != nil && c.pending.parent == token {
		pending := c.pending
		c.pending = nil
		if !outcome.Result.IsError && c.captured == nil {
			c.captured = pending.value
			c.committed, c.committedRelease = token, pending.release
		} else {
			releases = append(releases, pending.release)
		}
	}
	entry, staged := c.staged[token]
	delete(c.staged, token)
	if staged {
		switch {
		case outcome.Result.IsError || c.captured != nil || c.pending != nil:
			releases = append(releases, entry.release)
		default:
			if parent, nested := outcome.Request.ParentExecutionToken(); nested {
				c.pending = &structuredPending{origin: token, parent: parent, value: entry.value, release: entry.release}
			} else {
				c.captured = entry.value
				c.committed, c.committedRelease = token, entry.release
			}
		}
	}
	c.mu.Unlock()
	for _, release := range releases {
		release()
	}
}

// finalize only releases state owned by this exact execution. Results is the
// sole commit authority; error-only exits may never have reached that signal.
func (c *structuredCapture) finalize(token harness.ToolExecutionToken, failed bool) {
	var releases []func()
	c.mu.Lock()
	if entry, staged := c.staged[token]; staged {
		delete(c.staged, token)
		releases = append(releases, entry.release)
	}
	if c.pending != nil && (c.pending.parent == token || failed && c.pending.origin == token) {
		releases = append(releases, c.pending.release)
		c.pending = nil
	}
	if failed && c.committed == token {
		c.captured = nil
		c.committed = harness.ToolExecutionToken{}
		if c.committedRelease != nil {
			releases = append(releases, c.committedRelease)
		}
		c.committedRelease = nil
	}
	c.mu.Unlock()
	for _, release := range releases {
		release()
	}
}

func (c *structuredCapture) terminal() bool {
	c.mu.Lock()
	terminal := c.captured != nil || c.pending != nil
	c.mu.Unlock()
	return terminal
}

func (c *structuredCapture) complete() bool {
	c.mu.Lock()
	complete := c.captured != nil
	c.mu.Unlock()
	return complete
}

func (c *structuredCapture) value() any {
	if c == nil {
		return nil
	}
	c.mu.Lock()
	value := c.captured
	c.mu.Unlock()
	return value
}
