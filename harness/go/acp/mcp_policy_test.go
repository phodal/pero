//go:build unix

package acp

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Fixture tests: a scripted provider and a stand-in stdio MCP server. They prove
// Pero's policy enforcement and say nothing about any real memory server.

type fixtureServer struct {
	dir   string
	entry map[string]any
}

func (f fixtureServer) path(name string) string { return filepath.Join(f.dir, name) }

func (f fixtureServer) log() []string {
	data, _ := os.ReadFile(f.path("log"))
	return strings.Fields(strings.ReplaceAll(string(data), "\n", " "))
}

func (f fixtureServer) pid(t *testing.T) int {
	t.Helper()
	var pid int
	waitUntil(t, "fixture pid", func() bool {
		data, err := os.ReadFile(f.path("pid"))
		if err != nil {
			return false
		}
		pid, err = strconv.Atoi(string(data))
		return err == nil
	})
	return pid
}

func newFixtureServer(t *testing.T, mutations string, clean bool) fixtureServer {
	t.Helper()
	dir := t.TempDir()
	f := fixtureServer{dir: dir}
	policy := map[string]any{"mutations": mutations, "tools": []any{
		map[string]any{"name": "lookup", "pin": map[string]any{"project": "p"}, "forbid": []any{"all_projects"}},
		map[string]any{"name": "store", "mutates": true, "pin": map[string]any{"capture_prompt": false}},
	}}
	f.entry = map[string]any{
		"name": "memory", "command": os.Args[0], "args": []any{"-test.run=^$"},
		"env": []any{
			map[string]any{"name": "PERO_FIXTURE_MCP", "value": "1"},
			map[string]any{"name": "FIXTURE_LOG", "value": f.path("log")},
			map[string]any{"name": "FIXTURE_PID", "value": f.path("pid")},
			map[string]any{"name": "FIXTURE_ENV", "value": f.path("env")},
		},
		"_meta": map[string]any{"pero.dev/mcp-server": map[string]any{"toolPolicy": policy, "cleanEnvironment": clean, "failOnStartupError": true}},
	}
	return f
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestToolPolicyDecidesWhatTheModelSeesAndWhatNeedsApproval(t *testing.T) {
	const lookup, store, purge = "mcp__memory__lookup", "mcp__memory__store", "mcp__memory__purge"
	for _, test := range []struct {
		name      string
		mutations string
		steps     []scriptStep
		approval  map[string]any // nil: no request is expected
		offered   []string
		missing   []string
		wantLog   string // fixture log entries that must appear, space separated prefixes
		denied    string // text the model must read instead of a result
	}{
		{name: "read tool needs no approval and gets the pinned project", mutations: "deny",
			steps: []scriptStep{{lookup, `{"q":"x"}`}}, offered: []string{lookup}, missing: []string{store, purge, "list_mcp_resources", "read_mcp_resource"},
			wantLog: `lookup:{"project":"p","q":"x"}`},
		{name: "mutation is hidden when denied", mutations: "deny",
			steps: []scriptStep{{store, `{}`}}, offered: []string{lookup}, missing: []string{store}, denied: "unknown tool"},
		{name: "approved mutation runs with pinned privacy arguments", mutations: "approve",
			steps: []scriptStep{{store, `{"title":"t"}`}}, approval: outcomeAllow, offered: []string{lookup, store}, missing: []string{purge},
			wantLog: `store:{"capture_prompt":false,"title":"t"}`},
		{name: "rejected mutation never reaches the server", mutations: "approve",
			steps: []scriptStep{{store, `{}`}}, approval: outcomeReject, denied: "tool approval rejected"},
		{name: "cancelled approval never reaches the server", mutations: "approve",
			steps: []scriptStep{{store, `{}`}}, approval: map[string]any{"outcome": "cancelled"}, denied: "tool approval cancelled"},
		{name: "an argument the policy refuses is rejected without asking for approval", mutations: "approve",
			steps: []scriptStep{{store, `{"capture_prompt":true}`}}, denied: `"capture_prompt" must be false`},
		{name: "model cannot widen a read beyond the pinned project", mutations: "deny",
			steps: []scriptStep{{lookup, `{"all_projects":true}`}}, denied: `"all_projects" is not permitted`},
		{name: "unlisted tool stays unreachable even when the model names it", mutations: "approve",
			steps: []scriptStep{{purge, `{}`}}, denied: "unknown tool"},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := &scriptedProvider{}
			w := startWire(t, bootScripted(t, provider))
			f := newFixtureServer(t, test.mutations, false)
			w.permit = func(map[string]any) map[string]any {
				if test.approval == nil {
					t.Error("unexpected approval request")
					return outcomeReject
				}
				return test.approval
			}
			provider.reset(append(test.steps, scriptStep{})...)
			session, rpcError := w.newSession(t.TempDir(), f.entry)
			if rpcError != nil {
				t.Fatal(rpcError)
			}
			w.prompt(session, "go")
			offered, results, _ := provider.snapshot()
			for _, name := range test.offered {
				if !contains(offered, name) {
					t.Errorf("model was not offered %s: %v", name, offered)
				}
			}
			for _, name := range test.missing {
				if contains(offered, name) {
					t.Errorf("model was offered %s", name)
				}
			}
			wantApprovals := 0
			if test.approval != nil {
				wantApprovals = 1
			}
			if w.permissions != wantApprovals {
				t.Errorf("approval requests=%d want %d", w.permissions, wantApprovals)
			}
			log := strings.Join(f.log(), " ")
			if test.wantLog != "" && !strings.Contains(log, strings.ReplaceAll(test.wantLog, "\n", " ")) {
				t.Errorf("fixture log %q lacks %q", log, test.wantLog)
			}
			if test.denied != "" {
				joined := strings.Join(results, "\n")
				if !strings.Contains(joined, test.denied) {
					t.Errorf("model read %q, want %q", joined, test.denied)
				}
				if strings.Contains(log, "store:") || strings.Contains(log, "purge") || strings.Contains(log, "lookup:") {
					t.Errorf("denied call reached the server: %q", log)
				}
			}
			w.closeSession(session)
		})
	}
}

