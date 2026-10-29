package kubernetes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
)

type coldAPI struct {
	mu                             sync.Mutex
	objects                        map[string]map[string]any
	posts, deletes                 map[string]int
	lostCreate, lostDelete, linger map[string]bool
	image                          string
	uid                            int
}

func coldFixture(t *testing.T) (*ColdOwner, *coldAPI) {
	t.Helper()
	digest := "sha256:" + strings.Repeat("a", 64)
	config := ColdConfig{Namespace: "isolated", ClusterID: "cluster", ImageRef: "registry.invalid/agent@" + digest, ImageDigest: digest, RuntimeClass: "gvisor", ServiceAccountName: "run-agent", ServiceAccountUID: "sa-uid", Audience: "pero-runtime", ControlURL: "https://control.invalid", ControlCAFile: "/etc/pero/control-ca.pem", StorageClass: "test-csi", StorageAccessMode: "ReadWriteOncePod", VolumeSize: "1Gi", WorkspaceRevision: strings.Repeat("b", 40), Model: "fixed-model", TTLSeconds: 600}
	config.TemplateDigest, _ = ColdTemplateDigest(config)
	fake := &coldAPI{objects: map[string]map[string]any{}, posts: map[string]int{}, deletes: map[string]int{}, lostCreate: map[string]bool{}, lostDelete: map[string]bool{}, linger: map[string]bool{}, image: config.ImageRef}
	fake.objects["serviceaccounts/run-agent"] = map[string]any{"apiVersion": "v1", "kind": "ServiceAccount", "metadata": map[string]any{"name": "run-agent", "namespace": "isolated", "uid": "sa-uid", "resourceVersion": "1"}}
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	owner, err := NewColdOwner(server.URL, server.Client(), config, func() time.Time { return time.Date(2026, 10, 29, 12, 0, 0, 0, time.UTC) })
	if err != nil {
		t.Fatal(err)
	}
	return owner, fake
}
func (c *coldAPI) change(fn func(*coldAPI)) { c.mu.Lock(); defer c.mu.Unlock(); fn(c) }
func (c *coldAPI) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	defer c.mu.Unlock()
	parts := strings.Split(r.URL.Path, "/")
	at := 0
	for i, p := range parts {
		if p == "namespaces" {
			at = i + 2
			break
		}
	}
	if at == 0 || at >= len(parts) {
		w.WriteHeader(400)
		return
	}
	kind := parts[at]
	name := ""
	if len(parts) > at+1 {
		name = parts[at+1]
	}
	key := kind + "/" + name
	switch r.Method {
	case http.MethodPost:
		c.posts[kind]++
		var value map[string]any
		if json.NewDecoder(r.Body).Decode(&value) != nil {
			w.WriteHeader(400)
			return
		}
		meta := value["metadata"].(map[string]any)
		name = meta["name"].(string)
		key = kind + "/" + name
		if _, exists := c.objects[key]; exists {
			w.WriteHeader(409)
			return
		}
		c.uid++
		uid := kind + "-uid-" + string(rune('a'+c.uid))
		meta["uid"], meta["resourceVersion"], meta["generation"] = uid, "1", 1
		if kind == "persistentvolumeclaims" {
			value["status"] = map[string]any{"phase": "Pending"}
		}
		if kind == "sandboxes" {
			value["status"] = map[string]any{"conditions": []any{map[string]any{"type": "Ready", "status": "True", "observedGeneration": 1}}}
			spec := value["spec"].(map[string]any)
			podSpec := cloneMap(spec["podTemplate"].(map[string]any)["spec"].(map[string]any))
			volumes := podSpec["volumes"].([]any)
			pvcName := volumes[0].(map[string]any)["persistentVolumeClaim"].(map[string]any)["claimName"].(string)
			pvc := c.objects["persistentvolumeclaims/"+pvcName]
			pvc["spec"].(map[string]any)["volumeName"] = "pv-owned"
			pvc["status"] = map[string]any{"phase": "Bound"}
			c.objects["pods/"+name] = map[string]any{"apiVersion": "v1", "kind": "Pod", "metadata": map[string]any{"name": name, "namespace": "isolated", "uid": "pod-uid", "resourceVersion": "2", "ownerReferences": []any{map[string]any{"apiVersion": SandboxAPI, "kind": "Sandbox", "name": name, "uid": uid, "controller": true, "blockOwnerDeletion": true}}}, "spec": podSpec, "status": map[string]any{"phase": "Running", "conditions": []any{map[string]any{"type": "Ready", "status": "True"}}, "containerStatuses": []any{map[string]any{"name": "agent", "containerID": "containerd://agent", "restartCount": 0, "imageID": c.image, "ready": true, "state": map[string]any{"running": map[string]any{}}}}}}
		}
		c.objects[key] = value
		if c.lostCreate[kind] {
			delete(c.lostCreate, kind)
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		w.WriteHeader(201)
		json.NewEncoder(w).Encode(value)
	case http.MethodDelete:
		c.deletes[kind]++
		var options struct {
			PropagationPolicy string `json:"propagationPolicy"`
			Preconditions     struct {
				UID string `json:"uid"`
			} `json:"preconditions"`
		}
		if json.NewDecoder(r.Body).Decode(&options) != nil || options.PropagationPolicy != "Foreground" || options.Preconditions.UID == "" {
			w.WriteHeader(400)
			return
		}
		value, exists := c.objects[key]
		if !exists {
			w.WriteHeader(404)
			return
		}
		if value["metadata"].(map[string]any)["uid"] != options.Preconditions.UID {
			w.WriteHeader(409)
			return
		}
		if c.linger[kind] {
			value["metadata"].(map[string]any)["deletionTimestamp"] = "2026-10-29T12:00:01Z"
		} else {
			delete(c.objects, key)
			if kind == "sandboxes" {
				delete(c.objects, "pods/"+name)
			}
		}
		if c.lostDelete[kind] {
			delete(c.lostDelete, kind)
			conn, _, _ := w.(http.Hijacker).Hijack()
			conn.Close()
			return
		}
		w.WriteHeader(200)
	default:
		value, exists := c.objects[key]
		if !exists {
			w.WriteHeader(404)
			return
		}
		json.NewEncoder(w).Encode(value)
	}
}
func cloneMap(value map[string]any) map[string]any {
	data, _ := json.Marshal(value)
	var out map[string]any
	json.Unmarshal(data, &out)
	return out
}
func provisionCold(t *testing.T, o *ColdOwner) (PVCRef, model.ResourceRef) {
	t.Helper()
	pvc, err := o.ProvisionVolume(t.Context(), "run-1")
	if err != nil {
		t.Fatal(err)
	}
	ref, err := o.ProvisionSandbox(t.Context(), "run-1", pvc)
	if err != nil {
		t.Fatal(err)
	}
	return pvc, ref
}

