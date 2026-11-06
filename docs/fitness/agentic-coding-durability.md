---
kind: verification_report
date: 2026-11-06
---

# Selected Agentic Coding Durability projects

Three projects and four public prompts run with the native Pero ACP runtime and
`gpt-6.1-sol`. Gin's two sequential features and FastAPI's blog feature pass
independent HTTP/persistence checks. OpenManus passes the scoped search-module
checks; complete application startup remains unverified. Total usage is
**99 requests, 152 tool calls and 2,166,073 provider-reported tokens**.

This is a local adaptation of
[Qoder's evaluation set](https://github.com/QoderAI/agentic-coding-durability-evalset),
not an official score. Upstream explicitly supplies no automated completion
verifier and asks people to iterate until they judge the task done. We freeze
behavioral acceptance before model execution, use one attempt per project,
and do not feed independent judge results back to the model.

## Sources and execution

The requested clones live under `/Users/phodal/benchmarks/ai4se`.
Sources remain pristine; agents edit separate Git copies under
`runs/20261106-sol-durability-01/workspaces/`.

| Source | Pinned revision | Selected public task |
| --- | --- | --- |
| Evaluation-set index | `993d6a5a124d5cbb127312e82fdb92be94bbacef` | README and methodology |
| `gin-demo` | `1700b5c5aadafdc464042722cbd0253979b0d475` | Tasks 1 and 2: JWT, then SQLite users CRUD |
| `fastapi-sqlite-demo` | `3e29d316778e4f6b723bcf4a5898f3b0e3fe2ef8` | Task 1: blog schema, repository, tests and async routes |
| `OpenManus` | `6c80b4ac7180069957c92338aca5189d2c5f03ee` | Task 1: configurable Google-only search |

The macOS arm64 binary is built with Go 1.27.3 and `CGO_ENABLED=0` from master
`5e87d45aaa496097d67217e4be50ebb57c4a742a`, with `vcs.modified=false`.
Its SHA-256 is
`57aa75636f49a02dceb7f8ed9c65e7bfe8b52d058172acdf94081708e35f541b`.
Publication incorporates master `08a0e6a2`; the `harness/go` and
`harness/tools/trial` Git trees are unchanged from the evaluated revision.

The configured endpoint is `http://187.124.157.143:8989/v1`, using Responses,
nonstreaming requests and explicit HTTP admission. The ignored mode-0600 `.env`
supplies the credential through `OPENAI_API_KEY`; no credential is a report field.
Projects run serially, with zero retries, zero continuations, a 128-request
ceiling per project, 16,384 output tokens per response, a 1,800-second project
timeout, 600-second idle timeout and 180-second provider request timeout.
Gin's two prompts share one Session and the same request budget.

Native Claude-style tools use deferred discovery and a neutral plugin. Tool
history uses 48,000/24,000-character watermarks and protects four recent results.
The existing `feedback` engineering profile is enabled, with no delivery
contract. Automatic model compaction is off because the endpoint's context
capacity is unknown. These settings differ from the preceding Terminal-Bench
sample, so neither score nor token differences establish a runtime improvement.

## Preparation and controls

Gin's existing module dependencies are downloaded and its workspace `go.sum`
populated before execution. The original project builds and answers `/ping`;
the independent feature probe fails at the absent login route as expected.

FastAPI uses Python 3.13 and `uv sync`. Its baseline initially cannot collect
tests because SQLAlchemy's async path needs `greenlet`; installing that package
in the workspace venv makes the original two tests pass. `UV_NO_SYNC=1` preserves
that prepared venv during the agent run. No baseline source dependency file is
edited. The blog probe rejects the original application because it has no blog
routes. The existing unknown `env_files` pytest warning remains.

OpenManus uses Python 3.12 and the real search dependencies, with an ignored
local TOML configuration containing an unused placeholder Daytona key. The
full browser/LLM/sandbox dependencies and application credentials are not
provisioned. Scoped imports bypass the unrelated `app.tool` package barrel;
actual config, base tool, search engines and WebSearch code still load.
The original default fallback control passes and the absent Google-only
feature control fails. No live Google request or application LLM is used.

## Independent results

| Project | Acceptance evidence | Requests | Tools / failed calls | Reported tokens |
| --- | --- | ---: | ---: | ---: |
| Gin | Race suite and build pass; eight HTTP/JWT/schema/persistence groups pass after both turns | 43 | 57 / 1 | 1,094,016 |
| FastAPI | 17 tests pass; ten independent CRUD/regression/schema groups pass | 34 | 55 / 6 | 698,692 |
| OpenManus | Four search behavior cases and ten scoped tests pass; ordinary pytest collection is blocked | 22 | 40 / 1 | 373,365 |

Gin retains public `/ping`, issues HS256 tokens with the required username
subject and approximately 30-day expiry, rejects missing/invalid/expired or
wrong-secret credentials with 401 JSON, and accepts Bearer and `x-api-key`
query tokens. The independent probe checks user CRUD, the actual SQLite schema,
and persistence across a real server restart. All of these run against the
final second-turn submission, so adding SQLite did not remove JWT protection.
The public README selects `/login`, `/api/v1/users` and its demo credentials;
upstream does not mandate those route names.

FastAPI delivers the blog table in the actual `db/demo.sqlite3` before any
independent tests run. Review confirms SQLModel schemas, async repository CRUD,
dependency-injected routes and repository/API tests. The independent client
discovers `/blogs` and its schemas from public OpenAPI, exercises CRUD, reads
the updated record from a fresh interpreter and checks existing Hero behavior.
Full-repository lint/type checks still fail: pristine baseline versus candidate
is 8 versus 7 Ruff diagnostics and 11 versus 11 identical ty diagnostics.
The retained diagnostics concern the old Hero/database/test code; they are
not new blog regressions. This is functional acceptance with inherited quality
debt, not a claim that every repository gate passes.

OpenManus adds a default-false `[search].google_only` setting and one selection
branch in the existing engine-order owner. The example TOML documents that it
overrides preferred/fallback engines while preserving retry settings. Independent
probes load the actual TOML configuration and replace only the external search
engine seam: default fallback works, Google success returns results, and empty
or failing Google calls never invoke another engine. Ordinary candidate pytest
collection fails on missing `browser_use`, matching the known search-only
environment boundary. Its ten unchanged tests pass when launched with the
same package-barrel bypass. Both outcomes are retained; full startup, live
search and unrelated browser/sandbox behavior remain unverified.

## Failures, usage and quality implications

All four prompts end with ACP `end_turn`. Each process exits zero with no
cleanup errors; no owned native agent or Gin probe server remains. All 99
responses report usage and all 152 tool calls have matched results. There are
no missing results, request deadlines or detected zero-exit validation candidates.
The eight explicit failed calls remain failures even though scoped acceptance
passes: Gin repairs missing module checksums; FastAPI encounters lint/type
diagnostics and corrects its overly strict SQLite schema comparison; OpenManus
encounters the missing browser dependency. Existing lint/type debt and the
OpenManus dependency gap remain unresolved.

Reported usage comprises 1,864,646 uncached input tokens, 272,896 cache-read
tokens and 28,531 output tokens. No monetary cost is inferred. Summed native
project durations are 1,114.14 seconds, excluding preparation and independent
verification. Input plus cache reads account for about 98.7% of reported usage.
Measured prepared payloads total 8,294,057 bytes, including 3,292,986 bytes of
retained tool-result messages across requests; bytes are not token estimates.

These examples support feature implementation and local regression checking,
while exposing substantial context consumption. Repeated calls are not all
waste: Gin's repeated vet/build and executable removal occur across successive
features. A useful next experiment freezes the same tasks and acceptance,
compares context policies serially, and verifies that reduced tokens preserve
delivery and regression results. Do not infer savings from these single runs
or add benchmark-specific behavior to native tools.

Continue Terminal-Bench and SWE-bench-style repair coverage alongside this
suite. Only Gin exercises two rounds here; this sample does not establish
long-horizon durability, full original-plugin development/review/merge
acceptance, or complete Claude Code/Workflow SDK parity. The preceding
[polyglot delivery failure](../issues/2026-11-06-coding-delivery-residue.md)
remains open and is not repaired or overturned by these different tasks.

## Retained evidence

`/Users/phodal/benchmarks/ai4se/runs/20261106-sol-durability-01/` retains original
prompts, the pre-run acceptance plan, frozen runners/judges/binary hashes,
native Sessions, receipts, tracked patches, manifests covering new source files
and the delivered database, controls, test logs and independent verification.
Fresh copies are used for independent probes; candidate workspaces stay intact.

Final audits confirm unchanged source clones, original prompts and frozen
inputs/judges, with zero configured credential-literal matches. Binaries,
SQLite files and raw traces are excluded from Pero Git. The
[machine-readable report](../design-docs/harness-durability-sol-evaluation.json)
records receipt, Session, verification and manifest hashes.
