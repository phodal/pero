---
kind: verification_report
date: 2026-10-29
---

# Isolated Agent acceptance: evidence and open gates

This is a **Draft, not a production-readiness certificate**. The
[isolated profile](../adr/0017-isolated-agent-runtime.md) is separate from the
[trusted Worker pool](agent-sandbox-runtime.md). No production deployment or
existing cluster is part of this verification.

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

## Deployment-blocking requirements

1. Demonstrate the actual fixed Agent Pod's runtime, admission and network
   envelope, including preventing unintended IPv6 connectivity. YAML and a
   positive-control pass alone are not enforcement evidence.
2. Complete non-skipped cold Sandbox/PVC, real Go ACP, read-only exporter,
   backend-checksummed manifest and UID-safe data-cleanup cluster flows.
3. Integrate a trusted storage-fence adapter and export orchestration for the
   selected CSI backend. Single-node kind cannot prove partition/failover
   fencing. Pod API absence is not physical writer fencing.
4. Meet the [durable artifact prerequisites](durable-artifact-exports.md),
   including retained-volume recovery, backend retention and operator handling
   of failed/expired collectors. Automatic unattended tool approval remains
   disabled; the file-production fixture is not an ACP tool-approval proof.
