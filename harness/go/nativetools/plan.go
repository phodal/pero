package nativetools

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

func mountPlanTools(ctx context.Context, h *harness.Harness) error {
	definition := point.Define(point.Descriptor{ID: "native/plan-mode"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
		if _, err := h.Tools().RestrictWhen(run, harness.PlanningToolAllowed); err != nil {
			return nil, err
		}
		for _, exit := range []bool{false, true} {
			name, description, schema := "EnterPlanMode", "Enter root-session planning. Future calls are restricted to a conservative read/control tool set; existing accepted background work is not canceled. No file changes are allowed. Exit requires approval and restores the prior permission mode.", `{"type":"object","additionalProperties":false}`
			if exit {
				name, description, schema = "ExitPlanMode", "Submit a plan for approval and leave root-session planning only if approved. Rejection, cancellation or unavailable approval leaves planning active. Restores the prior permission mode; does not execute the plan.", `{"type":"object","additionalProperties":false,"required":["plan"],"properties":{"plan":{"type":"string","minLength":1,"maxLength":32768}}}`
			}
			_, err := h.Tools().Register(run, harness.Tool{Schema: harness.ToolSchema{Name: name, Description: description, InputSchema: json.RawMessage(schema)}, RequiresApproval: exit, AlwaysAskApproval: exit, ExecutionMode: harness.ExecutionSerial, ExecuteRequest: func(ctx context.Context, request harness.ToolRequest) (harness.ToolResult, error) {
				if request.Agent == nil || request.Agent.Parent() != nil {
					return harness.ToolResult{}, errors.New("planning transitions require a root session")
				}
				var err error
				if exit {
					err = harness.ExitPlanMode(request.Agent.Session())
				} else {
					err = harness.EnterPlanMode(request.Agent.Session())
				}
				if err == nil {
					err = request.Agent.Session().Flush(ctx)
				}
				return renderResult(struct {
					Planning bool `json:"planning"`
				}{!exit}, err)
			}})
			if err != nil {
				return nil, err
			}
		}
		return nil, nil
	})
	instance, err := h.Runtime().Mount(nil, "native/plan-mode", definition, nil)
	if err == nil {
		err = instance.WaitStable(ctx)
	}
	return err
}
