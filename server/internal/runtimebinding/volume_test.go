package runtimebinding

import (
	"github.com/phodal/pero/server/internal/environments/model"
	"testing"
	"time"
)

func TestIsolatedVolumeAndComputeLifetimes(t *testing.T) {
	c := configuration()
	c.Profile = "isolated-agent-v1"
	b := New("run_1", c, time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC))
	volume := VolumeBinding{Resource: model.ResourceRef{Owner: model.Owner{Kind: "kubernetes", ID: c.ClusterID}, Kind: "kubernetes.pvc", Scope: c.Namespace, ID: "volume", Incarnation: "pvc-uid"}, ProviderDigest: c.ImageDigest}
	pending, err := b.WithVolume(volume)
	if err != nil {
		t.Fatal(err)
	}
	if err = pending.ValidateNext(b); err != nil {
		t.Fatal(err)
	}
	volume.VolumeName = "pv-original"
	bound, err := pending.WithVolume(volume)
	if err != nil {
		t.Fatal(err)
	}
	if err = bound.ValidateNext(pending); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*Binding){
		func(b *Binding) { b.Volume.Resource.Incarnation = "new-pvc" },
		func(b *Binding) { b.Volume.VolumeName = "new-pv" },
		func(b *Binding) { b.Volume.VolumeName = "" },
		func(b *Binding) { b.Volume.ProviderDigest = c.TemplateDigest },
		func(b *Binding) { b.Volume = nil },
	} {
		next := model.Clone(bound)
		change(&next)
		if next.ValidateNext(bound) == nil {
			t.Fatal("frozen volume identity changed")
		}
	}
	obs := observed(c, b.CreatedAt)
	obs.Resource.Kind = "kubernetes.sandbox"
	obs.Artifacts[0].Revision = "agent"
	admitted, _ := pending.WithResource(obs.Resource)
	admitted = admitted.Observe(obs, b.CreatedAt)
	if admitted.ValidateNext(pending) == nil {
		t.Fatal("readiness before bound PV was persisted")
	}
	ready, _ := bound.WithResource(obs.Resource)
	ready = ready.Observe(obs, b.CreatedAt)
	if err = ready.ValidateNext(bound); err != nil {
		t.Fatal(err)
	}
	requested := ready.RequestRelease()
	receipt := model.Ref{Kind: "kubernetes-dispose", ID: b.RequestID, Digest: c.ImageDigest}
	cleanup, err := requested.ComputeCleanup(receipt)
	if err != nil || cleanup.Phase != CleanupPending || cleanup.Reason != "DataExportPending" || cleanup.CleanupReceipt != nil || cleanup.Volume.VolumeName != "pv-original" {
		t.Fatalf("data released: %+v %v", cleanup, err)
	}
	if err = cleanup.ValidateNext(requested); err != nil {
		t.Fatal(err)
	}
	if cleanup.Cleanup(receipt).ValidateNext(cleanup) == nil {
		t.Fatal("compute receipt released retained workspace")
	}
	if _, err = cleanup.DataCleanup(receipt, c.ImageDigest); err == nil {
		t.Fatal("compute receipt accepted as data cleanup")
	}
	volumeReceipt := model.Ref{Kind: "kubernetes-volume-dispose", ID: "gc.original", Digest: c.TemplateDigest}
	released, err := cleanup.DataCleanup(volumeReceipt, c.ImageDigest)
	if err != nil || released.Phase != Released || released.DataCleanupReceipt == nil {
		t.Fatal(released, err)
	}
	if err = released.ValidateNext(cleanup); err != nil {
		t.Fatal(err)
	}
	changed := model.Clone(released)
	changed.DataCleanupReceipt.Digest = c.ImageDigest
	if changed.ValidateNext(released) == nil {
		t.Fatal("data cleanup receipt replaced")
	}
}
