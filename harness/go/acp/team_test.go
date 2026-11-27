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

	boardSnapshot := func(w *questionWire, id string, enabled bool) []team.TaskView {
		t.Helper()
		raw := w.rpc(teamBoardMethod, map[string]string{"sessionId": id})
		var snapshot team.BoardSnapshot
		if err := json.Unmarshal(raw, &snapshot); err != nil || snapshot.Enabled != enabled || snapshot.Tasks == nil {
			t.Fatalf("unexpected board mode or task projection: %s, %v", raw, err)
		}
		return snapshot.Tasks
	}
	create := map[string]any{"cwd": cwd, "mcpServers": []any{}}
	server, wire, stop := start(true)
	if !strings.Contains(string(wire.rpc("initialize", map[string]any{"protocolVersion": 1})), `"pero.teamBoard":1`) {
		t.Fatal("mounted ACP process did not advertise Team projection")
	}
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
	task, err = server.teamBoard.Update(ctx, root, team.TaskRef{ID: task.ID, Revision: task.Revision}, team.Claim)
	if err != nil {
		t.Fatal(err)
	}
	tombstone, err := server.teamBoard.Create(ctx, root, team.NewTask{Title: "Discarded task", Details: "Not visible"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = server.teamBoard.Update(ctx, root, team.TaskRef{ID: tombstone.ID, Revision: tombstone.Revision}, team.Delete); err != nil {
		t.Fatal(err)
	}
	checkProjection := func(w *questionWire) {
		t.Helper()
		rows := boardSnapshot(w, a, true)
		if len(rows) != 1 || rows[0].ID != task.ID || rows[0].Revision != task.Revision || rows[0].Owner != harness.SessionID(a) || rows[0].Title != task.Title || rows[0].Status != team.InProgress || rows[0].Ready || rows[0].Details != "" {
			t.Fatalf("saved task was not projected accurately or exposed its body/tombstone: %+v", rows)
		}
		if other := boardSnapshot(w, b, false); len(other) != 0 {
			t.Fatalf("other root received tasks: %+v", other)
		}
	}
	before := len(root.Session().Events())
	checkProjection(wire)
	if len(root.Session().Events()) != before {
		t.Fatal("reading the board changed its root journal")
	}
	check(set(wire, a, "team", "off"), "off", "b")
	if hidden := boardSnapshot(wire, a, false); len(hidden) != 0 {
		t.Fatalf("disabled board exposed tasks: %+v", hidden)
	}
	assertTools(server, a, 0)
	stop()

	server, wire, stop = start(true)
	check(wire.rpc("session/load", map[string]any{"sessionId": a, "cwd": cwd, "mcpServers": []any{}}), "off", "b")
	check(wire.rpc("session/load", map[string]any{"sessionId": b, "cwd": cwd, "mcpServers": []any{}}), "off", "a")
	assertTools(server, a, 0)
	assertTools(server, b, 0)
	check(set(wire, a, "team", "on"), "on", "b")
	assertTools(server, a, 4)
	checkProjection(wire)
	assertTools(server, b, 0)
	stop()

	server, wire, _ = start(false)
	if strings.Contains(string(wire.rpc("initialize", map[string]any{"protocolVersion": 1})), teamBoardCapability) {
		t.Fatal("default ACP process advertised Team projection")
	}
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
