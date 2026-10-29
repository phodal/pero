---
kind: issue
status: resolved
---

# Isolated collector identity validation blocks export

Canonical tracker for the resolved collector acceptance failure in Draft
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
proven adapter defect consistent with the actual failure stage. The earlier raw
Pod shape was not retained; the successful follow-up below confirms that exact
wire shape and the completed export/cleanup path without weakening validation.

## Verified resolution

Diagnostics retain only fixed rejection stages, digests and recognized response
field shapes, not arbitrary keys, environment values, arguments, logs or tokens.
The strict validation and `ErrIdentity` semantics remain unchanged. A temporary
`k8s.io/api` / `apimachinery` v0.36.4 JSON roundtrip did not emit a zero
`creationTimestamp`; older null-timestamp examples do not prove this failure.

[Run 40912932701](https://github.com/phodal/pero/actions/runs/40912932701), immutable
PR head `73dfa11eeebf0e79050fadfa75f97aa1e84710e9`, tested merge/workspace
`85474b1624b15181242725e1b5bff60b71a34f7c`, passed both success and cancellation.
Actual pre-GC PodList receipts confirm a complete `v1/PodList` with **both nested
item type fields absent** and original collector Pod UID, namespace and Job UID
matching. No conflicting type or identity check was bypassed.

Both scenarios committed the verified manifest, retained the PVC until explicit
GC approval, confirmed original PVC deletion, preserved the manifest and reread
identical private S3 bytes afterward. Final compute/data cleanup receipts are
separate and the binding is `released`. Artifact `12914738397` ZIP SHA-256:
`77c5fdc549621a785d7fdc623fcf0e30094a75b600f468f55d82c96bb5879e29`.
Cleanup exited zero; owned node, MinIO, registry and PostgreSQL were removed.
Independent review checked the actual receipts and reconstructed both file hashes.

This closes the adapter compatibility/fixture acceptance issue, not production
readiness. The selected production CSI partition/fence adapter and trusted
export-orchestration integration remain separate deployment prerequisites. This
record references the immutable tested head, not any later documentation commit.
