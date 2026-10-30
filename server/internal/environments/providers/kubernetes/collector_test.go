package kubernetes

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
)

func collectorFixture(t *testing.T) (*CollectorOwner, *coldAPI, CollectorRequest, CollectorRef) {
	t.Helper()
	cold, api := coldFixture(t)
	pvc, _ := provisionCold(t, cold)
	pvc, err := cold.ObserveVolume(t.Context(), pvc)
	if err != nil {
		t.Fatal(err)
	}
	config := CollectorConfig{ImageRef: "registry.invalid/collector@" + cold.config.ImageDigest, ImageDigest: cold.config.ImageDigest, RuntimeClass: cold.config.RuntimeClass, ServiceAccountName: "collector", ServiceAccountUID: "collector-sa", ControlURL: cold.config.ControlURL, ControlCAFile: cold.config.ControlCAFile}
	api.change(func(c *coldAPI) {
		c.objects["serviceaccounts/collector"] = map[string]any{"apiVersion": "v1", "kind": "ServiceAccount", "metadata": map[string]any{"name": "collector", "namespace": "isolated", "uid": "collector-sa", "resourceVersion": "1"}}
	})
	owner, err := NewCollectorOwner(cold, config)
	if err != nil {
		t.Fatal(err)
	}
	request := CollectorRequest{ExportID: "export.run-1", PVC: pvc, SourceDigest: cold.config.ImageDigest, PolicyDigest: cold.config.TemplateDigest}
	ref, err := owner.Reservation(request, time.Date(2026, 10, 29, 12, 15, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	return owner, api, request, ref
}
func TestCollectorOriginalJobAndReadOnlyMount(t *testing.T) {
	owner, api, request, ref := collectorFixture(t)
	ctx := context.Background()
	api.change(func(c *coldAPI) { c.lostCreate["jobs"] = true })
	if _, err := owner.Provision(ctx, request, ref); err == nil {
		t.Fatal("lost create reported confirmed")
	}
	recovered, err := owner.Reconcile(ctx, request, ref)
	if err != nil || recovered.UID == "" {
		t.Fatal(recovered, err)
	}
	ref = recovered
	pod, err := owner.Observe(ctx, request, ref)
	if err != nil || pod.UID == "" || pod.JobUID != ref.UID {
		t.Fatal(pod, err)
	}
	api.change(func(c *coldAPI) {
		if c.posts["jobs"] != 1 {
			t.Fatal("unknown create repeated")
		}
		spec := c.objects["jobs/"+ref.Name]["spec"].(map[string]any)
		template := spec["template"].(map[string]any)["spec"].(map[string]any)
		if template["automountServiceAccountToken"] != false || template["serviceAccountName"] != "collector" || template["runtimeClassName"] != "gvisor" {
			t.Fatal("collector runtime identity drift")
		}
		volumes := template["volumes"].([]any)
		if len(volumes) != 2 || volumes[0].(map[string]any)["persistentVolumeClaim"].(map[string]any)["readOnly"] != true {
			t.Fatal("collector can write retained volume")
		}
		encoded, _ := json.Marshal(template)
		raw := strings.ToLower(string(encoded))
		if strings.Contains(raw, "access_key") || strings.Contains(raw, "secret_key") || strings.Contains(raw, "s3") {
			t.Fatal("storage secret in collector")
		}
		c.linger["pods"] = true
	})
	if err = owner.Dispose(ctx, request, ref, &pod); err == nil {
		t.Fatal("Job absence certified original Pod absence")
	}
	api.change(func(c *coldAPI) {
		delete(c.objects, "pods/"+pod.Name)
		c.objects["jobs/"+ref.Name] = map[string]any{"apiVersion": "batch/v1", "kind": "Job", "metadata": map[string]any{"name": ref.Name, "namespace": "isolated", "uid": "replacement", "resourceVersion": "1"}}
	})
	if err = owner.Dispose(ctx, request, ref, &pod); err != nil {
		t.Fatal(err)
	}
	api.change(func(c *coldAPI) {
		if c.deletes["jobs"] != 1 {
			t.Fatal("replacement Job deleted")
		}
	})
}
func TestCollectorRejectsIdentityOrMountDrift(t *testing.T) {
	for _, field := range []string{"pv", "sa", "pod-volume", "pod-symlink-env", "job-uid", "pending-status", "partial-list"} {
		t.Run(field, func(t *testing.T) {
			owner, api, request, ref := collectorFixture(t)
			ref, err := owner.Provision(t.Context(), request, ref)
			if err != nil {
				t.Fatal(err)
			}
			api.change(func(c *coldAPI) {
				pod := c.objects["pods/"+ref.Name+"-pod"]
				switch field {
				case "pv":
					c.objects["persistentvolumeclaims/"+request.PVC.Name]["spec"].(map[string]any)["volumeName"] = "replacement"
				case "sa":
					c.objects["serviceaccounts/collector"]["metadata"].(map[string]any)["uid"] = "replacement"
				case "pod-volume":
					pod["spec"].(map[string]any)["volumes"].([]any)[0].(map[string]any)["persistentVolumeClaim"].(map[string]any)["readOnly"] = false
				case "pod-symlink-env":
					pod["spec"].(map[string]any)["containers"].([]any)[0].(map[string]any)["env"] = []any{map[string]any{"name": "UPLOAD_PATH", "value": "/etc"}}
				case "job-uid":
					c.objects["jobs/"+ref.Name]["metadata"].(map[string]any)["uid"] = "replacement"
				case "pending-status":
					delete(pod, "status")
				case "partial-list":
					c.listContinue = true
				}
			})
			_, err = owner.Observe(t.Context(), request, ref)
			if field == "pending-status" {
				if !errors.Is(err, ErrNotFound) {
					t.Fatal(err)
				}
			} else if !errors.Is(err, model.ErrIdentity) {
				t.Fatal("drift accepted", err)
			}
		})
	}
}

func TestCollectorAPIDefaultsAndPrivateDiagnostics(t *testing.T) {
	for _, changed := range []string{"defaults", "job-schema", "template-profile", "pod-profile"} {
		t.Run(changed, func(t *testing.T) {
			owner, api, request, ref := collectorFixture(t)
			ref, err := owner.Provision(t.Context(), request, ref)
			if err != nil {
				t.Fatal(err)
			}
			const private = "DO_NOT_LOG_CREDENTIAL_PAYLOAD"
			api.change(func(c *coldAPI) {
				job := c.objects["jobs/"+ref.Name]
				spec := job["spec"].(map[string]any)
				template := spec["template"].(map[string]any)
				// Pinned Kubernetes v1.36.4 batch/v1 defaults + Job selector strategy.
				spec["manualSelector"] = false
				spec["selector"] = map[string]any{"matchLabels": map[string]any{"batch.kubernetes.io/controller-uid": ref.UID}}
				labels := template["metadata"].(map[string]any)["labels"].(map[string]any)
				for _, key := range []string{"controller-uid", "batch.kubernetes.io/controller-uid"} {
					labels[key] = ref.UID
				}
				for _, key := range []string{"job-name", "batch.kubernetes.io/job-name"} {
					labels[key] = ref.Name
				}
				pod := template["spec"].(map[string]any)
				pod["dnsPolicy"], pod["schedulerName"] = "ClusterFirst", "default-scheduler"
				container := pod["containers"].([]any)[0].(map[string]any)
				container["terminationMessagePath"], container["terminationMessagePolicy"] = "/dev/termination-log", "File"
				switch changed {
				case "job-schema":
					spec[private] = private
				case "template-profile":
					container["env"] = []any{map[string]any{"name": private, "value": private}}
				case "pod-profile":
					c.objects["pods/"+ref.Name+"-pod"]["spec"].(map[string]any)["containers"].([]any)[0].(map[string]any)["env"] = []any{map[string]any{"name": private, "value": private}}
				}
			})
			_, err = owner.Observe(t.Context(), request, ref)
			if changed == "defaults" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			want := map[string]string{"job-schema": "collector Job spec schema", "template-profile": "collector Job Pod template profile", "pod-profile": "collector Pod profile"}[changed]
			if !errors.Is(err, model.ErrIdentity) || !strings.Contains(err.Error(), want) || strings.Contains(err.Error(), private) {
				t.Fatalf("missing safe identity diagnostic: %v", err)
			}
		})
	}
}

func TestCollectorTypedPodListIdentity(t *testing.T) {
	for _, change := range []string{"omitted-type", "partial-type", "wrong-version", "wrong-kind", "missing-uid", "namespace", "spec-label", "owner", "partial-list"} {
		t.Run(change, func(t *testing.T) {
			owner, api, request, ref := collectorFixture(t)
			ref, err := owner.Provision(t.Context(), request, ref)
			if err != nil {
				t.Fatal(err)
			}
			api.change(func(c *coldAPI) {
				pod := c.objects["pods/"+ref.Name+"-pod"]
				// Kubernetes v0.36.4's typed PodList JSON codec sets TypeMeta on
				// the list, not its nested Pod items. Standalone GETs differ.
				delete(pod, "apiVersion")
				delete(pod, "kind")
				meta := pod["metadata"].(map[string]any)
				switch change {
				case "partial-type":
					pod["apiVersion"] = "v1"
				case "wrong-version":
					pod["apiVersion"], pod["kind"] = "v2", "Pod"
				case "wrong-kind":
					pod["apiVersion"], pod["kind"] = "v1", "ConfigMap"
				case "missing-uid":
					delete(meta, "uid")
				case "namespace":
					meta["namespace"] = "other-project"
				case "spec-label":
					meta["labels"].(map[string]any)[labelPrefix+"spec"] = "changed"
				case "owner":
					meta["ownerReferences"].([]any)[0].(map[string]any)["uid"] = "other-job"
				case "partial-list":
					c.listContinue = true
				}
			})
			pod, err := owner.Observe(t.Context(), request, ref)
			if change == "omitted-type" {
				if err != nil || pod.UID != "collector-pod-uid" || pod.JobUID != ref.UID {
					t.Fatalf("typed list identity lost: %+v %v", pod, err)
				}
			} else if !errors.Is(err, model.ErrIdentity) {
				t.Fatalf("conflicting list identity admitted: %v", err)
			}
		})
	}
}
