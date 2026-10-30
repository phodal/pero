package artifacts

import (
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"
)

func source() Source {
	return Source{ProjectID: "project", TaskID: "task_1", RunID: "run_1", Generation: 1, ClusterID: "cluster", Namespace: "project", SandboxUID: "sandbox-uid", PodUID: "pod-uid", PVCName: "run-volume", PVCUID: "pvc-uid", VolumeName: "pv-uid", ImageDigest: "sha256:" + strings.Repeat("a", 64), TemplateDigest: "sha256:" + strings.Repeat("b", 64), WorkspaceRevision: strings.Repeat("c", 40)}
}
func policy() Policy {
	return Policy{Paths: []string{"outputs/b.txt", "outputs/a.txt"}, MaxFiles: 2, MaxFileBytes: 8, MaxTotalBytes: 12}
}
func stamp() time.Time { return time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC) }
func entries() []Entry {
	return []Entry{{Path: "outputs/a.txt", Bytes: 4, SHA256: "sha256:" + strings.Repeat("d", 64)}, {Path: "outputs/b.txt", Bytes: 8, SHA256: "sha256:" + strings.Repeat("e", 64)}}
}
func quiescence() Quiescence {
	return Quiescence{PodUID: "pod-uid", PVCUID: "pvc-uid", VolumeName: "pv-uid", ComputeReleaseDigest: "sha256:" + strings.Repeat("f", 64), StorageFenceDigest: "sha256:" + strings.Repeat("1", 64), ObservedAt: stamp().Add(time.Second)}
}

func TestPolicyPathsAndBudgets(t *testing.T) {
	for _, path := range []string{"", "/root", "../outside", "a/../b", "a//b", "a/./b", "a/", "C:/file", "a\\b", "file:secret", "a\x00b", "a\nb", ".git/config", "a/.ssh/id_rsa", ".env", "CON", "nul.txt", "a/LPT9.log", "a.", "a ", strings.Repeat("a", 256), strings.Repeat("a/", 32) + "a", string([]byte{0xff})} {
		t.Run(path, func(t *testing.T) {
			if ValidatePath(path) == nil {
				t.Fatal("unsafe path accepted")
			}
		})
	}
	for _, path := range []string{"report.csv", "数据/结果.csv", "out/.hidden", "company.txt"} {
		if err := ValidatePath(path); err != nil {
			t.Fatalf("safe path %q: %v", path, err)
		}
	}
	for _, change := range []func(*Policy){func(p *Policy) { p.Paths = []string{"A", "a"} }, func(p *Policy) { p.Paths = nil }, func(p *Policy) { p.MaxFiles = MaxFiles + 1 }, func(p *Policy) { p.MaxFileBytes = 0 }, func(p *Policy) { p.MaxTotalBytes = MaxTotalBytes + 1 }, func(p *Policy) { p.MaxTotalBytes = 1 }} {
		p := policy()
		change(&p)
		if _, err := p.Canonical(); err == nil {
			t.Fatalf("invalid policy accepted: %+v", p)
		}
	}
	p := policy()
	canonical, err := p.Canonical()
	if err != nil || canonical.Paths[0] != "outputs/a.txt" || p.Paths[0] != "outputs/b.txt" {
		t.Fatalf("canonicalization mutated caller: %+v %v", canonical, err)
	}
}

