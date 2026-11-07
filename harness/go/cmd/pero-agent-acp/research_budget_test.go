package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResearchRequestBudgetSurvivesReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "attempts.log")
	if err := os.WriteFile(path, []byte("attempt\nattempt\n"), 0600); err != nil {
		t.Fatal(err)
	}
	beforeRequest, err := researchAttemptAudit(path, 3)
	if err != nil {
		t.Fatal(err)
	}
	if err := beforeRequest(); err != nil {
		t.Fatalf("remaining request refused: %v", err)
	}
	bytes, err := os.ReadFile(path)
	if err != nil || string(bytes) != "attempt\nattempt\nattempt\n" {
		t.Fatalf("permitted request was not durably recorded: %q, %v", bytes, err)
	}
	// Reopening models a new process. It may not reset the approved total.
	resumed, err := researchAttemptAudit(path, 3)
	if err == nil {
		err = resumed()
	}
	if err == nil {
		t.Fatal("reopened research admitted a request beyond the cumulative cap")
	}
	after, err := os.ReadFile(path)
	if err != nil || string(after) != string(bytes) {
		t.Fatalf("refused request changed the durable count: %q, %v", after, err)
	}
}

func TestResearchRequestBudgetRefusesUnavailableOrCorruptAudit(t *testing.T) {
	for _, sample := range []struct {
		name    string
		content string
		missing bool
	}{
		{name: "missing audit", missing: true},
		{name: "unrecognized entry", content: "attempt\nunknown\n"},
		{name: "incomplete entry", content: "attempt\nattempt"},
		{name: "unexpected empty entry", content: "attempt\n\n"},
		{name: "invalid bytes", content: "attempt\n\xff\n"},
	} {
		t.Run(sample.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "attempts.log")
			if !sample.missing {
				if err := os.WriteFile(path, []byte(sample.content), 0600); err != nil {
					t.Fatal(err)
				}
			}
			beforeRequest, err := researchAttemptAudit(path, 10)
			if err == nil {
				err = beforeRequest()
			}
			if err == nil {
				t.Fatal("research request permitted without an intact durable audit")
			}
			bytes, readErr := os.ReadFile(path)
			if sample.missing {
				if !os.IsNotExist(readErr) {
					t.Fatalf("missing audit was recreated: %q, %v", bytes, readErr)
				}
			} else if readErr != nil || string(bytes) != sample.content {
				t.Fatalf("corrupt audit was modified: %q, %v", bytes, readErr)
			}
		})
	}
	// The file can disappear after launch; permission to call the provider is
	// contingent on the write succeeding for each particular attempt.
	t.Run("removed after launch", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "attempts.log")
		if err := os.WriteFile(path, nil, 0600); err != nil {
			t.Fatal(err)
		}
		beforeRequest, err := researchAttemptAudit(path, 1)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.Remove(path); err != nil {
			t.Fatal(err)
		}
		if err := beforeRequest(); err == nil {
			t.Fatal("request permitted after its audit disappeared")
		}
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("deleted audit was recreated: %v", err)
		}
	})
}

func TestOrdinaryRequestAuditKeepsItsProcessBudget(t *testing.T) {
	path := filepath.Join(t.TempDir(), "attempts.log")
	if err := os.WriteFile(path, []byte("attempt\n"), 0600); err != nil {
		t.Fatal(err)
	}
	beforeRequest, err := httpAttemptAudit(path, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := beforeRequest(); err != nil {
		t.Fatalf("ordinary per-process budget changed: %v", err)
	}
	if err := beforeRequest(); err == nil {
		t.Fatal("ordinary audit no longer enforces its process limit")
	}
}
