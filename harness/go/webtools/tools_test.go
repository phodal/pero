package webtools

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
	point "github.com/phodal/pero/harness/go/runtime"
)

func TestWebToolsUseRealRegistryApprovalAndExtraction(t *testing.T) {
	var attempts, extractions, approvals atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		if r.URL.Path == "/search" {
			fmt.Fprint(w, searchResponse)
		} else {
			fmt.Fprint(w, `{"title":"Article","content":"前缀extraction-source"}`)
		}
	}))
	defer server.Close()
	provider, err := NewDeepSeek(DeepSeekOptions{Endpoint: server.URL, APIKey: "fixture-placeholder", MaxRequests: 2})
	if err != nil {
		t.Fatal(err)
	}
	h, err := harness.Boot(t.Context(), harness.Options{Adapter: harness.AdapterFunc(func(context.Context, harness.GenerateRequest, func(harness.StreamChunk) error) (harness.Completion, error) {
		t.Error("tools must not call the parent model")
		return harness.Completion{}, nil
	}), AdapterProviders: []string{"fixture"}})
	if err != nil {
		t.Fatal(err)
	}
	app, err := Mount(t.Context(), h, Options{Provider: provider, Extract: func(_ context.Context, parent *harness.Agent, input Extraction) (string, error) {
		extractions.Add(1)
		if parent.ID() != "web-tools" || input.Content != "extraction-source" || input.Prompt != "extract criteria" {
			t.Errorf("wrong extraction input: %+v", input)
		}
		return "verified extraction", nil
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()); _ = app.Close() }()
	parent, err := h.Agents().Create(t.Context(), harness.AgentOptions{ID: "web-tools", CWD: t.TempDir(), Provider: "fixture", Model: "scripted", Configure: func(_ context.Context, run *point.Run, _ *harness.Agent) error {
		_, err := h.Approvals().Register(run, func(context.Context, harness.ApprovalRequest) (harness.ApprovalOutcome, error) {
			approvals.Add(1)
			return harness.ApprovalAllowedOnce, nil
		})
		return err
	}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := parent.Session().Append("turn/start", struct {
		Turn int `json:"turn"`
	}{1}); err != nil {
		t.Fatal(err)
	}
	if err := h.Approvals().SetPolicy(parent, harness.ApprovalNever); err != nil {
		t.Fatal(err)
	}
	request := harness.ToolRequest{Agent: parent, CallID: "denied", Name: "WebSearch", Arguments: json.RawMessage(`{"query":"criteria"}`)}
	out, err := h.Tools().Execute(t.Context(), request)
	if err != nil || !out.Result.IsError || attempts.Load() != 0 {
		t.Fatalf("denial reached provider: %+v %v", out.Result, err)
	}
	if err := h.Approvals().SetPolicy(parent, harness.ApprovalAsk); err != nil {
		t.Fatal(err)
	}
	request.CallID = "search"
	request.Arguments = json.RawMessage(`{"query":"criteria","allowed_domains":["example.com"]}`)
	out, err = h.Tools().Execute(t.Context(), request)
	if err != nil || out.Result.IsError || !strings.Contains(out.Result.Content[0].Text, "[Verified source](https://docs.example.com/a)") || strings.Contains(out.Result.Content[0].Text, "excluded summary") {
		t.Fatalf("%+v %v", out.Result, err)
	}
	request.CallID = "fetch"
	request.Name = "WebFetch"
	request.Arguments = json.RawMessage(`{"url":"http://example.com/article","prompt":"extract criteria","offset":2}`)
	out, err = h.Tools().Execute(t.Context(), request)
	if err != nil || out.Result.IsError || !strings.Contains(out.Result.Content[0].Text, "verified extraction") || strings.Contains(out.Result.Content[0].Text, "extraction-source") {
		t.Fatalf("%+v %v", out.Result, err)
	}
	if attempts.Load() != 2 || extractions.Load() != 1 || approvals.Load() != 2 {
		t.Fatalf("attempts=%d extraction=%d approvals=%d", attempts.Load(), extractions.Load(), approvals.Load())
	}
}
