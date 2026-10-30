// Adapted from phodal/point@edff76d7dd39b2900cff707af1896fe8ff9fd2dc; see ../../SOURCE_REFERENCES.md.
package kubernetes

import (
	"context"
	"crypto/sha256"
	"encoding/base32"
	"encoding/hex"
	"errors"
	"fmt"
	"reflect"
	"time"

	"github.com/phodal/pero/server/internal/environments/model"
	"github.com/phodal/pero/server/internal/environments/ports"
)

const ClaimKind = "kubernetes.sandboxclaim"

var errIdentity = model.ErrIdentity

// labelPrefix sits under the controller's default allowed label domain so the
// claim can carry its request identity onto the Pod without system keys.
const labelPrefix = "environments.sandbox.users.io/"

// ClaimConfig fixes where and how claims are made. TTL is mandatory: an
// abandoned environment must expire on its own at the cluster.
type ClaimConfig struct {
	Namespace      string
	WarmPool       string
	TTL            time.Duration
	ShutdownPolicy string     // Delete / DeleteForeground / Retain; default Delete
	Recipe         *model.Ref // Host-reviewed identity of this Owner's pool recipe
}

// ClaimOwner adds SandboxClaim provisioning and disposal to an attachment
// Owner of the same cluster identity. It never sets env or volumeClaimTemplates
// (either forces a cold start), never returns a claim to the pool (the
// controller has no such operation) and never deletes anything but a claim it
// can name by UID.
// attachment names the embedded read-only Owner without shadowing its Owner().
type attachment = Owner

type ClaimOwner struct {
	*attachment
	writer ClaimWriter
	config ClaimConfig
}

func NewClaimOwner(base *Owner, writer ClaimWriter, config ClaimConfig) (*ClaimOwner, error) {
	if base == nil || writer == nil || !base.namespaces[config.Namespace] || config.WarmPool == "" || !dnsName.MatchString(config.WarmPool) || config.TTL <= 0 || config.TTL > 7*24*time.Hour {
		return nil, model.ErrInvalid
	}
	if config.Recipe != nil && (config.Recipe.Validate() != nil || config.Recipe.Digest == "") {
		return nil, model.ErrInvalid
	}
	switch config.ShutdownPolicy {
	case "":
		config.ShutdownPolicy = "Delete"
	case "Delete", "DeleteForeground", "Retain":
	default:
		return nil, model.ErrInvalid
	}
	config.Recipe = model.Clone(config.Recipe)
	return &ClaimOwner{attachment: base, writer: writer, config: config}, nil
}

// ClaimName is derived from the request so a repeated create names the same
// object and Kubernetes' AlreadyExists answers whether it already happened.
func ClaimName(environmentID, slotID, requestID string) string {
	sum := sha256.Sum256([]byte(environmentID + "\x00" + slotID + "\x00" + requestID))
	return "env-" + hex.EncodeToString(sum[:])[:40]
}

func (c *ClaimOwner) ref(object Object) model.ResourceRef {
	return model.ResourceRef{Owner: c.identity, Kind: ClaimKind, Scope: c.config.Namespace, ID: object.Metadata.Name, Incarnation: object.Metadata.UID}
}

func (c *ClaimOwner) requestDigest(requestID string, spec ports.ProvisionSpec) (string, error) {
	if !model.ValidKey(requestID) || !model.ValidKey(spec.EnvironmentID) || !model.ValidKey(spec.SlotID) || spec.ResourceKind != ClaimKind || spec.Acquisition != "pool" || !reflect.DeepEqual(spec.Recipe, c.config.Recipe) {
		return "", model.ErrInvalid
	}
	return model.Digest(struct {
		Request string
		Spec    ports.ProvisionSpec
		Config  ClaimConfig
	}{requestID, spec, c.config})
}

func claimDigestLabel(digest string) string {
	sum, _ := hex.DecodeString(digest[len("sha256:"):])
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(sum)
}

