package kubernetes

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
)

// CollectorOwner owns only a fixed trusted Job recipe. The workflow caller must
// persist its reservation before Provision and supply actual writer-fence proof
// before mounting. This adapter never infers physical fencing from API absence.
type CollectorOwner struct {
	cold   *ColdOwner
	config CollectorConfig
}
type CollectorConfig struct {
	ImageRef, ImageDigest, RuntimeClass, ServiceAccountName, ServiceAccountUID, ControlURL, ControlCAFile string
}
type CollectorRequest struct {
	ExportID, SourceDigest, PolicyDigest string
	PVC                                  PVCRef
}
type CollectorRef struct {
	Name, UID, ConfigDigest string
	ExpiresAt               time.Time
}
type CollectorPod struct{ Name, UID, ServiceAccount, ServiceAccountUID, JobUID string }

func NewCollectorOwner(cold *ColdOwner, c CollectorConfig) (*CollectorOwner, error) {
	if cold == nil || !coldName.MatchString(c.RuntimeClass) || c.RuntimeClass != cold.config.RuntimeClass || !coldName.MatchString(c.ServiceAccountName) || c.ServiceAccountName == cold.config.ServiceAccountName || !model.ValidKey(c.ServiceAccountUID) || c.ServiceAccountUID == cold.config.ServiceAccountUID || !imageDigest.MatchString(c.ImageDigest) || !strings.HasSuffix(c.ImageRef, "@"+c.ImageDigest) || c.ImageRef == c.ImageDigest || strings.ContainsAny(c.ImageRef, " \t\r\n") {
		return nil, model.ErrInvalid
	}
	u, err := url.Parse(c.ControlURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" || c.ControlCAFile != "" && c.ControlCAFile != "/etc/pero/control-ca.pem" {
		return nil, model.ErrInvalid
	}
	return &CollectorOwner{cold, c}, nil
}
func (o *CollectorOwner) Configuration() CollectorConfig { return o.config }
func (o *CollectorOwner) Reservation(r CollectorRequest, deadline time.Time) (CollectorRef, error) {
	if !model.ValidKey(r.ExportID) || !imageDigest.MatchString(r.SourceDigest) || !imageDigest.MatchString(r.PolicyDigest) || o.cold.checkPVC(r.PVC) != nil || r.PVC.VolumeName == "" || deadline.IsZero() {
		return CollectorRef{}, model.ErrInvalid
	}
	sum := sha256.Sum256([]byte(r.ExportID))
	name := "pero-export-" + hex.EncodeToString(sum[:])[:40]
	digest, err := model.Digest(struct {
		Request  CollectorRequest
		Config   CollectorConfig
		Deadline time.Time
	}{r, o.config, deadline.UTC()})
	return CollectorRef{Name: name, ConfigDigest: digest, ExpiresAt: deadline.UTC()}, err
}

type collectorJobSpec struct {
	Parallelism           int    `json:"parallelism"`
	Completions           int    `json:"completions"`
	BackoffLimit          int    `json:"backoffLimit"`
	ActiveDeadlineSeconds int64  `json:"activeDeadlineSeconds"`
	CompletionMode        string `json:"completionMode"`
	PodReplacementPolicy  string `json:"podReplacementPolicy"`
	Suspend               bool   `json:"suspend"`
	ManualSelector        *bool  `json:"manualSelector,omitempty"`
	Selector              *struct {
		MatchLabels map[string]string `json:"matchLabels"`
	} `json:"selector,omitempty"`
	Template struct {
		Metadata struct {
			Labels      map[string]string `json:"labels"`
			Annotations map[string]string `json:"annotations,omitempty"`
		} `json:"metadata"`
		Spec coldPodSpec `json:"spec"`
	} `json:"template"`
}