func TestColdOriginalOperationsSurviveLostRepliesWithoutRecreate(t *testing.T) {
	o, api := coldFixture(t)
	api.lostCreate["persistentvolumeclaims"] = true
	if _, err := o.ProvisionVolume(t.Context(), "run-1"); err == nil {
		t.Fatal("lost PVC reply not reported")
	}
	pvc, err := o.ReconcileVolume(t.Context(), "run-1")
	if err != nil || pvc.UID == "" || pvc.Phase != "Pending" {
		t.Fatalf("original PVC: %+v %v", pvc, err)
	}
	api.change(func(c *coldAPI) { c.lostCreate["sandboxes"] = true })
	if _, err := o.ProvisionSandbox(t.Context(), "run-1", pvc); err == nil {
		t.Fatal("lost Sandbox reply not reported")
	}
	ref, err := o.ReconcileSandbox(t.Context(), "run-1", pvc)
	if err != nil {
		t.Fatal(err)
	}
	observation, err := o.Observe(t.Context(), ref, pvc)
	if err != nil || observation.Ready.Status != "True" || observation.Runtime.ID != "pod-uid" || observation.Artifacts[0].Digest != o.config.ImageDigest {
		t.Fatalf("ready observed profile: %+v %v", observation, err)
	}
	api.change(func(c *coldAPI) {
		if c.posts["persistentvolumeclaims"] != 1 || c.posts["sandboxes"] != 1 {
			t.Error("unknown effects were replayed")
		}
		c.lostDelete["sandboxes"] = true
	})
	if _, err := o.ReconcileDispose(t.Context(), "run-1", ref, "pod-uid"); err == nil {
		t.Fatal("lost Sandbox delete not reported")
	}
	if receipt, err := o.ReconcileDispose(t.Context(), "run-1", ref, "pod-uid"); err != nil || receipt.Digest == "" {
		t.Fatalf("compute cleanup: %+v %v", receipt, err)
	}
	api.change(func(c *coldAPI) {
		if c.deletes["persistentvolumeclaims"] != 0 || c.objects["persistentvolumeclaims/"+pvc.Name] == nil {
			t.Error("compute disposal deleted workspace")
		}
	})
	if _, err := o.ReconcileSandbox(t.Context(), "run-1", pvc); !errors.Is(err, ErrNotFound) {
		t.Fatalf("absent Sandbox: %v", err)
	}
	api.change(func(c *coldAPI) {
		if c.posts["sandboxes"] != 1 {
			t.Error("absent compute recreated")
		}
		c.lostDelete["persistentvolumeclaims"] = true
	})
	if _, err := o.DeleteVolume(t.Context(), "export-receipt-gc", pvc); err == nil {
		t.Fatal("lost volume delete not reported")
	}
	if _, err := o.DeleteVolume(t.Context(), "export-receipt-gc", pvc); err != nil {
		t.Fatal(err)
	}
	if _, err := o.ReconcileVolume(t.Context(), "run-1"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("absent PVC: %v", err)
	}
	api.change(func(c *coldAPI) {
		if c.posts["persistentvolumeclaims"] != 1 || c.deletes["persistentvolumeclaims"] != 1 || c.deletes["sandboxes"] != 1 {
			t.Errorf("replay counts: %+v %+v", c.posts, c.deletes)
		}
	})
}

