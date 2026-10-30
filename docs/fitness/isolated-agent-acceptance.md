---
kind: verification_report
date: 2026-10-29
---

# Isolated Agent acceptance: evidence and open gates

This is a **Draft, not a production-readiness certificate**. The
[isolated profile](../adr/0017-isolated-agent-runtime.md) is separate from the
[trusted Worker pool](agent-sandbox-runtime.md). No production deployment or
existing cluster is part of this verification.

## Historical evidence correction (2026-10-30)

The original isolated CI archives referenced below were deleted after generated
Cilium TLS Secret fields were found in their full Helm manifests. The recorded
functional results are historical; those archives are no longer downloadable.
See the [incident and verified replacement evidence](../issues/2026-10-30-isolated-evidence-secret-manifest.md).
CI run logs remain available.

## Local real-provider proof

Test source: `e6014040951c4b786b54dbcb72da438a56770570`. Actual Rust Worker,
ACP bridge, control plane, outbound wrapper and Go ACP executed against the
official DeepSeek `deepseek-flash` chat endpoint, using only synthetic prompts.

| Approved batch 2 | Result | Duration | Control-plane attempts |
| --- | --- | --- | --- |
| Completion | `succeeded`; exact answer reconstructed from five text deltas | 5.78 s | 1 / HTTP 200 |
| Cancellation after first retained text delta | `cancelled`; channel closed | 5.77 s | 1 / HTTP 200 |
| Repeated completion | `succeeded`; exact answer reconstructed from five text deltas | 5.42 s | 1 / HTTP 200 |

The batch reserved six attempts conservatively, observed three charged attempts,
and capped every request at 1,024 output tokens. Unused reservations were not
refunded. Temporary key material was removed; the logs were checked for key
leakage. Each disposable PostgreSQL instance stopped and removed its test data.
The sanitized batch receipt SHA-256 is
`e726a664923ae754a2d8aee117101e41eb0ab421eea8c6e625a53485a47abd4a`.

This proof uses an explicit local cwd adapter, simulated authenticated Pod
identity and a **test-only compiler overlay** that sends the control plane's
fixed official HTTPS request through the execution environment's existing
egress proxy. TLS verification and redirect denial remain enabled; production
transport still has no ambient proxy. It is not a byte-identical production
transport or Kubernetes-isolation test. Provider-internal cancellation, billing
cessation, token usage and raw provider finish reasons were not verified.

An earlier separately budgeted batch did not pass full acceptance. Two rounds
failed before successful execution; the diagnostic round identified a transport
failure in the direct-DNS-restricted test environment. A third reached durable
`succeeded` but failed a whole-JSON marker assertion. Synthetic tests subsequently
proved that assertion mishandled split text and could match unrelated channels.
The replacement reconstructs only the bound session's first complete turn and
requires the exact trimmed answer. Earlier evidence is **not retroactively a
pass**. Synthetic split-text, wrong-channel/turn, cancellation and sanitized
401/503/303 cases pass against actual Go ACP with race detection.

## Cluster evidence remains separate

