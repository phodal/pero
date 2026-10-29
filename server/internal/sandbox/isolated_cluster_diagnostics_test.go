package sandbox_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/phodal/pero/server/internal/store"
)

// The rejected API response is never an artifact: even its map keys can contain
// credentials. Retain only fixed built-in field names, kinds/counts and digests.
func diagnosticObject(value any) map[string]any {
	m, _ := value.(map[string]any)
	return m
}
func diagnosticKind(value any, present bool) string {
	if !present {
		return "absent"
	}
	switch value.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64:
		return "number"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return "other"
	}
}
func diagnosticFields(value any, names string) map[string]any {
	m := diagnosticObject(value)
	out := map[string]any{"kind": diagnosticKind(value, true)}
	known := 0
	for _, name := range strings.Fields(names) {
		v, ok := m[name]
		out[name] = diagnosticKind(v, ok)
		if ok {
			known++
		}
	}
	out["other_field_count"] = len(m) - known
	return out
}
func diagnosticChoice(value any, allowed ...string) string {
	s, ok := value.(string)
	if !ok {
		return diagnosticKind(value, true)
	}
	for _, choice := range allowed {
		if s == choice {
			return s
		}
	}
	return "other"
}
func collectorJobShape(job map[string]any) map[string]any {
	spec := diagnosticObject(job["spec"])
	template := diagnosticObject(spec["template"])
	meta := diagnosticObject(template["metadata"])
	pod := diagnosticObject(template["spec"])
	selector := diagnosticObject(spec["selector"])
	encoded, _ := json.Marshal(spec)
	digest := sha256.Sum256(encoded)
	out := map[string]any{
		"canonical_spec_sha256":    hex.EncodeToString(digest[:]),
		"spec_fields":              diagnosticFields(spec, "parallelism completions activeDeadlineSeconds podFailurePolicy successPolicy backoffLimit backoffLimitPerIndex maxFailedIndexes selector manualSelector template ttlSecondsAfterFinished completionMode suspend podReplacementPolicy managedBy"),
		"selector_fields":          diagnosticFields(selector, "matchLabels matchExpressions"),
		"selector_label_fields":    diagnosticFields(selector["matchLabels"], "batch.kubernetes.io/controller-uid controller-uid batch.kubernetes.io/job-name job-name environments.sandbox.users.io/spec"),
		"template_label_fields":    diagnosticFields(meta["labels"], "batch.kubernetes.io/controller-uid controller-uid batch.kubernetes.io/job-name job-name environments.sandbox.users.io/spec"),
		"template_fields":          diagnosticFields(template, "metadata spec"),
		"template_metadata_fields": diagnosticFields(meta, "name generateName namespace selfLink uid resourceVersion generation creationTimestamp deletionTimestamp deletionGracePeriodSeconds labels annotations ownerReferences finalizers managedFields"),
		"pod_fields":               diagnosticFields(pod, "volumes initContainers containers ephemeralContainers restartPolicy terminationGracePeriodSeconds activeDeadlineSeconds dnsPolicy nodeSelector serviceAccountName serviceAccount automountServiceAccountToken nodeName hostNetwork hostPID hostIPC shareProcessNamespace securityContext imagePullSecrets hostname subdomain affinity schedulerName tolerations hostAliases priorityClassName priority dnsConfig readinessGates runtimeClassName enableServiceLinks preemptionPolicy overhead topologySpreadConstraints setHostnameAsFQDN os hostUsers schedulingGates resourceClaims resources hostnameOverride"),
		"pod_security_fields":      diagnosticFields(pod["securityContext"], "seLinuxOptions windowsOptions runAsUser runAsGroup runAsNonRoot supplementalGroups supplementalGroupsPolicy fsGroup sysctls fsGroupChangePolicy seccompProfile appArmorProfile"),
		"completion_mode":          diagnosticChoice(spec["completionMode"], "NonIndexed", "Indexed"),
		"replacement_policy":       diagnosticChoice(spec["podReplacementPolicy"], "Failed", "TerminatingOrFailed"),
		"managed_by":               diagnosticChoice(spec["managedBy"], "kubernetes.io/job-controller"),
	}
	for _, key := range []string{"parallelism", "completions", "activeDeadlineSeconds", "backoffLimit"} {
		if n, ok := spec[key].(float64); ok && n >= 0 && n <= 1e9 {
			out[key] = n
		}
	}
	for _, key := range []string{"manualSelector", "suspend"} {
		if b, ok := spec[key].(bool); ok {
			out[key] = b
		}
	}
	for _, key := range []string{"labels", "annotations"} {
		out["template_"+key+"_count"] = len(diagnosticObject(meta[key]))
	}
	containers, _ := pod["containers"].([]any)
	out["container_count"] = len(containers)
	if len(containers) == 1 {
		c := diagnosticObject(containers[0])
		out["container_fields"] = diagnosticFields(c, "name image command args workingDir ports envFrom env resources resizePolicy restartPolicy volumeMounts volumeDevices livenessProbe readinessProbe startupProbe lifecycle terminationMessagePath terminationMessagePolicy imagePullPolicy securityContext stdin stdinOnce tty")
		out["container_security_fields"] = diagnosticFields(c["securityContext"], "capabilities privileged seLinuxOptions windowsOptions runAsUser runAsGroup runAsNonRoot readOnlyRootFilesystem allowPrivilegeEscalation procMount seccompProfile appArmorProfile")
	}
	return out
}

