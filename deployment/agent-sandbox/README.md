# Trusted Worker on Agent Sandbox

This is an opt-in runtime for one **trusted, fixed Worker pool**. The Go control
plane owns Task/Run, claims, leases, events and result receipts. Agent Sandbox
v1.0.2 owns Sandbox/Template/Claim/WarmPool and Pod lifecycle. A Pod runs the
existing Rust `pero-worker`, which launches `pero-agent-acp` over local stdio.
No second scheduler, Desktop, VNC, Agent-side Kubernetes credential or Pod exec
transport is added.

The initial authorization policy remains **deny** for unattended ACP permission
requests. The generated agent config uses `--approval ask`, does not enable shell
and does not set `native_approvals`. A Kubernetes Pod is not evidence that the
existing strict-bwrap contract is enforced, and this template grants no new
unattended write or shell permission.

## What is fixed and what is observed

The operator reviews one project/workspace/agent, image, source snapshot, template
and pool. The desired template digest and workspace revision are provenance,
not cluster attestation. The server independently observes Claim UID, owner
references, readiness generation, Pod UID and container runtime/image identity;
the expected worker image manifest digest must match before claiming a Run.

`PERO_RUNTIME_POD_UID` is populated by the Downward API and persisted with every
Worker claim request. It is a trusted-pool identity guard, **not cryptographic
attestation**. All pool Pods share an existing scoped Worker credential: one warm
replica can mean both a claimed Pod and its replacement prewarm Pod. The server
binds one Run to the observed Pod and one Worker slot; it does not promise
hostile multi-tenant isolation. The same OS user runs Worker and Agent, so stripping
`PERO_*` from the Agent environment is not a boundary against hostile code reading
other processes or their credentials.

A restart reconciles the original journal; it never replays an interrupted prompt.
The entrypoint never overwrites an existing workspace. `emptyDir` preserves files
across a container restart, **not Pod deletion**. Completed events and receipts
remain in PostgreSQL; private session state, unuploaded journal data and workspace
files disappear on cleanup. Durable artifact upload is not part of this slice.

## Build a reviewed image

Build on Linux for the target architecture, using a runtime base compatible with
the Worker's libc ABI. The disposable CI uses Ubuntu 24.04 for both build and
runtime; do not copy a macOS binary or assume a newer-glibc binary runs on Alpine.
Supply a reviewed digest-pinned runtime base that already contains `/bin/ps`,
`/bin/sh`, coreutils and CA certificates. The product Dockerfile installs nothing.
The CI-only script explicitly builds its throwaway base from pinned Ubuntu,
installs procps/CA certificates and records package versions before pinning its
new registry digest.

```sh
node scripts/cargo.mjs build --locked --release -p pero-worker
CGO_ENABLED=0 go -C harness/go build -trimpath -o /tmp/pero-agent-acp ./cmd/pero-agent-acp
context=$(mktemp -d)
cp deployment/agent-sandbox/{Dockerfile,entrypoint.sh} "$context/"
cp target/release/pero-worker /tmp/pero-agent-acp "$context/"
revision=$(git rev-parse HEAD)
node deployment/agent-sandbox/prepare-workspace.mjs "$PWD" "$revision" "$context/workspace"
docker build --build-arg SOURCE_REVISION="$revision" \
  --build-arg RUNTIME_BASE_IMAGE="$REVIEWED_PREPARED_RUNTIME_BASE_AT_DIGEST" \
  -t YOUR_REGISTRY/pero-worker:REVIEWED_REVISION "$context"
```

The preparation command exports only the exact tracked commit. It excludes local
edits, untracked files and `.git` configuration; it rejects submodules rather than
silently producing an incomplete checkout. Inspect the tracked source for secrets
and approve its contents before building. The source snapshot is a working tree,
not a cloned Git repository. No repository checkout or provider login happens in
the Pod. Publish the image only to an authorized registry, then obtain and record
its actual `repo@sha256:…` manifest digest; a local image config ID is not that digest.

The product Dockerfile checks its required runtime commands and CA bundle before
accepting the prepared base. It runs UID/GID 10001. The Pod drops
all capabilities, disables privilege escalation and ServiceAccount automount,
uses a read-only image filesystem, and mounts bounded workspace/state/temp/home
volumes. `WORKDIR /workspace` exists before the entrypoint creates `repo` in the
initially empty volume. No Service or Ingress is requested.

## Render, review, then separately authorize deployment

`render.mjs` is offline and does not contact Kubernetes or read credentials. Supply
reviewed JSON with these fields (the image digest and CIDRs must be real values
for your environment, not copied from an example):

```json
{
  "namespace": "pero-runtime",
  "name": "reviewed-v1",
  "image": "REGISTRY/pero-worker@sha256:REPLACE_WITH_OBSERVED_DIGEST",
  "workspaceRevision": "REPLACE_WITH_FULL_PREPARED_GIT_COMMIT",
  "workspaceKey": "repo",
  "agentID": "dsh",
  "cloudURL": "https://YOUR_CONTROL_PLANE",
  "providerEndpoint": "https://YOUR_PROVIDER/v1",
  "model": "YOUR_REVIEWED_MODEL",
  "workerSecret": "existing-worker",
  "providerSecret": "existing-provider",
  "dnsCIDR": "YOUR_DNS_IP/32",
  "egress": [{ "cidr": "YOUR_APPROVED_ENDPOINT_IP/32", "port": 443 }]
}
```

```sh
node deployment/agent-sandbox/render.mjs /private/operator-config.json > /tmp/pero-runtime.json
sha256sum /tmp/pero-runtime.json
```