func TestColdObservedPodProfileFailsClosed(t *testing.T) {
	cases := map[string]func(map[string]any){
		"runtime class":           func(s map[string]any) { s["runtimeClassName"] = "runc" },
		"host PID":                func(s map[string]any) { s["hostPID"] = true },
		"host IPC":                func(s map[string]any) { s["hostIPC"] = true },
		"host network":            func(s map[string]any) { s["hostNetwork"] = true },
		"share process namespace": func(s map[string]any) { s["shareProcessNamespace"] = true },
		"service account":         func(s map[string]any) { s["serviceAccountName"] = "default" },
		"automount token":         func(s map[string]any) { s["automountServiceAccountToken"] = true },
		"DNS override":            func(s map[string]any) { s["dnsPolicy"] = "None" },
		"scheduler override":      func(s map[string]any) { s["schedulerName"] = "unreviewed" },
		"host path": func(s map[string]any) {
			s["volumes"].([]any)[0] = map[string]any{"name": "workspace", "hostPath": map[string]string{"path": "/"}}
		},
		"extra volume": func(s map[string]any) {
			s["volumes"] = append(s["volumes"].([]any), map[string]any{"name": "secrets", "secret": map[string]string{"secretName": "operator"}})
		},
		"extra container":     func(s map[string]any) { s["containers"] = append(s["containers"].([]any), s["containers"].([]any)[0]) },
		"init container":      func(s map[string]any) { s["initContainers"] = s["containers"] },
		"ephemeral container": func(s map[string]any) { s["ephemeralContainers"] = s["containers"] },
		"privileged": func(s map[string]any) {
			s["containers"].([]any)[0].(map[string]any)["securityContext"].(map[string]any)["privileged"] = true
		},
		"termination path": func(s map[string]any) {
			s["containers"].([]any)[0].(map[string]any)["terminationMessagePath"] = "/workspace/credentials"
		},
		"termination policy": func(s map[string]any) {
			s["containers"].([]any)[0].(map[string]any)["terminationMessagePolicy"] = "FallbackToLogsOnError"
		},
		"root user": func(s map[string]any) { s["securityContext"].(map[string]any)["runAsUser"] = float64(0) },
		"seccomp": func(s map[string]any) {
			s["securityContext"].(map[string]any)["seccompProfile"] = map[string]string{"type": "Unconfined"}
		},
		"mount replacement": func(s map[string]any) {
			s["containers"].([]any)[0].(map[string]any)["volumeMounts"].([]any)[0].(map[string]any)["mountPath"] = "/"
		},
		"token audience": func(s map[string]any) {
			s["volumes"].([]any)[2].(map[string]any)["projected"].(map[string]any)["sources"].([]any)[0].(map[string]any)["serviceAccountToken"].(map[string]any)["audience"] = "kubernetes"
		},
		"token override": func(s map[string]any) {
			s["containers"].([]any)[0].(map[string]any)["env"] = []any{map[string]string{"name": "PERO_WORKER_TOKEN", "value": "must-not-leak"}}
		},
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			o, api := coldFixture(t)
			pvc, ref := provisionCold(t, o)
			api.change(func(c *coldAPI) { mutate(c.objects["pods/"+ref.ID]["spec"].(map[string]any)) })
			if got, err := o.Observe(t.Context(), ref, pvc); !errors.Is(err, model.ErrIdentity) || got.Ready.Status == "True" {
				t.Fatalf("profile admitted: %+v %v", got, err)
			}
		})
	}
}

