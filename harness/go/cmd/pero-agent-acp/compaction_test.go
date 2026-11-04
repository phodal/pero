package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"math"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/providers/openai"
)

type compactionSyntheticAdapter struct {
	harness.Adapter
	harness.ModelInfoResolver
}

func compactionLaunch(t *testing.T, args ...string) (openai.Config, *harness.BasicCompactionConfig) {
	t.Helper()
	f := flag.NewFlagSet("test", flag.ContinueOnError)
	c := bindCompaction(f)
	if err := f.Parse(args); err != nil {
		t.Fatal(err)
	}
	p, err := configuredProvider("https://unused.invalid/v1", "synthetic", "synthetic-not-a-credential", providerBudget{})
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := configuredCompaction(&p, *c)
	if err != nil {
		t.Fatal(err)
	}
	return p, cfg
}

func TestCompactionLaunchDefaultsAndValidation(t *testing.T) {
	p, c := compactionLaunch(t)
	if c != nil || p.Models[0].ContextWindow != 0 {
		t.Fatal("omission enabled compaction")
	}
	p, c = compactionLaunch(t, "--context-window=1024")
	if c == nil || c.MaxTokens != 128 || *c.HeadroomTokens != 128 || c.ThresholdRatio != .8 || *c.RetainRatio != .16 || p.Models[0].ContextWindow != 1024 {
		t.Fatalf("unexpected config: %+v", c)
	}
	_, c = compactionLaunch(t, "--context-window=1024", "--disable-compaction")
	if c != nil {
		t.Fatal("disable flag ignored")
	}
	for _, mutate := range []func(*compactionFlags, *openai.Config){
		func(c *compactionFlags, _ *openai.Config) { c.ContextWindow = -1 },
		func(c *compactionFlags, _ *openai.Config) { c.ContextWindow = 1<<30 + 1 },
		func(c *compactionFlags, _ *openai.Config) { c.ContextWindow = 1 },
		func(c *compactionFlags, _ *openai.Config) { c.Threshold = math.NaN() },
		func(c *compactionFlags, _ *openai.Config) { c.Threshold = math.Inf(1) },
		func(c *compactionFlags, _ *openai.Config) { c.Threshold = 0 },
		func(c *compactionFlags, _ *openai.Config) { c.Retain = .8 },
		func(c *compactionFlags, _ *openai.Config) { c.Retain = math.NaN() },
		func(c *compactionFlags, _ *openai.Config) { c.SummaryTokens = 1024 },
		func(c *compactionFlags, p *openai.Config) { p.Models[0].MaxTokens = 1024 },
		func(c *compactionFlags, p *openai.Config) { p.Models[0].MaxTokens = 900 },
	} {
		p, _ := compactionLaunch(t)
		c := compactionFlags{ContextWindow: 1024, Threshold: .8, Retain: .16}
		mutate(&c, &p)
		if _, err := configuredCompaction(&p, c); err == nil {
			t.Fatalf("accepted invalid config %+v", c)
		}
	}
	p, _ = compactionLaunch(t)
	p.MaxOutputTokens, p.Models[0].MaxTokens = 32, 32
	c, err := configuredCompaction(&p, compactionFlags{ContextWindow: 1024, Threshold: .8, Retain: .16})
	if err != nil || c.MaxTokens != 32 {
		t.Fatalf("output cap not inherited: %+v %v", c, err)
	}
}

