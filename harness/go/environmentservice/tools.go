package environmentservice

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/phodal/pero/harness/go/harness"
)

func Mount(ctx context.Context, h *harness.Harness, options Options, checkCWD func(string) error) error {
	if err := privateDirectory(options.Directory, true); err != nil {
		return err
	}
	for _, name := range []string{"ServiceStart", "ServiceStatus", "ServiceStop"} {
		properties, required := `"service_id":{"type":"string","pattern":"^[a-f0-9]{32}$"}`, `"service_id"`
		description := "Observe the exact environment-owned service receipt. Running is not application readiness; verify the required endpoint separately."
		if name == "ServiceStart" {
			properties, required = `"command":{"type":"string","minLength":1,"maxLength":16384},"lifetime_ms":{"type":"integer","minimum":100,"maximum":7200000}`, `"command"`
			description = "Start an approved foreground server under an environment-owned supervisor. It survives agent and Session exit until ServiceStop or expiry (default 30 minutes, maximum 2 hours). Return the exact service_id for environment cleanup. Keep the server in the foreground; do not daemonize it. A starting/running receipt is not endpoint readiness. Use ordinary Bash for builds and tests."
		} else if name == "ServiceStop" {
			description = "Request environment cleanup of the exact service_id. stop_requested is an acknowledgement; use ServiceStatus to observe confirmed termination."
		}
		toolName := name
		_, err := h.RegisterTool(ctx, "environment/"+name, harness.Tool{
			Schema:           harness.ToolSchema{Name: name, Description: description, InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false,"properties":{` + properties + `},"required":[` + required + `]}`)},
			RequiresApproval: name != "ServiceStatus", ExecutionMode: harness.ExecutionSerial, Timeout: 10 * time.Second,
			ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
				if request.Agent == nil || checkCWD == nil {
					return harness.ToolResult{}, errors.New("service tools require a native workspace")
				}
				if err := checkCWD(request.Agent.Session().WorkingDirectory()); err != nil {
					return harness.ToolResult{}, err
				}
				var receipt Receipt
				var err error
				if toolName == "ServiceStart" {
					var input StartRequest
					if err := json.Unmarshal(request.Arguments, &input); err != nil {
						return harness.ToolResult{}, err
					}
					if input.LifetimeMS == 0 {
						input.LifetimeMS = 1800000
					}
					current := options
					current.Workspace = request.Agent.Session().WorkingDirectory()
					receipt, err = Start(ctx, current, input)
				} else {
					var input struct {
						ID string `json:"service_id"`
					}
					if err := json.Unmarshal(request.Arguments, &input); err != nil {
						return harness.ToolResult{}, err
					}
					if toolName == "ServiceStop" {
						receipt, err = Stop(options.Directory, input.ID)
					} else {
						receipt, err = Status(options.Directory, input.ID)
					}
				}
				if err != nil {
					return harness.ToolResult{}, err
				}
				if _, err := request.Agent.Session().Append("environment-service/receipt", receipt); err != nil {
					return harness.ToolResult{}, err
				}
				raw, err := json.Marshal(receipt)
				return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: string(raw)}}}, err
			},
		})
		if err != nil {
			return err
		}
	}
	_, err := h.RegisterPrompt(ctx, "environment/services", harness.PromptSection{ID: "environment/services", Order: 705, Guidance: func(_ context.Context, _ *harness.Agent, capabilities harness.PromptCapabilities) (string, error) {
		if !capabilities.HasTool("ServiceStart") {
			return "", nil
		}
		return "For a delivered server that must remain accessible after this agent exits, use ServiceStart and verify application readiness separately. Preserve its service_id for the environment to stop after verification. Ordinary Bash jobs remain Session-owned and are cleaned up on exit.", nil
	}})
	return err
}
