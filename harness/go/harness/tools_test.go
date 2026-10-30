package harness

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	point "github.com/phodal/pero/harness/go/runtime"
)

func TestToolRegistryAgentCatalogIsAuthoritativeAndModelVisible(t *testing.T) {
	ctx := testContext(t)
	requests := make(chan GenerateRequest, 1)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(_ context.Context, request GenerateRequest, _ func(StreamChunk) error) (Completion, error) {
		requests <- request
		return Completion{Message: Message{Role: RoleAssistant, Content: []ContentBlock{{Type: BlockText, Text: "done"}}}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())

	tool := func(name, description, output string) Tool {
		return Tool{
			Schema:        ToolSchema{Name: name, Description: description, InputSchema: json.RawMessage(`{"type":"object","additionalProperties":false}`)},
			ExecutionMode: ExecutionParallel,
			ExecuteRequest: func(_ context.Context, request ToolRequest) (ToolResult, error) {
				return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: output + ":" + string(request.Agent.ID())}}}, nil
			},
		}
	}
	providerDisposed := make(chan point.Dispose, 1)
	released := make(chan SessionID, 8)
	definition := point.Define(
		point.Descriptor{ID: "test/agent-catalog"},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			if _, registerErr := h.Tools().Register(run, tool("collision", "ordinary static tool", "static")); registerErr != nil {
				return nil, registerErr
			}
			if _, replaceErr := h.Tools().ReplaceGeneration(run, "dynamic", []Tool{tool("shared", "global proxy", "proxy")}); replaceErr != nil {
				return nil, replaceErr
			}
			dispose, registerErr := h.Tools().RegisterCatalogProvider(run, "dynamic", ToolCatalogProvider{
				Schemas: func(_ context.Context, agent *Agent) ([]ToolSchema, error) {
					switch agent.ID() {
					case "denied":
						return nil, nil
					case "collision-agent":
						return []ToolSchema{tool("collision", "bad shadow", "bad").Schema}, nil
					default:
						return []ToolSchema{
							tool("shared", "agent override", "override").Schema,
							tool("agent_only", "agent-only capability", "only").Schema,
						}, nil
					}
				},
				Resolve: func(_ context.Context, agent *Agent, name string) (Tool, bool, error) {
					if agent.ID() == "resolver-error" {
						return Tool{}, false, errors.New("catalog unavailable")
					}
					if agent.ID() == "denied" {
						return Tool{}, false, nil
					}
					if agent.ID() == "collision-agent" && name == "collision" {
						return tool("collision", "bad shadow", "bad"), true, nil
					}
					switch name {
					case "shared":
						return tool("shared", "agent override", "override"), true, nil
					case "agent_only":
						return tool("agent_only", "agent-only capability", "only"), true, nil
					default:
						return Tool{}, false, nil
					}
				},
				Release: func(_ context.Context, agent *Agent) error {
					released <- agent.ID()
					return nil
				},
			})
			if registerErr != nil {
				return nil, registerErr
			}
			providerDisposed <- dispose
			return nil, nil
		},
	)
	instance, err := h.Runtime().Mount(nil, "test-agent-catalog", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer instance.Dispose(context.Background())
	if err := instance.WaitStable(ctx); err != nil {
		t.Fatal(err)
	}
	disposeProvider := <-providerDisposed

	create := func(id SessionID) *Agent {
		agent, createErr := h.Agents().Create(ctx, AgentOptions{ID: id})
		if createErr != nil {
			t.Fatal(createErr)
		}
		return agent
	}
	dynamic := create("dynamic-agent")
	denied := create("denied")
	collision := create("collision-agent")
	resolverError := create("resolver-error")
	releaseTarget := create("release-target")

	schemas, err := h.Tools().SchemasForAgent(ctx, dynamic)
	if err != nil {
		t.Fatal(err)
	}
	if len(schemas) != 3 || schemas[0].Name != "agent_only" || schemas[1].Name != "collision" ||
		schemas[2].Name != "shared" || schemas[2].Description != "agent override" {
		t.Fatalf("dynamic schemas=%+v", schemas)
	}
	result, err := dynamic.Prompt(ctx, Message{Role: RoleUser, Content: []ContentBlock{{Type: BlockText, Text: "inspect tools"}}})
	if err != nil || result.Reason != FinishStop {
		t.Fatalf("prompt result=%+v err=%v", result, err)
	}
	modelRequest := <-requests
	if len(modelRequest.Tools) != 3 || modelRequest.Tools[0].Name != "agent_only" || modelRequest.Tools[2].Description != "agent override" {
		t.Fatalf("model tools=%+v", modelRequest.Tools)
	}
	override, err := h.Tools().Execute(ctx, ToolRequest{Agent: dynamic, CallID: "override", Name: "shared", Arguments: json.RawMessage(`{}`)})
	if err != nil || override.Result.IsError || override.Result.Content[0].Text != "override:dynamic-agent" {
		t.Fatalf("override=%+v err=%v", override.Result, err)
	}
	only, err := h.Tools().Execute(ctx, ToolRequest{Agent: dynamic, CallID: "only", Name: "agent_only", Arguments: json.RawMessage(`{}`)})
	if err != nil || only.Result.IsError || only.Result.Content[0].Text != "only:dynamic-agent" {
		t.Fatalf("agent-only=%+v err=%v", only.Result, err)
	}

	deniedSchemas, err := h.Tools().SchemasForAgent(ctx, denied)
	if err != nil || len(deniedSchemas) != 1 || deniedSchemas[0].Name != "collision" {
		t.Fatalf("denied schemas=%+v err=%v", deniedSchemas, err)
	}
	deniedCall, err := h.Tools().Execute(ctx, ToolRequest{Agent: denied, CallID: "denied", Name: "shared", Arguments: json.RawMessage(`{}`)})
	if err != nil || !deniedCall.Result.IsError || !strings.Contains(deniedCall.Result.Content[0].Text, "unknown tool") {
		t.Fatalf("denied call=%+v err=%v", deniedCall.Result, err)
	}
	if _, err := h.Tools().SchemasForAgent(ctx, collision); err == nil || !strings.Contains(err.Error(), "conflicts at the same scope") {
		t.Fatalf("collision error=%v", err)
	}
	if mode := h.Tools().ExecutionMode(ctx, ToolRequest{Agent: resolverError, Name: "shared", Arguments: json.RawMessage(`{}`)}); mode != ExecutionSerial {
		t.Fatalf("resolver error mode=%q", mode)
	}
	failed, err := h.Tools().Execute(ctx, ToolRequest{Agent: resolverError, CallID: "error", Name: "shared", Arguments: json.RawMessage(`{}`)})
	if err != nil || !failed.Result.IsError || !strings.Contains(failed.Result.Content[0].Text, "catalog unavailable") {
		t.Fatalf("resolver failure=%+v err=%v", failed.Result, err)
	}
	if _, err := h.Tools().SchemasForAgent(ctx, releaseTarget); err != nil {
		t.Fatal(err)
	}
	if err := h.Agents().Remove(ctx, releaseTarget.ID()); err != nil {
		t.Fatal(err)
	}
	if got := <-released; got != releaseTarget.ID() {
		t.Fatalf("released agent=%q want=%q", got, releaseTarget.ID())
	}

	if err := disposeProvider(ctx); err != nil {
		t.Fatal(err)
	}
	restored, err := h.Tools().SchemasForAgent(ctx, denied)
	if err != nil || len(restored) != 2 || restored[1].Name != "shared" || restored[1].Description != "global proxy" {
		t.Fatalf("restored schemas=%+v err=%v", restored, err)
	}
	proxy, err := h.Tools().Execute(ctx, ToolRequest{Agent: denied, CallID: "proxy", Name: "shared", Arguments: json.RawMessage(`{}`)})
	if err != nil || proxy.Result.IsError || proxy.Result.Content[0].Text != "proxy:denied" {
		t.Fatalf("restored proxy=%+v err=%v", proxy.Result, err)
	}
}

