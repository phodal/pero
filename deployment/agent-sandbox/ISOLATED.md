# Isolated Agent profile: operator boundary

This profile places the trusted Rust Worker **outside** each untrusted Agent Pod.
It is distinct from [the trusted warm-pool profile](README.md), which is unchanged.
Read [ADR 0013](../../docs/adr/0013-isolated-agent-runtime.md) before enabling it.
This is not an installer or permission to modify an existing cluster.

## Prerequisites that startup does not prove

- Agent Sandbox controller/API pinned to v1.0.2; reviewed digest-only Agent and
  collector images and prepared workspace revision. No runtime repository clone,
  Worker binary, host socket, reusable Worker/provider/S3 key or Desktop stack in
  the Agent image. `Dockerfile.isolated` requires a reviewed base with tini/CA
  roots and a public control-plane CA; never put its private key in an image.
- A real, supported RuntimeClass handler and workload admission enforcing the
  exact hardened profile: non-root, drop-ALL, no escalation/host namespaces,
  read-only root, fixed volume mounts/resources, no injected sidecars/init
  containers, `restartPolicy: Never`, no automatic ServiceAccount token mount.
  The **explicit** projected custom-audience token is still required.
- Enforced CNI policy installed **before dispatch**: deny ingress and egress other
  than the fixed TLS relay/provider-proxy destination. Any DNS allowance must be
  separately bounded and tested; a policy object or RuntimeClass name is not
  enforcement evidence. Verify node/API/metadata/cross-namespace/public egress
  denial with reachable positive controls. Do not assume IPv4 tests cover IPv6.
- Independent per-Run PVC storage with a reviewed retention/reclaim policy and
  an actual node/CSI writer-fence implementation. `ReadWriteOnce` or API Pod
  deletion alone is not a storage fence, especially across node partitions.
- One active control-plane relay for this configured Worker slot. TLS terminates
  at a trusted front end that supports streaming duplex bodies, bounded headers,
  flushing and deadlines without retries/buffering. The stock server listens HTTP;
  it does not automatically issue TLS certificates or configure an ingress.
- Private, supported S3-compatible storage qualified for conditional PUT and
  verified GET. Keys below approved project/run prefixes only; no public reads,
  broad bucket administration, overwrite or deletion authority in workload Pods.
  Application conditional writes are not ObjectLock/administrator-proof retention.

Controller permissions and online TokenReview credentials belong only to the
trusted control plane. Give Agent and collector **different** SA names/UIDs and
zero Kubernetes API roles; their projected audiences are `pero-runtime` and
`pero-export`. A TokenReview caller needs explicit cluster-scoped review authority,
not `pods/exec`, arbitrary secret access or a token mounted into the Agent. Choose
namespace/cluster RBAC and production identity provisioning separately; this
runbook does not create credentials or RoleBindings.

## Configuration shape

`PERO_SANDBOX_CONFIG` names an operator-owned JSON file read by
`sandbox.LoadProfile`. Unknown fields fail closed. The following is a
**placeholder shape, not a deployable configuration**: replace every capitalized
value using reviewed observations; never invent an image, template or SA UID.