func (c *ClaimOwner) Provision(ctx context.Context, requestID string, spec ports.ProvisionSpec) (model.ResourceRef, error) {
	digest, err := c.requestDigest(requestID, spec)
	if err != nil {
		return model.ResourceRef{}, err
	}
	name := ClaimName(spec.EnvironmentID, spec.SlotID, requestID)
	request := sha256.Sum256([]byte(requestID))
	claim := map[string]any{
		"apiVersion": ClaimAPI, "kind": "SandboxClaim",
		"metadata": map[string]any{"name": name, "namespace": c.config.Namespace, "labels": map[string]string{labelPrefix + "spec": claimDigestLabel(digest)}},
		"spec": map[string]any{
			"warmPoolRef":           map[string]string{"name": c.config.WarmPool},
			"lifecycle":             map[string]any{"shutdownTime": c.now().Add(c.config.TTL).UTC().Format(time.RFC3339), "shutdownPolicy": c.config.ShutdownPolicy},
			"additionalPodMetadata": map[string]any{"labels": map[string]string{labelPrefix + "request": hex.EncodeToString(request[:])[:40]}},
		},
	}
	object, err := c.writer.CreateClaim(ctx, c.config.Namespace, claim)
	if errors.Is(err, ErrAlreadyExists) {
		object, err = c.reader.Get(ctx, Key{Kind: ClaimKind, Namespace: c.config.Namespace, Name: name})
	}
	if err != nil {
		return model.ResourceRef{}, err
	}
	return c.provisioned(object, name, digest)
}

func (c *ClaimOwner) provisioned(object Object, name, digest string) (model.ResourceRef, error) {
	ref := c.ref(object)
	if object.Metadata.Name != name || object.Spec.WarmPoolRef.Name != c.config.WarmPool || !matches(object, ref) || object.Metadata.Labels[labelPrefix+"spec"] != claimDigestLabel(digest) {
		return model.ResourceRef{}, model.ErrIdentity
	}
	return ref, nil
}

// ReconcileProvision is read-only. Absence may mean the first claim expired or
// was deleted after creation, so it never recreates even under the same name.
func (c *ClaimOwner) ReconcileProvision(ctx context.Context, requestID string, spec ports.ProvisionSpec) (model.ResourceRef, error) {
	digest, err := c.requestDigest(requestID, spec)
	if err != nil {
		return model.ResourceRef{}, err
	}
	name := ClaimName(spec.EnvironmentID, spec.SlotID, requestID)
	object, err := c.reader.Get(ctx, Key{Kind: ClaimKind, Namespace: c.config.Namespace, Name: name})
	if err != nil {
		return model.ResourceRef{}, err
	}
	return c.provisioned(object, name, digest)
}

// SupportedDispositions: destroy deletes the claim, which deletes its Sandbox.
// There is deliberately no return; the pool replenishes itself.
func (c *ClaimOwner) SupportedDispositions() []string { return []string{"destroy"} }

func (c *ClaimOwner) Observe(ctx context.Context, ref model.ResourceRef) (model.Observation, error) {
	if ref.Kind != ClaimKind {
		return c.attachment.Observe(ctx, ref)
	}
	if ref.Validate() != nil || ref.Owner != c.identity || ref.Scope != c.config.Namespace {
		return model.Observation{}, model.ErrIdentity
	}
	claim, err := c.reader.Get(ctx, Key{Kind: ClaimKind, Namespace: ref.Scope, Name: ref.ID})
	if err != nil {
		return model.Observation{}, err
	}
	if claim.APIVersion != ClaimAPI || claim.Kind != "SandboxClaim" || !matches(claim, ref) {
		return model.Observation{}, model.ErrIdentity
	}
	observation := model.Observation{
		Resource: ref, ObservedAt: c.now(),
		Receipt:    model.Ref{Kind: "kubernetes-observation", ID: ref.Incarnation, Revision: claim.Metadata.ResourceVersion},
		Ready:      model.Condition{Status: "False", Reason: "NotReady"},
		Attributes: map[string]string{"provisioning": "sandbox-claim", "warm-pool": claim.Spec.WarmPoolRef.Name},
	}
	deadline, err := time.Parse(time.RFC3339, claim.Spec.Lifecycle.ShutdownTime)
	if err != nil {
		return model.Observation{}, model.ErrInvalid
	}
	observation.LeaseExpiresAt = &deadline
	if !deadline.After(c.now()) {
		observation.Ready.Reason = "Expired"
		return observation, nil
	}
	if claim.Metadata.DeletionTimestamp != "" {
		observation.Ready.Reason = "Terminating"
		return observation, nil
	}
	if !readyCondition(claim, true) || claim.Status.Sandbox.Name == "" {
		observation.Ready.Reason = "ClaimNotReady"
		return observation, nil
	}
	sandbox, err := c.reader.Get(ctx, Key{Kind: "kubernetes.sandbox", Namespace: ref.Scope, Name: claim.Status.Sandbox.Name})
	if err != nil {
		return model.Observation{}, err
	}
	if !ownedByClaim(sandbox, claim) {
		return model.Observation{}, model.ErrIdentity
	}
	inner, err := c.attachment.Observe(ctx, model.ResourceRef{Owner: c.identity, Kind: "kubernetes.sandbox", Scope: ref.Scope, ID: sandbox.Metadata.Name, Incarnation: sandbox.Metadata.UID})
	if err != nil {
		return model.Observation{}, err
	}
	observation.Runtime, observation.States, observation.Ready = inner.Runtime, inner.States, inner.Ready
	observation.Artifacts = inner.Artifacts
	observation.Receipt.Revision += "/" + inner.Receipt.Revision
	return observation, observation.Validate()
}

