// Adapted from phodal/point@edff76d7dd39b2900cff707af1896fe8ff9fd2dc; see ../../SOURCE_REFERENCES.md.
package kubernetes_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/environments/ports"
	"github.com/phodal/pero/server/internal/environments/providers/kubernetes"
)

// cluster is a minimal in-memory API: the claim controller's effects (a ready
// claim bound to an owned Sandbox and Pod) are part of the fixture.
type cluster struct {
	objects        map[kubernetes.Key]kubernetes.Object
	creates, drops int
	createLost     bool
	failDelete     bool
	lastClaim      map[string]any
	lingering      bool // deletion leaves a terminating claim until the next reconcile
}

func object(raw string) kubernetes.Object {
	var o kubernetes.Object
	if err := json.Unmarshal([]byte(raw), &o); err != nil {
		panic(err)
	}
	return o
}

func newCluster() *cluster { return &cluster{objects: map[kubernetes.Key]kubernetes.Object{}} }

func (c *cluster) Get(_ context.Context, key kubernetes.Key) (kubernetes.Object, error) {
	o, ok := c.objects[key]
	if !ok {
		return kubernetes.Object{}, kubernetes.ErrNotFound
	}
	return model.Clone(o), nil
}

func (c *cluster) CreateClaim(_ context.Context, namespace string, claim map[string]any) (kubernetes.Object, error) {
	c.creates++
	c.lastClaim = claim
	name := claim["metadata"].(map[string]any)["name"].(string)
	key := kubernetes.Key{Kind: "kubernetes.sandboxclaim", Namespace: namespace, Name: name}
	if _, exists := c.objects[key]; exists {
		return kubernetes.Object{}, kubernetes.ErrAlreadyExists
	}
	raw, _ := json.Marshal(claim)
	created := object(string(raw))
	created.Metadata.UID, created.Metadata.ResourceVersion, created.Metadata.Generation = "claim-uid", "1", 1
	created.Status.Sandbox.Name = "warm-1"
	created.Status.Conditions = []struct {
		Type               string `json:"type"`
		Status             string `json:"status"`
		Reason             string `json:"reason"`
		ObservedGeneration int64  `json:"observedGeneration"`
	}{{Type: "Ready", Status: "True", ObservedGeneration: 1}}
	c.objects[key] = created
	// The controller adopts a warm Sandbox and its Pod for the claim.
	c.objects[kubernetes.Key{Kind: "kubernetes.sandbox", Namespace: namespace, Name: "warm-1"}] = object(`{"apiVersion":"agents.x-k8s.io/v1beta1","kind":"Sandbox","metadata":{"name":"warm-1","namespace":"qa","uid":"sandbox-uid","resourceVersion":"4","generation":2,"ownerReferences":[{"apiVersion":"extensions.agents.x-k8s.io/v1beta1","kind":"SandboxClaim","name":"` + name + `","uid":"claim-uid","controller":true}]},"spec":{"operatingMode":"Running"},"status":{"conditions":[{"type":"Ready","status":"True","observedGeneration":2}]}}`)
	p := pod()
	p.Metadata.Name = "warm-1"
	p.Metadata.OwnerReferences[0].Name = "warm-1"
	c.objects[kubernetes.Key{Kind: "kubernetes.pod", Namespace: namespace, Name: "warm-1"}] = p
	if c.createLost {
		return kubernetes.Object{}, errors.New("reply lost")
	}
	return model.Clone(created), nil
}

func (c *cluster) DeleteClaim(_ context.Context, key kubernetes.Key, uid string) error {
	c.drops++
	if c.failDelete {
		return errors.New("api down")
	}
	existing, ok := c.objects[key]
	if !ok {
		return kubernetes.ErrNotFound
	}
	if existing.Metadata.UID != uid {
		return model.ErrIdentity
	}
	if c.lingering {
		existing.Metadata.DeletionTimestamp = "2026-10-24T00:00:00Z"
		c.objects[key] = existing
		return nil
	}
	delete(c.objects, key)
	return nil
}

