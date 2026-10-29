package httpapi_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/artifacts"
	"github.com/phodal/pero/server/internal/httpapi"
	"github.com/phodal/pero/server/internal/store"
)

type artifactObjects struct {
	mu      sync.Mutex
	data    map[string][]byte
	corrupt bool
}

func (o *artifactObjects) Put(_ context.Context, e artifacts.Entry, r io.Reader) error {
	b, err := io.ReadAll(io.LimitReader(r, e.Bytes+1))
	if err != nil {
		return err
	}
	sum := sha256.Sum256(b)
	if int64(len(b)) != e.Bytes || "sha256:"+hex.EncodeToString(sum[:]) != e.SHA256 {
		return artifacts.ErrConflict
	}
	o.mu.Lock()
	defer o.mu.Unlock()
	if old, ok := o.data[e.ObjectKey]; ok && !bytes.Equal(old, b) {
		return artifacts.ErrConflict
	}
	o.data[e.ObjectKey] = b
	return nil
}
func (o *artifactObjects) Read(_ context.Context, e artifacts.Entry) ([]byte, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.corrupt {
		return []byte("corrupt"), nil
	}
	b, ok := o.data[e.ObjectKey]
	if !ok {
		return nil, store.ErrNotFound
	}
	return bytes.Clone(b), nil
}

func TestArtifactCollectorAndAuthorizedDownload(t *testing.T) {
	ctx := context.Background()
	objects := &artifactObjects{data: map[string][]byte{}}
	var e artifacts.Export
	var db *store.Store
	var member, foreign string
	server := testAPI(t, func(s *store.Store) http.Handler {
		db = s
		e = seedArtifactExport(t, s, time.Minute)
		var err error
		_, member, err = s.CreateClient(ctx, "member", []string{"project"})
		if err != nil {
			t.Fatal(err)
		}
		_, foreign, err = s.CreateClient(ctx, "foreign", []string{"other"})
		if err != nil {
			t.Fatal(err)
		}
		reads := httpapi.HandlerWithArtifacts(s, "test-operator", objects)
		upload := httpapi.ArtifactCollectorHandler(s, objects, func(_ context.Context, token, id string) error {
			if token != "synthetic-collector-token" || id != e.ID {
				return errors.New("online identity fixture rejected")
			}
			return nil
		})
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, "/api/artifact-export/") {
				upload.ServeHTTP(w, r)
			} else {
				reads.ServeHTTP(w, r)
			}
		})
	})
	list := "/api/client/v1/runs/" + e.Source.RunID + "/artifacts"
	request(t, server, "GET", list, "", nil, "", 401)
	request(t, server, "GET", list, foreign, nil, "", 404)
	request(t, server, "GET", "/api/artifact-export/v1/"+e.ID, member, nil, "", 403)
	request(t, server, "GET", "/api/artifact-export/v1/other", "synthetic-collector-token", nil, "", 403)
	request(t, server, "GET", "/api/artifact-export/v1/"+e.ID, "synthetic-collector-token", nil, "", 200)
	data := []byte("result")
	sum := sha256.Sum256(data)
	file, err := e.FileEntry(artifacts.EntryID("result.txt"), int64(len(data)), "sha256:"+hex.EncodeToString(sum[:]))
	if err != nil {
		t.Fatal(err)
	}
	m, err := artifacts.NewManifest(e.Source, e.Policy, e.ID, []artifacts.Entry{file}, nil, e.Quiescence.ObservedAt)
	if err != nil {
		t.Fatal(err)
	}
	request(t, server, "POST", "/api/artifact-export/v1/"+e.ID+"/commit", "synthetic-collector-token", m, "", 409)
	put := func(id, digest string, body []byte, want int) {
		t.Helper()
		req, _ := http.NewRequest(http.MethodPut, server.URL+"/api/artifact-export/v1/"+e.ID+"/files/"+id, bytes.NewReader(body))
		req.Header.Set("Authorization", "Bearer synthetic-collector-token")
		req.Header.Set("X-Artifact-Sha256", digest)
		resp, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != want {
			b, _ := io.ReadAll(resp.Body)
			t.Fatalf("PUT=%d want%d %s", resp.StatusCode, want, b)
		}
	}
	put(artifacts.EntryID("not-selected"), file.SHA256, data, 400)
	put(file.ID, file.SHA256, data, 200)
	put(file.ID, file.SHA256, data, 200)
	request(t, server, "POST", "/api/artifact-export/v1/"+e.ID+"/commit", "synthetic-collector-token", m, "", 200)
	request(t, server, "POST", "/api/artifact-export/v1/"+e.ID+"/commit", "synthetic-collector-token", m, "", 200)
	listing := request(t, server, "GET", list, member, nil, "", 200)
	if bytes.Contains(listing, []byte("object_key")) || bytes.Contains(listing, []byte("pvc")) || !bytes.Contains(listing, []byte(m.Digest)) {
		t.Fatalf("unsafe list projection: %s", listing)
	}
	download := list + "/" + e.ID + "/files/" + file.ID
	request(t, server, "GET", download, foreign, nil, "", 404)
	request(t, server, "GET", list+"/"+e.ID+"/files/unknown", member, nil, "", 404)
	req, _ := http.NewRequest(http.MethodGet, server.URL+download, nil)
	req.Header.Set("Authorization", "Bearer "+member)
	resp, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Equal(got, data) || !strings.HasPrefix(resp.Header.Get("Content-Disposition"), "attachment;") || resp.Header.Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("download not an isolated exact attachment: %d %q", resp.StatusCode, got)
	}
	objects.mu.Lock()
	objects.corrupt = true
	objects.mu.Unlock()
	request(t, server, "GET", download, member, nil, "", 500)
	// A bogus caller-supplied project cannot authorize a different Run's files.
	if _, err = db.ClientArtifactExports(ctx, &store.Client{Projects: []string{"other"}}, e.Source.RunID); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("manifest project bypass", err)
	}
	var plan artifacts.Export
	json.Unmarshal(request(t, server, "GET", "/api/artifact-export/v1/"+e.ID, "synthetic-collector-token", nil, "", 200), &plan)
	if plan.Manifest == nil || plan.Manifest.Digest != m.Digest {
		t.Fatal("lost commit response not recoverable through original plan")
	}
}