func TestAuthoritativeCatalogProjectsAndNestedDispatchesTheUnpresentedBase(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatal(err)
	}
	defer h.Dispose(context.Background())
	var observedMu sync.Mutex
	var observed []ToolOutcome
	var base ToolCatalogBase
	definition := point.Define(
		point.Descriptor{ID: "test/authoritative-catalog"},
		point.DecodeJSON[struct{}],
		func(run *point.Run, _ struct{}) (point.Dispose, error) {
			if _, resultErr := h.Tools().Results.On(run, func(_ context.Context, outcome ToolOutcome) error {
				observedMu.Lock()
				observed = append(observed, outcome)
				observedMu.Unlock()
				return nil
			}); resultErr != nil {
				return nil, resultErr
			}
			baseTool := Tool{
				Schema: ToolSchema{Name: "base_echo", Description: "ordinary Go capability", InputSchema: json.RawMessage(`{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}`)},
				ExecuteRequest: func(_ context.Context, request ToolRequest) (ToolResult, error) {
					return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: "base:" + string(request.Arguments)}}}, nil
				},
			}
			if _, registerErr := h.Tools().Register(run, baseTool); registerErr != nil {
				return nil, registerErr
			}
			runCode := Tool{
				Schema: ToolSchema{Name: "run_code", Description: "projected transport", InputSchema: json.RawMessage(`{"type":"object","properties":{"value":{"type":"string"}},"required":["value"],"additionalProperties":false}`)},
				ExecuteRequest: func(callCtx context.Context, request ToolRequest) (ToolResult, error) {
					if !request.ExecutionToken().Valid() {
						return ToolResult{}, errors.New("outer execution token is missing")
					}
					if _, nested := request.ParentExecutionToken(); nested {
						return ToolResult{}, errors.New("root presentation call unexpectedly has a parent token")
					}
					outcome, executeErr := base.Execute(callCtx, ToolRequest{Agent: request.Agent, CallID: request.CallID + "/nested", Name: "base_echo", Arguments: request.Arguments})
					if executeErr == nil {
						parent, ok := outcome.Request.ParentExecutionToken()
						if !outcome.Request.ExecutionToken().Valid() || !ok || parent != request.ExecutionToken() {
							return ToolResult{}, errors.New("nested execution lineage did not bind to the presenter")
						}
					}
					return outcome.Result, executeErr
				},
			}
			_, registerErr := h.Tools().RegisterCatalogProvider(run, "presentation", ToolCatalogProvider{
				Authoritative: true,
				Bind:          func(view ToolCatalogBase) { base = view },
				Schemas: func(callCtx context.Context, agent *Agent) ([]ToolSchema, error) {
					schemas, schemaErr := base.Schemas(callCtx, agent)
					if schemaErr != nil {
						return nil, schemaErr
					}
					if len(schemas) != 1 || schemas[0].Name != "base_echo" {
						return nil, fmt.Errorf("unexpected base schemas: %+v", schemas)
					}
					return []ToolSchema{runCode.Schema}, nil
				},
				Resolve: func(_ context.Context, _ *Agent, name string) (Tool, bool, error) {
					return runCode, name == runCode.Schema.Name, nil
				},
			})
			return nil, registerErr
		},
	)
	instance, err := h.Runtime().Mount(nil, "authoritative-catalog", definition, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer instance.Dispose(context.Background())
	if err := instance.WaitStable(ctx); err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(ctx, AgentOptions{ID: "authoritative-agent"})
	if err != nil {
		t.Fatal(err)
	}
	if _, dispatchErr := base.Dispatch(ctx, ToolRequest{Agent: agent, CallID: "unadmitted", Name: "base_echo", Arguments: json.RawMessage(`{"value":"x"}`)}); dispatchErr == nil || !strings.Contains(dispatchErr.Error(), "matching admitted execution") {
		t.Fatalf("unadmitted base dispatch error=%v", dispatchErr)
	}
	schemas, err := h.Tools().SchemasForAgent(ctx, agent)
	if err != nil || len(schemas) != 1 || schemas[0].Name != "run_code" {
		t.Fatalf("projected schemas=%+v err=%v", schemas, err)
	}
	direct, err := h.Tools().Execute(ctx, ToolRequest{Agent: agent, CallID: "direct", Name: "base_echo", Arguments: json.RawMessage(`{"value":"x"}`)})
	if err != nil || !direct.Result.IsError || !strings.Contains(direct.Result.Content[0].Text, "unknown tool") {
		t.Fatalf("direct collapsed call=%+v err=%v", direct.Result, err)
	}
	nested, err := h.Tools().Execute(ctx, ToolRequest{Agent: agent, CallID: "transport", Name: "run_code", Arguments: json.RawMessage(`{"value":"x"}`)})
	if err != nil || nested.Result.IsError || nested.Result.Content[0].Text != `base:{"value":"x"}` {
		t.Fatalf("nested base dispatch=%+v err=%v", nested.Result, err)
	}
	if !nested.Request.ExecutionToken().Valid() {
		t.Fatal("outer outcome lost its execution token")
	}
	if _, ok := nested.Request.ParentExecutionToken(); ok {
		t.Fatal("root outcome unexpectedly has a parent token")
	}
	observedMu.Lock()
	gotObserved := append([]ToolOutcome(nil), observed...)
	observedMu.Unlock()
	if len(gotObserved) != 2 || gotObserved[0].Request.Name != "base_echo" || gotObserved[1].Request.Name != "run_code" {
		t.Fatalf("authoritative result notifications=%+v", gotObserved)
	}
	parentToken, ok := gotObserved[0].Request.ParentExecutionToken()
	if !ok || parentToken != gotObserved[1].Request.ExecutionToken() {
		t.Fatal("nested result notification lost its parent execution token")
	}
}

