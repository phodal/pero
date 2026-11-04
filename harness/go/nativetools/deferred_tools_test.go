package nativetools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/providers/openai"
	point "github.com/phodal/pero/harness/go/runtime"
)

type deferredWireStep struct {
	names     []string
	call      string
	arguments string
}

type promptContractAdapter struct {
	generate   harness.AdapterFunc
	modalities []string
	strip      bool
	inject     []harness.ToolSchema
}

func (a promptContractAdapter) Generate(ctx context.Context, request harness.GenerateRequest, emit func(harness.StreamChunk) error) (harness.Completion, error) {
	return a.generate(ctx, request, emit)
}

func (a promptContractAdapter) PrepareGenerateCall(_ context.Context, request harness.GenerateRequest) (harness.PreparedAdapterCall, harness.GenerateRequest, error) {
	if a.strip {
		request.Tools = nil
	}
	request.Tools = append(request.Tools, a.inject...)
	return harness.PreparedAdapterCall{ModelInfo: harness.ModelInfo{Provider: request.Provider, Model: request.Model, InputModalities: a.modalities}, Generate: a.generate}, request, nil
}

// The server validates actual provider JSON, rather than adapter inputs.
func deferredWireProvider(t *testing.T, steps []deferredWireStep) (harness.Adapter, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		index := int(calls.Add(1)) - 1
		if index >= len(steps) {
			t.Errorf("unexpected provider request %d", index)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		step := steps[index]
		var request struct {
			Tools []struct {
				Function struct {
					Name       string
					Parameters json.RawMessage
				}
			}
			Messages []struct {
				Role    string
				Content json.RawMessage
			}
		}
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		names := make([]string, 0, len(request.Tools))
		for _, tool := range request.Tools {
			names = append(names, tool.Function.Name)
			if tool.Function.Name == "deferred_probe" && !strings.Contains(string(tool.Function.Parameters), `"value"`) {
				t.Errorf("request %d lost activated input contract", index)
			}
		}
		sort.Strings(names)
		if !reflect.DeepEqual(names, step.names) {
			t.Errorf("request %d tools=%v want=%v", index, names, step.names)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		if step.call == "" {
			fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"observed\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
			return
		}
		arguments, _ := json.Marshal(step.arguments)
		call, extra := step.call, ""
		if strings.Contains(call, "+") {
			call = "ToolSearch"
			extra = fmt.Sprintf(`,{"index":1,"id":"guessed-%d","type":"function","function":{"name":"deferred_probe","arguments":"{\"value\":\"observed\"}"}}`, index)
		}
		fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-%d\",\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":%s}}%s]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n", index, call, arguments, extra)
	}))
	t.Cleanup(server.Close)
	adapter, err := openai.New(openai.Config{Endpoint: server.URL, APIKey: "local-fixture", ProviderName: "fixture", Models: []openai.ModelConfig{{ID: "text", InputModalities: []string{"text"}, ContextWindow: 65536}}})
	if err != nil {
		t.Fatal(err)
	}
	return adapter, &calls
}