- [Trusted diagnostic run 40885730812](https://github.com/phodal/pero/actions/runs/40885730812)
  for PR head `ff40f73e60b0be66932c6e85a26a387ec91beeba`, testing merge/workspace
  `ab345232b26b061fb046a6355deb1c59041fd081`, passed success and cancellation
  with one model request each. Original Claim/Pod release, owned
  cluster and registry removal were observed. Two earlier trusted cancellation
  runs observed two model requests; their cause remains unresolved. Injected
  truncated SSE can reproduce a same-turn transport retry, but does not prove
  that historical cause. A later green run is not a fix for an unexplained
  intermittent failure.
- [Isolated diagnostic run 40885730745](https://github.com/phodal/pero/actions/runs/40885730745)
  failed closed before product execution. All nine positive-control TCP/DNS
  targets were reachable, but gVisor's `eth0` retained an IPv6 link-local address
  despite the IPv4-only Cilium configuration. The strict IP-family gate rejected
  it; no negative-isolation, product Run or MinIO acceptance is claimed. The
  owned node and registry were removed. Artifact SHA-256:
  `a7cf513f0ed1e69acfc122fd875101d1db612220924b257986beddd94dc8591b`.

## Accepted disposable cluster baseline

[Isolated run 40912932701](https://github.com/phodal/pero/actions/runs/40912932701)
passed at PR head `73dfa11eeebf0e79050fadfa75f97aa1e84710e9`, tested merge/workspace
`85474b1624b15181242725e1b5bff60b71a34f7c`. This immutable source receipt does not
claim that a later documentation/test-only head has already run.

- Actual external Rust Worker → ACP bridge → actual Go ACP passed success
  (80.55 s) and cancellation (59.88 s), 140.45 s total. Each retained eight
  events and made one synthetic provider request; both ended `released`.
- The exact Agent Pod/container identities ran under `io.containerd.runsc.v1`
  as UID/GID10001. Nine positive-control/negative TCP and DNS outcomes passed
  against the actual product policy, including same/cross-namespace neighbors,
  API, node and synthetic metadata/public targets. IPv4-only inventory passed;
  Pod-netns CNI tuning prevented link-local IPv6 while owned-node global values
  stayed unchanged. Valid admission passed; missing-runtime, privileged and
  hostPath dry runs were denied. This is neither dual-stack nor HA evidence.
- Independent PVC/PV identity survived original compute removal. A separate
  read-only collector exported each runtime-generated, fsynced 125-byte
  Run-ID/nonce file, and its SHA-256 matched the immutable verified manifest.
  Ordinary release retained data; explicit UID-safe GC removed the original
  collector and PVC. Manifest and identical private S3 bytes survived that
  removal. The real pinned MinIO conditional-write/checksum/replay gate passed.
- Live collector PodLists confirmed omitted nested type fields under a valid
  typed envelope. The [compatibility defect](../issues/2026-10-29-isolated-collector-identity.md)
  is resolved without relaxing UID, owner, image/profile or completeness checks.
- Cleanup exited zero; cluster node, registry, MinIO and PostgreSQL were removed.
  Independent review verified the receipts. Artifact `12914738397` ZIP SHA-256:
  `77c5fdc549621a785d7fdc623fcf0e30094a75b600f468f55d82c96bb5879e29`.

Image provenance (SHA-256 manifest digests):

| Image | Digest |
| --- | --- |
| Normal Agent | `b21aab7f83ad59affc2f2dc3db052f36b147c03aab75273d84c673af1aa6d6d9` |
| Instrumented test derivative | `c6e11c579d0e024bc807d61610e2bfc90d3065fbfe2411cbaccd1f9fa9d7e1ac` |
| Trusted collector | `4b87f80d60d3b118d942951109918a43db5572d38ce6af1dc4844d3f765fec62` |

The test derivative adds a fixed runtime probe and output writer before unchanged
Go ACP. The file was not image-seeded, but this is **not** ACP tool-write approval
or byte-identical normal-image execution. Default-deny tool permission remains.
Storage fencing is independently observed on one owned node, not CSI failover.

[Trusted regression run 40912932737](https://github.com/phodal/pero/actions/runs/40912932737)
on the same source passed success/cancel (34.67 s total), one request/session/turn
each, retained eight/four events, original UID cleanup and fixture teardown.
Artifact `12915770193` SHA-256:
`e47b86ab413a62853784132449c85db2a243b80d733f89bbfdf7f704efa2f085`.
The historical intermittent two-request cause remains unproven; this pass does
not silently erase that limitation. Desktop/standard CI are separate checks.

## Deployment-blocking requirements

1. Integrate a trusted storage-fence adapter and export orchestration for the
   selected CSI backend. Single-node kind cannot prove partition/failover
   fencing. Pod API absence is not physical writer fencing.
2. Validate the actual target cluster's pinned RuntimeClass, admission and CNI
   configuration with the same negative/positive controls; the disposable Linux
   IPv4-only reference profile does not certify another deployment. The relay is
   single-instance; failover/HA and reconnect-to-replay are not supported.
3. Meet the [durable artifact prerequisites](durable-artifact-exports.md),
   including retained-volume recovery, backend retention and operator handling
   of failed/expired collectors. Automatic unattended tool approval remains
   disabled; the file-production fixture is not an ACP tool-approval proof.
