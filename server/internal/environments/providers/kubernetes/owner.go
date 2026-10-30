// Adapted from phodal/point@edff76d7dd39b2900cff707af1896fe8ff9fd2dc; see ../../SOURCE_REFERENCES.md.
package kubernetes

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
)

type Owner struct {
	identity   model.Owner
	reader     Reader
	namespaces map[string]bool
	now        func() time.Time
}

func NewOwner(clusterID string, namespaces []string, reader Reader, now func() time.Time) (*Owner, error) {
	identity := model.Owner{Kind: "kubernetes", ID: clusterID}
	if identity.Validate() != nil || reader == nil || len(namespaces) == 0 {
		return nil, model.ErrInvalid
	}
	if now == nil {
		now = time.Now
	}
	owner := &Owner{identity: identity, reader: reader, namespaces: map[string]bool{}, now: now}
	for _, namespace := range namespaces {
		if _, err := resourcePath(Key{Kind: "kubernetes.pod", Namespace: namespace, Name: "check"}); err != nil {
			return nil, err
		}
		owner.namespaces[namespace] = true
	}
	return owner, nil
}

func (o *Owner) Owner() model.Owner { return o.identity }

// Resolve reads a Pod or Sandbox by name and returns its current UID as the
// incarnation. A later Attach still observes and rejects a replaced object.
func (o *Owner) Resolve(ctx context.Context, ref model.ResourceRef) (model.ResourceRef, error) {
	if ref.Owner != o.identity || !o.namespaces[ref.Scope] || ref.Kind != "kubernetes.pod" && ref.Kind != "kubernetes.sandbox" || !model.ValidText(ref.ID) || ref.Incarnation != "" {
		return model.ResourceRef{}, model.ErrInvalid
	}
	object, err := o.reader.Get(ctx, Key{Kind: ref.Kind, Namespace: ref.Scope, Name: ref.ID})
	if errors.Is(err, ErrNotFound) {
		return model.ResourceRef{}, model.ErrNotFound
	}
	if err != nil {
		return model.ResourceRef{}, err
	}
	ref.Incarnation = object.Metadata.UID
	if ref.Validate() != nil || !matches(object, ref) {
		return model.ResourceRef{}, model.ErrIdentity
	}
	return ref, nil
}

func (o *Owner) Observe(ctx context.Context, ref model.ResourceRef) (model.Observation, error) {
	if ref.Validate() != nil || ref.Owner != o.identity || !o.namespaces[ref.Scope] {
		return model.Observation{}, model.ErrIdentity
	}
	object, err := o.reader.Get(ctx, Key{Kind: ref.Kind, Namespace: ref.Scope, Name: ref.ID})
	if err != nil {
		return model.Observation{}, err
	}
	if !matches(object, ref) {
		return model.Observation{}, model.ErrIdentity
	}
	observation := model.Observation{Resource: ref, ObservedAt: o.now(), Receipt: model.Ref{Kind: "kubernetes-observation", ID: ref.Incarnation, Revision: object.Metadata.ResourceVersion}, Ready: model.Condition{Status: "False", Reason: "NotReady"}}
	if object.Metadata.DeletionTimestamp != "" {
		observation.Ready.Reason = "Terminating"
		return observation, nil
	}
	pod := object
	if ref.Kind == "kubernetes.sandbox" {
		if object.Spec.OperatingMode != "Running" {
			observation.Ready.Reason = "Suspended"
			return observation, nil
		}
		if object.Spec.ShutdownTime != "" {
			deadline, err := time.Parse(time.RFC3339, object.Spec.ShutdownTime)
			if err != nil || !deadline.After(o.now()) {
				observation.Ready.Reason = "Expired"
				return observation, nil
			}
		}
		if !readyCondition(object, true) {
			observation.Ready.Reason = "SandboxNotReady"
			return observation, nil
		}
		// v1beta1's backing Pod has the Sandbox's name. A same-name Pod is
		// accepted only after validating its controller OwnerReference.
		// A warm-pool adoption keeps the Pod it adopted and records its name.
		podName := ref.ID
		if object.Metadata.PodName != "" {
			podName = object.Metadata.PodName
		}
		pod, err = o.reader.Get(ctx, Key{Kind: "kubernetes.pod", Namespace: ref.Scope, Name: podName})
		if err != nil {
			return model.Observation{}, err
		}
		podRef := model.ResourceRef{Owner: o.identity, Kind: "kubernetes.pod", Scope: ref.Scope, ID: podName, Incarnation: pod.Metadata.UID}
		if !matches(pod, podRef) || pod.Metadata.DeletionTimestamp != "" || !controlledBy(pod, object) {
			return model.Observation{}, model.ErrIdentity
		}
		// Both resourceVersions witness this observation; they remain opaque
		// ordering tokens and do not become environment configuration revisions.
		observation.Receipt.Revision += "/" + pod.Metadata.ResourceVersion
	}
	runtime, ready, err := runtimeIdentity(pod)
	if err != nil {
		return model.Observation{}, err
	}
	observation.Runtime = runtime
	for _, container := range pod.Status.ContainerStatuses {
		if container.ImageID != "" {
			observation.States = append(observation.States, model.Ref{Kind: "container-image", ID: container.ImageID, Revision: container.Name})
		}
		if artifact, ok := imageArtifact(container.Name, container.ImageID); ok {
			observation.Artifacts = append(observation.Artifacts, artifact)
		}
	}
	sort.Slice(observation.States, func(i, j int) bool { return observation.States[i].Revision < observation.States[j].Revision })
	sort.Slice(observation.Artifacts, func(i, j int) bool { return observation.Artifacts[i].Revision < observation.Artifacts[j].Revision })
	if ready {
		observation.Ready = model.Condition{Status: "True", Reason: "OwnerReady"}
	}
	return observation, observation.Validate()
}