func TestColdUIDBindingsAndMandatoryTTL(t *testing.T) {
	for _, change := range []string{"pvc UID", "sandbox UID", "SA UID", "foreign Pod", "stale readiness", "missing TTL", "expired TTL", "image mismatch"} {
		t.Run(change, func(t *testing.T) {
			o, api := coldFixture(t)
			pvc, ref := provisionCold(t, o)
			api.change(func(c *coldAPI) {
				switch change {
				case "pvc UID":
					c.objects["persistentvolumeclaims/"+pvc.Name]["metadata"].(map[string]any)["uid"] = "replacement"
				case "sandbox UID":
					c.objects["sandboxes/"+ref.ID]["metadata"].(map[string]any)["uid"] = "replacement"
				case "SA UID":
					c.objects["serviceaccounts/run-agent"]["metadata"].(map[string]any)["uid"] = "replacement"
				case "foreign Pod":
					c.objects["pods/"+ref.ID]["metadata"].(map[string]any)["ownerReferences"] = []any{}
				case "stale readiness":
					c.objects["sandboxes/"+ref.ID]["metadata"].(map[string]any)["generation"] = 2
				case "missing TTL":
					delete(c.objects["sandboxes/"+ref.ID]["spec"].(map[string]any), "shutdownTime")
				case "expired TTL":
					c.objects["sandboxes/"+ref.ID]["spec"].(map[string]any)["shutdownTime"] = o.now().Format(time.RFC3339)
				case "image mismatch":
					c.objects["pods/"+ref.ID]["status"].(map[string]any)["containerStatuses"].([]any)[0].(map[string]any)["imageID"] = "repo@sha256:" + strings.Repeat("f", 64)
				}
			})
			if got, err := o.Observe(t.Context(), ref, pvc); err == nil && got.Ready.Status == "True" {
				t.Fatalf("unsafe observation: %+v", got)
			}
			api.change(func(c *coldAPI) {
				if c.deletes["persistentvolumeclaims"] != 0 || c.objects["persistentvolumeclaims/"+pvc.Name] == nil {
					t.Error("expiry/identity failure lost PVC")
				}
			})
		})
	}
	o, _ := coldFixture(t)
	for _, ttl := range []int64{0, -1, 86401} {
		config := o.config
		config.TTLSeconds = ttl
		config.TemplateDigest, _ = ColdTemplateDigest(config)
		if _, err := NewColdOwner(o.base, o.client, config, o.now); err == nil {
			t.Fatalf("unbounded TTL %d accepted", ttl)
		}
	}
}

func TestColdCleanupWaitsForOriginalComputeAndPreservesReplacements(t *testing.T) {
	o, api := coldFixture(t)
	pvc, ref := provisionCold(t, o)
	api.change(func(c *coldAPI) { c.linger["sandboxes"] = true })
	if _, err := o.ReconcileDispose(t.Context(), "run-1", ref, "pod-uid"); err == nil {
		t.Fatal("terminating Sandbox reported gone")
	}
	api.change(func(c *coldAPI) { delete(c.objects, "sandboxes/"+ref.ID) })
	if _, err := o.ReconcileDispose(t.Context(), "run-1", ref, "pod-uid"); err == nil {
		t.Fatal("live original Pod reported gone")
	}
	api.change(func(c *coldAPI) { delete(c.objects["pods/"+ref.ID]["metadata"].(map[string]any), "ownerReferences") })
	if _, err := o.ReconcileDispose(t.Context(), "run-1", ref, "pod-uid"); err == nil {
		t.Fatal("live original Pod with ownerRef drift reported gone")
	}
	api.change(func(c *coldAPI) {
		delete(c.objects, "pods/"+ref.ID)
		c.objects["sandboxes/"+ref.ID] = map[string]any{"apiVersion": SandboxAPI, "kind": "Sandbox", "metadata": map[string]any{"name": ref.ID, "namespace": "isolated", "uid": "new-sandbox", "resourceVersion": "9"}}
	})
	if _, err := o.ReconcileDispose(t.Context(), "run-1", ref, "pod-uid"); err != nil {
		t.Fatal(err)
	}
	api.change(func(c *coldAPI) {
		if c.deletes["sandboxes"] != 1 || c.objects["sandboxes/"+ref.ID] == nil || c.objects["persistentvolumeclaims/"+pvc.Name] == nil {
			t.Error("replacement/PVC deleted")
		}
	})
}