func TestServerWriteFailureIsReportedAndNeverReplayed(t *testing.T) {
	for _, mode := range []string{"fail", "die"} {
		t.Run(mode, func(t *testing.T) {
			provider := &scriptedProvider{}
			w := startWire(t, bootScripted(t, provider))
			f := newFixtureServer(t, "approve", false)
			w.permit = func(map[string]any) map[string]any { return outcomeAllow }
			provider.reset(scriptStep{"mcp__memory__store", `{"mode":"` + mode + `"}`}, scriptStep{})
			session, rpcError := w.newSession(t.TempDir(), f.entry)
			if rpcError != nil {
				t.Fatal(rpcError)
			}
			w.prompt(session, "write")
			_, results, _ := provider.snapshot()
			if len(results) == 0 {
				t.Fatal("the model saw no tool outcome")
			}
			if mode == "fail" && !strings.Contains(results[0], "storage is read-only") {
				t.Errorf("tool error text was not preserved: %v", results)
			}
			if mode == "die" && strings.Contains(results[0], "stored") {
				t.Errorf("an unknown outcome was reported as success: %v", results)
			}
			// Give a reconnect every chance to replay, then count attempts.
			w.closeSession(session)
			attempts := 0
			for _, line := range f.log() {
				if strings.HasPrefix(line, "store:") {
					attempts++
				}
			}
			if attempts != 1 {
				t.Errorf("write attempted %d times", attempts)
			}
		})
	}
}

