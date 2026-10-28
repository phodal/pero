//go:build linux

package acp

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Real interoperability: these tests start the actual Engram binary through the
// same policy entry the Rust runtime emits (tests/fixtures/engram-memory). They
// use synthetic data only, no model, and no network. They run only when
// PERO_ENGRAM_BIN names an absolute path to an Engram binary (baseline v1.20.0,
// commit ba9e46ced152c37a7cb9e576153c41995873e2fc); otherwise they skip and say so.

const synthProject = "synthetic-project"

func engramBinary(t *testing.T) string {
	t.Helper()
	bin := os.Getenv("PERO_ENGRAM_BIN")
	if bin == "" {
		t.Skip("PERO_ENGRAM_BIN not set: real Engram interoperability was NOT run")
	}
	if info, err := os.Stat(bin); err != nil || !filepath.IsAbs(bin) || info.IsDir() {
		t.Fatalf("PERO_ENGRAM_BIN must be an absolute path to a file: %v", err)
	}
	return bin
}

// engramEntry is the entry the Rust runtime emits for approve mode, with the
// golden file's placeholders filled in.
func engramEntry(t *testing.T, bin, dataDir string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile("../../../tests/fixtures/engram-memory/mcp-server.json")
	if err != nil {
		t.Fatal(err)
	}
	text := strings.NewReplacer("{{ENGRAM_BIN}}", bin, "{{DATA_DIR}}", dataDir, "{{PROJECT}}", synthProject).Replace(string(raw))
	var entry map[string]any
	if err := json.Unmarshal([]byte(text), &entry); err != nil {
		t.Fatal(err)
	}
	return entry
}

func entryEnv(entry map[string]any, name string) (string, bool) {
	for _, pair := range entry["env"].([]any) {
		if pair.(map[string]any)["name"] == name {
			return pair.(map[string]any)["value"].(string), true
		}
	}
	return "", false
}

// engramProcesses lists live Engram processes that were given dataDir.
func engramProcesses(dataDir string) []int {
	var pids []int
	entries, _ := filepath.Glob("/proc/[0-9]*/environ")
	for _, path := range entries {
		data, err := os.ReadFile(path)
		if err == nil && strings.Contains("\x00"+string(data), "\x00ENGRAM_DATA_DIR="+dataDir+"\x00") {
			if pid, err := strconv.Atoi(strings.Split(path, "/")[2]); err == nil {
				pids = append(pids, pid)
			}
		}
	}
	return pids
}

// engramStats reads the store through a separate admin-only Engram process the
// test owns; it is never reachable by the model.
func engramStats(t *testing.T, bin, dataDir string) string {
	t.Helper()
	command := exec.Command(bin, "mcp", "--tools=mem_stats")
	command.Env = []string{"HOME=" + dataDir, "ENGRAM_DATA_DIR=" + dataDir, "ENGRAM_PROJECT=" + synthProject, "ENGRAM_CLOUD_AUTOSYNC=0"}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, &mcp.CommandTransport{Command: command}, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "mem_stats", Arguments: map[string]any{}})
	if err != nil || len(result.Content) == 0 {
		t.Fatalf("mem_stats: %v", err)
	}
	return result.Content[0].(*mcp.TextContent).Text
}

var searchID = regexp.MustCompile(`"results":\[\{"id":(\d+)`)

func saveStep(title, content string) scriptStep {
	arguments, _ := json.Marshal(map[string]any{"title": title, "content": content, "type": "manual"})
	return scriptStep{Tool: "mcp__engram__mem_save", Arguments: string(arguments)}
}

func searchSteps(query string) []scriptStep {
	arguments, _ := json.Marshal(map[string]any{"query": query})
	return []scriptStep{
		{Tool: "mcp__engram__mem_search", Arguments: string(arguments)},
		{Tool: "mcp__engram__mem_get_observation", Build: func(results []string) string {
			if m := searchID.FindStringSubmatch(results[len(results)-1]); m != nil {
				return `{"id":` + m[1] + `}`
			}
			return `{"id":0}`
		}},
	}
}