func TestColdAdmissionWaitsForIndependentPVC(t *testing.T) {
	o, api := coldFixture(t)
	pvc, ref := provisionCold(t, o)
	api.change(func(c *coldAPI) {
		c.objects["persistentvolumeclaims/"+pvc.Name]["status"] = map[string]string{"phase": "Pending"}
	})
	got, err := o.Observe(context.Background(), ref, pvc)
	if err != nil || got.Ready.Status == "True" {
		t.Fatalf("unbound PVC admitted: %+v %v", got, err)
	}
	api.change(func(c *coldAPI) {
		p := c.objects["persistentvolumeclaims/"+pvc.Name]
		p["status"] = map[string]string{"phase": "Bound"}
		p["metadata"].(map[string]any)["ownerReferences"] = []any{map[string]any{"kind": "Sandbox", "name": ref.ID, "uid": ref.Incarnation, "controller": true}}
	})
	if _, err := o.Observe(t.Context(), ref, pvc); !errors.Is(err, model.ErrIdentity) {
		t.Fatalf("cascading PVC owner admitted: %v", err)
	}
}

func TestColdObservedDefaultsAndBoundVolumeIdentity(t *testing.T) {
	o, api := coldFixture(t)
	pvc, ref := provisionCold(t, o)
	bound, err := o.ObserveVolume(t.Context(), pvc)
	if err != nil || bound.UID != pvc.UID || bound.VolumeName != "pv-owned" || bound.Phase != "Bound" {
		t.Fatalf("bound volume identity: %+v %v", bound, err)
	}
	api.change(func(c *coldAPI) {
		s := c.objects["pods/"+ref.ID]["spec"].(map[string]any)
		s["nodeName"], s["schedulerName"], s["dnsPolicy"] = "scheduler-assigned", "default-scheduler", "ClusterFirst"
		s["serviceAccount"], s["priority"], s["preemptionPolicy"], s["shareProcessNamespace"] = "run-agent", 0, "PreemptLowerPriority", false
		s["tolerations"] = []any{map[string]any{"key": "node.kubernetes.io/not-ready", "operator": "Exists", "effect": "NoExecute", "tolerationSeconds": 300}}
		container := s["containers"].([]any)[0].(map[string]any)
		container["terminationMessagePath"], container["terminationMessagePolicy"] = "/dev/termination-log", "File"
	})
	if got, err := o.Observe(t.Context(), ref, bound); err != nil || got.Ready.Status != "True" {
		t.Fatalf("known Kubernetes defaults rejected: %+v %v", got, err)
	}
	api.change(func(c *coldAPI) {
		c.objects["persistentvolumeclaims/"+pvc.Name]["spec"].(map[string]any)["volumeName"] = "rebound-pv"
	})
	if _, err := o.ObserveVolume(t.Context(), bound); !errors.Is(err, model.ErrIdentity) {
		t.Fatalf("underlying bound PV changed: %v", err)
	}
}

func TestColdVolumeCleanupWaitsAndPreservesReplacement(t *testing.T) {
	o, api := coldFixture(t)
	pvc, _ := provisionCold(t, o)
	api.change(func(c *coldAPI) { c.linger["persistentvolumeclaims"] = true })
	if _, err := o.DeleteVolume(t.Context(), "verified-export-gc", pvc); err == nil {
		t.Fatal("terminating original PVC reported gone")
	}
	api.change(func(c *coldAPI) {
		c.objects["persistentvolumeclaims/"+pvc.Name]["metadata"].(map[string]any)["uid"] = "replacement-pvc"
	})
	if _, err := o.DeleteVolume(t.Context(), "verified-export-gc", pvc); err != nil {
		t.Fatal(err)
	}
	api.change(func(c *coldAPI) {
		if c.deletes["persistentvolumeclaims"] != 1 || c.objects["persistentvolumeclaims/"+pvc.Name] == nil {
			t.Fatal("replacement PVC deleted")
		}
	})
}

func TestColdAdmissionWaitsForControllerAndKubelet(t *testing.T) {
	for _, stage := range []string{"controller", "kubelet", "image-pull"} {
		t.Run(stage, func(t *testing.T) {
			o, api := coldFixture(t)
			pvc, ref := provisionCold(t, o)
			api.change(func(c *coldAPI) {
				switch stage {
				case "controller":
					delete(c.objects["sandboxes/"+ref.ID], "status")
				case "kubelet":
					delete(c.objects["pods/"+ref.ID], "status")
				case "image-pull":
					c.objects["pods/"+ref.ID]["status"].(map[string]any)["containerStatuses"] = []any{map[string]any{"name": "agent", "restartCount": 0, "ready": false}}
				}
			})
			if got, err := o.Observe(t.Context(), ref, pvc); err != nil || got.Ready.Status != "False" {
				t.Fatalf("normal pending stage: %+v %v", got, err)
			}
		})
	}
}
