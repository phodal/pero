package kubernetes

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
)

// ColdOwner creates only core Agent Sandbox resources and independent PVCs.
// The coordinator persists each original request/UID before the next effect.
// Neither this resource owner nor the workload SA owns Run/Worker authority.
type ColdOwner struct {
	base         string
	client       *http.Client
	config       ColdConfig
	identity     model.Owner
	configDigest string
	now          func() time.Time
}
type ColdResourceNames struct{ Sandbox, Volume string }

func IsolatedNames(requestID string) (ColdResourceNames, error) {
	if !model.ValidKey(requestID) {
		return ColdResourceNames{}, model.ErrInvalid
	}
	sum := sha256.Sum256([]byte(requestID))
	suffix := hex.EncodeToString(sum[:])[:40]
	return ColdResourceNames{Sandbox: "pero-agent-" + suffix, Volume: "pero-work-" + suffix}, nil
}
func NewColdOwner(base string, client *http.Client, config ColdConfig, now func() time.Time) (*ColdOwner, error) {
	if config.Validate() != nil {
		return nil, model.ErrInvalid
	}
	origin, checked, err := checkedClient(base, client)
	if err != nil {
		return nil, err
	}
	digest, err := model.Digest(config)
	if err != nil {
		return nil, err
	}
	if now == nil {
		now = time.Now
	}
	return &ColdOwner{origin, checked, config, model.Owner{Kind: "kubernetes", ID: config.ClusterID}, digest, now}, nil
}
func (o *ColdOwner) Owner() model.Owner { return o.identity }

type coldObject struct {
	APIVersion string          `json:"apiVersion"`
	Kind       string          `json:"kind"`
	Metadata   Metadata        `json:"metadata"`
	Spec       json.RawMessage `json:"spec"`
	Status     json.RawMessage `json:"status"`
}
type coldPVCSpec struct {
	AccessModes      []string `json:"accessModes"`
	StorageClassName string   `json:"storageClassName"`
	VolumeMode       string   `json:"volumeMode"`
	VolumeName       string   `json:"volumeName,omitempty"`
	Resources        struct {
		Requests map[string]string `json:"requests"`
		Limits   map[string]string `json:"limits,omitempty"`
	} `json:"resources"`
}
type coldSandboxSpec struct {
	OperatingMode  string `json:"operatingMode"`
	ShutdownTime   string `json:"shutdownTime"`
	ShutdownPolicy string `json:"shutdownPolicy"`
	Service        *bool  `json:"service"`
	PodTemplate    struct {
		Metadata struct {
			Labels      map[string]string `json:"labels,omitempty"`
			Annotations map[string]string `json:"annotations,omitempty"`
		} `json:"metadata"`
		Spec coldPodSpec `json:"spec"`
	} `json:"podTemplate"`
}