// remember runs one session that saves value with approval, then closes it.
func remember(t *testing.T, w *wire, provider *scriptedProvider, entry map[string]any, value string) {
	t.Helper()
	w.permit = func(map[string]any) map[string]any { return outcomeAllow }
	provider.reset(saveStep("Synthetic note", "The synthetic marker is "+value), scriptStep{})
	session, rpcError := w.newSession(t.TempDir(), entry)
	if rpcError != nil {
		t.Fatal(rpcError)
	}
	w.prompt(session, "remember this")
	if _, results, _ := provider.snapshot(); len(results) == 0 || !strings.Contains(results[len(results)-1], "Memory saved") {
		t.Fatalf("save did not succeed: %v", results)
	}
	w.closeSession(session)
}

// recall runs a fresh session and reports whether search+read surfaced value.
func recall(t *testing.T, w *wire, provider *scriptedProvider, entry map[string]any, value string) (found bool, firstPrompt string) {
	t.Helper()
	provider.reset(append(searchSteps(value), scriptStep{})...)
	session, rpcError := w.newSession(t.TempDir(), entry)
	if rpcError != nil {
		t.Fatal(rpcError)
	}
	w.prompt(session, "what do you remember?")
	_, results, first := provider.snapshot()
	w.closeSession(session)
	return len(results) >= 2 && strings.Contains(results[len(results)-1], value), first
}

func TestEngramMemoryPersistsAcrossSessionsAndProcessRestart(t *testing.T) {
	bin := engramBinary(t)
	dataDir := t.TempDir()
	entry := engramEntry(t, bin, dataDir)
	const value = "zebra-quartz-4417"

	provider := &scriptedProvider{}
	w := startWire(t, bootScripted(t, provider))
	remember(t, w, provider, entry, value)
	waitUntil(t, "session A's Engram process to exit", func() bool { return len(engramProcesses(dataDir)) == 0 })

	found, first := recall(t, w, provider, entry, value)
	if strings.Contains(first, value) {
		t.Fatal("session B started with the value in its history")
	}
	if !found {
		t.Fatal("fresh session B could not search and read what session A saved")
	}
	if found, _ := recall(t, w, provider, entry, "never-saved-5555"); found {
		t.Fatal("recall reported a value that was never saved")
	}
	waitUntil(t, "session B's Engram process to exit", func() bool { return len(engramProcesses(dataDir)) == 0 })

	// A new harness, new wire and new Engram process: nothing in memory survives
	// except what Engram persisted.
	provider2 := &scriptedProvider{}
	w2 := startWire(t, bootScripted(t, provider2))
	if found, _ := recall(t, w2, provider2, entry, value); !found {
		t.Fatal("memory did not survive an MCP process restart")
	}
	waitUntil(t, "the restarted Engram process to exit", func() bool { return len(engramProcesses(dataDir)) == 0 })
}

func TestEngramDataDirectoriesDoNotShareObservations(t *testing.T) {
	bin := engramBinary(t)
	dirA, dirB := t.TempDir(), t.TempDir()
	const value = "otter-basalt-9082"
	provider := &scriptedProvider{}
	w := startWire(t, bootScripted(t, provider))
	remember(t, w, provider, engramEntry(t, bin, dirA), value)
	if found, _ := recall(t, w, provider, engramEntry(t, bin, dirA), value); !found {
		t.Fatal("the writing data directory lost its own observation")
	}
	if found, _ := recall(t, w, provider, engramEntry(t, bin, dirB), value); found {
		t.Fatal("a different data directory returned the observation")
	}
	if stats := engramStats(t, bin, dirB); !strings.Contains(stats, "Observations: 0") {
		t.Fatalf("data directory B is not empty: %s", stats)
	}
}

