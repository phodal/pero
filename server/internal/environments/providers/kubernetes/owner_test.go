// Adapted from phodal/point@edff76d7dd39b2900cff707af1896fe8ff9fd2dc; see ../../SOURCE_REFERENCES.md.
package kubernetes_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
)

var now = time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)

func pod() kubernetes.Object {
	var object kubernetes.Object
	if err := json.Unmarshal([]byte(`{"apiVersion":"v1","kind":"Pod","metadata":{"name":"sample","namespace":"qa","uid":"pod-uid","resourceVersion":"3","ownerReferences":[{"apiVersion":"agents.x-k8s.io/v1beta1","kind":"Sandbox","name":"sample","uid":"sandbox-uid","controller":true}]},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}],"containerStatuses":[{"name":"app","containerID":"containerd://original","imageID":"sha256:actual-image","restartCount":0,"ready":true,"state":{"running":{}}}]}}`), &object); err != nil {
		panic(err)
	}
	return object
}
func sandbox() kubernetes.Object {
	var object kubernetes.Object
	if err := json.Unmarshal([]byte(`{"apiVersion":"agents.x-k8s.io/v1beta1","kind":"Sandbox","metadata":{"name":"sample","namespace":"qa","uid":"sandbox-uid","resourceVersion":"4","generation":2},"spec":{"operatingMode":"Running"},"status":{"conditions":[{"type":"Ready","status":"True","observedGeneration":2}]}}`), &object); err != nil {
		panic(err)
	}
	return object
}

type reader struct {
	pod, sandbox kubernetes.Object
	reads        int
}

