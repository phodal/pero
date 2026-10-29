---
kind: issue
status: open
---

# Isolated collector identity validation blocks export

Canonical tracker for the remaining collector acceptance failure in Draft
[PR #20](https://github.com/phodal/pero/pull/20). This is not a deployment approval.

## Observed failure

[Run 40900668618](https://github.com/phodal/pero/actions/runs/40900668618), PR head
`c029d94d73330ac82743e474844cf8e1647f5303`, tested merge/workspace
`9d27a2ef22d29bff3f2e46dda653d256deea0e54`, reached both actual external Worker /
Go ACP scenarios. Before export, their expected execution result, one provider
request, retained events, exact product Pod runsc/network proof, original compute
removal, retained PVC/PV identity and single-owned-node quiescence assertions
passed. The pinned MinIO conditional-write/checksum/replay conformance test passed.
These are partial proofs: neither complete isolated subtest passed.

Both scenarios then rejected the collector with `resource or execution identity
changed`. Collector Jobs/Pods existed, but no manifest committed and data-GC
acceptance was not reached. The original response was not retained, so the exact
rejected field/stage is not established. API defaulting is a hypothesis, not a
justification to ignore unknown fields or weaken identity validation.

Artifact `12909532979` ZIP SHA-256:
`45162f9bed7fb6ba8de02ddb261f23b04a83ebaf6ba6b9cf903f4dd70c912e1b`.
The owned cluster, registry, MinIO and PostgreSQL were removed; the original
failure exit status was retained.

## Narrowed failure and typed-list regression

[Run 40908702004](https://github.com/phodal/pero/actions/runs/40908702004)
retained both intermediate execution/compute receipts. Both export failures are
now specifically `collector Pod identity`: the original Job UID was persisted
and matched the observed Job, but collector authority was not bound. The Job
template's `creationTimestamp` was absent. Artifact `12913207576` ZIP SHA-256:
`642a96c2f965228a5c573cbb8686140d5ab6168f5e9fd9938b248240751fdd42`.

An exact `k8s.io/api` / `apimachinery` v0.36.4 harness using `runtime.Encode` and
the registered v1 legacy codec reproduced a typed `PodList` with `apiVersion`
and `kind` only on the envelope, not nested Pod items. This follows the
[typed list](https://github.com/kubernetes/api/blob/v0.36.4/core/v1/types.go) and
[versioning encoder](https://github.com/kubernetes/apimachinery/blob/v0.36.4/pkg/runtime/serializer/versioning/versioning.go)
boundaries. The adapter incorrectly required standalone-object type fields on
those items. `TestCollectorTypedPodListIdentity` reproduced the same rejection
before the fix.

The narrow fix derives only a **both-absent** item type pair after validating a
complete `v1/PodList` envelope. Explicit conflicting or partial type pairs still
fail. Namespace, UID, spec fingerprint, Job owner, Pod profile, image and
pagination checks remain mandatory; standalone object validation is unchanged.
Provider race tests pass, including negative identity-drift cases. This is a
proven adapter defect consistent with the actual failure stage, not yet proof
that it was the historical failure's only cause: raw Pod shape was not retained.
Actual export, immutable manifest and explicit data-GC acceptance remain pending.

## Next verification

Diagnostics retain only fixed rejection stages, digests and recognized response
field shapes, not arbitrary keys, environment values, arguments, logs or tokens.
The strict validation and `ErrIdentity` semantics remain unchanged. A temporary
`k8s.io/api` / `apimachinery` v0.36.4 JSON roundtrip did not emit a zero
`creationTimestamp`; older null-timestamp examples do not prove this failure.

Require the next actual fixture to pass collector admission, verified manifest
commit and explicit UID-safe PVC cleanup before closing this issue. Preserve the
safe rejection diagnostics if another mismatch remains. A green single-node
fixture still does not supply a production CSI partition/fence adapter or the
missing trusted export-orchestration integration.