func seedArtifactExport(t *testing.T, s *store.Store, lifetime time.Duration) artifacts.Export {
	t.Helper()
	ctx := context.Background()
	w, _, err := s.CreateWorker(ctx, "worker", []string{"project"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.CreateTask(ctx, store.Spec{Title: "Artifact", Prompt: "Produce file", Acceptance: "inspect", ProjectID: "project", WorkspaceKey: "repo", AgentID: "fixture"}, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.Dispatch(ctx, task.ID, w.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	source := artifacts.Source{ProjectID: "project", TaskID: task.ID, RunID: run.ID, Generation: run.Generation, ClusterID: "cluster", Namespace: "project", SandboxUID: "sandbox", PodUID: "pod", PVCName: "volume", PVCUID: "pvc", VolumeName: "pv", ImageDigest: "sha256:" + strings.Repeat("a", 64), TemplateDigest: "sha256:" + strings.Repeat("b", 64), WorkspaceRevision: strings.Repeat("c", 40)}
	e, err := s.ReserveArtifactExport(ctx, source, artifacts.Policy{Paths: []string{"result.txt"}, MaxFiles: 1, MaxFileBytes: 16, MaxTotalBytes: 16}, "export_1")
	if err != nil {
		t.Fatal(err)
	}
	e, err = s.BeginArtifactExport(ctx, e.ID, e.Version, artifacts.Quiescence{PodUID: source.PodUID, PVCUID: source.PVCUID, VolumeName: source.VolumeName, ComputeReleaseDigest: source.ImageDigest, StorageFenceDigest: source.TemplateDigest, ObservedAt: e.CreatedAt})
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(lifetime)
	j := artifacts.CollectorJob{ServiceAccount: "collector", ServiceAccountUID: "collector-sa", Name: "collector", Namespace: source.Namespace, ConfigDigest: source.ImageDigest, ExpiresAt: deadline}
	e, err = s.SaveArtifactCollectorJob(ctx, e.ID, e.Version, j)
	if err != nil {
		t.Fatal(err)
	}
	j.UID = "collector-job"
	e, err = s.SaveArtifactCollectorJob(ctx, e.ID, e.Version, j)
	if err != nil {
		t.Fatal(err)
	}
	e, err = s.BindArtifactCollector(ctx, e.ID, e.Version, artifacts.CollectorAuthority{PodName: "collector", JobUID: "collector-job", Namespace: source.Namespace, ServiceAccount: "collector", ServiceAccountUID: "collector-sa", PodUID: "collector-pod", Audience: artifacts.CollectorAudience, ExpiresAt: deadline})
	if err != nil {
		t.Fatal(err)
	}
	return e
}

func TestArtifactCollectorStalledBodyReleasesTransport(t *testing.T) {
	objects := &artifactObjects{data: map[string][]byte{}}
	var e artifacts.Export
	finished := make(chan struct{})
	server := testAPI(t, func(db *store.Store) http.Handler {
		e = seedArtifactExport(t, db, 500*time.Millisecond)
		handler := httpapi.ArtifactCollectorHandler(db, objects, func(context.Context, string, string) error { return nil })
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { defer close(finished); handler.ServeHTTP(w, r) })
	})
	conn, err := net.Dial("tcp", strings.TrimPrefix(server.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	sum := sha256.Sum256([]byte("result"))
	fmt.Fprintf(conn, "PUT /api/artifact-export/v1/%s/files/%s HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer synthetic\r\nContent-Length: 6\r\nX-Artifact-Sha256: sha256:%x\r\n\r\nr", e.ID, artifacts.EntryID("result.txt"), sum)
	select {
	case <-finished:
	case <-time.After(3 * time.Second):
		t.Fatal("stalled collector retained handler beyond authority deadline")
	}
	objects.mu.Lock()
	defer objects.mu.Unlock()
	if len(objects.data) != 0 {
		t.Fatal("partial body became a verified object")
	}
}
