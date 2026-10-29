# 0012: Trusted Worker runtime on Agent Sandbox

Status: implemented behind explicit operator configuration; deployment acceptance
is recorded separately in [the verification report](../fitness/agent-sandbox-runtime.md).

## Decision

Keep the existing topology and owners: one Go control plane owns Task/Run,
Worker claim receipts, leases, events and completion. The existing Rust Worker
owns its durable local journal, cancellation and ACP process supervision. The
existing Go `pero-agent-acp` runs over local stdio in that Worker's Pod. No second
scheduler, Point daemon, Desktop/VNC, pod exec or port-forward execution path is
introduced.

Copy/adapt the bounded Point environment owner implementation, not its engine.
`server/internal/environments` contains resource identity, provision/dispose
ports and the Kubernetes HTTP owner. It has no Use grant or Task/Run authority.
`runtimebinding` is the functional resource-binding core; `sandbox` is its I/O
composition with the existing PostgreSQL Store. Exact source blobs, user-approved
copy scope and the absence of a source license file are recorded in
[SOURCE_REFERENCES](../../server/internal/environments/SOURCE_REFERENCES.md).

The upstream contract is `kubernetes-sigs/agent-sandbox` **v1.0.2**, commit
`9a85153590e54cb980f3241f9e7a9228449412c9`: Sandbox, SandboxTemplate,
SandboxClaim and SandboxWarmPool use their v1beta1 APIs. There is no SDK/client-go
dependency and no bespoke Pod pool.

## Runtime flow

1. An operator selects one fixed, reviewed template/pool, Worker, project,
   workspace key, Agent, image manifest digest, workspace revision and mandatory
   TTL. Task payloads cannot choose commands, paths, images, credentials or pools.
2. Operator runtime dispatch calls the existing `dispatchTx` and reserves a
   RuntimeBinding in **the same database transaction**. The configured Worker is
   durably marked runtime-only: an old binary or missing Pod UID cannot drain the
   ordinary project queue, even after this provider is disabled.
3. Only the first reservation caller issues create. Claim name derives from the
   Run/request identity, and a fingerprint covers the provision spec and fixed
   owner configuration. A lost reply or process restart only reads the original
   request; absence never authorizes a new create.
4. Observe Claim → Sandbox → Pod owner references/UIDs and generation readiness.
   Readiness requires a future shutdown deadline and the actual `worker`
   container's manifest digest. Freeze Pod UID plus sorted container IDs, restart
   counts and image IDs. `workspace_revision` and `template_digest` are reviewed
   build provenance, **not** Kubernetes-attested checkout contents.
5. Worker persists Downward-API Pod UID with its original claim request. Server
   admits only that Ready Run and observed UID. Existing execution receipts,
   monotonic events, cancellation and journal recovery remain the execution
   protocol; a restart never replays the prompt.
6. Resource observations refresh every three seconds; authority expires after at
   most fifteen seconds or the earlier Claim TTL. Claim/renew leases are capped
   by that freshness. Identity/readiness loss revokes an active Run to `reconcile`,
   without overwriting a completed result. This is bounded polling, not
   instantaneous incarnation attestation.
7. Release first requests normal Run cancellation. Once execution is terminal
   (including unresolved `reconcile`), the owner deletes only the original Claim
   UID with foreground propagation. The fixed Claim lifecycle also uses
   `DeleteForeground`. `cleanup_pending` remains until original absence is
   observed; completion/events and the binding snapshot remain readable. There
   is no return-to-pool operation: upstream replenishes the pool itself.

## Trust and recovery boundaries

This is a **trusted Worker cluster runtime**, not hostile multi-tenant isolation.
The fixed template uses `restartPolicy: Never`, non-root, drop-ALL capabilities,
read-only root and no ServiceAccount token. The warm pool can contain both the
claimed Pod and a replenishment Pod; they share its narrowly scoped Worker
credential. Self-reported Pod UID is a trusted-pool identity guard, not workload
attestation. Each Pod has its own journal; deleting that Pod can lose local
unuploaded data, but server state still prevents Run replay.

Kubernetes controller credentials remain in the control plane. Worker/provider
credentials are separately provisioned and never included in binding snapshots.
Agent execution strips `PERO_*` variables, but same-Pod trusted processes are not
an adversarial secret boundary. Default unattended approvals remain **deny**.
The image does not enable `native_approvals`; a Pod does not prove strict bwrap
shell admission, gVisor/Kata isolation or CNI NetworkPolicy enforcement.

If reservation commits and the process dies before create, later absence cannot
distinguish “never created” from “created, then expired/deleted.” The binding
stays pending/unconfirmed and fences that Worker. Even release cannot manufacture
a cleanup receipt without a known UID. Operators must quiesce the original
controller operation and audit the cluster before any separately reviewed manual
recovery or replacement Worker provisioning. There is deliberately no automatic
reset/recreate endpoint. Configuration drift with an unreleased binding also
fails closed. A normal non-Kubernetes Worker remains the unchanged default.

The first deployment is one configured pool and one Worker slot. Automatic
repository checkout, multiple-pool scheduling, external write approval,
production credentials/deployment and research-result acceptance are not added.