func TestManifestIdentityCoverageAndIntegrity(t *testing.T) {
	p := policy()
	m, err := NewManifest(source(), p, "export_1", entries(), nil, stamp().Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if m.Validate(p) != nil || m.TotalBytes != 12 || m.Outcome != "complete" || len(m.Entries[0].ID) != 64 {
		t.Fatalf("invalid manifest: %+v", m)
	}
	reversed := entries()
	reversed[0], reversed[1] = reversed[1], reversed[0]
	same, err := NewManifest(source(), p, "export_1", reversed, nil, stamp().Add(2*time.Second))
	if err != nil || !reflect.DeepEqual(m, same) {
		t.Fatal("manifest ordering is not canonical")
	}
	for _, change := range []func(*Manifest){func(m *Manifest) { m.Source.ProjectID = "other" }, func(m *Manifest) { m.Source.Generation++ }, func(m *Manifest) { m.TotalBytes++ }, func(m *Manifest) { m.Entries[0].ObjectKey = "foreign/key" }, func(m *Manifest) { m.Entries[0].SHA256 = "sha256:" + strings.Repeat("0", 64) }, func(m *Manifest) { m.Digest = "sha256:" + strings.Repeat("0", 64) }, func(m *Manifest) { m.Outcome = "succeeded" }} {
		next := m
		next.Entries = append([]Entry(nil), m.Entries...)
		change(&next)
		if next.Validate(p) == nil {
			t.Fatalf("tampered manifest accepted: %+v", next)
		}
	}
	for _, items := range [][]Entry{entries()[:1], append(entries(), entries()[0]), {{Path: "outside", Bytes: 1, SHA256: m.Entries[0].SHA256}}, {{Path: "outputs/a.txt", Bytes: 9, SHA256: m.Entries[0].SHA256}, entries()[1]}, {{Path: "outputs/a.txt", Bytes: -1, SHA256: m.Entries[0].SHA256}, entries()[1]}} {
		if _, err := NewManifest(source(), p, "export_1", items, nil, stamp()); err == nil {
			t.Fatal("invalid coverage/budget accepted")
		}
	}
	if _, err := NewManifest(source(), p, "export_1", entries()[:1], []string{"outputs/b.txt"}, stamp()); !errors.Is(err, ErrNotReady) {
		t.Fatal("missing required output accepted")
	}
	p.AllowMissing = true
	partial, err := NewManifest(source(), p, "export_1", entries()[:1], []string{"outputs/b.txt"}, stamp())
	if err != nil || partial.Outcome != "partial" || partial.Validate(p) != nil {
		t.Fatalf("partial: %+v %v", partial, err)
	}
	if _, err := NewManifest(source(), p, "export_1", entries()[:1], []string{"outputs/b.txt", "outputs/b.txt"}, stamp()); err == nil {
		t.Fatal("duplicate missing entry accepted")
	}
	other := source()
	other.ProjectID = "other"
	if ObjectKey(other, "export_1", "outputs/a.txt", m.Entries[0].SHA256) == m.Entries[0].ObjectKey {
		t.Fatal("cross-project object identity collision")
	}
}

func TestExportQuiescenceCommitAndDataGC(t *testing.T) {
	e, err := NewExport(source(), policy(), "export_1", stamp())
	if err != nil {
		t.Fatal(err)
	}
	m, err := NewManifest(e.Source, e.Policy, e.ID, entries(), nil, stamp().Add(2*time.Second))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.Commit(m); !errors.Is(err, ErrNotReady) {
		t.Fatal("commit before quiescence")
	}
	a := GCApproval{OperationID: "gc_1", ActorID: "operator", ManifestDigest: m.Digest, ApprovedAt: stamp().Add(3 * time.Second)}
	if _, err = e.AllowDataGC(a); !errors.Is(err, ErrNotReady) {
		t.Fatal("data GC before quiescence/commit")
	}
	for _, change := range []func(*Quiescence){func(q *Quiescence) { q.PVCUID = "other" }, func(q *Quiescence) { q.PodUID = "other" }, func(q *Quiescence) { q.StorageFenceDigest = "" }, func(q *Quiescence) { q.ComputeReleaseDigest = "" }, func(q *Quiescence) { q.ObservedAt = stamp().Add(-time.Second) }} {
		q := quiescence()
		change(&q)
		if _, err = e.Begin(q); err == nil {
			t.Fatal("unfenced/wrong source accepted")
		}
	}
	e, err = e.Begin(quiescence())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = e.AllowDataGC(a); !errors.Is(err, ErrNotReady) {
		t.Fatal("GC without committed receipt")
	}
	e, err = e.Commit(m)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := e.Commit(m); err != nil || !reflect.DeepEqual(e, again) {
		t.Fatal("identical commit is not idempotent")
	}
	m.TotalBytes++
	if _, err = e.Commit(m); !errors.Is(err, ErrConflict) {
		t.Fatal("conflicting commit accepted")
	}
	e, err = e.AllowDataGC(a)
	if err != nil {
		t.Fatal(err)
	}
	if again, err := e.AllowDataGC(a); err != nil || !reflect.DeepEqual(e, again) {
		t.Fatal("identical GC receipt not idempotent")
	}
	a.ActorID = "other"
	if _, err = e.AllowDataGC(a); !errors.Is(err, ErrConflict) {
		t.Fatal("changed GC receipt accepted")
	}
	discard, _ := NewExport(source(), policy(), "export_2", stamp())
	discard, _ = discard.Begin(quiescence())
	a = GCApproval{OperationID: "discard_1", ActorID: "operator", Discard: true, ApprovedAt: stamp().Add(3 * time.Second)}
	if _, err = discard.AllowDataGC(a); err == nil {
		t.Fatal("unaudited discard accepted")
	}
	a.Reason = "Explicit user-authorized discard"
	discard, err = discard.AllowDataGC(a)
	if err != nil {
		t.Fatal(err)
	}
	late, _ := NewManifest(discard.Source, discard.Policy, discard.ID, entries(), nil, stamp().Add(4*time.Second))
	if _, err = discard.Commit(late); !errors.Is(err, ErrNotReady) {
		t.Fatal("late export after data GC authorization")
	}
}

func TestCollectorAuthorityAndUploadIdentity(t *testing.T) {
	e, _ := NewExport(source(), policy(), "export", stamp())
	e, _ = e.Begin(quiescence())
	j := CollectorJob{ServiceAccount: "collector", ServiceAccountUID: "sa-uid", Name: "job", Namespace: e.Source.Namespace, ConfigDigest: e.Source.ImageDigest, ExpiresAt: stamp().Add(MaxCollectionDuration)}
	e, _ = e.WithCollectorJob(j, stamp())
	j.UID = "job-uid"
	e, _ = e.WithCollectorJob(j, stamp())
	a := CollectorAuthority{PodName: "collector", JobUID: "job-uid", Namespace: e.Source.Namespace, ServiceAccount: "collector", ServiceAccountUID: "sa-uid", PodUID: "collector-pod", Audience: CollectorAudience, ExpiresAt: stamp().Add(time.Minute)}
	bound, err := e.BindCollector(a, stamp())
	if err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*CollectorAuthority){func(a *CollectorAuthority) { a.Namespace = "other" }, func(a *CollectorAuthority) { a.Audience = "pero-runtime" }, func(a *CollectorAuthority) { a.PodUID = "" }, func(a *CollectorAuthority) { a.ExpiresAt = stamp() }, func(a *CollectorAuthority) { a.ExpiresAt = stamp().Add(MaxCollectionDuration + time.Second) }} {
		next := a
		change(&next)
		if _, err = e.BindCollector(next, stamp()); err == nil {
			t.Fatal("invalid collector authority accepted")
		}
	}
	replacement := a
	replacement.PodUID = "other-pod"
	replacement.ExpiresAt = a.ExpiresAt.Add(time.Minute)
	if _, err = bound.BindCollector(replacement, stamp()); !errors.Is(err, ErrConflict) {
		t.Fatal("live collector identity replaced")
	}
	if _, err = bound.BindCollector(replacement, a.ExpiresAt); err != nil {
		t.Fatal("expired collector could not be replaced", err)
	}
	if _, err = e.FileEntry(EntryID("not-selected"), 1, source().ImageDigest); err == nil {
		t.Fatal("unselected upload accepted")
	}
	if _, err = e.FileEntry(EntryID("outputs/a.txt"), MaxFileBytes, source().ImageDigest); err == nil {
		t.Fatal("oversize upload accepted")
	}
}