func recordCollectorFailure(t *testing.T, ctx context.Context, api clusterAPI, db *store.Store, runID, namespace string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	out := map[string]any{"kind": "collector-rejection-diagnostic", "run_id": runID}
	e, err := db.ArtifactExport(ctx, "export."+runID)
	if err != nil {
		out["export_read"] = "failed"
	} else {
		out["job_reserved"] = e.CollectorJob != nil
		out["collector_bound"] = e.Collector != nil
		out["manifest_committed"] = e.Manifest != nil
		if e.CollectorJob != nil {
			out["job_uid_persisted"] = e.CollectorJob.UID != ""
			var response json.RawMessage
			path := "/apis/batch/v1/namespaces/" + url.PathEscape(namespace) + "/jobs/" + url.PathEscape(e.CollectorJob.Name)
			if err := api.request(ctx, http.MethodGet, path, nil, &response); err != nil {
				out["job_read"] = "failed" // Never serialize API error bodies/URLs.
			} else {
				var job map[string]any
				var raw map[string]json.RawMessage
				if json.Unmarshal(response, &job) != nil || json.Unmarshal(response, &raw) != nil {
					out["job_read"] = "invalid-json"
				} else {
					out["job_read"] = "observed"
					digest := sha256.Sum256(raw["spec"])
					out["observed_spec_sha256"] = hex.EncodeToString(digest[:])
					out["job_shape"] = collectorJobShape(job)
					meta := diagnosticObject(job["metadata"])
					out["job_name_matches"] = meta["name"] == e.CollectorJob.Name
					out["job_namespace_matches"] = meta["namespace"] == namespace
					out["job_uid_matches_persisted"] = meta["uid"] == e.CollectorJob.UID
					out["job_metadata_fields"] = diagnosticFields(meta, "name generateName namespace selfLink uid resourceVersion generation creationTimestamp deletionTimestamp deletionGracePeriodSeconds labels annotations ownerReferences finalizers managedFields")
				}
			}
		}
	}
	data, err := json.Marshal(out)
	if err == nil {
		err = os.WriteFile(filepath.Join(requiredIsolatedEnv(t, "EVIDENCE"), "collector-failure-"+runID+".json"), append(data, '\n'), 0600)
	}
	if err != nil {
		t.Log("collector diagnostic receipt could not be retained")
	}
}

func TestCollectorDiagnosticProjection(t *testing.T) {
	secret := "DO-NOT-RETAIN-synthetic-credential"
	job := map[string]any{"metadata": map[string]any{"name": secret}, "spec": map[string]any{
		secret: secret, "managedBy": secret, "parallelism": float64(1), "backoffLimit": float64(0), "completionMode": "NonIndexed",
		"template": map[string]any{"metadata": map[string]any{"creationTimestamp": nil, "labels": map[string]any{secret: secret}}, "spec": map[string]any{
			secret: secret, "containers": []any{map[string]any{"name": secret, "args": []any{secret}, "env": []any{map[string]any{"name": secret, "value": secret}}}},
		}},
	}}
	shape := collectorJobShape(job)
	encoded, _ := json.Marshal(shape)
	if strings.Contains(string(encoded), secret) {
		t.Fatal("response payload or dynamic key leaked")
	}
	if shape["managed_by"] != "other" || shape["parallelism"] != float64(1) || shape["completion_mode"] != "NonIndexed" {
		t.Fatal("fixed default projection missing")
	}
	if shape["spec_fields"].(map[string]any)["other_field_count"] != 1 {
		t.Fatal("unknown field presence lost")
	}
	if shape["template_metadata_fields"].(map[string]any)["creationTimestamp"] != "null" {
		t.Fatal("null metadata shape lost")
	}
	delete(job["spec"].(map[string]any)["template"].(map[string]any)["metadata"].(map[string]any), "creationTimestamp")
	if collectorJobShape(job)["template_metadata_fields"].(map[string]any)["creationTimestamp"] != "absent" {
		t.Fatal("absent metadata shape lost")
	}
}
