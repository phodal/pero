# Isolated disposable acceptance fixture

This is a **separate opt-in test gate**, not a production installer or a claim
that arbitrary malicious code is absolutely safe. The existing trusted-pool
gate stays unchanged. Root review/publication and the same-repository PR label
`agent-sandbox-isolated-e2e` are required before executing the new CI gate.
`workflow_dispatch` is also available once the workflow exists on the default
branch. No production cluster, cloud bucket, provider account, or persistent
credential is used.

## Scope and acceptance

The fixture creates one owned kind node, installs pinned gVisor/runsc and Cilium,
and uses the upstream Agent Sandbox controller. Its private kubeconfig is never
merged with an ambient configuration. CNI installation is privileged **inside
this disposable test environment**; it is not permission to install anything in
a production cluster. Only synthetic workloads and temporary identities are
created, and the EXIT trap destroys the cluster, registry, object store, private
keys, tokens, and build contexts.

Required evidence, not just YAML:

1. All synthetic destinations are reachable from an unrestricted positive
   control before testing denial. Both probes use the same runsc runtime. The gate is explicitly IPv4-only: kind/Cilium IPv6 is disabled and each probe rejects any non-loopback IPv6 interface address. Dual-stack is not accepted by this fixture.
2. The isolated probe can reach its relay but cannot connect to same-namespace
   or cross-namespace neighbors, the API server, the node, or synthetic
   metadata/public-IP destinations, including a controlled UDP/53 DNS reply. The first forbidden successful connection
   fails; Job retries are disabled. Metadata/public targets are controlled IP
   canaries on TCP 18080, **not requests to a real cloud metadata service or the
   public Internet**.
3. Host CRI/containerd evidence binds the probe Pod UID and container ID to
   `io.containerd.runsc.v1`. `/proc/version` in the probe is supplementary, not
   authentication or runtime attestation.
4. Real object-store conformance must pass conditional-create/overwrite denial
   and digest verification; skipped or absent tests fail the gate.
5. `TestIsolatedClusterRuntime` must pass with the production cold renderer,
   real external Worker and ACP Agent. Infrastructure canary success alone is
   never a product isolation pass. The test owner defines and records its
   run-bound authorization, cancellation, lease and artifact cases separately.
   A host-only helper probes the actual Agent Pod's fixed policy and checks its
   UID/container/sandbox identity before and after. It executes only the pinned
   static probe through the owned node's CRI; the control plane still has no
   `pods/exec` permission. Probe UID/GID must be 10001. This uses a dedicated
   derived test image (fixed probe and runtime-artifact wrapper executables), **not byte-identical product
   image execution**; both manifest digests and fixture binary SHA-256 values
   are recorded. As UID 10001 the wrapper reads public Run metadata, creates
   `artifacts/generated.txt` containing the Run ID and a random nonce, fsyncs
   the file/directory, then execs the unchanged real Go ACP Agent. The host probe
   records its bytes/hash before teardown; the collector verifies them after
   the original Pod is gone. This is actual runtime-process I/O, **not proof of
   an ACP tool approval or `fs_write` flow**. The separately seeded
   `artifacts/result.txt` remains explicitly synthetic input, not generated output.
6. Before collection, a read-only host helper binds the original Pod/Sandbox
   and retained PVC/PV identities to a single-node quiescence observation. It
   requires absent API/CRI objects and original tasks, no remaining Pod using
   the PVC, no original Pod mount, and no observed live fd/mapped path pointing
   to the exact local volume or original kubelet Pod path. Unreadable live PID
   fd directories fail closed. This is not CSI or partition fencing.
7. `cleanup.json` must show successful teardown. The bounded evidence directory
   contains pins, image/runtime IDs, test results and diagnostics, never tokens,
   object-store keys, TLS private keys, kubeconfig or secret-bearing manifests.

**Not covered:** node-loss recovery, cross-node CSI attachment/writer fencing,
backend disaster recovery, production admission controls, real-provider quotas,
or a proof against all kernel/runtime vulnerabilities. kind's `standard`
StorageClass is single-node test storage; passing retained-PVC tests does not
qualify it as a production CSI backend. Actual production CSI and supported
object-store acceptance remains a separate deployment prerequisite.

## Pins and provenance

`pins.json` contains versioned official download URLs and SHA-256 checksums.
The fixture verifies downloads before execution. Built images are pushed to an
owned local registry and consumed by observed manifest digest. The Cilium chart
is the **released chart**, whose image digests differ from development-tree
values; rendered component images must all contain a digest.

- [kind releases](https://github.com/kubernetes-sigs/kind/releases/tag/v0.33.0)
  and [local registry contract](https://kind.sigs.k8s.io/docs/user/local-registry/).
- [gVisor release 20261026.0](https://github.com/google/gvisor/releases/tag/release-20261026.0)
  and [containerd setup](https://gvisor.dev/docs/user_guide/containerd/quick_start/).
  Install the whole official bundle, including its `gvisor-bin` support files.
  The explicit `systrap` platform does not depend on nested KVM availability.
- [Cilium on kind](https://docs.cilium.io/en/stable/installation/kind/)
  and [Kubernetes compatibility](https://docs.cilium.io/en/stable/network/kubernetes/requirements/).
  kind's default CNI is disabled, and localhost policy bypass is disabled for
  the controlled node canary. Actual negative tests remain mandatory.
- [Agent Sandbox v1.0.2](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v1.0.2).
  Both manifest checksum and controller image digest are pinned.
- [MinIO RELEASE.2025-10-15T17-29-55Z](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
  is source-built at commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`.
  This AGPL-3.0 project was archived in April 2026; the fixture is a bounded
  compatibility test, **not a recommendation or claim of current support**.
  The source revision, LICENSE hash and built binary hash are recorded. Its
  temporary S3 keys stay on the trusted host and are not mounted into Agent Pods.

## Offline checks

These do not install infrastructure or establish runtime/network acceptance:

```sh
bash -n deployment/agent-sandbox/isolated-kind.sh
node --test deployment/agent-sandbox/test/isolated-fixtures.test.mjs
go test -race deployment/agent-sandbox/isolated/probe{,_test}.go
go test -race deployment/agent-sandbox/isolated/artifact-writer{,_test}.go
```

The live script refuses to start without both `GITHUB_ACTIONS=true` and the
separate `PERO_ISOLATED_ACCEPTANCE=1` opt-in. Bypassing this check locally is not
an authorization mechanism. A missing product test or image wiring must fail
closed rather than accepting infrastructure-only evidence.
