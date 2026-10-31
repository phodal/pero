package acp

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/phodal/pero/harness/go/harness"
)

func TestPermissionDefaultsToAutoReviewAndSurvivesReload(t *testing.T) {
	s, _ := modelServer(t, false)
	s.writer = &wireWriter{encoder: json.NewEncoder(discardWriter{})}
	ctx := context.Background()
	cwd := t.TempDir()
	id, err := s.newSession(ctx, NewSessionParams{CWD: cwd})
	if err != nil {
		t.Fatal(err)
	}
	current := func() string {
		t.Helper()
		configured, rpcErr := s.sessionConfiguration(id, false)
		if rpcErr != nil {
			t.Fatal(rpcErr)
		}
		options := configured.(map[string]any)["configOptions"].([]any)
		for _, option := range options {
			item := option.(map[string]any)
			if item["id"] == "permission" {
				return item["currentValue"].(string)
			}
		}
		t.Fatal(configured)
		return ""
	}
	if current() != "auto-review" {
		t.Fatal(current())
	}
	if _, rpcErr := s.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "permission", Value: "nope"}); rpcErr == nil {
		t.Fatal("unadvertised permission accepted")
	}
	if _, rpcErr := s.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "permission", Value: "read-only"}); rpcErr != nil || current() != "read-only" {
		t.Fatal(rpcErr, current())
	}
	_, finish, err := s.beginCommandRecord(string(id))
	if err != nil {
		t.Fatal(err)
	}
	if _, rpcErr := s.setConfigOption(ctx, setConfigOptionParams{SessionID: string(id), ConfigID: "permission", Value: "full-access"}); rpcErr == nil {
		t.Fatal("busy session accepted a permission change")
	}
	finish()
	if err := s.closeSession(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := s.resumeSession(ctx, ResumeSessionParams{SessionID: string(id), CWD: s.closedSessions[id].agent.Session().Header().CWD}); err != nil {
		t.Fatal(err)
	}
	if current() != "read-only" {
		t.Fatal(current())
	}
	record, err := s.currentRecord(id)
	if err != nil {
		t.Fatal(err)
	}
	mode, found, err := harness.PermissionModeOverride(record.agent.Session().Events())
	if err != nil || !found || mode != harness.PermissionReadOnly {
		t.Fatalf("mode=%q found=%v error=%v", mode, found, err)
	}
}
