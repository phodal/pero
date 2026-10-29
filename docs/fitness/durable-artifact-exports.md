---
kind: verification_report
date: 2026-10-29
---

# Isolated Run file artifacts: contract and acceptance

This is separate from durable Run events/stdout/completion in PostgreSQL. The
older trusted Worker-in-Pod profile does not gain file durability or hostile-code
isolation merely because these components exist.

## Bounded production design

- One cold Sandbox per Run; its independently owned PVC has **no Sandbox/Pod
  ownerReference**. Agent Sandbox v1.0.2-managed `volumeClaimTemplates` are not
  used for this lifetime. Compute cleanup alone leaves `DataExportPending`.
- Source freezes Project/Task/Run/generation, cluster/namespace, Sandbox UID,
  original writer Pod UID, PVC name/UID, bound PV name, image/template digests and
  workspace revision. Project is the current collaboration scope, not a new
  tenant claim supplied by the Agent.
- A trusted caller supplies actual compute-release and storage-fence evidence
  bound to that writer/PVC/PV before `Runtime.AdvanceExport`. API Pod absence,
  lease expiry, a caller-invented digest, or successful `DELETE` is **not** a CSI
  writer fence. There is deliberately no public HTTP endpoint accepting such a
  digest as proof.
- A durable CollectorJob reservation precedes Kubernetes POST. An unknown create
  result is reconciled by GET only. Original Job UID, actual Pod UID, exact
  digest-pinned recipe and separate ServiceAccount UID are checked. The single
  trusted collector uses the same required isolation RuntimeClass, UID10001,
  dropped capabilities, read-only root and **read-only PVC**. It receives only a
  projected `pero-export` token; no S3/provider/Worker credential.
- The whole PVC is mounted at `/data`; the Agent's working directory is
  `/workspace/repo`. Therefore `repo/artifacts/result.txt`, not
  `artifacts/result.txt`, selects that workspace output. Paths are exact files,
  never recursive directories, shell expansions or archives.
- Canonical policy limits: at most 256 files, 128 MiB/file, 1 GiB/export. Linux
  descriptor-relative opens reject symlinks at each path component, hardlinks,
  nonregular files (including nonblocking FIFO opens), traversal, alternate-data
  stream syntax and cross-device paths. Hash/size and stable-file checks use the
  opened descriptor. The root `/data` is trusted runtime configuration, not an
  Agent-provided path.
- S3 credentials exist only in the control plane. Private path-style HTTPS S3
  storage uses content-addressed, source-scoped keys and conditional create
  (`If-None-Match: *`), followed by bounded GET/SHA256/size verification. A lost
  PUT response or existing identical object is reconciled against original bytes.
  ETag is not treated as SHA256. This is application-level create-only integrity,
  **not** ObjectLock/version retention or protection against a storage admin.
- Upload metadata/budget is reserved before storage I/O; exact verified object
  receipts are required before immutable manifest commit. Every selected path is
  represented. Missing files require explicit `allow_missing` and produce a
  `partial` manifest, never an assertion that all outputs exist.
- Original manifest timestamps are stable across collector restarts. Existing
  upload/commit receipts can be replayed; an already committed manifest is read
  before attempting collection. Cancellation does not discard files.
- Explicit data-GC approval names its actor/operation and exact committed manifest
  digest, or a separate audited discard reason. Collection is revoked first;
  original collector Job/Pod disappearance is checked before UID-precondition PVC
  deletion. Separate compute and data cleanup receipts are persisted. The PVC
  API deletion receipt is **not** proof of physical PV erasure.
- Human listing/download reauthorizes current Run→Task→Project membership on each
  request. Foreign IDs return404. Public responses omit bucket keys and storage
  identities. Downloads verify bytes first and force attachment/octet-stream,
  `nosniff`, CSP sandbox and private/no-store. There are no public upload URLs.

## Recovery and operating limits

The first bounded Job has zero retries and a fixed 15-minute grant. A failed or
expired collector does **not** automatically mint another Job or authority. The
PVC stays retained for trusted operator recovery or explicit discard. An
unconfirmed create with no recoverable original Job remains pending; absence is
not permission to launch a replacement. Do not describe this as general automatic
export retry or unattended recovery.

