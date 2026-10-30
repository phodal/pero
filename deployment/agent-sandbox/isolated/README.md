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
   control before testing denial. Both probes use the same runsc runtime. The gate is explicitly IPv4-only: kind/Cilium IPv6 is disabled, the trusted CNI prerequisite below removes Pod-netns IPv6 before runsc starts, and each probe rejects any non-loopback IPv6 interface address. Dual-stack is not accepted by this fixture.
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

## IPv4-only deployment prerequisite

This is a requirement of the isolated profile, not just a CI workaround.
`ipv6.enabled=false` in Cilium 1.20.4 does **not** remove Linux-created Pod
link-local IPv6 addresses. The strict gate observed one and correctly failed.
The pinned [Cilium CNI source](https://github.com/cilium/cilium/blob/v1.20.4/plugins/cilium-cni/cmd/cmd.go)
only enables IPv6 when requested; it has no corresponding disable operation.
[gVisor imports the container network namespace](https://gvisor.dev/docs/user_guide/networking/),
so removing addresses must happen in the trusted CNI lifecycle before runsc
imports them. No link-local exemption or Agent sysctl/capability grant is used.

`ipv4-cni.mjs` fixes the CNI 1.0.0 chain to `cilium-cni` then official `tuning`.
Only `net.ipv6.conf.all.disable_ipv6=1` and
`net.ipv6.conf.default.disable_ipv6=1` are configured. According to the
[Linux network sysctl contract](https://docs.kernel.org/networking/ip-sysctl.html),
disabling an interface removes its IPv6 addresses/routes; the default covers
new interfaces. Reading only the `all` flag is not proof of interface state,
so both canaries **and each actual product Pod** retain address-inventory gates.

The [pinned tuning implementation](https://github.com/containernetworking/plugins/blob/v1.9.1/plugins/meta/tuning/tuning.go)
enters the CRI-supplied network namespace before writes, fails ADD on namespace
entry/write errors, and returns the primary plugin's unchanged `prevResult`.
Empty, missing or invalid namespace paths fail entry; a valid host namespace
supplied by a compromised node administrator is **not** rejected by this plugin.
The CRI/CNI/node administrator remains trusted. No workload input supplies its
namespace path or `CNI_ARGS`; the fixed config contains no `args`,
`runtimeConfig`, capabilities, MAC, MTU or other interface changes. The exact
two-key anchored allowlist is installed and read back **before Cilium starts**;
upstream treats a missing allowlist as unrestricted, so absence is never accepted.

Only the pinned `tuning` binary is installed under the owned node's
`/opt/cni/bin`, not the rest of the release bundle. An immutable ConfigMap is
Cilium's custom conflist source. With `cni.configMap` and `cni.exclusive=true`,
the [pinned config manager](https://github.com/cilium/cilium/blob/v1.20.4/daemon/cmd/cni/config.go)
maintains that source instead of regenerating a chain without tuning.
`cni.customConf` stays false so the chart retains the exclusive watcher.
The fixture verifies installed bytes, binary SHA-256, root ownership/modes,
absence of competing CNI configs, and unchanged node-global `all`/`default`
values after installation, canaries and product cases. All nine reachability/
denial targets and existing product/runtime checks remain required.

The custom chain affects newly created, non-hostNetwork Pod network namespaces
on the **one owned test node**, including test infrastructure Pods. It does not
retrofit existing namespaces or change host-global IPv6 settings. Pure sysctl
configuration creates no tuning backup; tuning DEL does **not** restore these
sysctls. Namespace destruction removes their effects, and cluster teardown
removes the binary, allowlist and config. No production configuration is applied.
A production operator must install/protect and validate an equivalent pinned
prerequisite on its dedicated runtime nodes before scheduling hostile Pods;
this fixture is not acceptance of another CNI/kernel/runtime combination.

## Admission activation barrier

The fixed policy remains deny-only. `status.observedGeneration` and empty
`status.typeChecking` establish type-check completion, **not active enforcement**:
[Kubernetes documents type checking separately](https://kubernetes.io/docs/reference/access-authn-authz/validating-admission-policy/#type-checking),
and the [pinned v1.36.4 API server source](https://github.com/kubernetes/kubernetes/blob/v1.36.4/staging/src/k8s.io/apiserver/pkg/admission/plugin/policy/generic/policy_source.go)
refreshes active policy/binding pairs asynchronously. The prior immediate
wrong-runtime dry-run acceptance is consistent with propagation delay, but its
artifact lacks observed binding/namespace snapshots, so the cause is not proven.

Before granting the test control-plane token or starting product workloads, the
fixture verifies observed binding selectors/actions and namespace labels,
records the policy UID/generation, and requires zero type-check warnings. It
then waits at most 120 seconds for a **server-side dry-run** lacking RuntimeClass
to receive the exact named policy **and** binding's envelope denial. All attempts,
including initial accepted dry-runs, remain in evidence. Other errors are fatal,
not readiness signals. No probe Pod is persisted or scheduled. After activation,
the valid case and all three forbidden cases run **once**: any forbidden
acceptance fails, without retry. The existing credential-free neighbor is only
an infrastructure canary, not a hostile product workload. This single-API-server
fixture does not establish a barrier across all replicas of a production HA API.

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
- [Official CNI plugins v1.9.1](https://github.com/containernetworking/plugins/releases/tag/v1.9.1),
  Apache-2.0; [raw upstream checksum](https://github.com/containernetworking/plugins/releases/download/v1.9.1/cni-plugins-linux-amd64-v1.9.1.tgz.sha256).
  Both archive and extracted tuning binary hashes are pinned. The raw release
  checksum, installed configuration/allowlist, binary hashes and node-default
  observations are retained with the acceptance evidence.
- [Agent Sandbox v1.0.2](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v1.0.2).
  Both manifest checksum and controller image digest are pinned.
- [MinIO RELEASE.2025-10-15T17-29-55Z](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)
  is source-built at commit `9e49d5e7a648f00e26f2246f4dc28e6b07f8c84a`.
  This AGPL-3.0 project was archived in April 2026; the fixture is a bounded
  compatibility test, **not a recommendation or claim of current support**.
  The source revision, LICENSE hash and built binary hash are recorded. Its
  temporary S3 keys stay on the trusted host and are not mounted into Agent Pods.

## Object-store startup observation

Before S3 tests, `minio-readiness.mjs` waits at most 60 seconds on the owned
container's fixed loopback `GET /minio/health/cluster`, which checks initialization
and write quorum in the pinned source. `/live` can return 200 before initialization.
Each bounded attempt records only safe state fields and curl/HTTP statuses.
Stopped, OOM-killed, restarted or mismatched containers and non-startup errors
fail immediately. Failure logs are capped and projected to fixed category counts;
raw logs, environment, credentials and endpoints are never uploaded. No container
restart or object-write retry is added. Actual conditional-write/no-skip S3 and
product acceptance tests remain required after health activation.

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
