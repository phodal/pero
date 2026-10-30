# Bounded Point environment port

The provider and reference types are copied/adapted from
[`phodal/point@edff76d7dd39b2900cff707af1896fe8ff9fd2dc`](https://github.com/phodal/point/tree/edff76d7dd39b2900cff707af1896fe8ff9fd2dc/environments)
at the repository owner's request. Source content and Git blob identities were
verified on 2026-10-29. This is a source port into the existing Go server, not a
new service, scheduler, SDK dependency, or import of Point's whole environment
engine.

## Source and license boundary

No `LICENSE`, `COPYING`, or `NOTICE` was present in the checked source root or
the `environments`, `model`, `ports`, `providers`, and `providers/kubernetes`
directories at that revision. The selected Go files carry no separate license
header. Owner-directed copying does not establish a general public license; do
not label this code Apache/MIT by analogy with its API references. Publication
and any relicensing require the repository owner's authorization.

Point's pinned `environments/SOURCE_REFERENCES.md` states its portable module is
a standard-library implementation with external projects used as design/API
references, not copied source. This port includes no Coder, Crossplane, labgrid,
E2B, desktop, browser, VNC, credentials, kubeconfig, product configuration, or
private diagnostic payloads.

| Source relative to Point `environments/` | Verified Git blob | Port scope |
| --- | --- | --- |
| `model/refs.go` | `4b2003474646a8c67d7e385abda88207a64515e4` | References, resource/runtime observations, validation and digest; desktop endpoint/target types removed |
| `model/instance.go` | `e71d3d25831fbc5b3cf23cd63f1037ef6fbc93e4` | Minimal `Binding` fields only; no Instance/Use state machine |
| `ports/ports.go` | `a768d083d0ae9f5fd4e4bef36c55b8e180d3c7fa` | ResourceOwner, Provisioner, ProvisionSpec, Disposer only |
| `providers/kubernetes/reader.go` | `c4848623772392fbeeaa37c02ce7edbb60bdd96e` | Bounded HTTP read and allowlisted object projection |
| `providers/kubernetes/writer.go` | `a4fc6c46958d72140a798e4a1f46b6b19d864f24` | Claim POST and UID-precondition foreground DELETE |
| `providers/kubernetes/owner.go` | `f23f7845e592f8abdbb97419307801a0c5238dd9` | Observation, runtime incarnation, read-only resolve/detach; no endpoints |
| `providers/kubernetes/claim.go` | `48e457f29c17844132676d78da415c8576cf6a1a` | Fixed-pool claim lifecycle and original-request reconciliation |
| `providers/kubernetes/owner_test.go` | `90a99325a0fb5d27ab8951295490c2518b4fa28a` | Provider tests only; endpoint tests removed |
| `providers/kubernetes/claim_test.go` | `1ebf720569451999e4b7c79d8b331dd2b01b6a22` | Provider tests only; Point service/storage tests removed |

Additional Pero lifecycle tests exercise response loss over actual loopback
HTTP, rejected stale claim readiness, mandatory observed TTL, config conflicts,
and refusal to issue an empty-UID delete. The port corrects those TTL/readiness/
UID cases, bounds create-response bytes, changes import paths, and retains the
claim name and config/request digest algorithms.

## Agent Sandbox contract pin

The API contract is Kubernetes SIGs Agent Sandbox **v1.0.2**, annotated tag
`468cf30617c01e30098d631a2bdd8d032f8359e4`, commit
[`9a85153590e54cb980f3241f9e7a9228449412c9`](https://github.com/kubernetes-sigs/agent-sandbox/tree/9a85153590e54cb980f3241f9e7a9228449412c9).
The checked files are `api/v1beta1/sandbox_types.go`,
`extensions/api/v1beta1/sandboxclaim_types.go`,
`extensions/api/v1beta1/groupversion_info.go`, and
`extensions/controllers/sandboxclaim_controller.go` at that pin. They are API
references under upstream Apache-2.0, not vendored Go code or a linked SDK.

- Core `Sandbox`: `agents.x-k8s.io/v1beta1`.
- Extension `SandboxClaim`, `SandboxTemplate`, `SandboxWarmPool`:
  `extensions.agents.x-k8s.io/v1beta1`.
- Claims select one existing `warmPoolRef.name`. No `env` or
  `volumeClaimTemplates` are sent; those fields force cold starts upstream.
- Claim lifecycle accepts `Delete`, `DeleteForeground`, `Retain`. Retain keeps
  the Claim record, **not** its underlying resources. Explicit disposal always
  uses UID-precondition foreground DELETE regardless of TTL policy.
- Claim and Sandbox readiness must match their current generation. The
  v1.0.2 controller populates Claim `observedGeneration`.
- The provider does not return a Claim to its pool. It supports only destroy;
  the upstream controller replenishes the pool.

Point's separate 2026-10-24 diagnostic records real v1.0.2 hot claim/destroy and
lost-response recovery. This port's tests are synthetic HTTP/API evidence, not
a new real-cluster run or proof of controller installation. Cold starts, multiple
pools, TTL expiry in a real cluster, adoption concurrency, gVisor/Kata and CNI
NetworkPolicy enforcement remain unverified here.

## Authority

`ResourceOwner` observes resource identity. `Provisioner` and `Disposer` acquire
and destroy infrastructure. None is a `UseOwner`, issues an execution grant,
opens a Pod exec/tunnel, supplies Agent credentials, or owns Task/Run state.
The existing Pero server/Worker protocol remains the sole execution lease,
journal, cancellation, event and result authority. The embedding application
must persist operation IDs before dispatch, call read-only `ReconcileProvision`
after unknown create results, pin the returned runtime snapshot, and never
re-run a prompt solely because a Pod was replaced.