Output contains an immutable ConfigMap, SandboxTemplate and one-replica WarmPool.
`name` yields `name-config`, `name-template`, `name-pool`; use a new name for a
changed recipe rather than mutating a live pool. Claim env/volume overrides are
disallowed. Secrets are references only: the existing worker Secret must contain
`token`, the provider Secret `api-key`. The Kubernetes control-plane credential
must remain exclusively in the server, never in this Pod.

NetworkPolicy is Managed, with empty ingress and explicit CIDR/port egress plus
DNS. This is **desired policy, not proof of CNI enforcement**. Names may resolve to
new IPs; the operator owns review of egress rules. Optional `runtimeClassName`
selects an already installed, separately verified RuntimeClass. Omitting it makes
no gVisor/Kata claim. No cluster setup or broad egress fallback is automatic.

Before applying anything, separately approve the target cluster, controller
installation, namespace, resource budget, existing Worker/provider secrets and
server identity. [`access.yaml`](access.yaml) is only a namespaced Role example;
it creates no ServiceAccount, RoleBinding or token. The provider requires only
get Pod/Sandbox and create/get/delete SandboxClaim; no Secrets, exec, logs,
port-forward or Pod creation. Upstream controller privileges are separate.
Configure the existing Worker and start the server with its sandbox configuration
**before starting the WarmPool**: the server must persist that Worker’s runtime-only
claim fence before any prewarm Pod begins polling. Otherwise a Never-restart Worker
may reject startup, or an unfenced Worker could reach the ordinary queue.
Use server-side dry-run against that reviewed cluster before applying resources.
No production cluster installation is performed by the offline renderer.

## Server workflow

Set `PERO_SANDBOX_CONFIG` to a private server-only JSON file. Its `runtime` fields
are `cluster_id`, `namespace`, `warm_pool`, `worker_id`, `project_id`,
`workspace_key`, `agent_id`, `image_digest`, `workspace_revision`,
`template_digest`, and mandatory `ttl_seconds`. `api_url`, `token_file` and
`ca_file` configure the explicit Kubernetes client; it never reads ambient
kubeconfig. `image_digest` is the manifest `sha256:…` from the reviewed image;
`template_digest` is the SHA-256 of the frozen rendered recipe. Neither secret
file is placed in the Worker image or request body.

The approved server service invocation must include the explicit file, alongside
its existing private `PERO_DATABASE_URL` and `PERO_OPERATOR_TOKEN` configuration:

```sh
PERO_SANDBOX_CONFIG=/private/pero/sandbox-runtime.json /absolute/path/to/pero-server
```

Apply that change through the server's reviewed service/rollout process, not by
starting a second production server. `sandbox.FromFile` configures the runtime-only
Worker fence before the HTTP listener starts; failure aborts startup. Confirm the
new configured process started successfully and its `/healthz` is healthy **before**
applying the WarmPool. An old healthy process without this configuration is not
that evidence. The Worker must already be registered for the fixed project; its
existing token belongs only in the separately authorized Worker Secret.

Operator-authenticated calls:

1. `POST /api/v1/tasks/{id}/runtime-dispatch` with `{}` and a stable
   `Idempotency-Key` atomically creates the existing Run and its environment
   reservation. Ordinary dispatch does not allocate Kubernetes resources.
2. `GET /api/v1/runs/{id}/runtime` reads the binding. A queued Run remains
   unclaimable until its exact Pod is observed ready. Explicit
   `POST …/reconcile` with `{}` also reconciles the original operation.
3. Existing Task cancellation controls execution. `POST …/release` with `{}`
   requests separate environment cleanup. Foreground deletion is UID-preconditioned;
   cleanup stays pending until the original Claim is observed gone. There is no
   return-to-pool API and no fresh create after an unknown creation response.

The server continues to own lease fencing, persisted events and result receipts.
Changed Pod/container identity is not a request to replay the Run.

## Validation and disposable cluster acceptance

```sh
node --test deployment/agent-sandbox/test/*.test.mjs
PERO_TEST_WORKER_BIN=/absolute/pero-worker \
PERO_TEST_AGENT_BIN=/absolute/pero-agent-acp \
  node --test deployment/agent-sandbox/test/*.test.mjs
```

The first command reports the real executable test as **skipped** when paths are
missing. With paths, the actual entrypoint, Worker and Go ACP execute a synthetic
loopback provider turn and retain events/result; a second launch does not repeat
the turn. Worker tests additionally cover lost claim responses, original Pod UID
recovery, permissions, cancellation, lease loss and descendant cleanup.

`.github/workflows/agent-sandbox.yml` is opt-in: manual dispatch, or the maintainer
`agent-sandbox-e2e` label on a same-repository PR. It runs isolated PostgreSQL
contracts and creates an owned kind cluster on a disposable GitHub runner only.
`kind-smoke.sh` refuses existing clusters/registry names and uses its own kubeconfig.
It checks pinned download hashes, installs the pinned controller, pushes a test
image to a local registry to obtain a real manifest digest, runs
`TestClusterRuntime`, then destroys the owned cluster and registry even on failure.
Only non-secret validation logs/version/cleanup receipts are uploaded.

The CI-only image adds `test/gateway.go` as a same-Pod loopback sidecar to reach
synthetic host fixtures. Its fixture template also uses `networkPolicyManagement: Unmanaged`; the default
kind CNI does not prove NetworkPolicy enforcement. It changes neither product HTTP
admission nor production manifests. It does **not** validate deployed HTTPS routing or real model/provider
credentials. The local renderer/process tests are not a cluster pass; see
[`docs/fitness/agent-sandbox-runtime.md`](../../docs/fitness/agent-sandbox-runtime.md)
for the exact observed/failed/not-run validation status and CI revision.

Pins and copied-source boundaries are in [PROVENANCE.md](PROVENANCE.md).
