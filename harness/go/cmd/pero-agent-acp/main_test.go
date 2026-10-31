package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestCredentialCannotBeInheritedUnderCustomName(t *testing.T) {
	const name = "MY_CREDENTIAL"
	const dummy = "local-fixture-not-a-secret"
	t.Setenv(name, dummy)
	got, err := takeProviderCredential(name)
	if err != nil || got != dummy {
		t.Fatalf("credential read failed: %v", err)
	}
	if _, exists := os.LookupEnv(name); exists {
		t.Fatal("credential retained in process environment")
	}
	// This is the environment inherited by a default stdio MCP child.
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	child := exec.Command(exe, "-test.run=^TestCredentialChildProcess$")
	child.Env = append(os.Environ(), "AGENT_CREDENTIAL_CHILD_TEST=1")
	_, err = child.Output()
	if err != nil {
		t.Fatal(err)
	}

}

func TestCredentialChildProcess(t *testing.T) {
	if os.Getenv("AGENT_CREDENTIAL_CHILD_TEST") != "1" {
		return
	}
	if _, exists := os.LookupEnv("MY_CREDENTIAL"); exists {
		os.Exit(19)
	}
}

func TestProviderBudgetFlagsPreserveOmittedDefaults(t *testing.T) {
	flags := flag.NewFlagSet("test", flag.ContinueOnError)
	budget := bindProviderBudget(flags)
	if err := flags.Parse(nil); err != nil {
		t.Fatal(err)
	}
	config, err := configuredProvider("https://fixture.invalid/v1", "fixture", "fixture", *budget)
	if err != nil {
		t.Fatal(err)
	}
	if config.DisableThinking || config.UseEnvironmentProxy || config.MaxRequests != 0 || config.MaxOutputTokens != 0 || config.RetryPolicy != nil || config.Models[0].MaxTokens != 0 || config.Models[0].Reasoning != nil {
		t.Fatal("omitted flags changed provider defaults")
	}
}
func TestProviderBudgetFlagsHardCapsAndExplicitZeroRetry(t *testing.T) {
	flags := flag.NewFlagSet("test", flag.ContinueOnError)
	budget := bindProviderBudget(flags)
	if err := flags.Parse([]string{"--max-requests", "4", "--max-tokens", "512", "--max-retries", "0", "--reasoning-effort", "none"}); err != nil {
		t.Fatal(err)
	}
	config, err := configuredProvider("https://fixture.invalid/v1", "fixture", "fixture", *budget)
	if err != nil {
		t.Fatal(err)
	}
	if config.MaxRequests != 4 || config.MaxOutputTokens != 512 || config.Models[0].MaxTokens != 512 {
		t.Fatal("hard caps/default tokens not configured")
	}
	if config.RetryPolicy == nil || config.RetryPolicy.Mode != "normal" || config.RetryPolicy.MaxRetries == nil || *config.RetryPolicy.MaxRetries != 0 {
		t.Fatal("explicit zero retries lost")
	}
	reasoning := config.Models[0].Reasoning
	if reasoning == nil || reasoning.DefaultEffort != "none" || len(reasoning.Efforts) != 1 || reasoning.Efforts[0].ID != "none" || reasoning.Efforts[0].Name != "none" {
		t.Fatal("explicit reasoning effort not advertised/defaulted")
	}
}
func TestProviderBudgetRejectsInvalidValues(t *testing.T) {
	for _, budget := range []providerBudget{{MaxRequests: -1}, {MaxTokens: -1}, {MaxRetries: -2}, {ReasoningEffort: "none high"}} {
		if _, err := configuredProvider("https://fixture.invalid/v1", "fixture", "fixture", budget); err == nil {
			t.Fatalf("invalid budget accepted: %+v", budget)
		}
	}
}

func TestBudgetAgentProcess(t *testing.T) {
	if os.Getenv("PERO_BUDGET_TEST_CHILD") != "1" {
		return
	}
	flag.CommandLine = flag.NewFlagSet("agent-fixture", flag.ContinueOnError)
	os.Args = []string{"agent-fixture", "--endpoint", os.Getenv("PERO_BUDGET_TEST_ENDPOINT"), "--model", "fixture", "--session-dir", os.Getenv("PERO_BUDGET_TEST_SESSIONS"), "--max-requests", "4", "--max-tokens", "512", "--max-retries", "0", "--disable-thinking"}
	if audit := os.Getenv("PERO_BUDGET_TEST_AUDIT"); audit != "" {
		os.Args = append(os.Args, "--http-attempt-audit", audit)
	}
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	os.Exit(0)
}