func (r *reader) Get(_ context.Context, key kubernetes.Key) (kubernetes.Object, error) {
	r.reads++
	if key.Namespace != "qa" || key.Name != "sample" {
		return kubernetes.Object{}, errors.New("wrong key")
	}
	if key.Kind == "kubernetes.pod" {
		return model.Clone(r.pod), nil
	}
	if key.Kind == "kubernetes.sandbox" {
		return model.Clone(r.sandbox), nil
	}
	return kubernetes.Object{}, errors.New("unsupported resource")
}
func setup(t *testing.T, r kubernetes.Reader, kind string) (*kubernetes.Owner, model.ResourceRef) {
	t.Helper()
	owner, err := kubernetes.NewOwner("cluster-identity", []string{"qa"}, r, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	uid := "pod-uid"
	if kind == "kubernetes.sandbox" {
		uid = "sandbox-uid"
	}
	return owner, model.ResourceRef{Owner: owner.Owner(), Kind: kind, Scope: "qa", ID: "sample", Incarnation: uid}
}

func TestPodObservationPinsActualRuntimeAndImagesWithoutGrantingTools(t *testing.T) {
	r := &reader{pod: pod()}
	owner, ref := setup(t, r, "kubernetes.pod")
	first, err := owner.Observe(context.Background(), ref)
	if err != nil || first.Ready.Status != "True" || first.Runtime.ID != "pod-uid" || first.States[0].ID != "sha256:actual-image" {
		t.Fatalf("%+v %v", first, err)
	}
	r.pod.Status.ContainerStatuses[0].RestartCount++
	second, err := owner.Observe(context.Background(), ref)
	if err != nil || second.Resource != first.Resource || second.Runtime.Digest == first.Runtime.Digest {
		t.Fatal("runtime restart did not change execution identity")
	}
	r.pod.Metadata.UID = "replacement"
	if _, err := owner.Observe(context.Background(), ref); !errors.Is(err, model.ErrIdentity) {
		t.Fatal("same-name Pod was adopted")
	}
	ref.Scope = "another-project"
	before := r.reads
	if _, err := owner.Observe(context.Background(), ref); err == nil || r.reads != before {
		t.Fatal("queried an unconfigured namespace")
	}
}

func TestRunningAndStartingAreNotReadyAndDoNotPinAnIncompleteRuntime(t *testing.T) {
	r := &reader{pod: pod()}
	owner, ref := setup(t, r, "kubernetes.pod")
	r.pod.Status.Conditions[0].Status = "False"
	observation, err := owner.Observe(context.Background(), ref)
	if err != nil || observation.Ready.Status != "False" {
		t.Fatal("Running phase implied readiness")
	}
	r.pod.Status.ContainerStatuses[0].ContainerID = ""
	observation, err = owner.Observe(context.Background(), ref)
	if err != nil || observation.Runtime != nil {
		t.Fatal("incomplete execution identity was pinned")
	}
}

func TestSandboxIdentityIncludesItsOwnedPodAndObservedGeneration(t *testing.T) {
	r := &reader{pod: pod(), sandbox: sandbox()}
	owner, ref := setup(t, r, "kubernetes.sandbox")
	first, err := owner.Observe(context.Background(), ref)
	if err != nil || first.Ready.Status != "True" || first.Resource.Incarnation != "sandbox-uid" || first.Runtime.ID != "pod-uid" {
		t.Fatalf("%+v %v", first, err)
	}
	r.pod.Metadata.UID = "new-pod-uid"
	second, err := owner.Observe(context.Background(), ref)
	if err != nil || second.Resource != first.Resource || second.Runtime.ID == first.Runtime.ID {
		t.Fatal("controller identity was confused with execution identity")
	}
	r.pod.Metadata.OwnerReferences[0].UID = "foreign-sandbox"
	if _, err := owner.Observe(context.Background(), ref); !errors.Is(err, model.ErrIdentity) {
		t.Fatal("foreign Pod accepted")
	}
	r.pod = pod()
	r.sandbox.Metadata.Generation++
	observation, err := owner.Observe(context.Background(), ref)
	if err != nil || observation.Ready.Status != "False" || observation.Ready.Reason != "SandboxNotReady" {
		t.Fatal("old generation readiness accepted")
	}
	r.sandbox = sandbox()
	r.sandbox.Spec.OperatingMode = "Suspended"
	observation, err = owner.Observe(context.Background(), ref)
	if err != nil || observation.Ready.Reason != "Suspended" {
		t.Fatal("suspended Sandbox admitted")
	}
	r.sandbox = sandbox()
	r.sandbox.Spec.ShutdownTime = now.Add(-time.Second).Format(time.RFC3339)
	observation, err = owner.Observe(context.Background(), ref)
	if err != nil || observation.Ready.Reason != "Expired" {
		t.Fatal("expired Sandbox admitted")
	}
}

func TestHTTPAdapterReadsOnlySupportedPathsAndProjectsNoPrivatePodFields(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodGet || r.URL.Path != "/api/v1/namespaces/qa/pods/sample" {
			t.Error(r.Method, r.URL.Path)
			w.WriteHeader(400)
			return
		}
		data, _ := json.Marshal(pod())
		var raw map[string]any
		json.Unmarshal(data, &raw)
		raw["spec"] = map[string]any{"containers": []any{map[string]any{"env": []any{map[string]any{"name": "TOKEN", "value": "must-stay-private"}}}}}
		json.NewEncoder(w).Encode(raw)
	}))
	defer server.Close()
	client, err := kubernetes.NewHTTPReader(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	owner, ref := setup(t, client, "kubernetes.pod")
	observation, err := owner.Observe(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(observation)
	if strings.Contains(string(data), "must-stay-private") || strings.Contains(string(data), "TOKEN") {
		t.Fatal("private configuration escaped")
	}
	if _, err := client.Get(context.Background(), kubernetes.Key{Kind: "secret", Namespace: "qa", Name: "sample"}); err == nil || requests != 1 {
		t.Fatal("unsupported API request dispatched")
	}
	if _, err := owner.Detach(context.Background(), "detach-1", model.Binding{Observation: observation, ReleaseIntent: "detach"}); err != nil || requests != 1 {
		t.Fatal("attachment release performed a Kubernetes mutation")
	}
}

func TestHTTPAdapterRejectsRedirectsAndOversizedResponses(t *testing.T) {
	forwarded := 0
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { forwarded++ }))
	defer target.Close()
	redirect := true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if redirect {
			http.Redirect(w, r, target.URL, 302)
			return
		}
		w.Write([]byte(strings.Repeat(" ", (2<<20)+1)))
	}))
	defer server.Close()
	client, err := kubernetes.NewHTTPReader(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	key := kubernetes.Key{Kind: "kubernetes.pod", Namespace: "qa", Name: "sample"}
	if _, err := client.Get(context.Background(), key); err == nil || forwarded != 0 {
		t.Fatal("redirect was followed")
	}
	redirect = false
	if _, err := client.Get(context.Background(), key); err == nil || !strings.Contains(err.Error(), "byte limit") {
		t.Fatal(err)
	}
	writer, _ := kubernetes.NewHTTPWriter(server.URL, server.Client())
	if _, err := writer.CreateClaim(t.Context(), "qa", map[string]any{}); err == nil || !strings.Contains(err.Error(), "byte limit") {
		t.Fatalf("oversized create response accepted: %v", err)
	}
}

