package store

import (
	"testing"
	"time"
)

func TestWorkerPresence(t *testing.T) {
	now := time.Date(2026, 11, 13, 8, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name string
		seen *time.Time
		want WorkerPresenceState
	}{
		{"never contacted", nil, WorkerUnknown},
		{"recent", timePointer(now.Add(-time.Second)), WorkerOnline},
		{"inside window", timePointer(now.Add(-WorkerPresenceWindow + time.Nanosecond)), WorkerOnline},
		{"window elapsed", timePointer(now.Add(-WorkerPresenceWindow)), WorkerOffline},
		{"old", timePointer(now.Add(-time.Hour)), WorkerOffline},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := ObserveWorkerPresence(tc.seen, now); got.State != tc.want {
				t.Fatalf("presence: got %s, want %s", got.State, tc.want)
			}
		})
	}
}

func timePointer(value time.Time) *time.Time { return &value }
