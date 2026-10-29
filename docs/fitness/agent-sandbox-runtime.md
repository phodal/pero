---
kind: verification_report
date: 2026-10-29
---

# Agent Sandbox runtime verification

This report records the original trusted-pool scope. Subsequent isolated-profile
and separately approved real-provider evidence is tracked in
[isolated Agent acceptance](isolated-agent-acceptance.md), including open gates.

Original implementation base: Pero `11cc28ce16d2ac10e76a0cfa9771fcef45feda17`.
Rebased before publication onto `27046fcf5352868c5e715a257f77c1f94e76af0d`
(the independent MCP list-changed regression tests; no runtime source overlap).
Point source: `edff76d7dd39b2900cff707af1896fe8ff9fd2dc`.
Upstream Agent Sandbox: v1.0.2 / `9a85153590e54cb980f3241f9e7a9228449412c9`.

The [architecture decision](../adr/0012-agent-sandbox-runtime.md) defines the
trusted scope; [operator instructions](../../deployment/agent-sandbox/README.md)
define image preparation and explicit cluster setup. This feature is disabled
unless `PERO_SANDBOX_CONFIG` is provided. No production configuration is changed.

## Local evidence

- Bounded Point provider: Go race tests and vet, plus its Bazel target passed.
  Loopback HTTP tests cover lost create/delete replies, original-ID-only
  reconciliation, required TTL, stale observed generation, same-name UID
  replacement, image/runtime changes and foreground cleanup pending/gone.
- Porting exposed three concrete admission bugs: absent Claim TTL, ignored Claim
  observedGeneration, and empty-UID Dispose. Each received a failing test before
  its fix. No full Point environment service or desktop code was copied.
- RuntimeBinding core tests pass: fixed image/TTL, immutable snapshot/config,
  freshness cap, runtime replacement and release preserve audit identity.
- Rust Worker: 14 unit tests and 12 real subprocess/HTTP/ACP tests passed. The
  original Pod UID survives a lost claim response and changed restart environment;
  recovered claims do not replay the prompt. Executor input still strips
  `PERO_*` values.
- Image-entrypoint contract: six offline/real-process tests passed, including
  entrypoint → Rust Worker → Go ACP → synthetic provider, retained completion and
  subsequent launch with no model replay. This is process evidence, not an image
  or Kubernetes execution claim.
- TypeScript/generated TypeSpec contracts, theme and 523 bilingual message checks
  passed (`npm run check`).

- Full server race suite passed against isolated PostgreSQL 17.11, including
  existing community/HTTP/Store regressions and new atomic runtime reservations,
  missing/wrong UID fences, observation-capped leases, cancellation, immutable
  receipt retries and cleanup. The wrapper stopped PostgreSQL and removed its
  synthetic data after the run. Server vet and Bazel build passed.
- Combined fake-Kubernetes + real PostgreSQL + actual Rust Worker + Go ACP shell
  tests passed for success and running cancellation: one synthetic provider call
  each, eight/four retained events respectively, and UID-bound cleanup receipts.
  Fault tests also prove no duplicate Run/create after lost response and no replay
  after Pod/container replacement.

Disposable kind acceptance is an explicit CI gate, not a local pass. The workflow
must produce a non-skipped `TestClusterRuntime` PASS and retain its exact image,
Run/Claim/Pod identities and cleanup receipt. A skipped test or an unexecuted
workflow is not acceptance; inspect the Draft PR's exact-head check/artifacts.

## Reproduction

```sh
# Existing supported Go/Rust/Node toolchains; no real provider credentials needed.
go -C server test -race ./internal/environments/... ./internal/runtimebinding
node scripts/cargo.mjs test -p pero-worker
PERO_TEST_WORKER_BIN=/absolute/pero-worker PERO_TEST_AGENT_BIN=/absolute/pero-agent-acp \
  node --test deployment/agent-sandbox/test/*.test.mjs
npm run check

# Dedicated empty test DB: suites create/drop isolated schemas.
PERO_REQUIRE_TEST_DATABASE=1 PERO_TEST_DATABASE_URL=... \
PERO_SANDBOX_WORKER_BINARY=/absolute/pero-worker \
PERO_SANDBOX_AGENT_BINARY=/absolute/pero-agent-acp \
  go -C server test -race -count=1 ./...
```

The opt-in Agent Sandbox workflow uses only an ephemeral CI cluster, namespace,
registry, test RBAC, synthetic tokens/data and fixtures, then destroys them. Its
loopback fixture gateway is CI-only and does not weaken production HTTPS checks.

## Explicit limits

No existing/user cluster, production DB, model account or provider credentials
are used. No production Worker is enrolled, Task dispatched, PR merged or service
deployed by this verification. The fixed trusted pool is not hostile-code
isolation. NetworkPolicy fields are declarations until a CNI-specific positive
and negative test proves enforcement; gVisor/Kata and strict bwrap admission are
not verified. Fixture success is not real model-provider or external-write
acceptance. Unknown pre-create absence remains conservatively unconfirmed.