func TestDeferredToolsWireDiscoveryWithdrawalAndRediscovery(t *testing.T) {
	search := []string{"ToolSearch"}
	loaded := []string{"ToolSearch", "deferred_probe"}
	adapter, calls := deferredWireProvider(t, []deferredWireStep{
		{search, "ToolSearch+deferred_probe", `{"query":"select:deferred_probe"}`},
		{loaded, "deferred_probe", `{"value":"observed"}`},
		{loaded, "", ""},
		{search, "", ""}, // Withdrawn.
		{search, "", ""}, // An identical replacement needs rediscovery.
		{search, "ToolSearch", `{"query":"deferred_unique_probe"}`},
		{loaded, "deferred_probe", `{"value":"observed"}`},
		{loaded, "", ""},
		{search, "", ""}, // A different schema is also undiscovered.
	})
	f := newClaudeFixture(t, Options{DeferToolLoading: true}, adapter)
	var executions atomic.Int32
	probe := harness.Tool{Schema: harness.ToolSchema{Name: "deferred_probe", Description: "deferred_unique_probe capability", InputSchema: json.RawMessage(`{"type":"object","required":["value"],"properties":{"value":{"type":"string"}}}`)}, Execute: func(_ context.Context, arguments json.RawMessage) (harness.ToolResult, error) {
		executions.Add(1)
		if string(arguments) != `{"value":"observed"}` {
			t.Errorf("unexpected arguments %s", arguments)
		}
		return harness.ToolResult{Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "observed effect"}}}, nil
	}}
	registration, err := f.harness.RegisterTool(t.Context(), "deferred-probe", probe)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := f.harness.Agents().Create(t.Context(), harness.AgentOptions{ID: "wire-agent", CWD: f.root, Provider: "fixture", Model: "text"})
	if err != nil {
		t.Fatal(err)
	}
	prompt := func() {
		t.Helper()
		if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "use the appropriate capability"}}}); err != nil {
			t.Fatal(err)
		}
	}
	denied := func() {
		t.Helper()
		before := executions.Load()
		out, err := f.harness.Tools().Execute(t.Context(), harness.ToolRequest{Agent: agent, Name: "deferred_probe", CallID: "undiscovered", Arguments: json.RawMessage(`{"value":"observed"}`)})
		if err == nil && !out.Result.IsError || executions.Load() != before {
			t.Fatalf("undiscovered version dispatched: %+v %v", out, err)
		}
	}
	denied()
	prompt()
	if executions.Load() != 1 {
		t.Fatal("search did not activate actual dispatch")
	}
	if err := registration.Dispose(t.Context()); err != nil {
		t.Fatal(err)
	}
	prompt()
	registration, err = f.harness.RegisterTool(t.Context(), "deferred-probe-reloaded", probe)
	if err != nil {
		t.Fatal(err)
	}
	denied()
	prompt()
	prompt()
	if executions.Load() != 2 {
		t.Fatal("rediscovery did not activate replacement")
	}
	if err := registration.Dispose(t.Context()); err != nil {
		t.Fatal(err)
	}
	probe.Schema.InputSchema = json.RawMessage(`{"type":"object","required":["value"],"properties":{"value":{"type":"integer"}}}`)
	if _, err := f.harness.RegisterTool(t.Context(), "deferred-probe-changed", probe); err != nil {
		t.Fatal(err)
	}
	denied()
	prompt()
	if calls.Load() != 9 {
		t.Fatalf("provider calls=%d", calls.Load())
	}
}