func (o *ColdOwner) path(kind, name string) (string, error) {
	if name != "" && !dnsName.MatchString(name) {
		return "", model.ErrInvalid
	}
	prefix := "/api/v1/namespaces/" + o.config.Namespace + "/"
	switch kind {
	case "Sandbox":
		prefix = "/apis/" + SandboxAPI + "/namespaces/" + o.config.Namespace + "/sandboxes"
	case "Pod":
		prefix += "pods"
	case "PersistentVolumeClaim":
		prefix += "persistentvolumeclaims"
	case "ServiceAccount":
		prefix += "serviceaccounts"
	default:
		return "", model.ErrInvalid
	}
	if name != "" {
		prefix += "/" + name
	}
	return prefix, nil
}
func (o *ColdOwner) request(ctx context.Context, method, kind, name string, input any) (coldObject, error) {
	path, err := o.path(kind, name)
	if err != nil {
		return coldObject{}, err
	}
	var body []byte
	if input != nil {
		body, err = json.Marshal(input)
		if err != nil {
			return coldObject{}, err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, o.base+path, bytes.NewReader(body))
	if err != nil {
		return coldObject{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := o.client.Do(req)
	if err != nil {
		return coldObject{}, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return coldObject{}, ErrNotFound
	}
	if response.StatusCode == http.StatusConflict {
		if method == http.MethodPost {
			return coldObject{}, ErrAlreadyExists
		}
		return coldObject{}, model.ErrIdentity
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return coldObject{}, fmt.Errorf("Kubernetes %s %s: HTTP %d", method, path, response.StatusCode)
	}
	if method == http.MethodDelete {
		return coldObject{}, nil
	}
	const limit = 2 << 20
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return coldObject{}, err
	}
	if len(data) > limit {
		return coldObject{}, fmt.Errorf("Kubernetes isolated response exceeds byte limit")
	}
	var result coldObject
	err = json.Unmarshal(data, &result)
	return result, err
}
func (o *ColdOwner) fingerprint(requestID string, pvcUID string) (string, error) {
	if !model.ValidKey(requestID) {
		return "", model.ErrInvalid
	}
	return model.Digest(struct{ Request, Config, PVCUID string }{requestID, o.configDigest, pvcUID})
}
func (o *ColdOwner) metadata(name, digest string) map[string]any {
	return map[string]any{"name": name, "namespace": o.config.Namespace, "labels": map[string]string{labelPrefix + "spec": claimDigestLabel(digest)}}
}
func (o *ColdOwner) matches(object coldObject, kind, name, uid, digest string) bool {
	api := "v1"
	if kind == "Sandbox" {
		api = SandboxAPI
	}
	return object.APIVersion == api && object.Kind == kind && object.Metadata.Name == name && object.Metadata.Namespace == o.config.Namespace && object.Metadata.UID != "" && object.Metadata.ResourceVersion != "" && (uid == "" || object.Metadata.UID == uid) && (digest == "" || object.Metadata.Labels[labelPrefix+"spec"] == claimDigestLabel(digest))
}

func (o *ColdOwner) ProvisionVolume(ctx context.Context, requestID string) (PVCRef, error) {
	names, err := IsolatedNames(requestID)
	if err != nil {
		return PVCRef{}, err
	}
	digest, _ := o.fingerprint(requestID, "")
	spec := coldPVCSpec{AccessModes: []string{o.config.StorageAccessMode}, StorageClassName: o.config.StorageClass, VolumeMode: "Filesystem"}
	spec.Resources.Requests = map[string]string{"storage": o.config.VolumeSize}
	object, err := o.request(ctx, http.MethodPost, "PersistentVolumeClaim", "", map[string]any{"apiVersion": "v1", "kind": "PersistentVolumeClaim", "metadata": o.metadata(names.Volume, digest), "spec": spec})
	if errors.Is(err, ErrAlreadyExists) {
		return o.ReconcileVolume(ctx, requestID)
	}
	if err != nil {
		return PVCRef{}, err
	}
	return o.volume(object, requestID, "")
}

// ReconcileVolume never creates: an absent PVC can have been created and lost.
func (o *ColdOwner) ReconcileVolume(ctx context.Context, requestID string) (PVCRef, error) {
	names, err := IsolatedNames(requestID)
	if err != nil {
		return PVCRef{}, err
	}
	object, err := o.request(ctx, http.MethodGet, "PersistentVolumeClaim", names.Volume, nil)
	if err != nil {
		return PVCRef{}, err
	}
	return o.volume(object, requestID, "")
}
func (o *ColdOwner) volume(object coldObject, requestID, uid string) (PVCRef, error) {
	names, err := IsolatedNames(requestID)
	if err != nil {
		return PVCRef{}, err
	}
	digest, _ := o.fingerprint(requestID, "")
	if !o.matches(object, "PersistentVolumeClaim", names.Volume, uid, digest) || len(object.Metadata.OwnerReferences) != 0 || object.Metadata.DeletionTimestamp != "" {
		return PVCRef{}, model.ErrIdentity
	}
	var spec coldPVCSpec
	if strictProfile(object.Spec, &spec) != nil || !reflect.DeepEqual(spec.AccessModes, []string{o.config.StorageAccessMode}) || spec.StorageClassName != o.config.StorageClass || spec.VolumeMode != "Filesystem" || !reflect.DeepEqual(spec.Resources.Requests, map[string]string{"storage": o.config.VolumeSize}) || len(spec.Resources.Limits) != 0 {
		return PVCRef{}, model.ErrIdentity
	}
	var status struct {
		Phase string `json:"phase"`
	}
	if len(object.Status) > 0 && json.Unmarshal(object.Status, &status) != nil {
		return PVCRef{}, model.ErrInvalid
	}
	return PVCRef{Name: names.Volume, Namespace: o.config.Namespace, UID: object.Metadata.UID, VolumeName: spec.VolumeName, StorageClass: spec.StorageClassName, AccessMode: o.config.StorageAccessMode, VolumeSize: o.config.VolumeSize, Phase: status.Phase, RequestID: requestID, ConfigDigest: o.configDigest}, nil
}
func (o *ColdOwner) checkPVC(ref PVCRef) error {
	names, err := IsolatedNames(ref.RequestID)
	if err != nil || ref.Name != names.Volume || ref.Namespace != o.config.Namespace || !model.ValidText(ref.UID) || ref.StorageClass != o.config.StorageClass || ref.AccessMode != o.config.StorageAccessMode || ref.VolumeSize != o.config.VolumeSize || ref.ConfigDigest != o.configDigest {
		return model.ErrIdentity
	}
	return nil
}

// ObserveVolume refreshes the original UID-pinned PVC. Persist VolumeName on its
// first Bound observation before compute authorization or trusted export.
func (o *ColdOwner) ObserveVolume(ctx context.Context, ref PVCRef) (PVCRef, error) {
	if err := o.checkPVC(ref); err != nil {
		return PVCRef{}, err
	}
	object, err := o.request(ctx, http.MethodGet, "PersistentVolumeClaim", ref.Name, nil)
	if err != nil {
		return PVCRef{}, err
	}
	current, err := o.volume(object, ref.RequestID, ref.UID)
	if err == nil && ref.VolumeName != "" && current.VolumeName != ref.VolumeName {
		return PVCRef{}, model.ErrIdentity
	}
	return current, err
}

func (o *ColdOwner) ProvisionSandbox(ctx context.Context, requestID string, pvc PVCRef) (model.ResourceRef, error) {
	if requestID != pvc.RequestID {
		return model.ResourceRef{}, model.ErrIdentity
	}
	if _, err := o.ObserveVolume(ctx, pvc); err != nil {
		return model.ResourceRef{}, err
	}
	names, _ := IsolatedNames(requestID)
	digest, _ := o.fingerprint(requestID, pvc.UID)
	spec := coldSandboxSpec{OperatingMode: "Running", ShutdownTime: o.now().Add(time.Duration(o.config.TTLSeconds) * time.Second).UTC().Format(time.RFC3339), ShutdownPolicy: "Retain", Service: ptr(false)}
	spec.PodTemplate.Spec = o.config.pod(requestID, pvc.Name)
	object, err := o.request(ctx, http.MethodPost, "Sandbox", "", map[string]any{"apiVersion": SandboxAPI, "kind": "Sandbox", "metadata": o.metadata(names.Sandbox, digest), "spec": spec})
	if errors.Is(err, ErrAlreadyExists) {
		return o.ReconcileSandbox(ctx, requestID, pvc)
	}
	if err != nil {
		return model.ResourceRef{}, err
	}
	return o.sandboxRef(object, requestID, pvc)
}

// ReconcileSandbox is read-only even after a lost creation reply and absence.
func (o *ColdOwner) ReconcileSandbox(ctx context.Context, requestID string, pvc PVCRef) (model.ResourceRef, error) {
	if requestID != pvc.RequestID {
		return model.ResourceRef{}, model.ErrIdentity
	}
	if _, err := o.ObserveVolume(ctx, pvc); err != nil {
		return model.ResourceRef{}, err
	}
	names, _ := IsolatedNames(requestID)
	object, err := o.request(ctx, http.MethodGet, "Sandbox", names.Sandbox, nil)
	if err != nil {
		return model.ResourceRef{}, err
	}
	return o.sandboxRef(object, requestID, pvc)
}
func (o *ColdOwner) sandboxRef(object coldObject, requestID string, pvc PVCRef) (model.ResourceRef, error) {
	names, _ := IsolatedNames(requestID)
	digest, _ := o.fingerprint(requestID, pvc.UID)
	if !o.matches(object, "Sandbox", names.Sandbox, "", digest) {
		return model.ResourceRef{}, model.ErrIdentity
	}
	if _, err := o.sandboxSpec(object, pvc); err != nil {
		return model.ResourceRef{}, err
	}
	return model.ResourceRef{Owner: o.identity, Kind: "kubernetes.sandbox", Scope: o.config.Namespace, ID: names.Sandbox, Incarnation: object.Metadata.UID}, nil
}
func (o *ColdOwner) sandboxSpec(object coldObject, pvc PVCRef) (time.Time, error) {
	var spec coldSandboxSpec
	if strictProfile(object.Spec, &spec) != nil || spec.Service == nil || *spec.Service || spec.ShutdownPolicy != "Retain" || spec.OperatingMode != "Running" || !o.config.validPod(spec.PodTemplate.Spec, pvc.RequestID, pvc.Name) {
		return time.Time{}, model.ErrIdentity
	}
	deadline, err := time.Parse(time.RFC3339, spec.ShutdownTime)
	if err != nil {
		return time.Time{}, model.ErrInvalid
	}
	return deadline, nil
}

func (o *ColdOwner) Observe(ctx context.Context, ref model.ResourceRef, pvc PVCRef) (model.Observation, error) {
	if ref.Validate() != nil || ref.Owner != o.identity || ref.Kind != "kubernetes.sandbox" || ref.Scope != o.config.Namespace {
		return model.Observation{}, model.ErrIdentity
	}
	current, err := o.ObserveVolume(ctx, pvc)
	if err != nil {
		return model.Observation{}, err
	}
	names, _ := IsolatedNames(pvc.RequestID)
	digest, _ := o.fingerprint(pvc.RequestID, pvc.UID)
	object, err := o.request(ctx, http.MethodGet, "Sandbox", ref.ID, nil)
	if err != nil {
		return model.Observation{}, err
	}
	if ref.ID != names.Sandbox || !o.matches(object, "Sandbox", ref.ID, ref.Incarnation, digest) {
		return model.Observation{}, model.ErrIdentity
	}
	deadline, err := o.sandboxSpec(object, pvc)
	if err != nil {
		return model.Observation{}, err
	}
	observation := model.Observation{Resource: ref, ObservedAt: o.now(), Receipt: model.Ref{Kind: "kubernetes-observation", ID: ref.Incarnation, Revision: object.Metadata.ResourceVersion}, Ready: model.Condition{Status: "False", Reason: "NotReady"}, LeaseExpiresAt: &deadline, States: []model.Ref{{Kind: "persistent-volume-claim", ID: pvc.UID, Revision: current.VolumeName}}, Attributes: map[string]string{"runtime-class": o.config.RuntimeClass, "service-account-uid": o.config.ServiceAccountUID, "template-digest": o.config.TemplateDigest, "pvc-name": pvc.Name}}
	if !deadline.After(o.now()) {
		observation.Ready.Reason = "Expired"
		return observation, nil
	}
	if object.Metadata.DeletionTimestamp != "" {
		observation.Ready.Reason = "Terminating"
		return observation, nil
	}
	var status Object
	if len(object.Status) > 0 && json.Unmarshal(object.Status, &status.Status) != nil {
		return model.Observation{}, model.ErrInvalid
	}
	status.Metadata = object.Metadata
	if !readyCondition(status, true) || current.Phase != "Bound" || current.VolumeName == "" {
		return observation, nil
	}
	sa, err := o.request(ctx, http.MethodGet, "ServiceAccount", o.config.ServiceAccountName, nil)
	if err != nil {
		return model.Observation{}, err
	}
	if !o.matches(sa, "ServiceAccount", o.config.ServiceAccountName, o.config.ServiceAccountUID, "") || sa.Metadata.DeletionTimestamp != "" {
		return model.Observation{}, model.ErrIdentity
	}
	pod, err := o.request(ctx, http.MethodGet, "Pod", ref.ID, nil)
	if err != nil {
		return model.Observation{}, err
	}
	if !o.matches(pod, "Pod", ref.ID, "", "") || pod.Metadata.DeletionTimestamp != "" {
		return model.Observation{}, model.ErrIdentity
	}
	var actual coldPodSpec
	if strictProfile(pod.Spec, &actual) != nil || !o.config.validPod(actual, pvc.RequestID, pvc.Name) {
		return model.Observation{}, model.ErrIdentity
	}
	var projected Object
	projected.APIVersion = pod.APIVersion
	projected.Kind = pod.Kind
	projected.Metadata = pod.Metadata
	if len(pod.Status) > 0 && json.Unmarshal(pod.Status, &projected.Status) != nil {
		return model.Observation{}, model.ErrInvalid
	}
	if !controlledBy(projected, Object{Metadata: object.Metadata}) {
		return model.Observation{}, model.ErrIdentity
	}
	if len(projected.Status.ContainerStatuses) == 0 {
		return observation, nil
	}
	if len(projected.Status.ContainerStatuses) != 1 || projected.Status.ContainerStatuses[0].Name != "agent" {
		return model.Observation{}, model.ErrIdentity
	}
	runtime, ready, err := runtimeIdentity(projected)
	if err != nil {
		return model.Observation{}, err
	}
	if runtime == nil {
		return observation, nil
	}
	artifact, ok := imageArtifact("agent", projected.Status.ContainerStatuses[0].ImageID)
	if !ok || artifact.Kind != "container-image" || artifact.Digest != o.config.ImageDigest {
		return model.Observation{}, model.ErrIdentity
	}
	observation.Runtime = runtime
	observation.Artifacts = []model.Ref{artifact}
	observation.Receipt.Revision += "/" + pod.Metadata.ResourceVersion
	if ready {
		observation.Ready = model.Condition{Status: "True", Reason: "ProfileVerified"}
	}
	return observation, observation.Validate()
}

// ReconcileDispose deletes only the original compute UID and confirms both its
// absence and the original observed Pod UID's absence, even if ownerReferences
// drift. Without an observed Pod UID, any same-name Pod blocks conservatively.
// This is API-object settlement, not proof of physical storage/node fencing.
// A retained workspace is untouched.
func (o *ColdOwner) ReconcileDispose(ctx context.Context, requestID string, ref model.ResourceRef, originalPodUID string) (model.Ref, error) {
	names, err := IsolatedNames(requestID)
	if err != nil || ref.Validate() != nil || ref.Owner != o.identity || ref.Kind != "kubernetes.sandbox" || ref.Scope != o.config.Namespace || ref.ID != names.Sandbox || originalPodUID != "" && !model.ValidText(originalPodUID) {
		return model.Ref{}, model.ErrIdentity
	}
	object, err := o.request(ctx, http.MethodGet, "Sandbox", ref.ID, nil)
	if err == nil && object.Metadata.UID == ref.Incarnation {
		if object.Metadata.DeletionTimestamp == "" {
			_, err = o.request(ctx, http.MethodDelete, "Sandbox", ref.ID, uidDelete(ref.Incarnation))
			if err != nil && !errors.Is(err, ErrNotFound) {
				return model.Ref{}, err
			}
		}
		object, err = o.request(ctx, http.MethodGet, "Sandbox", ref.ID, nil)
		if err == nil && object.Metadata.UID == ref.Incarnation {
			return model.Ref{}, fmt.Errorf("original Sandbox is still terminating")
		}
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return model.Ref{}, err
	}
	pod, podErr := o.request(ctx, http.MethodGet, "Pod", ref.ID, nil)
	if podErr != nil && !errors.Is(podErr, ErrNotFound) {
		return model.Ref{}, podErr
	}
	if podErr == nil && (originalPodUID == "" || pod.Metadata.UID == originalPodUID || controlledBy(Object{Metadata: pod.Metadata}, Object{Metadata: Metadata{Name: ref.ID, UID: ref.Incarnation}})) {
		return model.Ref{}, fmt.Errorf("original Sandbox Pod is still present")
	}
	digest, _ := model.Digest(struct {
		Sandbox model.ResourceRef
		PodUID  string
	}{ref, originalPodUID})
	return model.Ref{Kind: "kubernetes-dispose", ID: requestID, Digest: digest}, nil
}
func uidDelete(uid string) map[string]any {
	return map[string]any{"apiVersion": "v1", "kind": "DeleteOptions", "propagationPolicy": "Foreground", "preconditions": map[string]string{"uid": uid}}
}

// DeleteVolume is a separate explicit effect. The caller must authorize it only
// after trusted export has committed a verified durable artifact receipt. This
// adapter cannot infer that authorization from compute completion or expiry.
func (o *ColdOwner) DeleteVolume(ctx context.Context, requestID string, pvc PVCRef) (model.Ref, error) {
	if !model.ValidKey(requestID) || o.checkPVC(pvc) != nil {
		return model.Ref{}, model.ErrIdentity
	}
	object, err := o.request(ctx, http.MethodGet, "PersistentVolumeClaim", pvc.Name, nil)
	if err == nil && object.Metadata.UID == pvc.UID {
		if object.Metadata.DeletionTimestamp == "" {
			if _, err = o.volume(object, pvc.RequestID, pvc.UID); err != nil {
				return model.Ref{}, err
			}
			_, err = o.request(ctx, http.MethodDelete, "PersistentVolumeClaim", pvc.Name, uidDelete(pvc.UID))
			if err != nil && !errors.Is(err, ErrNotFound) {
				return model.Ref{}, err
			}
		}
		object, err = o.request(ctx, http.MethodGet, "PersistentVolumeClaim", pvc.Name, nil)
		if err == nil && object.Metadata.UID == pvc.UID {
			return model.Ref{}, fmt.Errorf("workspace volume is still terminating")
		}
	}
	if err != nil && !errors.Is(err, ErrNotFound) {
		return model.Ref{}, err
	}
	digest, _ := model.Digest(pvc)
	return model.Ref{Kind: "kubernetes-volume-dispose", ID: requestID, Digest: digest}, nil
}
