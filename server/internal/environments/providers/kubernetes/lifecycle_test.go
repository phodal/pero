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

func TestClaimAdmissionRequiresTTLAndCurrentReadiness(t *testing.T) {
	for name, mutate := range map[string]func(*kubernetes.Object){
		"missing TTL":      func(o *kubernetes.Object) { o.Spec.Lifecycle.ShutdownTime = "" },
		"invalid TTL":      func(o *kubernetes.Object) { o.Spec.Lifecycle.ShutdownTime = "forever" },
		"stale generation": func(o *kubernetes.Object) { o.Metadata.Generation++ },
	} {
		t.Run(name, func(t *testing.T) {
			c := newCluster()
			owner := claimOwner(t, c)
			ref, err := owner.Provision(t.Context(), "request-1", spec)
			if err != nil {
				t.Fatal(err)
			}
			key := kubernetes.Key{Kind: kubernetes.ClaimKind, Namespace: "qa", Name: ref.ID}
			claim := c.objects[key]
			mutate(&claim)
			c.objects[key] = claim
			if got, err := owner.Observe(t.Context(), ref); err == nil && got.Ready.Status == "True" {
				t.Fatalf("unsafe claim admitted: %+v", got)
			}
		})
	}
	base, _ := kubernetes.NewOwner("cluster", []string{"qa"}, newCluster(), nil)
	for _, ttl := range []time.Duration{0, -time.Second, 8 * 24 * time.Hour} {
		if _, err := kubernetes.NewClaimOwner(base, newCluster(), kubernetes.ClaimConfig{Namespace: "qa", WarmPool: "pool", TTL: ttl}); !errors.Is(err, model.ErrInvalid) {
			t.Fatalf("TTL %s: %v", ttl, err)
		}
	}
}

func TestReconcileProvisionCannotAdoptAnotherConfigurationOrRecreateAbsence(t *testing.T) {
	c := newCluster()
	owner := claimOwner(t, c)
	ref, err := owner.Provision(t.Context(), "request-1", spec)
	if err != nil {
		t.Fatal(err)
	}
	base, _ := kubernetes.NewOwner("cluster-identity", []string{"qa"}, c, func() time.Time { return now })
	changed, _ := kubernetes.NewClaimOwner(base, c, kubernetes.ClaimConfig{Namespace: "qa", WarmPool: "pool-a", TTL: 2 * time.Hour})
	if _, err := changed.ReconcileProvision(t.Context(), "request-1", spec); !errors.Is(err, model.ErrIdentity) {
		t.Fatalf("changed config adopted claim: %v", err)
	}
	delete(c.objects, kubernetes.Key{Kind: kubernetes.ClaimKind, Namespace: "qa", Name: ref.ID})
	if _, err := owner.ReconcileProvision(t.Context(), "request-1", spec); !errors.Is(err, kubernetes.ErrNotFound) || c.creates != 1 {
		t.Fatalf("absence recreated: %v, creates %d", err, c.creates)
	}
}

func TestDestructionRequiresAnActualUIDBeforeAnyRequest(t *testing.T) {
	c := newCluster()
	owner := claimOwner(t, c)
	ref, err := owner.Provision(t.Context(), "request-1", spec)
	if err != nil {
		t.Fatal(err)
	}
	ref.Incarnation = ""
	if _, err := owner.Dispose(t.Context(), "destroy-1", "destroy", model.Binding{Observation: model.Observation{Resource: ref}}); !errors.Is(err, model.ErrInvalid) || c.drops != 0 {
		t.Fatalf("empty UID sent: %v, deletes %d", err, c.drops)
	}
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests++ }))
	defer server.Close()
	writer, _ := kubernetes.NewHTTPWriter(server.URL, server.Client())
	if err := writer.DeleteClaim(t.Context(), kubernetes.Key{Namespace: "qa", Name: "claim"}, ""); !errors.Is(err, model.ErrInvalid) || requests != 0 {
		t.Fatalf("HTTP empty UID sent: %v, requests %d", err, requests)
	}
}

