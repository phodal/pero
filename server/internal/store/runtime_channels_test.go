package store

import (
	"context"
	"errors"
	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/runtimebinding"
	"github.com/phodal/pero/server/internal/runtimechannel"
	"strings"
	"sync"
	"testing"
	"time"
)

func channelFixture(t *testing.T) (*Store, *Run, runtimebinding.Binding, runtimechannel.ProviderBudget) {
	t.Helper()
	s, _ := integrationStore(t)
	ctx := context.Background()
	worker, _ := mustWorker(t, s, "p")
	c := runtimeConfig(worker.ID)
	c.Profile = runtimechannel.Profile
	c.RuntimeClass = "runsc"
	c.ServiceAccount = "agent"
	c.ServiceAccountUID = "sa1"
	c.Audience = runtimechannel.Audience
	c.ControlURL = "https://control.invalid"
	c.ImageRef = "image@" + c.ImageDigest
	c.Model = "fixture"
	c.StorageClass = "retained"
	c.StorageAccessMode = "ReadWriteOnce"
	c.VolumeSize = "1Gi"
	if e := s.ConfigureRuntimeWorker(ctx, c); e != nil {
		t.Fatal(e)
	}
	_, b := runtimeTask(t, s, c, "isolated")
	now := time.Now()
	end := now.Add(time.Hour)
	ref := model.ResourceRef{Owner: model.Owner{Kind: "kubernetes", ID: c.ClusterID}, Kind: "kubernetes.sandbox", Scope: c.Namespace, ID: "sandbox1", Incarnation: "sandbox-uid"}
	b, e := b.WithResource(ref)
	if e != nil {
		t.Fatal(e)
	}
	b, e = b.WithVolume(runtimebinding.VolumeBinding{Resource: model.ResourceRef{Owner: ref.Owner, Kind: "kubernetes.pvc", Scope: ref.Scope, ID: "volume1", Incarnation: "volume-uid"}, VolumeName: "pv-fixture", ProviderDigest: "sha256:" + strings.Repeat("c", 64)})
	if e != nil {
		t.Fatal(e)
	}
	b = b.Observe(model.Observation{Resource: ref, Runtime: &model.Ref{Kind: "kubernetes-runtime", ID: "pod1", Digest: "sha256:" + strings.Repeat("d", 64)}, Receipt: model.Ref{Kind: "kubernetes-observation", ID: ref.Incarnation, Revision: "1"}, ObservedAt: now, Ready: model.Condition{Status: "True", Reason: "OwnerReady"}, Artifacts: []model.Ref{{Kind: "container-image", ID: c.ImageRef, Revision: "agent", Digest: c.ImageDigest}}, LeaseExpiresAt: &end}, now)
	b, e = s.SaveRuntimeBinding(ctx, b.Version, b)
	if e != nil || b.Phase != runtimebinding.Ready {
		t.Fatal(b, e)
	}
	if _, e = s.Claim(ctx, worker.ID, "external", "wrong-pod", "pod1"); !errors.Is(e, ErrForbidden) {
		t.Fatal("external worker pretended to be Pod", e)
	}
	run, e := s.Claim(ctx, worker.ID, "external", "original")
	if e != nil || run == nil || run.RemoteExecution == nil || run.RemoteExecution.SessionID != run.ID {
		t.Fatal(run, e)
	}
	return s, run, b, runtimechannel.ProviderBudget{MaxRequests: 2, MaxConcurrent: 1, MaxOutputTokens: 64, MaxRequestBytes: 1024, MaxResponseBytes: 2048, TimeoutSeconds: 3}
}
func TestRuntimeChannelAuthorityAndProviderReservations(t *testing.T) {
	s, r, b, budget := channelFixture(t)
	ctx := context.Background()
	secret := strings.Repeat("a", 64)
	c, e := s.ReserveRuntimeChannel(ctx, r.ID, r.WorkerID, r.InstanceID, r.Generation, r.ID, secret, budget)
	if e != nil {
		t.Fatal(e)
	}
	again, e := s.ReserveRuntimeChannel(ctx, r.ID, r.WorkerID, r.InstanceID, r.Generation, r.ID, secret, budget)
	if e != nil || again.Scope != c.Scope {
		t.Fatal(e)
	}
	if _, e = s.ReserveRuntimeChannel(ctx, r.ID, r.WorkerID, r.InstanceID, r.Generation, r.ID, strings.Repeat("b", 64), budget); !errors.Is(e, ErrConflict) {
		t.Fatal("secret replacement", e)
	}
	pod := runtimechannel.PodIdentity{Namespace: b.Config.Namespace, ServiceAccount: "agent", ServiceAccountUID: "sa1", PodUID: "pod1", Audience: runtimechannel.Audience}
	wrong := pod
	wrong.PodUID = "another"
	if _, e = s.AttachRuntimeChannel(ctx, r.ID, r.ID, "agent", "", wrong); !errors.Is(e, ErrForbidden) {
		t.Fatal("cross pod", e)
	}
	if _, e = s.AttachRuntimeChannel(ctx, r.ID, r.ID, "worker", secret, runtimechannel.PodIdentity{}); e != nil {
		t.Fatal(e)
	}
	c, e = s.AttachRuntimeChannel(ctx, r.ID, r.ID, "agent", "", pod)
	if e != nil || c.State != runtimechannel.Started {
		t.Fatal(c, e)
	}
	if _, e = s.AttachRuntimeChannel(ctx, r.ID, r.ID, "worker", secret, runtimechannel.PodIdentity{}); !errors.Is(e, ErrConflict) {
		t.Fatal("reattach", e)
	}
	var wg sync.WaitGroup
	attempts := make(chan string, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, id, e := s.ReserveRuntimeProvider(ctx, r.ID, pod)
			if e == nil {
				attempts <- id
			} else if !errors.Is(e, runtimechannel.ErrBudget) {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	close(attempts)
	if len(attempts) != 1 {
		t.Fatalf("parallel reservations=%d", len(attempts))
	}
	id := <-attempts
	if e = s.FinishRuntimeProvider(ctx, r.ID, id); e != nil {
		t.Fatal(e)
	}
	if e = s.FinishRuntimeProvider(ctx, r.ID, id); e != nil {
		t.Fatal(e)
	}
	_, id, e = s.ReserveRuntimeProvider(ctx, r.ID, pod)
	if e != nil {
		t.Fatal(e)
	}
	if e = s.FinishRuntimeProvider(ctx, r.ID, id); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ReserveRuntimeProvider(ctx, r.ID, pod); !errors.Is(e, runtimechannel.ErrBudget) {
		t.Fatal("spent attempt refunded", e)
	}
	if _, e = s.ReleaseRuntime(ctx, r.ID); e != nil {
		t.Fatal(e)
	}
	if _, e = s.AuthorizeRuntimeChannel(ctx, r.ID); !errors.Is(e, ErrLease) {
		t.Fatal("cancel did not revoke", e)
	}
}
func TestRuntimeChannelRestartNeverReopens(t *testing.T) {
	s, r, _, budget := channelFixture(t)
	ctx := context.Background()
	secret := strings.Repeat("a", 64)
	if _, e := s.ReserveRuntimeChannel(ctx, r.ID, r.WorkerID, r.InstanceID, r.Generation, r.ID, secret, budget); e != nil {
		t.Fatal(e)
	}
	if e := s.FenceRuntimeChannels(ctx, r.WorkerID); e != nil {
		t.Fatal(e)
	}
	current, e := s.RuntimeRun(ctx, r.ID)
	if e != nil || current.Status != "reconcile" {
		t.Fatal(current, e)
	}
	if _, e = s.ReserveRuntimeChannel(ctx, r.ID, r.WorkerID, r.InstanceID, r.Generation, r.ID, secret, budget); !errors.Is(e, ErrLease) {
		t.Fatal("reopened", e)
	}
}