func TestObservedArtifactsAreOnlyDigestsTheKubeletActuallyReported(t *testing.T) {
	const (
		manifest = "sha256:dc700a37ecf4e680a146098a30996f420507e76e83a27dbd293f2b8114b14daa"
		content  = "sha256:b9d6fe9d2fc3a742e8e42ec4ddd4b62d38df61b714ef4203963ea0bf30c01758"
	)
	for name, tc := range map[string]struct {
		imageID, kind string // an empty kind means no artifact
	}{
		"pulled":   {"registry.k8s.io/app/server@" + manifest, "container-image"},
		"dockerd":  {"docker-pullable://registry.k8s.io/app/server@" + manifest, "container-image"},
		"imported": {content, "container-image-id"},
		"short":    {"sha256:actual-image", ""},
		"tag":      {"registry.k8s.io/app/server:v1", ""},
		"upper":    {"repo@sha256:" + strings.ToUpper(manifest[7:]), ""},
		"trailing": {"repo@" + manifest + "x", ""},
	} {
		t.Run(name, func(t *testing.T) {
			r := &reader{pod: pod()}
			r.pod.Status.ContainerStatuses[0].ImageID = tc.imageID
			owner, ref := setup(t, r, "kubernetes.pod")
			observation, err := owner.Observe(context.Background(), ref)
			if err != nil || observation.Ready.Status != "True" {
				t.Fatalf("%+v %v", observation, err)
			}
			if tc.kind == "" {
				if len(observation.Artifacts) != 0 {
					t.Fatalf("guessed an artifact from %q: %+v", tc.imageID, observation.Artifacts)
				}
				return
			}
			if len(observation.Artifacts) != 1 || observation.Artifacts[0].Kind != tc.kind || observation.Artifacts[0].Revision != "app" || observation.Artifacts[0].Digest != tc.imageID[strings.LastIndex(tc.imageID, "sha256:"):] {
				t.Fatalf("%+v", observation.Artifacts)
			}
		})
	}
}

func TestResolveReportsTheCurrentIncarnationThatAttachThenObserves(t *testing.T) {
	r := &reader{pod: pod(), sandbox: sandbox()}
	for _, kind := range []string{"kubernetes.pod", "kubernetes.sandbox"} {
		owner, want := setup(t, r, kind)
		named := want
		named.Incarnation = ""
		got, err := owner.Resolve(t.Context(), named)
		if err != nil || got != want {
			t.Fatalf("%s: got %+v %v, want %+v", kind, got, err, want)
		}
		if _, err := owner.Observe(t.Context(), got); err != nil {
			t.Fatalf("%s: resolved identity is not observable: %v", kind, err)
		}
	}
	owner, ref := setup(t, r, "kubernetes.pod")
	for name, bad := range map[string]model.ResourceRef{
		"incarnation given": ref,
		"other namespace":   {Owner: ref.Owner, Kind: ref.Kind, Scope: "prod", ID: "sample"},
		"unsupported kind":  {Owner: ref.Owner, Kind: kubernetes.ClaimKind, Scope: "qa", ID: "sample"},
	} {
		if _, err := owner.Resolve(t.Context(), bad); !errors.Is(err, model.ErrInvalid) {
			t.Fatalf("%s: %v", name, err)
		}
	}
	missing, _ := setup(t, absent{}, "kubernetes.pod")
	if _, err := missing.Resolve(t.Context(), model.ResourceRef{Owner: ref.Owner, Kind: ref.Kind, Scope: "qa", ID: "gone"}); !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("missing: %v", err)
	}
}

type absent struct{}

func (absent) Get(context.Context, kubernetes.Key) (kubernetes.Object, error) {
	return kubernetes.Object{}, kubernetes.ErrNotFound
}
