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

## Next verification

Diagnostics retain only fixed rejection stages, digests and recognized response
field shapes, not arbitrary keys, environment values, arguments, logs or tokens.
The strict validation and `ErrIdentity` semantics remain unchanged. A temporary
`k8s.io/api` / `apimachinery` v0.36.4 JSON roundtrip did not emit a zero
`creationTimestamp`; older null-timestamp examples do not prove this failure.

Use the next actual response evidence to reproduce a specific mismatch, then
apply only a source-backed normalization with negative drift regressions. Keep
manifest/backend verification and explicit UID-safe PVC cleanup mandatory. A
green single-node fixture still does not supply a production CSI partition/fence
adapter or the missing trusted export-orchestration integration.