func ownedByClaim(sandbox, claim Object) bool {
	for _, owner := range sandbox.Metadata.OwnerReferences {
		if owner.APIVersion == ClaimAPI && owner.Kind == "SandboxClaim" && owner.Name == claim.Metadata.Name && owner.UID == claim.Metadata.UID && owner.Controller {
			return true
		}
	}
	return false
}

// Dispose deletes the claim by UID and reports success only when it is gone.
// A claim still terminating is an unsettled operation, not a completed one.
func (c *ClaimOwner) Dispose(ctx context.Context, requestID, intent string, binding model.Binding) (model.Ref, error) {
	resource := binding.Observation.Resource
	if !model.ValidKey(requestID) || intent != "destroy" || resource.Validate() != nil || resource.Kind != ClaimKind || resource.Owner != c.identity || resource.Scope != c.config.Namespace {
		return model.Ref{}, model.ErrInvalid
	}
	key := Key{Kind: ClaimKind, Namespace: resource.Scope, Name: resource.ID}
	if err := c.writer.DeleteClaim(ctx, key, resource.Incarnation); err != nil && !errors.Is(err, ErrNotFound) {
		return model.Ref{}, err
	}
	return c.settled(ctx, requestID, key, resource)
}

func (c *ClaimOwner) ReconcileDispose(ctx context.Context, requestID, intent string, binding model.Binding) (model.Ref, error) {
	resource := binding.Observation.Resource
	if !model.ValidKey(requestID) || intent != "destroy" || resource.Validate() != nil || resource.Kind != ClaimKind || resource.Owner != c.identity || resource.Scope != c.config.Namespace {
		return model.Ref{}, model.ErrInvalid
	}
	key := Key{Kind: ClaimKind, Namespace: resource.Scope, Name: resource.ID}
	object, err := c.reader.Get(ctx, key)
	if errors.Is(err, ErrNotFound) || err == nil && object.Metadata.UID != resource.Incarnation {
		return c.receipt(requestID, resource)
	}
	if err != nil {
		return model.Ref{}, err
	}
	if object.Metadata.DeletionTimestamp == "" {
		// The delete never took effect; deleting by UID again is idempotent.
		return c.Dispose(ctx, requestID, intent, binding)
	}
	return model.Ref{}, fmt.Errorf("claim %s is still terminating", resource.ID)
}

func (c *ClaimOwner) settled(ctx context.Context, requestID string, key Key, resource model.ResourceRef) (model.Ref, error) {
	object, err := c.reader.Get(ctx, key)
	if errors.Is(err, ErrNotFound) || err == nil && object.Metadata.UID != resource.Incarnation {
		return c.receipt(requestID, resource)
	}
	if err != nil {
		return model.Ref{}, err
	}
	return model.Ref{}, fmt.Errorf("claim %s is still terminating", resource.ID)
}

func (c *ClaimOwner) receipt(requestID string, resource model.ResourceRef) (model.Ref, error) {
	digest, err := model.Digest(resource)
	return model.Ref{Kind: "kubernetes-dispose", ID: requestID, Digest: digest}, err
}
