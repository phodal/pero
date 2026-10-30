# Bounded headless deployment provenance

The user authorized copying the Point Kubernetes environment implementation into
Pero on 2026-10-29. These artifacts adapt only the headless/non-root process and
prepared-workspace pattern, not the Point Desktop/VNC image, daemon control
server, browser bindings, root capabilities, model configuration or credentials.

Reviewed source: `phodal/point` commit
`edff76d7dd39b2900cff707af1896fe8ff9fd2dc`, fetched at that exact ref:

| Source | Git blob | SHA-256 |
| --- | --- | --- |
| `deployment/kubernetes/daemon-host/Dockerfile` | `28d7e8576062ec1fb00c81e1ba3062335c1e30ac` | `6dd64bc949e88ddad2b718b6c67df42a3ce9127d5a24bed5d204216c3114eb83` |
| `deployment/kubernetes/daemon-host/entrypoint.sh` | `06e0e0bc44b7678e007405fa9009250f6e12260a` | `ea2291251c4fc14a433b995eec5bccdc53a89602d316d763e7aa4a127a609fbb` |

Neither reviewed file contains a license header; no root Point LICENSE was found
at that source ref. This record preserves provenance and the user's copy grant;
it does not invent an open-source license or relicense unrelated Point code.
The Go provider's independent source manifest is
[`server/internal/environments/SOURCE_REFERENCES.md`](../../server/internal/environments/SOURCE_REFERENCES.md).

## Upstream API and disposable tooling pins

No Agent Sandbox SDK or controller source is vendored. The handwritten renderer
uses the reviewed **v1.0.2** `v1beta1` API at commit
`9a85153590e54cb980f3241f9e7a9228449412c9` (annotated tag object
`468cf30617c01e30098d631a2bdd8d032f8359e4`). The Template and WarmPool generated
objects were validated against that release's CRD OpenAPI schemas.

- [SandboxTemplate types](https://github.com/kubernetes-sigs/agent-sandbox/blob/9a85153590e54cb980f3241f9e7a9228449412c9/extensions/api/v1beta1/sandboxtemplate_types.go)
- [SandboxWarmPool types](https://github.com/kubernetes-sigs/agent-sandbox/blob/9a85153590e54cb980f3241f9e7a9228449412c9/extensions/api/v1beta1/sandboxwarmpool_types.go)
- [v1.0.2 release](https://github.com/kubernetes-sigs/agent-sandbox/releases/tag/v1.0.2):
  combined manifest SHA-256 `e3dda8359fee2b1bb6f4a9448d7004888286482b17670c581dee976f370fd165`.
- Controller manifest digest, observed from `registry.k8s.io` on 2026-10-29:
  `sha256:dc700a37ecf4e680a146098a30996f420507e76e83a27dbd293f2b8114b14daa`.
- [kind v0.33.0 release](https://github.com/kubernetes-sigs/kind/releases/tag/v0.33.0):
  Linux amd64 binary SHA-256 `aee6151561422756b764a4ae28e7f44cda5af5a9eead3cc9985112b1de8d8e0d`;
  Kubernetes v1.36.4 node image digest `sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed`.
- [kind local registry contract](https://kind.sigs.k8s.io/docs/user/local-registry/):
  node-local `localhost:port` resolves through containerd's hosts configuration to
  the disposable registry container; no node host-network access is granted.
- Docker Hub observed multi-platform manifest digests on 2026-10-29:
  [registry 3.0.0](https://hub.docker.com/_/registry)
  `sha256:6c5666b861f3505b116bb9aa9b25175e71210414bd010d92035ff64018f9457e`;
  [Ubuntu 24.04](https://hub.docker.com/_/ubuntu)
  `sha256:fe81560990fae86dc4743202b2cb4d3df98d0bcf949173cecef15ce1127ef852`.

The prepared base must provide [Tini](https://github.com/krallin/tini) as PID1,
with default child-signal forwarding and exit-status propagation. The disposable
Ubuntu base pins [`tini=0.19.0-1`](https://packages.ubuntu.com/noble/tini);
its exact package is recorded with the base digest and tested before cluster use.
Tini is an external base dependency, not vendored source or a new Worker protocol.

The CI workflow pins action commit SHAs. It records the built Worker image's
actual registry digest, binary hashes and tool versions. In the disposable CI-only runtime base, apt packages are resolved
inside its image build and retained in `/opt/pero/runtime-packages.txt`; pinning
the base image is not a claim that the package repository is reproducible.