func TestBudgetCLIActualLoopAndWire(t *testing.T) {
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts.Add(1)
		var request map[string]any
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		thinking, _ := request["thinking"].(map[string]any)
		if request["max_tokens"] != float64(512) || thinking["type"] != "disabled" || request["reasoning_effort"] != nil {
			t.Errorf("budget wire: max_tokens=%v thinking=%v reasoning_effort=%v", request["max_tokens"], thinking, request["reasoning_effort"])
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(500)
		_, _ = io.WriteString(w, `{"error":{"message":"local fixture","type":"server_error"}}`)
	}))
	defer server.Close()
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	audit := filepath.Join(t.TempDir(), "attempts")
	if err := os.WriteFile(audit, nil, 0600); err != nil {
		t.Fatal(err)
	}
	child := exec.CommandContext(ctx, exe, "-test.run=^TestBudgetAgentProcess$")
	child.Env = append(os.Environ(), "PERO_BUDGET_TEST_CHILD=1", "PERO_BUDGET_TEST_ENDPOINT="+server.URL+"/v1", "PERO_BUDGET_TEST_SESSIONS="+t.TempDir(), "PERO_BUDGET_TEST_AUDIT="+audit, "AGENT_PROVIDER_API_KEY=fixture-not-secret")
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
	if err = child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = input.Close(); _ = child.Process.Kill(); _ = child.Wait() })
	encoder := json.NewEncoder(input)
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 4096), 1<<20)
	next := 0
	rpc := func(method string, params any) map[string]any {
		t.Helper()
		next++
		id := next
		if err := encoder.Encode(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params}); err != nil {
			t.Fatal(err)
		}
		for scanner.Scan() {
			var message map[string]any
			if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
				t.Fatal(err)
			}
			if message["id"] == float64(id) {
				return message
			}
		}
		t.Fatalf("RPC %s EOF: %v %s", method, scanner.Err(), diagnostics.String())
		return nil
	}
	rpc("initialize", map[string]any{"protocolVersion": 1, "clientCapabilities": map[string]any{}})
	created := rpc("session/new", map[string]any{"cwd": t.TempDir(), "mcpServers": []any{}})
	result, ok := created["result"].(map[string]any)
	if !ok {
		t.Fatalf("session/new: %v", created)
	}
	session := result["sessionId"]
	for i := 0; i < 5; i++ {
		rpc("session/prompt", map[string]any{"sessionId": session, "prompt": []map[string]any{{"type": "text", "text": "local budget fixture"}}})
		want := i + 1
		if want > 4 {
			want = 4
		}
		if got := int(attempts.Load()); got != want {
			t.Fatalf("turn %d HTTP attempts=%d want=%d (retry/cap failure)", i, got, want)
		}
	}
	_ = input.Close()
	if err = child.Wait(); err != nil {
		t.Fatalf("child: %v %s", err, diagnostics.String())
	}
	data, err := os.ReadFile(audit)
	if err != nil || string(data) != "attempt\nattempt\nattempt\nattempt\n" {
		t.Fatalf("HTTP audit=%q error=%v", data, err)
	}
}

func TestEnvironmentProxyRequiresExplicitCLIOptIn(t *testing.T) {
	flags := flag.NewFlagSet("test", flag.ContinueOnError)
	settings := bindProviderBudget(flags)
	if err := flags.Parse([]string{"--use-env-proxy"}); err != nil {
		t.Fatal(err)
	}
	config, err := configuredProvider("https://fixture.invalid/v1", "fixture", "fixture", *settings)
	if err != nil {
		t.Fatal(err)
	}
	if !config.UseEnvironmentProxy {
		t.Fatal("explicit environment-proxy selection was not forwarded")
	}
}

func TestDisableThinkingRequiresExplicitCLIOptIn(t *testing.T) {
	flags := flag.NewFlagSet("test", flag.ContinueOnError)
	settings := bindProviderBudget(flags)
	if err := flags.Parse([]string{"--disable-thinking"}); err != nil {
		t.Fatal(err)
	}
	config, err := configuredProvider("https://fixture.invalid/v1", "fixture", "fixture", *settings)
	if err != nil {
		t.Fatal(err)
	}
	if !config.DisableThinking || config.Models[0].Reasoning != nil {
		t.Fatal("thinking disable flag must not invent a reasoning effort")
	}
}

func TestExplicitSkillRootFlags(t *testing.T) {
	flags := flag.NewFlagSet("skills", flag.ContinueOnError)
	roots := bindSkillRoots(flags)
	if err := flags.Parse(nil); err != nil || len(*roots) != 0 {
		t.Fatal("skills must default off")
	}
	if err := flags.Parse([]string{"--skills-root", "/fixture/one", "--skills-root", "/fixture/two"}); err != nil || len(*roots) != 2 {
		t.Fatalf("explicit roots: %v %v", *roots, err)
	}
	if err := flags.Parse([]string{"--skills-root="}); err == nil {
		t.Fatal("empty root accepted")
	}
	for len(*roots) < 8 {
		if err := flags.Set("skills-root", "/fixture/another"); err != nil {
			t.Fatal(err)
		}
	}
	if err := flags.Set("skills-root", "/fixture/overflow"); err == nil {
		t.Fatal("unbounded root flags")
	}
}