func (o *CollectorOwner) pod(r CollectorRequest) coldPodSpec {
	c := o.cold.config
	c.ImageRef = o.config.ImageRef
	c.RuntimeClass = o.config.RuntimeClass
	c.ServiceAccountName = o.config.ServiceAccountName
	c.Audience = "pero-export"
	pod := c.pod(r.ExportID, r.PVC.Name)
	pod.SecurityContext.FSGroup = nil // read-only collection must not chmod retained data
	container := &pod.Containers[0]
	container.Name = "collector"
	container.Env = nil
	container.Command = []string{"/usr/local/bin/pero-artifact-collector"}
	container.Args = []string{"--control-url", o.config.ControlURL, "--export-id", r.ExportID, "--token-file", "/var/run/pero-export/token", "--root", "/data"}
	if o.config.ControlCAFile != "" {
		container.Args = append(container.Args, "--ca-file", o.config.ControlCAFile)
	}
	container.VolumeMounts = []coldMount{{"workspace", "/data", true}, {"identity", "/var/run/pero-export", true}}
	container.Resources.Requests = map[string]string{"cpu": "100m", "memory": "64Mi", "ephemeral-storage": "16Mi"}
	container.Resources.Limits = map[string]string{"cpu": "1", "memory": "512Mi", "ephemeral-storage": "64Mi"}
	pod.Volumes = []coldVolume{pod.Volumes[0], pod.Volumes[2]}
	pod.Volumes[0].PersistentVolumeClaim.ReadOnly = true
	pod.Volumes[1].Projected.DefaultMode = 0444 // sole unprivileged container; no fsGroup mutation of retained volume
	return pod
}
func (o *CollectorOwner) spec(r CollectorRequest, ref CollectorRef) collectorJobSpec {
	spec := collectorJobSpec{Parallelism: 1, Completions: 1, BackoffLimit: 0, ActiveDeadlineSeconds: 900, CompletionMode: "NonIndexed", PodReplacementPolicy: "Failed"}
	spec.Template.Metadata.Labels = map[string]string{labelPrefix + "spec": claimDigestLabel(ref.ConfigDigest)}
	spec.Template.Spec = o.pod(r)
	return spec
}
func (o *CollectorOwner) check(r CollectorRequest, ref CollectorRef) error {
	expected, err := o.Reservation(r, ref.ExpiresAt)
	if err != nil || expected.Name != ref.Name || expected.ConfigDigest != ref.ConfigDigest || ref.UID != "" && !model.ValidKey(ref.UID) {
		return fmt.Errorf("collector reservation: %w", model.ErrIdentity)
	}
	return nil
}
func (o *CollectorOwner) validateJob(object coldObject, r CollectorRequest, ref CollectorRef) (CollectorRef, error) {
	if object.APIVersion != "batch/v1" || object.Kind != "Job" || object.Metadata.Name != ref.Name || object.Metadata.Namespace != r.PVC.Namespace || object.Metadata.UID == "" || object.Metadata.ResourceVersion == "" || object.Metadata.Labels[labelPrefix+"spec"] != claimDigestLabel(ref.ConfigDigest) || ref.UID != "" && ref.UID != object.Metadata.UID || object.Metadata.DeletionTimestamp != "" || len(object.Metadata.OwnerReferences) != 0 {
		return ref, fmt.Errorf("collector Job identity: %w", model.ErrIdentity)
	}
	var actual collectorJobSpec
	if strictProfile(object.Spec, &actual) != nil {
		return ref, fmt.Errorf("collector Job spec schema (sha256:%x): %w", sha256.Sum256(object.Spec), model.ErrIdentity)
	}
	expected := o.spec(r, ref)
	if actual.ManualSelector != nil && *actual.ManualSelector {
		return ref, fmt.Errorf("collector Job manual selector: %w", model.ErrIdentity)
	}
	actual.ManualSelector = nil
	if actual.Selector != nil {
		labels := actual.Selector.MatchLabels
		if !reflect.DeepEqual(labels, map[string]string{"batch.kubernetes.io/controller-uid": object.Metadata.UID}) {
			return ref, fmt.Errorf("collector Job generated selector: %w", model.ErrIdentity)
		}
		actual.Selector = nil
	}
	for k, v := range actual.Template.Metadata.Labels {
		switch k {
		case "batch.kubernetes.io/controller-uid", "controller-uid":
			if v != object.Metadata.UID {
				return ref, fmt.Errorf("collector Job template controller label: %w", model.ErrIdentity)
			}
			delete(actual.Template.Metadata.Labels, k)
		case "batch.kubernetes.io/job-name", "job-name":
			if v != ref.Name {
				return ref, fmt.Errorf("collector Job template name label: %w", model.ErrIdentity)
			}
			delete(actual.Template.Metadata.Labels, k)
		}
	}
	if len(actual.Template.Metadata.Annotations) != 0 {
		return ref, fmt.Errorf("collector Job template annotations: %w", model.ErrIdentity)
	}
	if !samePodProfile(actual.Template.Spec, expected.Template.Spec) {
		return ref, fmt.Errorf("collector Job Pod template profile (sha256:%x): %w", sha256.Sum256(object.Spec), model.ErrIdentity)
	}
	actual.Template.Spec = expected.Template.Spec
	if !reflect.DeepEqual(actual, expected) {
		return ref, fmt.Errorf("collector Job spec profile (sha256:%x): %w", sha256.Sum256(object.Spec), model.ErrIdentity)
	}
	ref.UID = object.Metadata.UID
	return ref, nil
}
func (o *CollectorOwner) verifyVolumeAndSA(ctx context.Context, r CollectorRequest) error {
	volume, err := o.cold.ObserveVolume(ctx, r.PVC)
	if err != nil {
		return fmt.Errorf("collector PVC observation: %w", err)
	}
	if volume.Phase != "Bound" || volume.VolumeName != r.PVC.VolumeName {
		return fmt.Errorf("collector bound PV identity: %w", model.ErrIdentity)
	}
	sa, err := o.cold.request(ctx, http.MethodGet, "ServiceAccount", o.config.ServiceAccountName, nil)
	if err != nil {
		return err
	}
	if !o.cold.matches(sa, "ServiceAccount", o.config.ServiceAccountName, o.config.ServiceAccountUID, "") || sa.Metadata.DeletionTimestamp != "" {
		return fmt.Errorf("collector service account identity: %w", model.ErrIdentity)
	}
	return nil
}
func (o *CollectorOwner) Provision(ctx context.Context, r CollectorRequest, ref CollectorRef) (CollectorRef, error) {
	if err := o.check(r, ref); err != nil {
		return ref, err
	}
	if ref.UID != "" {
		return ref, model.ErrIdentity
	}
	if err := o.verifyVolumeAndSA(ctx, r); err != nil {
		return ref, err
	}
	object, err := o.cold.request(ctx, http.MethodPost, "Job", "", map[string]any{"apiVersion": "batch/v1", "kind": "Job", "metadata": o.cold.metadata(ref.Name, ref.ConfigDigest), "spec": o.spec(r, ref)})
	if errors.Is(err, ErrAlreadyExists) {
		return o.Reconcile(ctx, r, ref)
	}
	if err != nil {
		return ref, err
	}
	return o.validateJob(object, r, ref)
}
func (o *CollectorOwner) Reconcile(ctx context.Context, r CollectorRequest, ref CollectorRef) (CollectorRef, error) {
	if err := o.check(r, ref); err != nil {
		return ref, err
	}
	if err := o.verifyVolumeAndSA(ctx, r); err != nil {
		return ref, err
	}
	object, err := o.cold.request(ctx, http.MethodGet, "Job", ref.Name, nil)
	if err != nil {
		return ref, err
	}
	return o.validateJob(object, r, ref)
}
func (o *CollectorOwner) pods(ctx context.Context, ref CollectorRef) ([]coldObject, error) {
	path := "/api/v1/namespaces/" + o.cold.config.Namespace + "/pods?limit=2&labelSelector=" + url.QueryEscape("batch.kubernetes.io/controller-uid="+ref.UID)
	list, err := o.cold.requestPath(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	if list.Kind != "PodList" || list.APIVersion != "v1" || list.Metadata.Continue != "" || len(list.Items) > 1 {
		return nil, fmt.Errorf("collector Pod list identity or completeness: %w", model.ErrIdentity)
	}
	for i := range list.Items {
		pod := &list.Items[i]
		// The typed Kubernetes PodList codec sets TypeMeta on the envelope,
		// not its nested Pods. Derive only that omitted pair from this validated
		// complete v1/PodList; never repair an explicit conflicting/partial type.
		if pod.APIVersion == "" && pod.Kind == "" {
			pod.APIVersion, pod.Kind = "v1", "Pod"
		}
		if pod.APIVersion != "v1" || pod.Kind != "Pod" {
			return nil, fmt.Errorf("collector Pod list item type: %w", model.ErrIdentity)
		}
	}
	return list.Items, nil
}
func (o *CollectorOwner) Observe(ctx context.Context, r CollectorRequest, ref CollectorRef) (CollectorPod, error) {
	if ref.UID == "" {
		return CollectorPod{}, model.ErrIdentity
	}
	if _, err := o.Reconcile(ctx, r, ref); err != nil {
		return CollectorPod{}, err
	}
	pods, err := o.pods(ctx, ref)
	if err != nil {
		return CollectorPod{}, err
	}
	if len(pods) != 1 {
		return CollectorPod{}, ErrNotFound
	}
	pod := pods[0]
	if !o.cold.matches(pod, "Pod", pod.Metadata.Name, "", ref.ConfigDigest) || pod.Metadata.DeletionTimestamp != "" {
		return CollectorPod{}, fmt.Errorf("collector Pod identity: %w", model.ErrIdentity)
	}
	owners := pod.Metadata.OwnerReferences
	if len(owners) != 1 || !owners[0].Controller || owners[0].APIVersion != "batch/v1" || owners[0].Kind != "Job" || owners[0].Name != ref.Name || owners[0].UID != ref.UID {
		return CollectorPod{}, fmt.Errorf("collector Pod owner identity: %w", model.ErrIdentity)
	}
	var actual coldPodSpec
	if strictProfile(pod.Spec, &actual) != nil {
		return CollectorPod{}, fmt.Errorf("collector Pod spec schema (sha256:%x): %w", sha256.Sum256(pod.Spec), model.ErrIdentity)
	}
	if !samePodProfile(actual, o.pod(r)) {
		return CollectorPod{}, fmt.Errorf("collector Pod profile (sha256:%x): %w", sha256.Sum256(pod.Spec), model.ErrIdentity)
	}
	var status Object
	if len(pod.Status) == 0 {
		return CollectorPod{}, ErrNotFound
	}
	if json.Unmarshal(pod.Status, &status.Status) != nil {
		return CollectorPod{}, fmt.Errorf("collector Pod status schema: %w", model.ErrIdentity)
	}
	if len(status.Status.ContainerStatuses) != 1 {
		return CollectorPod{}, ErrNotFound
	}
	container := status.Status.ContainerStatuses[0]
	if container.ImageID == "" {
		return CollectorPod{}, ErrNotFound
	}
	image, ok := imageArtifact("collector", container.ImageID)
	if container.Name != "collector" || !ok || image.Digest != o.config.ImageDigest {
		return CollectorPod{}, fmt.Errorf("collector container image identity: %w", model.ErrIdentity)
	}
	return CollectorPod{Name: pod.Metadata.Name, UID: pod.Metadata.UID, ServiceAccount: o.config.ServiceAccountName, ServiceAccountUID: o.config.ServiceAccountUID, JobUID: ref.UID}, nil
}

// Dispose settles original API objects, not physical storage. The collector is
// read-only; the caller retains the original trusted writer-fence receipt.
func (o *CollectorOwner) Dispose(ctx context.Context, r CollectorRequest, ref CollectorRef, pod *CollectorPod) error {
	if o.check(r, ref) != nil || ref.UID == "" {
		return model.ErrIdentity
	}
	object, err := o.cold.request(ctx, http.MethodGet, "Job", ref.Name, nil)
	if err == nil && object.Metadata.UID == ref.UID {
		_, err = o.cold.request(ctx, http.MethodDelete, "Job", ref.Name, uidDelete(ref.UID))
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		object, err = o.cold.request(ctx, http.MethodGet, "Job", ref.Name, nil)
		if err == nil && object.Metadata.UID == ref.UID {
			return fmt.Errorf("collector Job still terminating")
		}
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if pod != nil {
		if pod.JobUID != ref.UID || !dnsName.MatchString(pod.Name) || !model.ValidKey(pod.UID) {
			return model.ErrIdentity
		}
		object, err = o.cold.request(ctx, http.MethodGet, "Pod", pod.Name, nil)
		if err == nil && object.Metadata.UID == pod.UID {
			return fmt.Errorf("original collector Pod still present")
		}
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
	}
	pods, err := o.pods(ctx, ref)
	if err != nil {
		return err
	}
	if len(pods) != 0 {
		return fmt.Errorf("collector Pods still present")
	}
	return nil
}
