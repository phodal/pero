package store

import (
	"errors"
	"strings"
	"testing"
)

func TestPullRequestEvidence(t *testing.T) {
	for _, tc := range []struct {
		name, url, branch, head, revision string
		valid                             bool
	}{
		{"canonical", "https://github.com/phodal/pero/pull/12", "codex/contribution", strings.Repeat("a", 40), "revision", true},
		{"wrong origin", "https://github.com.evil/phodal/pero/pull/12", "branch", strings.Repeat("a", 40), "revision", false},
		{"credentials", "https://token@github.com/phodal/pero/pull/12", "branch", strings.Repeat("a", 40), "revision", false},
		{"query", "https://github.com/phodal/pero/pull/12?token=secret", "branch", strings.Repeat("a", 40), "revision", false},
		{"issue", "https://github.com/phodal/pero/issues/12", "branch", strings.Repeat("a", 40), "revision", false},
		{"zero number", "https://github.com/phodal/pero/pull/0", "branch", strings.Repeat("a", 40), "revision", false},
		{"empty branch", "https://github.com/phodal/pero/pull/12", "", strings.Repeat("a", 40), "revision", false},
		{"bad commit", "https://github.com/phodal/pero/pull/12", "branch", "unknown", "revision", false},
		{"empty revision", "https://github.com/phodal/pero/pull/12", "branch", strings.Repeat("a", 40), "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParsePullRequest(tc.url, tc.branch, tc.head, tc.revision)
			if (err == nil) != tc.valid {
				t.Fatalf("parse evidence: %v", err)
			}
		})
	}
}

func TestContributionTransitions(t *testing.T) {
	owner := TaskClaimant{ID: "alice", Name: "Alice"}
	for _, tc := range []struct {
		name, state, claimed, action, actor string
		want                                error
	}{
		{"claim available", "available", "", "claim", "alice", nil},
		{"repeat own claim", "claimed", "alice", "claim", "alice", nil},
		{"cannot steal", "claimed", "bob", "claim", "alice", ErrConflict},
		{"closed source", "closed", "", "claim", "alice", ErrConflict},
		{"changed source", "source_changed", "", "claim", "alice", ErrConflict},
		{"active execution", "running", "", "claim", "alice", ErrConflict},
		{"submitted candidate", "submitted", "alice", "claim", "alice", ErrConflict},
		{"release owner", "claimed", "alice", "release", "alice", nil},
		{"release someone else", "claimed", "alice", "release", "bob", ErrForbidden},
		{"submit owner", "claimed", "alice", "submit", "alice", nil},
		{"submit someone else", "claimed", "alice", "submit", "bob", ErrForbidden},
		{"submit changed source", "source_changed", "alice", "submit", "alice", ErrConflict},
	} {
		t.Run(tc.name, func(t *testing.T) {
			task := &Task{}
			if tc.claimed != "" {
				task.ClaimedBy = &TaskClaimant{ID: tc.claimed}
			}
			c := Contribution{State: tc.state, Repository: "phodal/pero", SourceRevision: "revision", ClaimedBy: task.ClaimedBy, task: task}
			var err error
			switch tc.action {
			case "claim":
				_, err = c.claim(owner)
			case "release":
				_, err = c.release(tc.actor)
			case "submit":
				pr, _ := ParsePullRequest("https://github.com/phodal/pero/pull/12", "branch", strings.Repeat("a", 40), "revision")
				err = c.submit(tc.actor, pr)
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("transition: %v, want %v", err, tc.want)
			}
		})
	}
}