// The HTTP shell proves the real client handles a committed create/delete whose
// response connection is lost. It does not simulate a controller installation.
func TestHTTPUnknownResponsesReconcileOriginalClaimAndUIDSafeCleanup(t *testing.T) {
	c := newCluster()
	posts, deletes := 0, 0
	lostCreate, lostDelete := true, true
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		kind := kubernetes.ClaimKind
		name := parts[len(parts)-1]
		if strings.Contains(r.URL.Path, "/pods/") {
			kind = "kubernetes.pod"
		}
		if strings.Contains(r.URL.Path, "/sandboxes/") {
			kind = "kubernetes.sandbox"
		}
		key := kubernetes.Key{Kind: kind, Namespace: "qa", Name: name}
		var got kubernetes.Object
		var err error
		switch r.Method {
		case http.MethodPost:
			posts++
			var claim map[string]any
			if err = json.NewDecoder(r.Body).Decode(&claim); err == nil {
				got, err = c.CreateClaim(r.Context(), "qa", claim)
			}
			if lostCreate {
				lostCreate = false
				conn, _, _ := w.(http.Hijacker).Hijack()
				conn.Close()
				return
			}
		case http.MethodDelete:
			deletes++
			var options struct {
				PropagationPolicy string `json:"propagationPolicy"`
				Preconditions     struct {
					UID string `json:"uid"`
				} `json:"preconditions"`
			}
			if err = json.NewDecoder(r.Body).Decode(&options); err == nil {
				if options.PropagationPolicy != "Foreground" || options.Preconditions.UID != "claim-uid" {
					t.Error("delete lacks foreground UID precondition")
				}
				err = c.DeleteClaim(r.Context(), key, options.Preconditions.UID)
			}
			if lostDelete {
				lostDelete = false
				conn, _, _ := w.(http.Hijacker).Hijack()
				conn.Close()
				return
			}
		default:
			got, err = c.Get(r.Context(), key)
		}
		if errors.Is(err, kubernetes.ErrNotFound) {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		if errors.Is(err, kubernetes.ErrAlreadyExists) || errors.Is(err, model.ErrIdentity) {
			w.WriteHeader(http.StatusConflict)
			return
		}
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusCreated)
		}
		json.NewEncoder(w).Encode(got)
	}))
	defer server.Close()
	reader, _ := kubernetes.NewHTTPReader(server.URL, server.Client())
	writer, _ := kubernetes.NewHTTPWriter(server.URL, server.Client())
	base, _ := kubernetes.NewOwner("cluster-identity", []string{"qa"}, reader, func() time.Time { return now })
	owner, _ := kubernetes.NewClaimOwner(base, writer, kubernetes.ClaimConfig{Namespace: "qa", WarmPool: "pool-a", TTL: time.Hour})
	if _, err := owner.Provision(context.Background(), "request-1", spec); err == nil {
		t.Fatal("lost create response not reported")
	}
	ref, err := owner.ReconcileProvision(t.Context(), "request-1", spec)
	if err != nil || posts != 1 || ref.Incarnation != "claim-uid" {
		t.Fatalf("lost create reconciliation: %+v %v posts=%d", ref, err, posts)
	}
	observation, err := owner.Observe(t.Context(), ref)
	if err != nil || observation.Ready.Status != "True" || observation.Runtime.ID != "pod-uid" {
		t.Fatalf("HTTP observation: %+v %v", observation, err)
	}
	binding := model.Binding{Observation: observation, ReleaseIntent: "destroy"}
	if _, err := owner.Dispose(t.Context(), "destroy-1", "destroy", binding); err == nil {
		t.Fatal("lost delete response not reported")
	}
	receipt, err := owner.ReconcileDispose(t.Context(), "destroy-1", "destroy", binding)
	if err != nil || receipt.ID != "destroy-1" || deletes != 1 || posts != 1 {
		t.Fatalf("lost delete reconciliation: %+v %v deletes=%d posts=%d", receipt, err, deletes, posts)
	}
}
