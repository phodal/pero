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
