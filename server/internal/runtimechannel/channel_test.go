package runtimechannel

import (
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T) Session {
	t.Helper()
	s, e := New(Scope{RunID: "run_1", SessionID: "run_1", Generation: 1, WorkerID: "worker_1", InstanceID: "i1", ProjectID: "p1", Namespace: "p1", ServiceAccount: "agent", ServiceAccountUID: "sa1", Audience: Audience, PodUID: "pod1", RuntimeDigest: "sha256:" + strings.Repeat("a", 64)}, strings.Repeat("b", 64), ProviderBudget{2, 1, 128, 1024, 2048, 5}, time.Unix(100, 0))
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func TestOneShotChannel(t *testing.T) {
	now := time.Unix(101, 0)
	for _, tc := range []struct {
		name string
		run  func(*testing.T, Session)
	}{
		{"two peers start once", func(t *testing.T, s Session) {
			s, e := s.Attach("agent", now)
			if e != nil || s.State != Attached {
				t.Fatal(s, e)
			}
			s, e = s.Attach("worker", now)
			if e != nil || s.State != Started {
				t.Fatal(s, e)
			}
			if _, e = s.Attach("worker", now); e == nil {
				t.Fatal("reattached")
			}
		}},
		{"first peer also consumed", func(t *testing.T, s Session) {
			s, _ = s.Attach("worker", now)
			if _, e := s.Attach("worker", now); e == nil {
				t.Fatal("duplicated")
			}
		}},
		{"loss cannot reopen", func(t *testing.T, s Session) {
			s = s.Stop(true)
			if _, e := s.Attach("agent", now); e == nil {
				t.Fatal("replayed")
			}
		}},
		{"expiry fails closed", func(t *testing.T, s Session) {
			if _, e := s.Attach("agent", s.CreatedAt.Add(MaxDuration)); e == nil {
				t.Fatal("expired")
			}
		}},
		{"only original secret", func(t *testing.T, s Session) {
			if !s.CheckSecret(strings.Repeat("b", 64)) || s.CheckSecret(strings.Repeat("c", 64)) || s.CheckSecret("bad") {
				t.Fatal("secret")
			}
		}},
		{"pod identity is exact", func(t *testing.T, s Session) {
			p := PodIdentity{"p1", "agent", "sa1", "pod1", Audience}
			if !s.Scope.Accepts(p) {
				t.Fatal("identity")
			}
			p.PodUID = "other"
			if s.Scope.Accepts(p) {
				t.Fatal("cross pod")
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) { tc.run(t, fixture(t)) })
	}
}
func TestProviderReservations(t *testing.T) {
	s := fixture(t)
	now := s.CreatedAt.Add(time.Second)
	if _, e := s.ReserveProvider(now); e == nil {
		t.Fatal("before start")
	}
	s, _ = s.Attach("worker", now)
	s, _ = s.Attach("agent", now)
	s, e := s.ReserveProvider(now)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.ReserveProvider(now); e != ErrBudget {
		t.Fatal("concurrency", e)
	}
	s = s.FinishProvider()
	s, e = s.ReserveProvider(now)
	if e != nil {
		t.Fatal(e)
	}
	s = s.FinishProvider()
	if _, e = s.ReserveProvider(now); e != ErrBudget {
		t.Fatal("unknown attempts refunded", e)
	}
	s = s.Stop(false)
	if _, e = s.ReserveProvider(now); e != ErrAuthority {
		t.Fatal("closed", e)
	}
}
