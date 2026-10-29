# 0017: Isolated Agent with an external trusted Worker

Status: implemented as an opt-in profile; local process/authority checks passed.
The disposable cluster gate and production deployment acceptance are separate
receipts, not inferred from this decision. See the [operator boundary](../../deployment/agent-sandbox/ISOLATED.md).

## Decision and owners

Keep ADR 0016's trusted warm-pool profile unchanged. Add `isolated-agent-v1` for a
**trusted Worker outside an untrusted Agent Pod**. Reuse the pinned upstream Agent
Sandbox **v1.0.2** core `Sandbox` API, not a new pool or second task scheduler.
The upstream commit and bounded Point provenance remain in
[SOURCE_REFERENCES](../../server/internal/environments/SOURCE_REFERENCES.md).

| Owner | Responsibility | Not its authority |
| --- | --- | --- |
| Go control plane / PostgreSQL | Task/Run, Worker claim/lease/receipts, fixed binding, channel and provider reservations | Agent-generated publication or a fabricated storage fence |
| External Rust Worker | Durable execution/grant journal, renew/cancel, default-deny ACP permission response, completion | Creating another Run or replaying an interrupted prompt |
| Trusted `pero-acp-bridge` | One exact-Run ACP stream and remote cwd projection | Worker credential, host MCP, filesystem/terminal callbacks |
| Kubernetes cold owner | Fixed Sandbox compute plus independent per-Run PVC, observed identity, UID-safe cleanup | Physical node/CSI writer fencing from API absence |
| Untrusted Pod | `pero-agent-connect` + existing Go ACP, prepared workspace on that PVC | Worker/operator/provider/S3 credentials or host execution |
| Trusted collector and storage owner | Quiesced bounded file export, verified object receipts, explicit data cleanup | Executing workspace code, accepting Agent-chosen paths/URLs, automatic discard |

This is a single active control-plane/relay process per configured Worker slot.
The relay has no durable resumable transport and no HA routing protocol. Startup
fences that Worker's previous in-flight channels. Multiple replicas, transparent
proxy retries and cross-instance reattachment are not supported.

## Execution and identity

1. Operator configuration fixes project, Worker, Agent, image manifest digest,
   RuntimeClass, ServiceAccount name **and UID**, provider model, mandatory TTL,
   workspace revision, PVC recipe and artifact policy. Tasks supply goals, not
   executable, template, command, endpoint, credential, or profile overrides.
2. Atomic dispatch reserves the existing Run and runtime binding. Only that first
   reservation may create its deterministically named PVC and Sandbox. The PVC
   has no Sandbox owner reference and survives compute cleanup. Claim admission
   requires fresh Ready observations, the expected Pod/container/image identity,
   and a bound, UID-pinned PVC. An external isolated Worker must not self-report
   a runtime Pod UID or consume the ordinary queue.
3. The server returns optional `remote_execution` with the original Run's session
   ID and literal `/workspace/repo`. The Worker persists a random 32-byte secret
   **before** issuing the channel reservation. Recovery uses the same original
   secret/receipt but never launches another stream or prompt. A missing bridge
   fails closed; there is no local execution fallback.
4. Worker-side streaming authentication is `sessionID.secret`, an exact-Run
   grant rather than the reusable Worker bearer. Agent-side authentication is an
   online Kubernetes TokenReview of a projected, Pod-bound ServiceAccount token
   for audience `pero-runtime`, matched to the persisted namespace, SA UID and
   Pod UID. This **is a Kubernetes credential**, accessible to hostile Pod code;
   its narrow audience and server authorization are the boundary. It cannot call
   ordinary Worker APIs. Downward API values are not accepted as attestation.
5. Each side attaches once. Only a known HTTP 425 *before admission* permits the
   Agent wrapper to retry, rereading its rotating token file. Connection errors,
   uncertain replies, accepted-stream EOF and Pod/container restarts never reopen
   the session. Streams have a 256 KiB newline-inclusive JSONL limit, 64 MiB shared
   byte budget and 15-minute lifetime. The bridge rewrites `session/new.cwd` only;
   host MCP, session loading, host fs/terminal callbacks and unknown methods fail
   closed. Permissions remain default-deny; no local `native_approvals` policy is
   imported into the hostile profile.
6. The wrapper gives Go ACP a loopback-only provider shim and a nonsecret dummy
   key. The server owns the real key, exact chat-completions endpoint/model,
   request/response/token limits, concurrency and total-attempt budget. Unknown
   upstream outcomes still consume an attempt. No arbitrary URL/header forwarding
   or Agent-controlled provider credentials are supported.
7. EOF immediately revokes the live relay/provider path, but **does not decide
   the Run outcome**. Normal `end_turn` closes ACP before the Worker posts its
   retained completion. Unexpected remote EOF becomes `reconcile`; Worker/relay
   restarts and lease expiry never replay the prompt. Runtime observation and
   lease checks are bounded polling, not instantaneous revocation/attestation.

