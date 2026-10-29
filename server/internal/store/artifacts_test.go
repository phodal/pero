package store

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
)

func TestArtifactExportDurabilityAuthorizationAndReceipts(t *testing.T) {
	s, dsn := integrationStore(t)
	ctx := context.Background()
	w, _ := mustWorker(t, s, "project")
	task, run := taskRun(t, s, "project", w.ID)
	source := artifacts.Source{ProjectID: "project", TaskID: task.ID, RunID: run.ID, Generation: run.Generation, ClusterID: "cluster", Namespace: "project", SandboxUID: "sandbox-uid", PodUID: "pod-uid", PVCName: "run-volume", PVCUID: "pvc-uid", VolumeName: "pv-uid", ImageDigest: "sha256:" + strings.Repeat("a", 64), TemplateDigest: "sha256:" + strings.Repeat("b", 64), WorkspaceRevision: strings.Repeat("c", 40)}
	policy := artifacts.Policy{Paths: []string{"result.txt"}, MaxFiles: 1, MaxFileBytes: 1024, MaxTotalBytes: 1024}
	e, err := s.ReserveArtifactExport(ctx, source, policy, "export_1")
	if err != nil {
		t.Fatal(err)
	}
	if again, err := s.ReserveArtifactExport(ctx, source, policy, e.ID); err != nil || again.Version != e.Version {
		t.Fatal("reservation replay", err)
	}
	other := source
	other.ProjectID = "other"
	if _, err = s.ReserveArtifactExport(ctx, other, policy, "export_other"); !errors.Is(err, ErrForbidden) {
		t.Fatal("wrong project accepted", err)
	}
	other = source
	other.PVCUID = "replacement"
	if _, err = s.ReserveArtifactExport(ctx, other, policy, e.ID); !errors.Is(err, ErrConflict) {
		t.Fatal("replacement PVC accepted", err)
	}
	if _, err = s.ReserveArtifactExport(ctx, source, policy, "new_operation"); !errors.Is(err, ErrConflict) {
		t.Fatal("same Run got fresh export", err)
	}
	q := artifacts.Quiescence{PodUID: source.PodUID, PVCUID: source.PVCUID, ComputeReleaseDigest: "sha256:" + strings.Repeat("d", 64), StorageFenceDigest: "sha256:" + strings.Repeat("e", 64), ObservedAt: e.CreatedAt.Add(time.Second)}
	if _, err = s.BeginArtifactExport(ctx, e.ID, 0, q); !errors.Is(err, ErrConflict) {
		t.Fatal("stale CAS accepted", err)
	}
	e, err = s.BeginArtifactExport(ctx, e.ID, e.Version, q)
	if err != nil {
		t.Fatal(err)
	}
	if replay, err := s.BeginArtifactExport(ctx, e.ID, 1, q); err != nil || replay.Version != e.Version {
		t.Fatal("lost Begin receipt not reconciled", err)
	}
	m, err := artifacts.NewManifest(source, policy, e.ID, []artifacts.Entry{{Path: "result.txt", Bytes: 3, SHA256: "sha256:" + strings.Repeat("f", 64)}}, nil, e.CreatedAt.Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	a := artifacts.GCApproval{OperationID: "gc_1", ActorID: "operator", ManifestDigest: m.Digest, ApprovedAt: e.CreatedAt.Add(3 * time.Second)}
	if _, err = s.AuthorizeArtifactDataGC(ctx, e.ID, e.Version, a); !errors.Is(err, artifacts.ErrNotReady) {
		t.Fatal("data cleanup before commit", err)
	}
	if _, err = s.CommitArtifactManifest(ctx, e.ID, e.Version, m); err == nil {
		t.Fatal("manifest without verified objects accepted")
	}
	object, err := s.ReserveArtifactObject(ctx, e.ID, m.Entries[0].ID, m.Entries[0].Bytes, m.Entries[0].SHA256)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.CommitArtifactManifest(ctx, e.ID, e.Version, m); err == nil {
		t.Fatal("pending object accepted")
	}
	if err = s.VerifyArtifactObject(ctx, e.ID, object); err != nil {
		t.Fatal(err)
	}
	e, err = s.CommitArtifactManifest(ctx, e.ID, e.Version, m)
	if err != nil {
		t.Fatal(err)
	}
	// A new Store instance observes the same source, manifest and commit receipt.
	reopened, err := Open(ctx, dsn, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	replay, err := reopened.CommitArtifactManifest(ctx, e.ID, 2, m)
	if err != nil || replay.Manifest.Digest != m.Digest || replay.Version != e.Version {
		t.Fatal("commit receipt lost across restart", err)
	}
	tampered := m
	tampered.Source.Generation++
	if _, err = reopened.CommitArtifactManifest(ctx, e.ID, e.Version, tampered); !errors.Is(err, artifacts.ErrConflict) {
		t.Fatal("manifest rebind accepted", err)
	}
	member := &Client{ID: "member", Projects: []string{"project"}}
	foreign := &Client{ID: "foreign", Projects: []string{"other"}}
	if rows, err := s.ClientArtifactExports(ctx, member, run.ID); err != nil || len(rows) != 1 || rows[0].Manifest.Digest != m.Digest {
		t.Fatal("authorized manifest unavailable", err)
	}
	if _, err = s.ClientArtifactExports(ctx, foreign, run.ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("foreign Run identity leaked", err)
	}
	if _, err = s.ClientArtifactExports(ctx, nil, run.ID); !errors.Is(err, ErrForbidden) {
		t.Fatal("nil client bypassed auth", err)
	}
	// Newer task generations do not change authority or erase older manifests.
	if _, err = s.Cancel(ctx, task.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Dispatch(ctx, task.ID, w.ID, ""); err != nil {
		t.Fatal(err)
	}
	if rows, err := s.ClientArtifactExports(ctx, member, run.ID); err != nil || len(rows) != 1 {
		t.Fatal("prior generation disappeared", err)
	}
	e, err = s.AuthorizeArtifactDataGC(ctx, e.ID, e.Version, a)
	if err != nil {
		t.Fatal(err)
	}
	if replay, err := s.AuthorizeArtifactDataGC(ctx, e.ID, e.Version-1, a); err != nil || replay.GC.ManifestDigest != m.Digest {
		t.Fatal("GC receipt replay", err)
	}
}
