package runtimebinding

import (
	"github.com/phodal/pero/server/internal/environments/model"
	"reflect"
)

// VolumeBinding freezes independent workspace ownership before compute exists.
// VolumeName is added once the PVC binds; API identity does not certify physical
// storage fencing. ProviderDigest binds the original fixed resource recipe.
type VolumeBinding struct {
	Resource       model.ResourceRef `json:"resource"`
	VolumeName     string            `json:"volume_name,omitempty"`
	ProviderDigest string            `json:"provider_digest"`
}

func (v VolumeBinding) valid(c Config) bool {
	return c.IsIsolated() && v.Resource.Validate() == nil && v.Resource.Kind == "kubernetes.pvc" && v.Resource.Scope == c.Namespace && v.Resource.Owner == (model.Owner{Kind: "kubernetes", ID: c.ClusterID}) && digest.MatchString(v.ProviderDigest) && (v.VolumeName == "" || model.ValidKey(v.VolumeName))
}
func (b Binding) WithVolume(volume VolumeBinding) (Binding, error) {
	if !volume.valid(b.Config) || b.Volume != nil && (b.Volume.Resource != volume.Resource || b.Volume.ProviderDigest != volume.ProviderDigest || b.Volume.VolumeName != "" && b.Volume.VolumeName != volume.VolumeName) {
		return b, ErrIdentity
	}
	b.Volume = &volume
	return b, nil
}

// ComputeCleanup does not release retained data or the overall binding. Only a
// later trusted export plus explicit data-GC authority may settle that lifetime.
func (b Binding) ComputeCleanup(receipt model.Ref) (Binding, error) {
	if !b.Config.IsIsolated() || !b.ReleaseRequested || receipt.Validate() != nil || receipt.Kind != "kubernetes-dispose" || receipt.Digest == "" || b.ComputeReceipt != nil && *b.ComputeReceipt != receipt {
		return b, ErrIdentity
	}
	b.ComputeReceipt = &receipt
	b.Phase = CleanupPending
	b.Reason = "DataExportPending"
	b.ValidUntil = nil
	return b, nil
}
func (b Binding) validateVolume(previous Binding) error {
	if b.Volume != nil && !b.Volume.valid(b.Config) {
		return ErrInvalid
	}
	if previous.Volume != nil && (b.Volume == nil || b.Volume.Resource != previous.Volume.Resource || b.Volume.ProviderDigest != previous.Volume.ProviderDigest || previous.Volume.VolumeName != "" && b.Volume.VolumeName != previous.Volume.VolumeName) {
		return ErrIdentity
	}
	if previous.ComputeReceipt != nil && (b.ComputeReceipt == nil || *b.ComputeReceipt != *previous.ComputeReceipt) {
		return ErrIdentity
	}
	if b.ComputeReceipt != nil && (!b.Config.IsIsolated() || !b.ReleaseRequested || b.ComputeReceipt.Validate() != nil || b.ComputeReceipt.Kind != "kubernetes-dispose" || b.ComputeReceipt.Digest == "" || b.ValidUntil != nil) {
		return ErrInvalid
	}
	if previous.DataCleanupReceipt != nil && !reflect.DeepEqual(previous.DataCleanupReceipt, b.DataCleanupReceipt) {
		return ErrIdentity
	}
	if b.DataCleanupReceipt != nil && (!b.Config.IsIsolated() || b.ComputeReceipt == nil || b.Volume == nil || b.DataCleanupReceipt.Validate() != nil || b.DataCleanupReceipt.Kind != "kubernetes-volume-dispose" || !digest.MatchString(b.DataCleanupReceipt.Digest) || !digest.MatchString(b.DataCleanupReceipt.Revision) || b.Phase != Released || !reflect.DeepEqual(b.CleanupReceipt, b.DataCleanupReceipt)) {
		return ErrInvalid
	}
	if b.Config.IsIsolated() && b.Phase == Released && b.DataCleanupReceipt == nil {
		return ErrInvalid
	}
	if b.Config.IsIsolated() && b.Snapshot != nil && (b.Volume == nil || b.Volume.VolumeName == "") {
		return ErrInvalid
	}
	return nil
}

// DataCleanup records only the explicit volume owner's receipt together with
// the durable approval digest. A compute receipt cannot end the data lifetime.
func (b Binding) DataCleanup(receipt model.Ref, approvalDigest string) (Binding, error) {
	if !b.Config.IsIsolated() || !b.ReleaseRequested || b.ComputeReceipt == nil || b.Volume == nil || b.Volume.VolumeName == "" || receipt.Validate() != nil || receipt.Kind != "kubernetes-volume-dispose" || !digest.MatchString(receipt.Digest) || !digest.MatchString(approvalDigest) {
		return b, ErrInvalid
	}
	receipt.Revision = approvalDigest
	if b.DataCleanupReceipt != nil && *b.DataCleanupReceipt != receipt {
		return b, ErrIdentity
	}
	b.DataCleanupReceipt = &receipt
	b.CleanupReceipt = &receipt
	b.Phase = Released
	b.Reason = "RetainedVolumeGone"
	b.ValidUntil = nil
	return b, nil
}