func TestToolRegistryValidatesSchemaAndArgumentsBeforeExecution(t *testing.T) {
	ctx := testContext(t)
	h, err := Boot(ctx, Options{Adapter: AdapterFunc(func(context.Context, GenerateRequest, func(StreamChunk) error) (Completion, error) {
		return Completion{Message: Message{Role: RoleAssistant}, Finish: FinishStop}, nil
	})})
	if err != nil {
		t.Fatalf("boot: %v", err)
	}
	if _, err := h.RegisterTool(ctx, "invalid-schema", Tool{
		Schema:  ToolSchema{Name: "invalid", InputSchema: json.RawMessage(`{"type":"array"}`)},
		Execute: func(context.Context, json.RawMessage) (ToolResult, error) { return ToolResult{}, nil },
	}); err == nil || !strings.Contains(err.Error(), "must describe an object") {
		t.Fatalf("non-object schema error = %v", err)
	}
	if _, err := h.RegisterTool(ctx, "ambiguous-executor", Tool{
		Schema:         ToolSchema{Name: "ambiguous", InputSchema: json.RawMessage(`{"type":"object"}`)},
		Execute:        func(context.Context, json.RawMessage) (ToolResult, error) { return ToolResult{}, nil },
		ExecuteRequest: func(context.Context, ToolRequest) (ToolResult, error) { return ToolResult{}, nil },
	}); err == nil || !strings.Contains(err.Error(), "only one executor form") {
		t.Fatalf("ambiguous executor error = %v", err)
	}

	var approvals atomic.Int32
	agent, err := h.Agents().Create(ctx, AgentOptions{
		ID: "validated-tools",
		Configure: func(_ context.Context, run *point.Run, _ *Agent) error {
			_, err := h.Approvals().Register(run, func(context.Context, ApprovalRequest) (ApprovalOutcome, error) {
				approvals.Add(1)
				return ApprovalAllowedOnce, nil
			})
			return err
		},
	})
	if err != nil {
		t.Fatalf("create agent: %v", err)
	}

	var executed atomic.Bool
	toolInstance, err := h.RegisterTool(ctx, "validated-tool", Tool{
		Schema: ToolSchema{
			Name: "greet",
			InputSchema: json.RawMessage(
				`{"type":"object","properties":{"name":{"type":"string","minLength":1}},"required":["name"],"additionalProperties":false}`,
			),
		},
		RequiresApproval: true,
		Execute: func(_ context.Context, raw json.RawMessage) (ToolResult, error) {
			executed.Store(true)
			return ToolResult{Content: []ContentBlock{{Type: BlockText, Text: string(raw)}}}, nil
		},
	})
	if err != nil {
		t.Fatalf("register validated tool: %v", err)
	}
	invalid, err := h.Tools().Execute(ctx, ToolRequest{
		Agent: agent, CallID: "invalid-call", Name: "greet", Arguments: json.RawMessage(`{}`),
	})
	if err != nil {
		t.Fatalf("invalid execute returned infrastructure error: %v", err)
	}
	if !invalid.Result.IsError || !strings.Contains(invalid.Result.Content[0].Text, "invalid tool arguments") {
		t.Fatalf("invalid result = %+v", invalid.Result)
	}
	if executed.Load() {
		t.Fatal("executor ran for schema-invalid arguments")
	}
	if approvals.Load() != 0 {
		t.Fatalf("approval requested for schema-invalid arguments: %d", approvals.Load())
	}
	if _, err := agent.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}

	valid, err := h.Tools().Execute(ctx, ToolRequest{
		Agent: agent, CallID: "valid-call", Name: "greet", Arguments: json.RawMessage(`{"name":"Point"}`),
	})
	if err != nil {
		t.Fatalf("valid execute: %v", err)
	}
	if valid.Result.IsError || !executed.Load() || approvals.Load() != 1 {
		t.Fatalf("valid result = %+v, executed=%v, approvals=%d", valid.Result, executed.Load(), approvals.Load())
	}

	if err := toolInstance.Dispose(ctx); err != nil {
		t.Fatalf("dispose tool: %v", err)
	}
	// Dispose may report pending while the canceled Agent worker unwinds.
	// This outer lifecycle must join the final receipt before accepting it.
	requestErr, finalErr := h.Dispose(ctx), h.Drain(ctx)
	if finalErr == nil && requestErr == ErrHarnessDisposalInProgress {
		requestErr = nil
	}
	if err := errors.Join(requestErr, finalErr); err != nil {
		t.Fatalf("dispose harness: %v", err)
	}
}