```json
{
  "api_url": "https://KUBERNETES_API",
  "token_file": "/run/pero/control/kubernetes-token",
  "ca_file": "/run/pero/control/kubernetes-ca.pem",
  "runtime": {
    "profile": "isolated-agent-v1",
    "cluster_id": "REVIEWED_CLUSTER_ID",
    "namespace": "REVIEWED_NAMESPACE",
    "warm_pool": "",
    "worker_id": "EXTERNAL_WORKER_ID",
    "project_id": "PROJECT_ID",
    "workspace_key": "repo",
    "agent_id": "REVIEWED_AGENT_ID",
    "image_ref": "REGISTRY/AGENT@sha256:OBSERVED_MANIFEST_DIGEST",
    "image_digest": "sha256:OBSERVED_MANIFEST_DIGEST",
    "workspace_revision": "REVIEWED_40_HEX_GIT_REVISION",
    "template_digest": "sha256:COMPUTED_COLD_TEMPLATE_DIGEST",
    "runtime_class": "REVIEWED_RUNTIME_CLASS",
    "service_account": "REVIEWED_AGENT_SERVICE_ACCOUNT",
    "service_account_uid": "OBSERVED_SERVICE_ACCOUNT_UID",
    "audience": "pero-runtime",
    "control_url": "https://FIXED_CONTROL_ORIGIN",
    "control_ca_file": "/etc/pero/control-ca.pem",
    "model": "REVIEWED_MODEL",
    "storage_class": "REVIEWED_STORAGE_CLASS",
    "storage_access_mode": "ReadWriteOncePod",
    "volume_size": "1Gi",
    "ttl_seconds": 900
  },
  "isolated": {
    "provider": {
      "endpoint": "https://FIXED_PROVIDER/v1/chat/completions",
      "model": "REVIEWED_MODEL",
      "api_key_file": "/run/pero/control/provider-key",
      "budget": {
        "max_requests": 8, "max_concurrent": 1, "max_output_tokens": 1024,
        "max_request_bytes": 1048576, "max_response_bytes": 1048576,
        "timeout_seconds": 60
      }
    },
    "artifacts": {
      "paths": ["repo/artifacts/result.txt"],
      "max_files": 1, "max_file_bytes": 1048576,
      "max_total_bytes": 1048576, "allow_missing": false
    },
    "storage": {
      "endpoint": "https://PRIVATE_S3_ORIGIN", "bucket": "PRIVATE_BUCKET",
      "region": "REVIEWED_REGION",
      "access_key_file": "/run/pero/control/s3-access-key",
      "secret_key_file": "/run/pero/control/s3-secret-key"
    }
  }
}
```

Compute `template_digest` with
`kubernetes.ColdTemplateDigest(sandbox.IsolatedConfig(config))` in the trusted
configuration composition, then assign it before validation. It covers the fixed
cold Pod/PVC recipe with per-Run placeholders, not an arbitrary manifest label.
`control_ca_file` may be omitted for system trust roots; if supplied in this
profile it is exactly `/etc/pero/control-ca.pem` inside the reviewed image. The
Kubernetes API's `ca_file` is separate. Production storage must use HTTPS; the
loader does not expose the S3 adapter's loopback test bypass.

Artifact paths are exact files **relative to the PVC root** mounted read-only at
`/data` by the collector. Thus the seeded Agent checkout at `/workspace/repo`
corresponds to `repo/...`, not an absolute host path. No glob, recursive archive,
secret directory, symlink/hardlink or special-file export is allowed. Provider
model must equal `runtime.model`; requests cannot override model/endpoint or
expand the configured budget. Protect all configuration/secret files with the
trusted service account's filesystem permissions; file parsing is not host ACL
provisioning. Do not include their contents in CI artifacts or Run snapshots.

The external Worker uses ordinary `PERO_CLOUD_URL`, `PERO_WORKER_TOKEN`,
`PERO_WORKER_CONFIG` and private `PERO_WORKER_STATE`. Its remote-only config is:

```json
{ "remote_bridge": "/opt/pero/bin/pero-acp-bridge" }
```

Do **not** set `PERO_RUNTIME_POD_UID`, put this Worker in the Agent Pod, or enable
`native_approvals`. Agent permissions are default-deny. Start the configured
control plane first so its durable runtime-only Worker fence is installed before
starting this Worker. The existing operator `runtime-dispatch`, runtime inspect,
reconcile and release endpoints retain their meanings; dispatch reserves the Run
and binding atomically. Terminal Run completion alone does not release compute;
use explicit runtime release and inspect its separate cleanup receipt. A missing
bridge, oversized remote ACP message, stale
binding or uncertain channel admission never falls back to local execution.

## Export and data cleanup are explicit integration points

The running server reserves export identity/policy when the original Pod/PVC is
observed. It does **not** infer a storage fence or automatically schedule collection
when compute disappears. Configure a separate trusted coordinator using:

1. `Runtime.AdvanceExport(ctx, runID, artifacts.Quiescence, collectorOwner)` after
   the selected storage owner has established the original writer's termination
   and volume fence. The quiescence record must identify the exact Pod UID, PVC
   UID/PV name, compute receipt, storage-fence evidence digest and observation time.
2. `kubernetes.NewCollectorOwner` with a reviewed collector image, the same
   RuntimeClass and a **distinct** collector SA name/UID. The library reserves
   its fixed Job before create, verifies actual Job/Pod identity and provides
   read-only collection. No Agent can select this image, root, paths or authority.
