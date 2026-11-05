package nativetools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/llm"
	"github.com/phodal/pero/harness/go/providers/openai"
	point "github.com/phodal/pero/harness/go/runtime"
)

// This is an explicit external-provider experiment, excluded from ordinary CI.
// Both variants execute the same native loop/tools on fresh synthetic data.
func TestNativeGuidanceModelEvaluationOptIn(t *testing.T) {
	if os.Getenv("PERO_GUIDANCE_EVAL") != "1" {
		t.Skip("set PERO_GUIDANCE_EVAL=1 and explicit PERO_EVAL_ENDPOINT, PERO_EVAL_MODEL, PERO_EVAL_API_KEY")
	}
	endpoint, model, key := os.Getenv("PERO_EVAL_ENDPOINT"), os.Getenv("PERO_EVAL_MODEL"), os.Getenv("PERO_EVAL_API_KEY")
	if endpoint == "" || model == "" || key == "" {
		t.Fatal("evaluation requires an explicit endpoint, model and credential")
	}
	zero := 0
	adapter, err := openai.New(openai.Config{Endpoint: endpoint, APIKey: key, ProviderName: "evaluation", DisableThinking: true, MaxRequests: 24, MaxOutputTokens: 1024, StreamIdleTimeoutMS: 45000, RetryPolicy: &llm.RetryPolicyConfig{Mode: llm.RetryNormal, MaxRetries: &zero}, Models: []openai.ModelConfig{{ID: model, InputModalities: []string{"text"}, ContextWindow: 65536, MaxTokens: 1024}}})
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name, prompt string
		files        map[string]string
		want         map[string]any
	}{
		{"regex", "Find lines in data/ matching ^item-[0-9]+:[0-9]+$ and sum their numeric values. Save report.json containing only a JSON object with total. Preserve other files. Use available file tools; no shell is available.", map[string]string{"data/a.txt": "item-1:11\nignore:80\n", "data/b.txt": "item-2:31\nitem-x:900\n", "untouched.txt": "preserve-me\n"}, map[string]any{"total": float64(42)}},
		{"notebook", "Read the saved notebook.ipynb without executing code. Save report.json with keys cell and count for its code cell, copying the saved cell ID and execution_count. Preserve the notebook.", map[string]string{"notebook.ipynb": `{"nbformat":4,"nbformat_minor":5,"metadata":{},"cells":[{"id":"intro","cell_type":"markdown","source":["# example"],"metadata":{}},{"id":"calc","cell_type":"code","source":["print(42)"],"execution_count":7,"outputs":[{"output_type":"stream","name":"stdout","text":["42\n"]}],"metadata":{}}]}`}, map[string]any{"cell": "calc", "count": float64(7)}},
	}
	for _, sample := range cases {
		for _, guidance := range []bool{false, true} {
			variant := "without-native-guidance"
			if guidance {
				variant = "with-native-guidance"
			}
			t.Run(sample.name+"/"+variant, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(t.Context(), 120*time.Second)
				defer cancel()
				root := t.TempDir()
				for name, text := range sample.files {
					path := filepath.Join(root, name)
					if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
						t.Fatal(err)
					}
					if err := os.WriteFile(path, []byte(text), 0600); err != nil {
						t.Fatal(err)
					}
				}
				calls, inputTokens, outputTokens := 0, 0, 0
				wrapped := harness.AdapterFunc(func(ctx context.Context, request harness.GenerateRequest, stream func(harness.StreamChunk) error) (harness.Completion, error) {
					if !guidance {
						request.System = strings.Replace(request.System, nativeGuidance(harness.PromptCapabilities{Tools: request.Tools, Model: harness.ModelInfo{InputModalities: []string{"text"}}}), "", 1)
					}
					calls++
					result, err := adapter.Generate(ctx, request, stream)
					if result.Usage != nil {
						inputTokens += result.Usage.InputTokens
						outputTokens += result.Usage.OutputTokens
					}
					return result, err
				})
				h, err := harness.Boot(ctx, harness.Options{Adapter: wrapped, ModelInfo: adapter, ApprovalPolicy: harness.ApprovalAsk})
				if err != nil {
					t.Fatal(err)
				}
				app, err := Mount(ctx, h, Options{Workspace: root, ClaudeTools: true, PDFRendererPath: "-"})
				if err != nil {
					h.Dispose(context.Background())
					h.Drain(context.Background())
					t.Fatal(err)
				}
				defer func() { h.Dispose(context.Background()); h.Drain(context.Background()); app.Close() }()
				agent, err := h.Agents().Create(ctx, harness.AgentOptions{CWD: root, Provider: "evaluation", Model: model, MaxSteps: 6, MaxTokens: 1024, Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
					_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
						return harness.ApprovalAllowedOnce, nil
					})
					return err
				}})
				if err != nil {
					t.Fatal(err)
				}
				started := time.Now()
				_, runErr := agent.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: sample.prompt}}})
				toolCalls, toolErrors := 0, 0
				for _, event := range agent.Session().Events() {
					if event.Type == "tool/call" {
						toolCalls++
					}
					if event.Type == "tool/result" {
						var result harness.ContentBlock
						if json.Unmarshal(event.Data, &result) == nil && result.IsError {
							toolErrors++
						}
					}
				}
				data, readErr := os.ReadFile(filepath.Join(root, "report.json"))
				var report map[string]any
				passed := runErr == nil && readErr == nil && json.Unmarshal(data, &report) == nil && reflect.DeepEqual(report, sample.want)
				for name, want := range sample.files {
					data, err := os.ReadFile(filepath.Join(root, name))
					passed = passed && err == nil && string(data) == want
				}
				metrics, _ := json.Marshal(map[string]any{"task": sample.name, "variant": variant, "model": model, "passed": passed, "requests": calls, "tool_calls": toolCalls, "tool_errors": toolErrors, "input_tokens": inputTokens, "output_tokens": outputTokens, "duration_ms": time.Since(started).Milliseconds()})
				t.Logf("GUIDANCE_EVALUATION %s", metrics)
				if !passed {
					t.Errorf("independent artifact validation failed (provider error=%v, report available=%t)", runErr, readErr == nil)
				}
			})
		}
	}
}