func TestCompactionLaunchEngineLongContextOverflowCancelResume(t *testing.T) {
	for _, scenario := range []string{"pressure", "overflow", "overflow-bound", "empty-summary", "cancel", "nonshrinking"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			window := "1024"
			if scenario != "pressure" && scenario != "nonshrinking" {
				window = "32768"
			}
			p, cfg := compactionLaunch(t, "--context-window="+window)
			metadata, err := openai.New(p) // Constructs metadata only; never invokes HTTP.
			if err != nil {
				t.Fatal(err)
			}
			var summaries, normals atomic.Int32
			var checkedRejection atomic.Bool
			var overflow, block, alwaysOverflow, emptySummary atomic.Bool
			entered := make(chan struct{}, 1)
			adapter := harness.AdapterFunc(func(ctx context.Context, req harness.GenerateRequest, _ func(harness.StreamChunk) error) (harness.Completion, error) {
				text := "answer"
				if req.Purpose == "compaction" {
					summaries.Add(1)
					if req.MaxTokens != cfg.MaxTokens {
						t.Errorf("summary cap=%d", req.MaxTokens)
					}
					if block.Load() {
						entered <- struct{}{}
						<-ctx.Done()
						return harness.Completion{}, ctx.Err()
					}
					text = "checkpoint: preserve task state"
					if emptySummary.Load() {
						text = ""
					}
					if scenario == "nonshrinking" {
						text = strings.Repeat("nonshrinking ", 10000)
					}
				} else {
					normals.Add(1)
					if scenario == "nonshrinking" && summaries.Load() > 0 && !checkedRejection.Swap(true) {
						// The main request header can change the resolved policy
						// after PreStep. Establish this exact selection first.
						if _, err := req.Agent.CompactIfNeeded(ctx, harness.CompactionPressure); err != nil && !strings.Contains(err.Error(), "did not shrink") {
							t.Fatal(err)
						}
						before := summaries.Load()
						for i := 0; i < 2; i++ {
							if _, err := req.Agent.CompactIfNeeded(ctx, harness.CompactionPressure); err != nil {
								t.Fatal(err)
							}
						}
						if summaries.Load() != before {
							t.Fatal("unchanged nonshrinking selection consumed another pressure request")
						}
						if _, err := req.Agent.CompactIfNeeded(ctx, harness.CompactionContextOverflow); err == nil || summaries.Load() != before+1 {
							t.Fatal("pressure rejection suppressed real overflow recovery")
						}
					}
					if overflow.Swap(false) || alwaysOverflow.Load() {
						return harness.Completion{}, harness.NewProviderErrorWithFailure(harness.ProviderFailure{Code: harness.ContextWindowExceededCode, Message: "synthetic overflow"}, errors.New("synthetic overflow"))
					}
				}
				return harness.Completion{Finish: harness.FinishStop, Usage: &harness.TokenUsage{InputTokens: 4, OutputTokens: 2, TotalTokens: 6}, Message: harness.Message{Role: harness.RoleAssistant, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}}, nil
			})
			h, err := harness.Boot(ctx, harness.Options{Adapter: compactionSyntheticAdapter{adapter, metadata}, AdapterProviders: []string{"configured"}, ModelInfo: metadata})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = h.Dispose(context.Background()); _ = h.Drain(context.Background()) }()
			persistence, err := harness.NewJSONLSessionPersistence(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			opts := harness.AgentOptions{ID: "long-session", Provider: "configured", Model: "synthetic", Compaction: cfg}
			a, err := h.Agents().Create(ctx, opts)
			if err != nil {
				t.Fatal(err)
			}
			detach, err := persistence.Attach(ctx, a.Session())
			if err != nil {
				t.Fatal(err)
			}
			prompt := func(a *harness.Agent, text string) {
				t.Helper()
				if _, err := a.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: text}}}); err != nil {
					t.Fatal(err)
				}
			}
			for i := 0; i < 6; i++ {
				prompt(a, strings.Repeat("long context detail ", 100))
			}
			if scenario == "pressure" && summaries.Load() == 0 {
				_, e := a.CompactIfNeeded(ctx, harness.CompactionPressure)
				t.Fatalf("pressure hook never activated: err=%v", e)
			}
			if scenario == "nonshrinking" {
				if !checkedRejection.Load() || summaries.Load() < 3 {
					t.Fatal("changed selection was not retried after pressure rejection")
				}
				before := summaries.Load()
				if _, err := a.CompactNow(ctx); err == nil || summaries.Load() != before+1 {
					t.Fatal("pressure rejection suppressed explicit compaction")
				}
			}
			if scenario == "overflow" {
				before := normals.Load()
				overflow.Store(true)
				prompt(a, "continue after overflow")
				if summaries.Load() == 0 || normals.Load() != before+2 {
					t.Fatalf("overflow did not compact and retry: summary=%d calls=%d", summaries.Load(), normals.Load()-before)
				}
			}
			if scenario == "overflow-bound" || scenario == "empty-summary" {
				beforeCalls, beforeSummaries := normals.Load(), summaries.Load()
				alwaysOverflow.Store(true)
				if scenario == "empty-summary" {
					emptySummary.Store(true)
				}
				before := a.Session().SurfaceSeqs()
				_, err := a.Prompt(ctx, harness.Message{Role: harness.RoleUser, Content: []harness.ContentBlock{{Type: harness.BlockText, Text: "forced overflow"}}})
				if err == nil {
					t.Fatal("persistent overflow unexpectedly succeeded")
				}
				wantCalls := int32(2)
				if scenario == "empty-summary" {
					wantCalls = 1
				}
				if normals.Load()-beforeCalls != wantCalls || summaries.Load()-beforeSummaries != 1 {
					t.Fatalf("unbounded recovery: calls=%d summaries=%d", normals.Load()-beforeCalls, summaries.Load()-beforeSummaries)
				}
				if scenario == "empty-summary" {
					after := a.Session().SurfaceSeqs()
					if len(after) < len(before) || !reflect.DeepEqual(before, after[:len(before)]) {
						t.Fatal("empty summary shadowed history")
					}
				}
				alwaysOverflow.Store(false)
				emptySummary.Store(false)
				if scenario == "empty-summary" {
					if _, err := a.CompactNow(ctx); err != nil {
						t.Fatal(err)
					}
				}
			}
			if scenario == "cancel" {
				before := a.Session().SurfaceSeqs()
				block.Store(true)
				operation, stop := context.WithCancel(ctx)
				done := make(chan error, 1)
				go func() { _, err := a.CompactNow(operation); done <- err }()
				select {
				case <-entered:
				case <-ctx.Done():
					t.Fatal("compaction not entered")
				}
				stop()
				select {
				case err := <-done:
					if err == nil {
						t.Fatal("cancel accepted")
					}
				case <-ctx.Done():
					t.Fatal("cancel hung")
				}
				if !reflect.DeepEqual(before, a.Session().SurfaceSeqs()) {
					t.Fatal("cancel shadowed history")
				}
				block.Store(false)
				prompt(a, "continue after cancellation")
				if _, err := a.CompactNow(ctx); err != nil {
					t.Fatal(err)
				}
			}
			surface := a.Session().SurfaceSeqs()
			if err := h.Agents().RemoveExact(ctx, a); err != nil {
				t.Fatal(err)
			}
			if err := detach(); err != nil {
				t.Fatal(err)
			}
			restored, err := persistence.Load(ctx, "long-session")
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(surface, restored.SurfaceSeqs()) {
				t.Fatal("JSONL lost compacted surface")
			}
			a, err = h.Agents().Resume(ctx, restored, opts)
			if err != nil {
				t.Fatal(err)
			}
			detach, err = persistence.Attach(ctx, a.Session())
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = detach() }()
			prompt(a, "resume checkpoint")
			found := false
			var responseCount int32
			for _, event := range a.Session().Events() {
				if event.Type == "compaction/end" {
					found = true
				}
				if event.Type == "compaction/response" {
					var response struct {
						CompactionID string             `json:"compactionId"`
						Usage        harness.TokenUsage `json:"usage"`
					}
					if err := json.Unmarshal(event.Data, &response); err != nil || response.CompactionID == "" || response.Usage.TotalTokens != 6 {
						t.Fatalf("invalid durable compaction usage: %s err=%v", event.Data, err)
					}
					responseCount++
				}
			}
			if !found {
				t.Fatal("missing durable compaction bracket")
			}
			want := summaries.Load()
			if scenario == "cancel" {
				want-- // A cancelled provider request has no completed usage receipt.
			}
			if responseCount != want {
				t.Fatalf("durable compaction responses=%d want %d including rejected summaries", responseCount, want)
			}
		})
	}
}