func TestEngramToolSurfaceAndArgumentPolicy(t *testing.T) {
	bin := engramBinary(t)
	dataDir := t.TempDir()
	provider := &scriptedProvider{}
	w := startWire(t, bootScripted(t, provider))
	entry := engramEntry(t, bin, dataDir)
	w.permit = func(map[string]any) map[string]any { return outcomeAllow }
	call := func(tool, arguments string) string {
		provider.reset(scriptStep{Tool: tool, Arguments: arguments}, scriptStep{})
		session, rpcError := w.newSession(t.TempDir(), entry)
		if rpcError != nil {
			t.Fatal(rpcError)
		}
		w.prompt(session, "go")
		w.closeSession(session)
		_, results, _ := provider.snapshot()
		return strings.Join(results, "\n")
	}
	for _, test := range []struct{ name, tool, arguments, want string }{
		{"prompt capture cannot be switched on", "mcp__engram__mem_save", `{"title":"t","content":"c","capture_prompt":true}`, `"capture_prompt" must be false`},
		{"search cannot span projects", "mcp__engram__mem_search", `{"query":"c","all_projects":true}`, `"all_projects" is not permitted`},
		{"search cannot pick a project", "mcp__engram__mem_search", `{"query":"c","project":"other"}`, `"project" is not permitted`},
		{"save cannot pick a project", "mcp__engram__mem_save", `{"title":"t","content":"c","project":"other"}`, `"project" is not permitted`},
		{"save cannot join another session", "mcp__engram__mem_save", `{"title":"t","content":"c","session_id":"s"}`, `"session_id" is not permitted`},
		{"an Engram error reaches the model unchanged", "mcp__engram__mem_save", `{"title":"t"}`, "content is required for mem_save"},
		{"prompt saving is not a tool", "mcp__engram__mem_save_prompt", `{"content":"private prompt"}`, "unknown tool"},
		{"passive capture is not a tool", "mcp__engram__mem_capture_passive", `{"content":"anything"}`, "unknown tool"},
		{"deletion is not a tool", "mcp__engram__mem_delete", `{"id":1}`, "unknown tool"},
	} {
		if got := call(test.tool, test.arguments); !strings.Contains(got, test.want) {
			t.Errorf("%s: model read %q, want %q", test.name, got, test.want)
		}
	}
	offered, _, _ := provider.snapshot()
	var engramTools []string
	for _, name := range offered {
		if strings.HasPrefix(name, "mcp__engram__") {
			engramTools = append(engramTools, strings.TrimPrefix(name, "mcp__engram__"))
		}
	}
	if len(engramTools) != 5 || contains(engramTools, "mem_save_prompt") || contains(engramTools, "mem_delete") {
		t.Errorf("model was offered %v", engramTools)
	}
	// A save through the allowed path never records a prompt, even though the
	// server's own default is to capture one.
	if got := call("mcp__engram__mem_save", `{"title":"t","content":"allowed"}`); !strings.Contains(got, "Memory saved") {
		t.Fatalf("allowed save failed: %s", got)
	}
	stats := engramStats(t, bin, dataDir)
	if !strings.Contains(stats, "Observations: 1") || !strings.Contains(stats, "Prompts: 0") {
		t.Errorf("unexpected store contents: %s", stats)
	}
}

func TestEngramMutationNeedsApprovalAndDenialWritesNothing(t *testing.T) {
	bin := engramBinary(t)
	dataDir := t.TempDir()
	provider := &scriptedProvider{}
	w := startWire(t, bootScripted(t, provider))
	entry := engramEntry(t, bin, dataDir)
	for _, outcome := range []map[string]any{outcomeReject, {"outcome": "cancelled"}} {
		w.permit = func(map[string]any) map[string]any { return outcome }
		provider.reset(saveStep("t", "denied write"), scriptStep{})
		session, rpcError := w.newSession(t.TempDir(), entry)
		if rpcError != nil {
			t.Fatal(rpcError)
		}
		w.prompt(session, "write")
		w.closeSession(session)
	}
	if w.permissions != 2 {
		t.Errorf("approval requests=%d, want 2", w.permissions)
	}
	if stats := engramStats(t, bin, dataDir); !strings.Contains(stats, "Observations: 0") {
		t.Errorf("a denied write reached Engram: %s", stats)
	}
}

