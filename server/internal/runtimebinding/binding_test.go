package runtimebinding

import (
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
)

func configuration() Config {
	return Config{ClusterID: "test", Namespace: "test", WarmPool: "trusted", WorkerID: "worker_1", ProjectID: "p", WorkspaceKey: "repo", AgentID: "pero", ImageDigest: "sha256:" + strings.Repeat("a", 64), TemplateDigest: "sha256:" + strings.Repeat("b", 64), WorkspaceRevision: strings.Repeat("c", 40), TTLSeconds: 3600}
}
func observed(config Config, now time.Time) model.Observation {
	until := now.Add(time.Hour)
	return model.Observation{Resource: model.ResourceRef{Owner: model.Owner{Kind: "kubernetes", ID: config.ClusterID}, Kind: "kubernetes.sandboxclaim", Scope: config.Namespace, ID: "claim", Incarnation: "claim-uid"}, Runtime: &model.Ref{Kind: "kubernetes-runtime", ID: "pod-uid", Digest: "sha256:" + strings.Repeat("d", 64)}, Receipt: model.Ref{Kind: "kubernetes-observation", ID: "claim-uid", Revision: "1/2/3"}, ObservedAt: now, Ready: model.Condition{Status: "True", Reason: "OwnerReady"}, Artifacts: []model.Ref{{Kind: "container-image", ID: "example@" + config.ImageDigest, Revision: "worker", Digest: config.ImageDigest}}, LeaseExpiresAt: &until}
}
func TestRuntimeBinding(t *testing.T) {
	now := time.Date(2026, 10, 29, 10, 0, 0, 0, time.UTC)
	config := configuration()
	initial := New("run_1", config, now)
	obs := observed(config, now)
	pending, err := initial.WithResource(obs.Resource)
	if err != nil {
		t.Fatal(err)
	}
	ready := pending.Observe(obs, now)
	for _, test := range []struct {
		name          string
		change        func(model.Observation) model.Observation
		phase, reason string
	}{
		{"same", func(o model.Observation) model.Observation { return o }, Ready, "ObservedReady"},
		{"pod replacement", func(o model.Observation) model.Observation { o.Runtime.ID = "new-pod"; return o }, Reconcile, "RuntimeChanged"},
		{"container restart", func(o model.Observation) model.Observation {
			o.Runtime.Digest = "sha256:" + strings.Repeat("e", 64)
			return o
		}, Reconcile, "RuntimeChanged"},
		{"claim replacement", func(o model.Observation) model.Observation { o.Resource.Incarnation = "new-claim"; return o }, Reconcile, "IdentityMismatch"},
		{"stale readiness", func(o model.Observation) model.Observation { o.Ready.Status = "False"; return o }, Reconcile, "RuntimeNotReady"},
		{"missing ttl", func(o model.Observation) model.Observation { o.LeaseExpiresAt = nil; return o }, Reconcile, "RuntimeNotReady"},
		{"expired", func(o model.Observation) model.Observation { o.LeaseExpiresAt = &now; return o }, Reconcile, "RuntimeNotReady"},
	} {
		t.Run(test.name, func(t *testing.T) {
			next := ready.Observe(test.change(model.Clone(obs)), now)
			if next.Phase != test.phase || next.Reason != test.reason {
				t.Fatalf("%+v", next)
			}
			if err := next.ValidateNext(ready); err != nil {
				t.Fatal(err)
			}
		})
	}
	if ready.ValidUntil == nil || !ready.ValidUntil.Equal(now.Add(FreshFor)) {
		t.Fatal("freshness not bounded")
	}
	short := model.Clone(obs)
	deadline := now.Add(time.Second)
	short.LeaseExpiresAt = &deadline
	if next := pending.Observe(short, now); next.ValidUntil == nil || !next.ValidUntil.Equal(deadline) {
		t.Fatal("lease exceeds claim TTL")
	}
	wrong := model.Clone(obs)
	wrong.Artifacts[0].Digest = "sha256:" + strings.Repeat("f", 64)
	if next := pending.Observe(wrong, now); next.Phase != Reconcile || next.ValidUntil != nil {
		t.Fatal("unapproved image admitted")
	}
	unavailable := ready.Failed("ObservationUnavailable")
	if next := unavailable.Observe(obs, now); next.Phase != Reconcile || next.ValidUntil != nil {
		t.Fatal("failed runtime silently recovered")
	}
	released := ready.RequestRelease().Cleanup(model.Ref{Kind: "kubernetes-dispose", ID: "release.run_1", Digest: config.ImageDigest})
	if released.Snapshot.Runtime.ID != "pod-uid" || released.Resource.Incarnation != "claim-uid" || released.ValidUntil != nil {
		t.Fatal("cleanup lost audit identity")
	}
	if err := released.ValidateNext(ready.RequestRelease()); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Binding){func(b *Binding) { b.RequestID = "another" }, func(b *Binding) { b.Config.ImageDigest = "changed" }, func(b *Binding) { b.Resource.Incarnation = "changed" }, func(b *Binding) { b.Snapshot.Runtime.ID = "changed" }, func(b *Binding) { b.Phase = Pending }} {
		changed := model.Clone(ready)
		change(&changed)
		if changed.ValidateNext(ready) == nil {
			t.Fatal("immutable binding changed")
		}
	}
}
func TestFixedConfig(t *testing.T) {
	for _, seconds := range []int64{0, -1, 59, 7*24*3600 + 1} {
		c := configuration()
		c.TTLSeconds = seconds
		if c.Validate() == nil {
			t.Fatalf("TTL %d accepted", seconds)
		}
	}
	c := configuration()
	if c.Validate() != nil {
		t.Fatal("valid config rejected")
	}
	c.ImageDigest = "latest"
	if c.Validate() == nil {
		t.Fatal("mutable image reference accepted")
	}
}