func TestCancellationStopsAnInFlightMutationAndTheChildExits(t *testing.T) {
	provider := &scriptedProvider{}
	w := startWire(t, bootScripted(t, provider))
	f := newFixtureServer(t, "approve", false)
	w.permit = func(map[string]any) map[string]any { return outcomeAllow }
	provider.reset(scriptStep{"mcp__memory__store", `{"mode":"block"}`}, scriptStep{})
	session, rpcError := w.newSession(t.TempDir(), f.entry)
	if rpcError != nil {
		t.Fatal(rpcError)
	}
	pid := f.pid(t)
	go func() {
		waitUntil(t, "the write to block", func() bool { return contains(f.log(), "blocking") })
		w.notify("session/cancel", map[string]any{"sessionId": session})
	}()
	result := w.prompt(session, "write")
	if result["stopReason"] != "cancelled" {
		t.Errorf("stopReason=%v", result["stopReason"])
	}
	waitUntil(t, "the server to see cancellation", func() bool { return contains(f.log(), "cancelled") })
	w.closeSession(session)
	waitUntil(t, "the MCP child to exit", func() bool { return !processAlive(pid) })
}

func TestCancelWhileApprovalIsPendingNeverReachesTheServer(t *testing.T) {
	provider := &scriptedProvider{}
	w := startWire(t, bootScripted(t, provider))
	f := newFixtureServer(t, "approve", false)
	session, rpcError := w.newSession(t.TempDir(), f.entry)
	if rpcError != nil {
		t.Fatal(rpcError)
	}
	w.permit = func(map[string]any) map[string]any {
		w.notify("session/cancel", map[string]any{"sessionId": session})
		return map[string]any{"outcome": "cancelled"}
	}
	provider.reset(scriptStep{"mcp__memory__store", `{}`}, scriptStep{})
	result := w.prompt(session, "write")
	if result["stopReason"] != "cancelled" {
		t.Errorf("stopReason=%v", result["stopReason"])
	}
	if strings.Contains(strings.Join(f.log(), " "), "store:") {
		t.Error("cancelled approval reached the server")
	}
	pid := f.pid(t)
	w.closeSession(session)
	waitUntil(t, "the MCP child to exit", func() bool { return !processAlive(pid) })
}

func TestCleanEnvironmentInheritsNothing(t *testing.T) {
	t.Setenv("PERO_DECOY_VALUE", "inherited")
	for _, clean := range []bool{false, true} {
		w := startWire(t, bootScripted(t, &scriptedProvider{}))
		f := newFixtureServer(t, "deny", clean)
		session, rpcError := w.newSession(t.TempDir(), f.entry)
		if rpcError != nil {
			t.Fatal(rpcError)
		}
		f.pid(t)
		var environment string
		waitUntil(t, "environment dump", func() bool {
			data, err := os.ReadFile(f.path("env"))
			environment = string(data)
			return err == nil && environment != ""
		})
		if inherited := strings.Contains(environment, "PERO_DECOY_VALUE=inherited"); inherited == clean {
			t.Errorf("clean=%v but inherited=%v", clean, inherited)
		}
		if !strings.Contains(environment, "FIXTURE_LOG=") {
			t.Errorf("clean=%v dropped explicit entries", clean)
		}
		w.closeSession(session)
	}
}

func TestPolicyMetaIsStrictAndStartupFailureIsExplicit(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"misspelled policy field", func(meta map[string]any) { meta["toolPolcy"] = meta["toolPolicy"]; delete(meta, "toolPolicy") }},
		{"policy that lists no tools", func(meta map[string]any) { meta["toolPolicy"] = map[string]any{"tools": []any{}} }},
		{"unknown mutation mode", func(meta map[string]any) {
			meta["toolPolicy"].(map[string]any)["mutations"] = "allow"
		}},
		{"missing binary with failOnStartupError", func(meta map[string]any) {}},
	} {
		t.Run(test.name, func(t *testing.T) {
			w := startWire(t, bootScripted(t, &scriptedProvider{}))
			f := newFixtureServer(t, "deny", false)
			test.mutate(f.entry["_meta"].(map[string]any)["pero.dev/mcp-server"].(map[string]any))
			if test.name == "missing binary with failOnStartupError" {
				f.entry["command"] = filepath.Join(f.dir, "absent-binary")
			}
			if _, rpcError := w.newSession(t.TempDir(), f.entry); rpcError == nil {
				t.Fatal("session was created")
			}
			if _, err := os.Stat(f.path("log")); err == nil {
				t.Error("a rejected session still ran the server")
			}
		})
	}
}