The channel bound is deliberately smaller than the worst-case Unicode Task
payload accepted by a local Worker. Oversized remote ACP messages fail closed,
not truncated; operators must keep the encoded prompt plus acceptance within
that bound. No blanket unattended write/shell approval was added.

## Compute is not data

Explicit runtime release requests normal Run cancellation and, once execution is
terminal, foreground UID-preconditioned Sandbox deletion. Completion alone does
not set `release_requested` or trigger compute deletion. TTL expiry removes
execution readiness but is not a cleanup receipt or data-deletion approval. The owner confirms original Sandbox/Pod API
absence and records `compute_receipt`. It does **not** delete the PVC or claim
that a partitioned node has stopped writing. The binding remains
`cleanup_pending` / `DataExportPending`.

The selected storage/runtime owner must establish original-writer termination
and real volume fencing before collection. `artifacts.Quiescence` binds Pod UID,
PVC UID, PV name, compute receipt digest, storage-fence digest and observation
time. A digest is an evidence reference, not proof manufactured by hashing a
Pod-deletion response. `Runtime.AdvanceExport` is a **trusted control-library
operation**, not an HTTP API that accepts caller-invented fence values. The stock
server does not discover CSI fencing or automatically promote a pending export.

After that boundary, a fixed, independent collector Job mounts the PVC read-only,
with no fsGroup mutation or workspace execution. Its distinct SA/token audience
is `pero-export`; online TokenReview and persisted Job/Pod identity restrict each
upload to its reserved export. Worker, provider and S3 keys remain outside this
Pod too. The collector uses handle-relative regular-file reads and rejects
symlinks, hardlinks, device/special files and policy/path escapes. The immutable
manifest accounts for every selected file, including explicit missing entries
where policy allows them; it is not a recursive workspace archive.

The server's private S3-compatible adapter performs conditional create at
identity-derived keys and verifies bytes/digests by reading the original key
when replies are lost. ETags are not SHA-256 evidence. This is
**application-level immutability**, not ObjectLock, WORM, or resistance to storage
administrators. There are no public object URLs, overwrite/delete operations or
cross-project deduplication in this adapter. Downloads require the existing
operator/project-client authorization and are served as inert attachments.

Data GC is another explicit trusted-library operation. It needs verified committed
manifest identity, or an authenticated discard actor/reason, **and** the original
storage fence. Collection is revoked and original collector resources are settled
before UID-safe PVC deletion. `data_cleanup_receipt` is distinct from the compute
receipt and records the approval digest. It confirms PVC API settlement, not
physical erasure or backend PV reclamation; those depend on the selected storage
contract. Cancellation, TTL, failed upload and `end_turn` never authorize discard.

## Uncertain creation and failures

A lost PVC create reply, or a crash after PVC reservation but before Sandbox POST,
can leave data without a confirmed compute identity. Reconciliation reads only
original names/digests/UIDs. It cannot distinguish never-created compute from
created-and-removed compute; absence does not authorize a fresh create. It leaves
an unconfirmed/reconcile binding and retained volume for operator resolution.
Likewise, uncertain collector create and cleanup replies retain their original
operation. A failed one-shot collector or expired reservation does not receive a
new Job or renewed expiry automatically; retained-data operator recovery is still
required. Do not reset bindings, provision a replacement Worker to bypass the
fence, mount the volume in another Agent, or manufacture release/export receipts.

A pending export can require manual, audited resolution of the original operation,
actual storage/node fence and discard decision. Availability is intentionally
traded for no duplicate execution and no silent data loss. No generic recovery
scheduler, dynamic environment override, arbitrary repository clone, Kubernetes
exec/tunnel, desktop feature or UI artifact preview is introduced.

## Evidence and deployment gate

Local tests establish durable grant ordering, default-deny permissions, wrong
Pod/audience rejection, one-shot attachment, provider quota including lost reply,
retained events/results, success-versus-EOF completion and cancellation/release
races over real PostgreSQL and
actual Worker/bridge/wrapper processes. That fixture uses a fixed ACP process to
avoid writing the container-only `/workspace/repo` on the host. A separate actual
Go ACP CLI test verifies TLS, provider wire compatibility and EOF cleanup.

Those tests do **not** establish RuntimeClass, CNI, CSI, node-partition fencing or
object-store conformance. The opt-in disposable kind gate is described in
[isolated/README](../../deployment/agent-sandbox/isolated/README.md); a receipt must
show product execution, negative network probes, actual runtime identities,
retained-PVC export and cleanup. At this ADR's initial implementation checkpoint,
that live gate is pending. Production additionally requires the chosen CSI/node
fence and admission/CNI/runtime deployment to pass its own conformance. There is
no universal production-ready or hostile-multitenancy safety claim.
