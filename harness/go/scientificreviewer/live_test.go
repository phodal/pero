package scientificreviewer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/llm"
	"github.com/phodal/pero/harness/go/nativetools"
	"github.com/phodal/pero/harness/go/providers/openai"
	point "github.com/phodal/pero/harness/go/runtime"
	"github.com/phodal/pero/harness/go/scientificreview"
)

// This smoke uses a real model to review an intentionally false answer against
// a real local arithmetic result. It does not establish scientific validation,
// human acceptance, or a model's reliability on other research questions.
func TestScientificReviewerLive(t *testing.T) {
	if os.Getenv("DEEPSEEK_REAL_API") != "1" {
		t.Skip("set DEEPSEEK_REAL_API=1 to spend at most four DeepSeek requests")
	}
	key := os.Getenv("DEEPSEEK_API_KEY")
	if strings.TrimSpace(key) == "" {
		t.Skip("DEEPSEEK_API_KEY is not explicitly configured; no credential files are read")
	}
	if runtime.GOOS != "darwin" && runtime.GOOS != "linux" {
		t.Skip("the local arithmetic evidence command requires a Unix shell")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 110*time.Second)
	defer cancel()
	zero := 0
	var attempts atomic.Int64
	adapter, err := openai.New(openai.Config{
		Endpoint: "https://api.deepseek.com/v1", APIKey: key, ProviderName: "deepseek",
		Models:          []openai.ModelConfig{{ID: "deepseek-flash", ContextWindow: 128000, MaxTokens: 4096}},
		DisableThinking: true, UseEnvironmentProxy: true, MaxRequests: 4, MaxOutputTokens: 4096,
		RequestTimeoutMS: 80000, StreamIdleTimeoutMS: 30000,
		RetryPolicy:       &llm.RetryPolicyConfig{Mode: llm.RetryNormal, MaxRetries: &zero},
		BeforeHTTPAttempt: func() error { attempts.Add(1); return nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter, ModelInfo: adapter, AdapterProviders: []string{"deepseek"}, ApprovalPolicy: harness.ApprovalAsk})
	if err != nil {
		t.Fatal(err)
	}
	var native *nativetools.App
	defer func() {
		_ = h.Dispose(context.Background())
		_ = h.Drain(context.Background())
		if native != nil {
			_ = native.Close()
		}
	}()
	workspace := t.TempDir()
	native, err = nativetools.Mount(ctx, h, nativetools.Options{Workspace: workspace, EnableShell: true, Shell: "/bin/bash", PDFRendererPath: "-"})
	if err != nil {
		t.Fatal(err)
	}
	disk, err := harness.NewJSONLSessionPersistence(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app, err := Mount(ctx, h, disk)
	if err != nil {
		t.Fatal(err)
	}
	agent, err := h.Agents().Create(ctx, harness.AgentOptions{ID: "scientific-review-live", CWD: workspace, Provider: "deepseek", Model: "deepseek-flash", MaxSteps: 4, MaxTokens: 4096,
		Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
			_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
				return harness.ApprovalAllowedOnce, nil
			})
			return err
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := agent.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	command := "mean=$(( (1 + 2 + 3) / 3 ))\nprintf '{\"mean\":%s,\"samples\":[1,2,3]}\\n' \"$mean\" > results.json\ncat results.json"
	arguments, _ := json.Marshal(struct {
		Command string `json:"command"`
	}{command})
	request := harness.ToolRequest{Agent: agent, Name: "shell", CallID: "local-arithmetic", Arguments: arguments}
	// The live smoke dispatches the existing native tool directly. Its caller
	// journals the exact invocation and returned outcome, as Agent's tool batch
	// owner does; neither the execution nor its output is a scripted fixture.
	if _, err := agent.Session().Append("tool/call", struct {
		Turn      int                `json:"turn"`
		Step      int                `json:"step"`
		CallID    harness.ToolCallID `json:"callId"`
		Name      string             `json:"name"`
		Arguments json.RawMessage    `json:"arguments"`
	}{1, 1, request.CallID, request.Name, request.Arguments}); err != nil {
		t.Fatal(err)
	}
	outcome, err := h.Tools().Execute(ctx, request)
	if err != nil || outcome.Result.IsError {
		t.Fatalf("local evidence command failed: err=%v result=%+v", err, outcome.Result)
	}
	resultEvent, err := agent.Session().Append("tool/result", harness.ContentBlock{
		Type: harness.BlockToolResult, ToolCallID: request.CallID,
		Content: outcome.Result.Content, IsError: outcome.Result.IsError, Meta: outcome.Result.Meta,
	})
	if err != nil {
		t.Fatal(err)
	}
	resultBytes, err := os.ReadFile(filepath.Join(workspace, "results.json"))
	if err != nil || string(resultBytes) != "{\"mean\":2,\"samples\":[1,2,3]}\n" {
		t.Fatalf("actual saved arithmetic result=%q err=%v", resultBytes, err)
	}
	resultID := fmt.Sprintf("event:%d", resultEvent.Seq)
	const answer = "I executed the calculation; the saved mean is 9."
	if _, err := agent.Session().Append("assistant/message", struct {
		Message harness.Message `json:"message"`
	}{harness.Message{ID: "intentionally-wrong-answer", Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: answer}}}}); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Command(ctx, agent, "/review"); err != nil {
		t.Fatal(err)
	}
	reports, err := readReports(agent)
	if err != nil || len(reports) != 1 {
		t.Fatalf("retained reports=%d err=%v", len(reports), err)
	}
	report := reports[0]
	// Persist only the frozen review packet and nonsecret request metadata. The
	// provider key, HTTP headers and process environment never enter this file.
	record := struct {
		Warning      string                  `json:"warning"`
		Provider     string                  `json:"provider"`
		Model        string                  `json:"model"`
		HTTPAttempts int64                   `json:"httpAttempts"`
		Report       scientificreview.Report `json:"report"`
	}{"Real-model evidence consistency only; the assistant answer is deliberately false. The local result was actually executed. No scientific validation or human acceptance.", "deepseek", "deepseek-flash", attempts.Load(), report}
	encoded, _ := json.MarshalIndent(record, "", "  ")
	reportPath := os.Getenv("PERO_REVIEW_LIVE_REPORT")
	if reportPath == "" {
		reportPath = filepath.Join(t.TempDir(), "scientific-review-live.json")
	}
	if !filepath.IsAbs(reportPath) {
		t.Fatal("PERO_REVIEW_LIVE_REPORT must be absolute")
	}
	if err := os.MkdirAll(filepath.Dir(reportPath), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(reportPath, append(encoded, '\n'), 0600); err != nil {
		t.Fatal(err)
	}
	t.Logf("Sanitized live review: %s; HTTP attempts: %d", reportPath, attempts.Load())
	t.Log(report.Markdown())
	if report.Status != "completed" || report.Assessment != "model_review" {
		t.Fatalf("real reviewer did not complete: %s", report.Diagnostic)
	}
	anchored := false
	for _, finding := range report.Findings {
		if finding.Category != scientificreview.NumericConflict || finding.MessageID != "intentionally-wrong-answer" || !strings.Contains(answer, finding.Quote) {
			continue
		}
		for _, evidenceID := range finding.EvidenceIDs {
			if evidenceID == resultID {
				anchored = true
			}
		}
	}
	if !anchored {
		t.Fatal("real reviewer did not anchor the intentional numeric contradiction to the actual command result")
	}
}
