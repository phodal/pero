package acp

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/harness/go/harness"
	"github.com/phodal/pero/harness/go/team"
)

func TestTeamModeACPWire(t *testing.T) {
	ctx := context.Background()
	adapter := &catalogFixture{capacity: 8192}
	home, cwd := t.TempDir(), t.TempDir()
	start := func(mounted bool) (*Server, *questionWire, func()) {
		t.Helper()
		h, err := harness.Boot(ctx, harness.Options{EnableSubagents: true, Adapter: adapter, ModelInfo: adapter, AdapterProviders: []string{"test"}})
		if err != nil {
			t.Fatal(err)
		}
		disk, err := harness.NewJSONLSessionPersistence(home)
		if err != nil {
			t.Fatal(err)
		}
		opts := Options{Harness: h, Persistence: disk, Provider: "test", Model: "a", ModelSelection: true}
		if mounted {
			if err := team.Mount(ctx, h); err != nil {
				t.Fatal(err)
			}
			opts.TeamBoard = &team.Board{Registry: h.Subagents()}
		}
		server, err := NewServer(opts)
		if err != nil {
			t.Fatal(err)
		}
		client, peer := net.Pipe()
		_ = client.SetDeadline(time.Now().Add(15 * time.Second))
		done := make(chan error, 1)
		go func() { done <- server.Serve(ctx, peer, peer); _ = peer.Close() }()
		stop := sync.OnceFunc(func() {
			_ = client.Close()
			if err := <-done; err != nil {
				t.Error(err)
			}
			if err := h.Dispose(ctx); err != nil && err != harness.ErrHarnessDisposalInProgress {
				t.Error(err)
			}
			if err := h.Drain(ctx); err != nil {
				t.Error(err)
			}
		})
		t.Cleanup(stop)
		return server, &questionWire{t: t, encoder: json.NewEncoder(client), scanner: bufio.NewScanner(client)}, stop
	}
	type settings struct {
		SessionID string `json:"sessionId"`
		Options   []struct {
			ID      string `json:"id"`
			Current string `json:"currentValue"`
		} `json:"configOptions"`
	}
	check := func(raw json.RawMessage, teamValue, model string) string {
		t.Helper()
		var state settings
		if err := json.Unmarshal(raw, &state); err != nil {
			t.Fatal(err)
		}
		values := map[string]string{}
		for _, option := range state.Options {
			values[option.ID] = option.Current
		}
		if values["team"] != teamValue || values["model"] != model || values["permission"] == "" {
			t.Fatalf("unrelated configuration changed or missing Team value: %s", raw)
		}
		return state.SessionID
	}
	set := func(w *questionWire, id, key, value string) json.RawMessage {
		t.Helper()
		return w.rpc("session/set_config_option", map[string]string{"sessionId": id, "configId": key, "value": value})
	}
	assertTools := func(server *Server, id string, want int) *harness.Agent {
		t.Helper()
		record, err := server.currentRecord(harness.SessionID(id))
		if err != nil {
			t.Fatal(err)
		}
		schemas, err := server.h.Tools().SchemasForAgent(ctx, record.agent)
		if err != nil {
			t.Fatal(err)
		}
		got := 0
		for _, schema := range schemas {
			if strings.HasPrefix(schema.Name, "team_task_") {
				got++
			}
		}
		if got != want {
			t.Fatalf("session %s has %d Team tools, want %d", id, got, want)
		}
		return record.agent
	}

	create := map[string]any{"cwd": cwd, "mcpServers": []any{}}
	server, wire, stop := start(true)
	a := check(wire.rpc("session/new", create), "off", "a")
	b := check(wire.rpc("session/new", create), "off", "a")
	check(set(wire, a, "model", "b"), "off", "b")
	check(set(wire, a, "team", "on"), "on", "b")
	root := assertTools(server, a, 4)
	assertTools(server, b, 0)
	task, err := server.teamBoard.Create(ctx, root, team.NewTask{Title: "Verify a result", Details: "Compare the frozen input"})
	if err != nil {
		t.Fatal(err)
	}
	check(set(wire, a, "team", "off"), "off", "b")
	assertTools(server, a, 0)
	stop()

	server, wire, stop = start(true)
	check(wire.rpc("session/load", map[string]any{"sessionId": a, "cwd": cwd, "mcpServers": []any{}}), "off", "b")
	check(wire.rpc("session/load", map[string]any{"sessionId": b, "cwd": cwd, "mcpServers": []any{}}), "off", "a")
	assertTools(server, a, 0)
	assertTools(server, b, 0)
	check(set(wire, a, "team", "on"), "on", "b")
	root = assertTools(server, a, 4)
	tasks, err := server.teamBoard.List(root)
	if err != nil || len(tasks) != 1 || tasks[0].ID != task.ID || tasks[0].Revision != task.Revision {
		t.Fatalf("toggle or restart changed saved task: %v, %v", tasks, err)
	}
	assertTools(server, b, 0)
	stop()

	server, wire, _ = start(false)
	unavailable := check(wire.rpc("session/new", create), "", "a")
	assertTools(server, unavailable, 0)
	check(wire.rpc("session/load", map[string]any{"sessionId": a, "cwd": cwd, "mcpServers": []any{}}), "", "b")
	assertTools(server, a, 0)
	adapter.mu.Lock()
	defer adapter.mu.Unlock()
	if len(adapter.calls) != 0 {
		t.Fatalf("Team settings or restore invoked the model: %v", adapter.calls)
	}
}