var imageDigest = regexp.MustCompile(`(?:^|@)(sha256:[a-f0-9]{64})$`)

// imageArtifact turns the kubelet-reported imageID into a deployed artifact.
// A pulled image reports repo@sha256:<manifest digest> (kind container-image);
// an image imported without a registry reports its bare content ID (kind
// container-image-id), which is a different hash space and is never presented
// as a manifest digest. Anything else yields no artifact rather than a guess.
func imageArtifact(container, imageID string) (model.Ref, bool) {
	match := imageDigest.FindStringSubmatch(imageID)
	if match == nil {
		return model.Ref{}, false
	}
	kind := "container-image"
	if strings.HasPrefix(imageID, "sha256:") {
		kind = "container-image-id"
	}
	return model.Ref{Kind: kind, ID: imageID, Revision: container, Digest: match[1]}, true
}

func matches(object Object, ref model.ResourceRef) bool {
	expectedKind, expectedAPI := "Pod", "v1"
	if ref.Kind == "kubernetes.sandbox" {
		expectedKind, expectedAPI = "Sandbox", SandboxAPI
	} else if ref.Kind == ClaimKind {
		expectedKind, expectedAPI = "SandboxClaim", ClaimAPI
	} else if ref.Kind != "kubernetes.pod" {
		return false
	}
	return object.APIVersion == expectedAPI && object.Kind == expectedKind && object.Metadata.Name == ref.ID && object.Metadata.Namespace == ref.Scope && object.Metadata.UID == ref.Incarnation && object.Metadata.UID != "" && object.Metadata.ResourceVersion != ""
}

func readyCondition(object Object, generation bool) bool {
	for _, condition := range object.Status.Conditions {
		if condition.Type == "Ready" {
			return condition.Status == "True" && (!generation || object.Metadata.Generation > 0 && condition.ObservedGeneration == object.Metadata.Generation)
		}
	}
	return false
}

func controlledBy(pod, sandbox Object) bool {
	for _, owner := range pod.Metadata.OwnerReferences {
		if owner.APIVersion == SandboxAPI && owner.Kind == "Sandbox" && owner.Name == sandbox.Metadata.Name && owner.UID == sandbox.Metadata.UID && owner.Controller {
			return true
		}
	}
	return false
}

func runtimeIdentity(pod Object) (*model.Ref, bool, error) {
	statuses := append(pod.Status.ContainerStatuses[:0:0], pod.Status.ContainerStatuses...)
	if len(statuses) == 0 {
		return nil, false, nil
	}
	sort.Slice(statuses, func(i, j int) bool { return statuses[i].Name < statuses[j].Name })
	identities := make([][4]string, 0, len(statuses))
	ready := pod.Status.Phase == "Running" && readyCondition(pod, false)
	for _, status := range statuses {
		if status.Name == "" || status.RestartCount < 0 {
			return nil, false, model.ErrInvalid
		}
		if status.ContainerID == "" || status.ImageID == "" {
			return nil, false, nil
		}
		ready = ready && status.Ready && status.State.Running != nil && status.ContainerID != "" && status.ImageID != ""
		identities = append(identities, [4]string{status.Name, status.ContainerID, fmt.Sprint(status.RestartCount), status.ImageID})
	}
	digest, err := model.Digest(identities)
	if err != nil {
		return nil, false, err
	}
	return &model.Ref{Kind: "kubernetes-runtime", ID: pod.Metadata.UID, Digest: digest}, ready, nil
}

// This adapter holds only an attachment. Acknowledge its detachment while the
// original resource remains externally owned. No DELETE, exec, tunnel, or
// credential delivery is performed, including during reconciliation.
func (o *Owner) Detach(ctx context.Context, requestID string, binding model.Binding) (model.Ref, error) {
	if err := ctx.Err(); err != nil {
		return model.Ref{}, err
	}
	if !model.ValidKey(requestID) || binding.Observation.Resource.Owner != o.identity || !o.namespaces[binding.Observation.Resource.Scope] || binding.ReleaseIntent != "detach" && binding.ReleaseIntent != "retain" {
		return model.Ref{}, model.ErrInvalid
	}
	digest, err := model.Digest(binding.Observation.Resource)
	return model.Ref{Kind: "kubernetes-detach", ID: requestID, Digest: digest}, err
}

func (o *Owner) ReconcileDetach(ctx context.Context, requestID string, binding model.Binding) (model.Ref, error) {
	return o.Detach(ctx, requestID, binding)
}