func claimOwner(t *testing.T, c *cluster) *kubernetes.ClaimOwner {
	t.Helper()
	base, err := kubernetes.NewOwner("cluster-identity", []string{"qa"}, c, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	owner, err := kubernetes.NewClaimOwner(base, c, kubernetes.ClaimConfig{Namespace: "qa", WarmPool: "pool-a", TTL: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	return owner
}

var spec = ports.ProvisionSpec{EnvironmentID: "env-1", SlotID: "sandbox", ResourceKind: kubernetes.ClaimKind, Acquisition: "pool"}

func TestProvisionCreatesOneClaimByDerivedNameWithExpiryAndNoColdStartFields(t *testing.T) {
	c := newCluster()
	owner := claimOwner(t, c)
	ref, err := owner.Provision(context.Background(), "request-1", spec)
	if err != nil || ref.ID != kubernetes.ClaimName("env-1", "sandbox", "request-1") || ref.Incarnation != "claim-uid" || ref.Kind != kubernetes.ClaimKind {
		t.Fatalf("%+v %v", ref, err)
	}
	claimSpec := c.lastClaim["spec"].(map[string]any)
	if _, cold := claimSpec["env"]; cold {
		t.Fatal("env forces a cold start")
	}
	if _, cold := claimSpec["volumeClaimTemplates"]; cold {
		t.Fatal("volumes force a cold start")
	}
	lifecycle := claimSpec["lifecycle"].(map[string]any)
	if lifecycle["shutdownTime"] != now.Add(time.Hour).Format(time.RFC3339) || lifecycle["shutdownPolicy"] != "Delete" {
		t.Fatalf("%v", lifecycle)
	}
	if again, err := owner.Provision(context.Background(), "request-1", spec); err != nil || again != ref || len(c.objects) != 3 {
		t.Fatalf("repeat created another claim: %v", err)
	}
	if other, _ := owner.Provision(context.Background(), "request-2", spec); other.ID == ref.ID {
		t.Fatal("distinct requests share a claim")
	}
	bad := spec
	bad.Acquisition = "provision"
	if _, err := owner.Provision(context.Background(), "request-3", bad); !errors.Is(err, model.ErrInvalid) {
		t.Fatalf("got %v", err)
	}
}

func TestClaimObservationBindsTheOwnedSandboxAndPodAndReportsLeaseExpiry(t *testing.T) {
	c := newCluster()
	owner := claimOwner(t, c)
	ref, _ := owner.Provision(context.Background(), "request-1", spec)
	observation, err := owner.Observe(context.Background(), ref)
	if err != nil || observation.Ready.Status != "True" || observation.Resource != ref || observation.Runtime == nil || observation.Runtime.ID != "pod-uid" {
		t.Fatalf("%+v %v", observation, err)
	}
	if observation.LeaseExpiresAt == nil || !observation.LeaseExpiresAt.Equal(now.Add(time.Hour)) || observation.Attributes["warm-pool"] != "pool-a" {
		t.Fatalf("%+v", observation)
	}
	// A Sandbox the claim does not control is never trusted.
	key := kubernetes.Key{Kind: "kubernetes.sandbox", Namespace: "qa", Name: "warm-1"}
	stolen := c.objects[key]
	stolen.Metadata.OwnerReferences[0].UID = "someone-else"
	c.objects[key] = stolen
	if _, err := owner.Observe(context.Background(), ref); !errors.Is(err, model.ErrIdentity) {
		t.Fatalf("got %v", err)
	}
	// A replacement claim with the same name is a different resource.
	replaced := c.objects[kubernetes.Key{Kind: kubernetes.ClaimKind, Namespace: "qa", Name: ref.ID}]
	replaced.Metadata.UID = "new-claim-uid"
	c.objects[kubernetes.Key{Kind: kubernetes.ClaimKind, Namespace: "qa", Name: ref.ID}] = replaced
	if _, err := owner.Observe(context.Background(), ref); !errors.Is(err, model.ErrIdentity) {
		t.Fatalf("got %v", err)
	}
}

func TestClaimThatExpiredOrHasNoSandboxYetIsNotReady(t *testing.T) {
	c := newCluster()
	owner := claimOwner(t, c)
	ref, _ := owner.Provision(context.Background(), "request-1", spec)
	key := kubernetes.Key{Kind: kubernetes.ClaimKind, Namespace: "qa", Name: ref.ID}
	claim := c.objects[key]
	claim.Status.Sandbox.Name = ""
	c.objects[key] = claim
	if o, err := owner.Observe(context.Background(), ref); err != nil || o.Ready.Status == "True" || o.Ready.Reason != "ClaimNotReady" {
		t.Fatalf("%+v %v", o.Ready, err)
	}
	claim.Spec.Lifecycle.ShutdownTime = now.Format(time.RFC3339)
	c.objects[key] = claim
	if o, err := owner.Observe(context.Background(), ref); err != nil || o.Ready.Reason != "Expired" || o.LeaseExpiresAt == nil {
		t.Fatalf("%+v %v", o.Ready, err)
	}
}

func TestDisposeDeletesByUIDAndSucceedsOnlyOnceTheClaimIsGone(t *testing.T) {
	c := newCluster()
	owner := claimOwner(t, c)
	ref, _ := owner.Provision(context.Background(), "request-1", spec)
	observation, _ := owner.Observe(context.Background(), ref)
	binding := model.Binding{ID: "b", SlotID: "sandbox", Observation: observation, ReleaseIntent: "destroy"}
	if got := owner.SupportedDispositions(); len(got) != 1 || got[0] != "destroy" {
		t.Fatalf("%v", got)
	}
	if _, err := owner.Dispose(context.Background(), "dispose-1", "return", binding); !errors.Is(err, model.ErrInvalid) {
		t.Fatalf("pool return is not a controller operation: %v", err)
	}
	c.lingering = true
	if _, err := owner.Dispose(context.Background(), "dispose-1", "destroy", binding); err == nil {
		t.Fatal("terminating claim reported as disposed")
	}
	if _, err := owner.ReconcileDispose(context.Background(), "dispose-1", "destroy", binding); err == nil {
		t.Fatal("terminating claim reported as disposed on reconcile")
	}
	delete(c.objects, kubernetes.Key{Kind: kubernetes.ClaimKind, Namespace: "qa", Name: ref.ID})
	receipt, err := owner.ReconcileDispose(context.Background(), "dispose-1", "destroy", binding)
	if err != nil || receipt.ID != "dispose-1" {
		t.Fatalf("%+v %v", receipt, err)
	}
	// Disposal never touches a claim that is not the one that was bound.
	other := binding
	other.Observation.Resource.Incarnation = "never-bound"
	c.lingering = false
	again, _ := owner.Provision(context.Background(), "request-1", spec)
	if _, err := owner.Dispose(context.Background(), "dispose-2", "destroy", other); err == nil {
		t.Fatal("deleted a claim with a different UID")
	}
	if _, ok := c.objects[kubernetes.Key{Kind: kubernetes.ClaimKind, Namespace: "qa", Name: again.ID}]; !ok {
		t.Fatal("the newer claim was removed")
	}
}

func TestHTTPWriterSpeaksTheClaimAPIAndMapsConflictAndAbsence(t *testing.T) {
	var methods, paths []string
	var deleteBody map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods, paths = append(methods, r.Method), append(paths, r.URL.Path)
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/apis/extensions.agents.x-k8s.io/v1beta1/namespaces/qa/sandboxclaims" && len(methods) == 1:
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"apiVersion":"extensions.agents.x-k8s.io/v1beta1","kind":"SandboxClaim","metadata":{"name":"c","namespace":"qa","uid":"u","resourceVersion":"1","annotations":{"secret":"x","agents.x-k8s.io/pod-name":"kept"}}}`))
		case r.Method == http.MethodPost:
			w.WriteHeader(http.StatusConflict)
		default:
			json.NewDecoder(r.Body).Decode(&deleteBody)
			if len(methods) == 3 {
				w.WriteHeader(http.StatusOK)
				return
			}
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	writer, err := kubernetes.NewHTTPWriter(server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	created, err := writer.CreateClaim(context.Background(), "qa", map[string]any{"kind": "SandboxClaim"})
	if err != nil || created.Metadata.UID != "u" || created.Metadata.PodName != "kept" {
		t.Fatalf("%+v %v", created, err)
	}
	if _, err := writer.CreateClaim(context.Background(), "qa", map[string]any{}); !errors.Is(err, kubernetes.ErrAlreadyExists) {
		t.Fatalf("got %v", err)
	}
	key := kubernetes.Key{Namespace: "qa", Name: "c"}
	if err := writer.DeleteClaim(context.Background(), key, "u"); err != nil {
		t.Fatal(err)
	}
	if deleteBody["propagationPolicy"] != "Foreground" || deleteBody["preconditions"].(map[string]any)["uid"] != "u" {
		t.Fatalf("%v", deleteBody)
	}
	if err := writer.DeleteClaim(context.Background(), key, "u"); !errors.Is(err, kubernetes.ErrNotFound) {
		t.Fatalf("got %v", err)
	}
	if _, err := kubernetes.NewHTTPWriter("http://example.com", http.DefaultClient); err == nil {
		t.Fatal("plaintext remote API accepted")
	}
}
