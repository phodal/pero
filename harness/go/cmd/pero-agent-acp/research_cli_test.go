//go:build linux || darwin

package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The explicit source opt-in runs the original selected skills and validator;
// the provider seam alone is a loopback fixture, never a paid model request.
func TestResearchCLIOriginalThreeStageWorkflowOptIn(t *testing.T) {
	source, python, knowledge := os.Getenv("PERO_RESEARCH_SOURCE"), os.Getenv("PERO_RESEARCH_PYTHON"), os.Getenv("PERO_KNOWLEDGE_SOURCE")
	if source == "" || python == "" || knowledge == "" {
		t.Skip("select inspected sources and isolated Python via PERO_RESEARCH_SOURCE, PERO_RESEARCH_PYTHON, PERO_KNOWLEDGE_SOURCE")
	}
	base, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	fixture := &researchWorkflowFixture{t: t, workspace: filepath.Join(base, "research workspace"), sessions: filepath.Join(base, "research sessions"), python: python, outlineFinished: make(chan struct{}), itemFinished: make(chan struct{})}
	for _, directory := range []string{fixture.workspace, fixture.sessions} {
		if err := os.Mkdir(directory, 0700); err != nil {
			t.Fatal(err)
		}
	}
	web := httptest.NewServer(http.HandlerFunc(fixture.web))
	defer web.Close()
	model := httptest.NewServer(http.HandlerFunc(fixture.model))
	defer model.Close()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 90*time.Second)
	defer cancel()
	child := exec.CommandContext(ctx, executable, "-test.run=^TestWebCLIProcess$")
	args, _ := json.Marshal([]string{"research-cli-fixture", "--endpoint", model.URL + "/v1", "--model", "fixture", "--plugin-model", "opus=fixture-research", "--session-dir", fixture.sessions, "--workspace", fixture.workspace, "--plugin-dir", knowledge, "--research-source", source, "--research-python", python, "--enable-shell", "--api-key-env", "PERO_RESEARCH_PRIMARY_KEY", "--web-provider", "deepseek-api", "--web-endpoint", web.URL + "/v1/tools", "--web-api-key-env", "PERO_RESEARCH_WEB_KEY", "--web-max-requests", "16", "--max-requests", "128", "--max-tokens", "4096", "--max-retries", "0"})
	child.Env = []string{"PATH=" + os.Getenv("PATH"), "HOME=" + base, "TMPDIR=" + base, "LANG=C.UTF-8", "PERO_WEB_TEST_CHILD=1", "PERO_WEB_TEST_ARGS=" + string(args), "PERO_RESEARCH_PRIMARY_KEY=research-model-fixture", "PERO_RESEARCH_WEB_KEY=research-web-fixture"}
	input, err := child.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := child.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var diagnostics bytes.Buffer
	child.Stderr = &diagnostics
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	waited := false
	defer func() {
		_ = input.Close()
		if !waited {
			_ = child.Process.Kill()
			_ = child.Wait()
		}
	}()
	encoder, scanner := json.NewEncoder(input), bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 4<<20)
	sequence, approvals, questions := 0, 0, 0
	sessionID := ""
	rpc := func(method string, params any) map[string]any {
		t.Helper()
		sequence++
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": sequence, "method": method, "params": params}); err != nil {
			t.Fatal(err)
		}
		for scanner.Scan() {
			var reply map[string]any
			if err := json.Unmarshal(scanner.Bytes(), &reply); err != nil {
				t.Fatal(err)
			}
			var response any
			switch reply["method"] {
			case "session/request_permission":
				approvals++
				if reply["params"].(map[string]any)["sessionId"] != sessionID {
					t.Error("child operation approval was not owned by the controlling root session")
				}
				response = map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": "allow-once"}}
			case "_pero/user_questions/ask":
				questions++
				params := reply["params"].(map[string]any)
				if params["sessionId"] != sessionID {
					t.Error("original research human gate moved into a child session")
				}
				answers := make([]map[string]any, len(params["questions"].([]any)))
				for index := range answers {
					answers[index] = map[string]any{"questionIndex": index, "selectedOptions": []int{0}}
				}
				response = map[string]any{"outcome": "answered", "answers": answers}
			}
			if response != nil {
				if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": reply["id"], "result": response}); err != nil {
					t.Fatal(err)
				}
			}
			if reply["id"] == float64(sequence) {
				if reply["error"] != nil {
					t.Fatalf("%s: %v", method, reply["error"])
				}
				return reply["result"].(map[string]any)
			}
		}
		_ = child.Process.Kill()
		_ = child.Wait()
		waited = true
		t.Fatalf("%s EOF: %v %s", method, scanner.Err(), diagnostics.String())
		return nil
	}
	initialized := rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{"_meta": map[string]int{"pero.userQuestions": 1}}})
	if initialized["agentCapabilities"].(map[string]any)["_meta"].(map[string]any)["pero.userQuestions"] != float64(1) {
		t.Fatal("research human gates were not negotiated")
	}
	sessionID = rpc("session/new", map[string]any{"cwd": fixture.workspace, "mcpServers": []any{}})["sessionId"].(string)
	rpc("session/set_config_option", map[string]any{"sessionId": sessionID, "configId": "permission", "value": "full-access"})
	if result := rpc("session/prompt", map[string]any{"sessionId": sessionID, "prompt": []any{map[string]any{"type": "text", "text": "Run the selected knowledge analysis through the original research workflow; preserve its human gates and real artifacts."}}}); result["stopReason"] != "end_turn" {
		t.Fatal(result)
	}
	rpc("session/close", map[string]any{"sessionId": sessionID})
	_ = input.Close()
	err = child.Wait()
	waited = true
	if err != nil {
		t.Fatalf("CLI cleanup: %v %s", err, diagnostics.String())
	}
	fixture.mu.Lock()
	searches, fetches, summaries := fixture.searches, fixture.fetches, fixture.summaries
	fixture.mu.Unlock()
	if questions != 6 || fixture.questions != 6 || searches != 10 || fetches != 2 || summaries != 2 || fixture.rootStage != 31 || fixture.outlineStage != 8 || fixture.itemStage != 13 {
		t.Fatalf("incomplete original workflow: questions=%d/%d search=%d fetch=%d extraction=%d stages=%d/%d/%d diagnostics=%s", questions, fixture.questions, searches, fetches, summaries, fixture.rootStage, fixture.outlineStage, fixture.itemStage, diagnostics.String())
	}
	report, err := os.ReadFile(fixture.file("research-fixture/report.md"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(fixture.rawDirectory(), "research/deep-research-raw.md"))
	if err != nil || !bytes.Equal(raw, report) || !bytes.Contains(raw, []byte("https://evidence.example/reference")) || bytes.Contains(raw, []byte(`"instructions"`)) {
		t.Fatal("the actual generated report was not preserved byte for byte as raw research")
	}
	for _, path := range []string{"research-fixture/outline.yaml", "research-fixture/fields.yaml", "research-fixture/results/research_fixture.json", "research-fixture/generate_report.py", "_knowledge-analysis/2026-11-02-research-fixture/context/task-card.md", "_knowledge-analysis/2026-11-02-research-fixture/research/source-ledger.md", "_knowledge-analysis/2026-11-02-research-fixture/reports/final-report.md", "_knowledge-analysis/2026-11-02-research-fixture/reports/executive-summary.md", "_knowledge-analysis/2026-11-02-research-fixture/meta/execution-log.md"} {
		data, err := os.ReadFile(fixture.file(path))
		if err != nil || len(data) == 0 {
			t.Fatalf("missing original or caller artifact %s: %v", path, err)
		}
	}
	state, err := os.ReadFile(filepath.Join(fixture.rawDirectory(), "meta/state.md"))
	if err != nil || !bytes.Contains(state, []byte("current_stage: completed")) {
		t.Fatal("knowledge analysis did not resume after receiving the real research report")
	}
	var journal strings.Builder
	if err := filepath.WalkDir(fixture.sessions, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() && strings.HasSuffix(path, ".jsonl") {
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			journal.Write(data)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, marker := range []string{"验证通过: 1/1", "OUTLINE_RESEARCH_FINISHED", "ITEM_RESEARCH_VALIDATED_FINISHED", "fixture-research"} {
		if !strings.Contains(journal.String(), marker) {
			t.Errorf("missing durable real execution receipt %s", marker)
		}
	}
	for _, credential := range []string{"research-model-fixture", "research-web-fixture"} {
		if strings.Contains(journal.String(), credential) || strings.Contains(diagnostics.String(), credential) {
			t.Error("provider credential leaked into journal or diagnostics")
		}
	}
	t.Logf("original research pipeline verified: human_gates=%d background_researchers=2 web_searches=%d web_fetches=%d isolated_extractions=%d approvals=%d raw_report_bytes=%d", questions, searches, fetches, summaries, approvals, len(raw))
}