3. Wait for a committed export whose manifest and object receipts have been
   verified by the control plane. Fetch only authorized inert attachments via
   `/api/v1/runs/{run}/artifacts` (or the project-scoped client equivalent), never
   a public bucket URL. Authenticated artifact downloads have a separate two-minute
   route budget and files bounded to 128 MiB, with two concurrent buffered downloads;
   they are not an unbounded streaming/public file service.
4. Separately call `Runtime.AuthorizeDataCleanup` with `GCApproval`: original
   operation ID, authenticated actor, time and committed manifest digest; or an
   explicit discard reason when there is no committed manifest. The same storage
   fence remains mandatory. The library revokes collection, settles the original
   collector Job/Pod, deletes only the original PVC UID, then records a separate
   data-cleanup receipt. PVC absence does not certify physical media erasure.

These are trusted Go control-library APIs, not generic HTTP operator endpoints
that accept a hash as fence proof. The first profile needs an explicit adapter
for the selected real storage backend; there is no automatic CSI proof generator.
Do not substitute the disposable kind single-node fixture's fence helper for a
production node-partition/CSI fencing implementation.

## Failure handling

| Observation | Required behavior |
| --- | --- |
| PVC create reply lost / process dies before Sandbox POST | Reconcile original request only. Retain PVC and the unconfirmed binding; no fresh create, reset, prompt replay or replacement-worker bypass. |
| Pod/container/image/SA/PVC identity changes or readiness expires | Stop admission, reconcile the original Run, preserve evidence. Never adopt a replacement execution. |
| ACP EOF / execution authority loss | Revoke stream; retain the original Run/grant. Normal ACP completion still awaits trusted Worker receipt. No transport reconnect or prompt replay. |
| Provider timeout / uncertain provider outcome | End that HTTP attempt and retain its quota charge. This alone need not close ACP or the Run; later explicit provider requests may spend remaining budget. No automatic replay or free refund. |
| Compute gone, no valid storage fence | Keep PVC and `cleanup_pending` / `DataExportPending`. Do not mount a collector or claim data exported. |
| Export/collector response unknown, failed Job, or expired reservation | Reconcile the original export/Job/immutable key; do not issue a new Job, renew its expiry automatically, or delete retained data. Operator recovery remains required. |
| Cancellation, TTL, or failed export | Not data-deletion approval. Resolve original identities/fence and obtain an explicit manifest-based GC or audited discard decision. |

A pre-POST gap may not have enough Pod evidence to use the normal export workflow.
It remains an operator-resolution case, not permission to fabricate a Pod UID or
receipt. Audit original operations and backend state before any separately
reviewed manual recovery. Keep Run result, artifact status, compute cleanup and
data cleanup visibly distinct.

## Verification status and commands

Local implementation evidence: 29 Rust Worker tests; bounded remote ACP race
tests including actual Go ACP CLI over synthetic TLS/provider; real PostgreSQL
17.11 with actual external Worker/bridge/wrapper and a fixed ACP process fixture.
The latter covers success/EOF reconciliation, default-deny permissions, wrong
Pod/audience, duplicate attach, wrong model, spent unknown provider attempt,
retained evidence and no post-close provider use. It is not cluster isolation.

With explicitly built binaries and a **disposable synthetic** database:

```sh
PERO_ISOLATED_PROCESS_E2E=1 \
PERO_SANDBOX_WORKER_BINARY=/ABS/pero-worker \
PERO_REMOTE_BRIDGE_BINARY=/ABS/pero-acp-bridge \
PERO_REMOTE_CONNECT_BINARY=/ABS/pero-agent-connect \
PERO_TEST_DATABASE_URL='DISPOSABLE_TEST_DSN' \
go -C server test -race -count=1 -run '^TestIsolatedRuntimeWorkerProcesses$' ./internal/httpapi

PERO_REMOTE_AGENT_BINARY=/ABS/pero-agent-acp \
PERO_REMOTE_CONNECT_BINARY=/ABS/pero-agent-connect \
go -C server test -race -count=1 ./internal/remoteacp
```

The opt-in [disposable cluster gate](isolated/README.md) must separately produce
actual runtime/CNI/identity, product execution, PVC/export/object-store and cleanup
receipts. **Live kind acceptance is pending at this documentation checkpoint.**
Even a passing single-node gate is not qualification of a production CSI backend,
node-partition recovery, dual-stack policy, HA relay, real provider account,
ObjectLock, or safety against every runtime/kernel defect. Production rollout is
blocked until those deployment-specific requirements have explicit evidence.