func TestEngramCloudSyncAndInheritedCredentialsStayOff(t *testing.T) {
	bin := engramBinary(t)
	dataDir := t.TempDir()
	// Decoys in the parent: the ACP server runs in this process.
	t.Setenv("ENGRAM_CLOUD_AUTOSYNC", "1")
	t.Setenv("ENGRAM_CLOUD_SERVER", "http://127.0.0.1:9")
	t.Setenv("ENGRAM_CLOUD_TOKEN", "decoy-cloud-token")
	t.Setenv("ENGRAM_JWT_SECRET", "decoy-jwt")
	t.Setenv("UNRELATED_SERVICE_PASSWORD", "decoy-password")
	provider := &scriptedProvider{}
	w := startWire(t, bootScripted(t, provider))
	entry := engramEntry(t, bin, dataDir)
	session, rpcError := w.newSession(t.TempDir(), entry)
	if rpcError != nil {
		t.Fatal(rpcError)
	}
	var environment string
	waitUntil(t, "the Engram child", func() bool {
		for _, pid := range engramProcesses(dataDir) {
			data, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/environ")
			environment = string(data)
			return err == nil
		}
		return false
	})
	w.closeSession(session)
	values := map[string]string{}
	for _, line := range strings.Split(environment, "\x00") {
		if name, value, ok := strings.Cut(line, "="); ok {
			values[name] = value
		}
	}
	if values["ENGRAM_CLOUD_AUTOSYNC"] != "0" || values["ENGRAM_CLOUD_TOKEN"] != "" || values["ENGRAM_CLOUD_SERVER"] != "" {
		t.Errorf("cloud configuration reached the child: %v", values)
	}
	for _, name := range []string{"ENGRAM_JWT_SECRET", "UNRELATED_SERVICE_PASSWORD", "PATH"} {
		if _, inherited := values[name]; inherited {
			t.Errorf("child inherited %s", name)
		}
	}
	// Run Engram directly with exactly the entry's environment and watch its log:
	// it announces autosync only when enabled. The control proves the probe works.
	for _, test := range []struct {
		name     string
		override map[string]string
		started  bool
	}{{"as configured", nil, false}, {"control: autosync enabled", map[string]string{"ENGRAM_CLOUD_AUTOSYNC": "1", "ENGRAM_CLOUD_SERVER": "http://127.0.0.1:9", "ENGRAM_CLOUD_TOKEN": "decoy"}, true}} {
		command := exec.Command(bin, "mcp", "--tools=mem_search")
		command.Env = nil
		for _, pair := range entry["env"].([]any) {
			name, value := pair.(map[string]any)["name"].(string), pair.(map[string]any)["value"].(string)
			if override, ok := test.override[name]; ok {
				value = override
			}
			command.Env = append(command.Env, name+"="+value)
		}
		stdin, _ := command.StdinPipe()
		var log strings.Builder
		command.Stderr = &log
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		time.Sleep(1500 * time.Millisecond)
		_ = stdin.Close()
		_ = command.Wait()
		if started := strings.Contains(log.String(), "[autosync] started"); started != test.started {
			t.Errorf("%s: autosync started=%v log=%q", test.name, started, log.String())
		}
	}
}

func TestEngramCancelWhileApprovalIsPendingWritesNothingAndChildExits(t *testing.T) {
	bin := engramBinary(t)
	dataDir := t.TempDir()
	provider := &scriptedProvider{}
	w := startWire(t, bootScripted(t, provider))
	session, rpcError := w.newSession(t.TempDir(), engramEntry(t, bin, dataDir))
	if rpcError != nil {
		t.Fatal(rpcError)
	}
	w.permit = func(map[string]any) map[string]any {
		w.notify("session/cancel", map[string]any{"sessionId": session})
		return map[string]any{"outcome": "cancelled"}
	}
	provider.reset(saveStep("t", "cancelled write"), scriptStep{})
	if result := w.prompt(session, "write"); result["stopReason"] != "cancelled" {
		t.Errorf("stopReason=%v", result["stopReason"])
	}
	w.closeSession(session)
	waitUntil(t, "the Engram process to exit", func() bool { return len(engramProcesses(dataDir)) == 0 })
	if stats := engramStats(t, bin, dataDir); !strings.Contains(stats, "Observations: 0") {
		t.Errorf("a cancelled write reached Engram: %s", stats)
	}
}