The adapter has no S3 delete API. Committed-object retention and orphan-object
reconciliation are an operator/backend policy, not an implemented application GC
service. Do not expire committed keys independently of their manifest retention.
Partial objects have no published read authority. Retained PVCs and orphan keys
need capacity alarms and an audited recovery/retention runbook; neither
cancellation nor arbitrary wall-clock TTL authorizes destructive cleanup.

The control process buffers bounded files and permits two concurrent uploads and
two downloads; provision memory for those budgets plus verification copies and
normal service load. Both context and socket deadlines bound binary transfers.
The private endpoint must pass actual conditional-write conformance; the label
“S3 compatible” is not sufficient.

## Required production acceptance

1. **Actual chosen CSI and StorageClass:** verify writable UID10001 workspace,
   RWO/RWOP behavior, independent ownership, reclaim policy and backup/retention.
   `Retain` avoids silent PV destruction after mistaken PVC deletion but requires
   explicit PV reclamation; `Delete` delegates physical removal to the driver.
   Neither policy is a backup. Review every TTL/controller/namespace deletion
   path so it cannot silently remove uncommitted data.
2. **Writer failure/fencing:** crash/delete the original Pod, interrupt the node,
   and exercise cross-node attachment recovery on the actual backend. Prove the
   old writer cannot still modify the volume before collection starts. A
   single-node kind/host-CRI test is not this production CSI evidence.
3. **Durable publication:** actual backend conditional-create rejection, lost PUT
   response, hash/size corruption rejection, interrupted upload, missing-required
   and explicit-partial files, control-plane restart and lost commit reply. No
   manifest may publish unverified/missing-required bytes; no data cleanup may
   precede the exact receipt or explicit discard.
4. **Authority:** foreign Project list/download, stale/replaced Run generation,
   PVC/PV/Job/Pod/ServiceAccount UID substitution, wrong token audience, revoked or
   expired collector, Agent attempts to upload, and hostile symlink/hardlink/FIFO
   paths all fail closed. Storage credentials never appear in Agent/collector
   specs, manifests, download URLs or logs.
5. **Cleanup recovery:** cancellation, partial export, lingering collector,
   lost Job/PVC DELETE response and concurrent reservation replay preserve the
   original operation and data receipt. Committed files remain readable after
   original compute and PVC deletion. Exercise the documented failed/expired Job
   operator path; alarms must identify retained work instead of silently retrying.
6. **RPO statement:** only a backend-verified, committed manifest establishes the
   exported-file durability boundary. Before that point the selected retained CSI
   volume and its real failure semantics determine recoverability. No guarantee
   is made for files never selected or never durably written by the workload.

## Local evidence and remaining gates

On 2026-10-29, Linux collector/core/S3 unit and AWS signing-vector tests, authorized
HTTP tests, store receipts and trusted Job provider tests passed with `-race`.
Disposable real PostgreSQL17.11 evidence: `run.SPZoeYf1`. Raw-loopback stalled-body
coverage: `run.TAq4QrPl`. Fake-Kubernetes + real PostgreSQL runtime export/explicit
GC coverage: `run.5wiQHzQ2`, including cancellation, lost create/delete replies,
original identity reconciliation, partial manifest and retained PVC safety.

The subsequent [isolated acceptance](isolated-agent-acceptance.md#accepted-disposable-cluster-baseline)
records non-skipped real MinIO and isolated-kind PASS at immutable PR head
`73dfa11eeebf0e79050fadfa75f97aa1e84710e9` / run `40912932701`: success and
cancellation both committed checked manifests and reread the same generated
bytes after original compute/PVC removal. This is actual disposable-backend
conformance, not a production storage durability or CSI failover certificate.
Production cross-node fencing and trusted export orchestration remain separate
deployment gates; this later report does not imply an unrun head was tested.

Code boundaries: `internal/artifacts` (domain), `artifacts/collector` (safe file
opens), `artifacts/s3` (private backend), Store artifact tables/migration016,
`httpapi/artifact*` (authorized transport), `kubernetes/collector.go` (trusted Job),
`sandbox/exporter.go` (explicit orchestration), and
`cmd/pero-artifact-collector` (credential-free collector executable).