func TestDeferredToolsSearchRecoveryAndBatchSelection(t *testing.T) {
	search, loaded := []string{"ToolSearch"}, []string{"Read", "ToolSearch", "Write"}
	adapter, calls := deferredWireProvider(t, []deferredWireStep{
		{search, "ToolSearch", `{"query":"files terminal list read write"}`},
		{search, "ToolSearch", `{"query":"read file contents"}`},
		{search, "ToolSearch", `{"query":"select:Read,Write"}`},
		{loaded, "Read", `{"file_path":"sample.txt"}`},
		{loaded, "", ""},
	})
	f := newClaudeFixture(t, Options{DeferToolLoading: true}, adapter)
	agent, err := f.harness.Agents().Create(t.Context(), harness.AgentOptions{ID: "selection-agent", CWD: f.root, Provider: "fixture", Model: "text"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.root, "sample.txt"), []byte("selection read evidence\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "read sample.txt"}}}); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, event := range agent.Session().Events() {
		if event.Type != "tool/result" {
			continue
		}
		var result harness.ContentBlock
		if err := json.Unmarshal(event.Data, &result); err != nil {
			t.Fatal(err)
		}
		for _, block := range result.Content {
			found = found || strings.Contains(block.Text, "selection read evidence")
		}
	}
	if !found || calls.Load() != 5 {
		t.Fatalf("batch selection did not reach actual Read: found=%v requests=%d", found, calls.Load())
	}
}

func TestDeferredToolsOmittedSelectionDoesNotActivate(t *testing.T) {
	f := newClaudeFixture(t, Options{DeferToolLoading: true})
	var executions atomic.Int32
	_, err := f.harness.RegisterTool(t.Context(), "oversized-probe", harness.Tool{
		Schema: harness.ToolSchema{Name: "oversized_probe", Description: "oversized discovery probe",
			InputSchema: json.RawMessage(`{"type":"object","description":"` + strings.Repeat("x", 40000) + `"}`)},
		Execute: func(context.Context, json.RawMessage) (harness.ToolResult, error) {
			executions.Add(1)
			return harness.ToolResult{}, nil
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	result := f.call(t, f.allowed, "ToolSearch", map[string]any{"query": "select:oversized_probe"})
	var parsed toolSearchResult
	if result.IsError || json.Unmarshal([]byte(result.Content[0].Text), &parsed) != nil || len(parsed.Tools) != 1 {
		t.Fatal(result)
	}
	if !parsed.Tools[0].SchemaOmitted || parsed.Tools[0].Activated || !strings.Contains(parsed.Notice, "no tools were activated") {
		t.Fatalf("omitted selection claimed activation: %+v", parsed)
	}
	out, err := f.harness.Tools().Execute(t.Context(), harness.ToolRequest{Agent: f.allowed, Name: "oversized_probe", CallID: "omitted", Arguments: json.RawMessage(`{}`)})
	if err == nil && !out.Result.IsError || executions.Load() != 0 {
		t.Fatalf("omitted schema dispatched: %+v %v", out, err)
	}
}

func TestDeferredToolsDiskRecoveryAndAgentIsolation(t *testing.T) {
	search, loaded := []string{"ToolSearch"}, []string{"Read", "ToolSearch"}
	adapter, calls := deferredWireProvider(t, []deferredWireStep{{search, "ToolSearch", `{"query":"bounded UTF-8 text line numbers"}`}, {loaded, "Read", `{"file_path":"sample.txt"}`}, {loaded, "", ""}, {[]string{}, "", ""}, {loaded, "", ""}, {search, "", ""}, {search, "", ""}})
	f := newClaudeFixture(t, Options{DeferToolLoading: true}, adapter)
	if err := os.WriteFile(filepath.Join(f.root, "sample.txt"), []byte("sample evidence\n"), 0600); err != nil {
		t.Fatal(err)
	}
	auto := false
	agent, err := f.harness.Agents().Create(t.Context(), harness.AgentOptions{ID: "disk-agent", CWD: f.root, Provider: "fixture", Model: "text", Compaction: &harness.BasicCompactionConfig{ContextWindow: 65536, Auto: &auto}})
	if err != nil {
		t.Fatal(err)
	}
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	detach, err := disk.Attach(t.Context(), agent.Session())
	if err != nil {
		t.Fatal(err)
	}
	message := harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "read sample.txt"}}}
	if _, err := agent.Prompt(t.Context(), message); err != nil {
		t.Fatal(err)
	}
	compacted, err := agent.CompactNow(t.Context())
	if err != nil || compacted == nil {
		t.Fatalf("actual compaction did not complete: %+v %v", compacted, err)
	}
	seed, err := agent.Session().ForkCompleted("forked-agent", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.harness.Agents().Remove(t.Context(), agent.ID()); err != nil {
		t.Fatal(err)
	}
	if err := detach(); err != nil {
		t.Fatal(err)
	}
	fresh, err := harness.Boot(t.Context(), harness.Options{Adapter: adapter})
	if err != nil {
		t.Fatal(err)
	}
	app, err := Mount(t.Context(), fresh, Options{Workspace: f.root, ClaudeTools: true, DeferToolLoading: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { fresh.Dispose(context.Background()); fresh.Drain(context.Background()); app.Close() })
	restored, err := disk.Load(t.Context(), "disk-agent")
	if err != nil {
		t.Fatal(err)
	}
	resumed, err := fresh.Agents().Resume(t.Context(), restored, harness.AgentOptions{Provider: "fixture", Model: "text"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := resumed.Prompt(t.Context(), message); err != nil {
		t.Fatal(err)
	}
	forked, err := fresh.Agents().Resume(t.Context(), seed, harness.AgentOptions{Provider: "fixture", Model: "text"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := forked.Prompt(t.Context(), message); err != nil {
		t.Fatal(err)
	}
	if _, err := fresh.RegisterToolRestrictionAt(t.Context(), resumed, "deny-restored-read", harness.ToolRestriction{Deny: []string{"Read"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := resumed.Prompt(t.Context(), message); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 7 {
		t.Fatalf("provider calls=%d", calls.Load())
	}
}

func TestNativePromptContractUsesFinalRequest(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		deferLoading, discover bool
		deny, strip            bool
		preparedStrip          bool
		modalities             []string
	}{
		{"full-text", false, false, false, false, false, []string{"text"}},
		{"full-vision", false, false, false, false, false, []string{"text", "image"}},
		{"deferred-initial", true, false, false, false, false, []string{"text"}},
		{"deferred-activated", true, true, false, false, false, []string{"text"}},
		{"deferred-restricted", true, true, true, false, false, []string{"text"}},
		{"middleware-strip", true, true, false, true, false, []string{"text"}},
		{"preparation-strip", true, true, false, false, true, []string{"text"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var captured harness.GenerateRequest
			var lock sync.Mutex
			adapter := promptContractAdapter{modalities: tc.modalities, strip: tc.preparedStrip, generate: harness.AdapterFunc(func(_ context.Context, request harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				lock.Lock()
				captured = request
				lock.Unlock()
				return harness.Completion{Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "done"}}}, Finish: harness.FinishStop}, nil
			})}
			f := newClaudeFixture(t, Options{DeferToolLoading: tc.deferLoading, PDFRendererPath: "-"}, adapter)
			if tc.discover {
				result := f.call(t, f.allowed, "ToolSearch", map[string]any{"query": "bounded UTF-8 text line numbers"})
				if result.IsError {
					t.Fatal(result)
				}
			}
			if tc.deny {
				if _, err := f.harness.RegisterToolRestrictionAt(t.Context(), f.allowed, "deny-read", harness.ToolRestriction{Deny: []string{"Read"}}); err != nil {
					t.Fatal(err)
				}
			}
			if tc.strip {
				definition := point.Define(point.Descriptor{ID: "test/strip-tools"}, point.DecodeJSON[struct{}], func(run *point.Run, _ struct{}) (point.Dispose, error) {
					return f.harness.Hooks().Request.Use(run, func(ctx context.Context, request harness.GenerateRequest, next point.Next[harness.GenerateRequest]) (harness.GenerateRequest, error) {
						request.Tools = nil
						return next(request)
					})
				})
				instance, err := f.harness.Runtime().Mount(f.allowed.Scope(), "strip-tools", definition, nil)
				if err != nil {
					t.Fatal(err)
				}
				if err := instance.WaitStable(t.Context()); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := f.allowed.Prompt(t.Context(), harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "inspect available tools"}}}); err != nil {
				t.Fatal(err)
			}
			lock.Lock()
			request := captured
			lock.Unlock()
			read := harness.PromptCapabilities{Tools: request.Tools}.HasTool("Read")
			if read != (!tc.deny && !tc.strip && !tc.preparedStrip && (!tc.deferLoading || tc.discover)) {
				t.Fatal("incorrect final Read capability")
			}
			if strings.Contains(request.System, "Read relevant code") != read || strings.Contains(request.System, "Go/RE2") != (harness.PromptCapabilities{Tools: request.Tools}).HasTool("Grep") {
				t.Fatalf("guidance differs from final tools: %s", request.System)
			}
			if strings.Contains(request.System, "interactive PTY") || strings.Contains(request.System, "`PDFRead`") {
				t.Fatal("unmounted capability leaked into guidance")
			}
			vision := len(tc.modalities) == 2
			if strings.Contains(request.System, "This route does not declare image input") != (read && !vision) {
				t.Fatal("modality guidance differs from prepared model")
			}
		})
	}
}
