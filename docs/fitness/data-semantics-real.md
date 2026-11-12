---
kind: verification_report
date: 2026-11-12
---
# Real semantic comparison and upstream deployment — #152

The real model comparison and a dedicated upstream deployment now have execution
evidence. **Full-service adoption remains blocked:** partial Vault configuration
accepted a connection and persisted its synthetic password as plaintext. Keep
#152 open; retain ADR 0035's `reuse-contract-only` decision.

The [committed result summary](../../experiments/data-semantics/results/2026-11-12-real.json)
contains actual denominators, usage, observed model fingerprint, image identities
and the failed gate. Raw local evidence is in `test-results/issue-152-real/`.
This extends, rather than replaces, the earlier [light-path evidence](data-semantics.md).

## Frozen comparison

Evaluation driver code was frozen at `ab831a5f` before execution. The original
questions, expected answers, definitions, SQL engine, three repetitions and
threshold proposal were unchanged. Two unscored calibration requests passed.
Formal A/B/C made **273 real API requests**: 270 question attempts and three B
semantic-generation calls, without retries. This is no longer fixture evidence.

The endpoint was `https://api.deepseek.com/chat/completions`, using the existing
repository credential only through the process environment. Requested and returned
model: `deepseek-flash`; the provider's published revision was
DeepSeek-V4.1-Flash-1017. All 273 replies carried the same observed fingerprint
`bc19ba97cbe016479903222bb1578db6`. The alias remains provider-managed; the
fingerprint is an observation, not independently attested model weights.

All arms used temperature 0.2, max_tokens 4096 and explicit non-thinking mode.
Only the frozen public/synthetic schema, definitions and questions were sent.
No private dataset, database credentials or provider key entered a model prompt.
No NVIDIA model, embedding, prediction or upstream `ask_question` ran.

| Arm | Original exact matches | Basic | Trap | Clarify | Refuse | SQL/parse errors | p50 / p95 seconds |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A: schema only | 33/90 | 3/36 | 0/24 | 15/15 | 15/15 | 0 | 1.18 / 2.21 |
| B: generated unreviewed context | 32/90 | 2/36 | 0/24 | 15/15 | 15/15 | 1 | 1.30 / 2.47 |
| C: existing reviewed definitions | 87/90 | 36/36 | 21/24 | 15/15 | 15/15 | 0 | 1.33 / 3.12 |

Each repetition was A 11/30; B 11/30, 11/30, 10/30; C 29/30. The
question-latency table excludes B's three separately recorded generation calls
(8.19, 8.42 and 7.71 seconds); their tokens are included in the cost totals.
The independent D checker also reran: 20/20 answerable questions per repetition,
90/90 provenance-complete receipts, and all 15 execution/integrity probes passed.
D's clarification/refusal intents remain pre-authored fixtures, not model scores.

### Interpretation and failed answers

The frozen scorer compares complete result JSON exactly, including aliases and
floating-point representation. A post-hoc diagnostic found **30 A and 24 B**
attempts differing only by a documented column alias and/or six-decimal rounding.
Those cases remain failures in the original score. The diagnostic retains extra
columns and does not declare arbitrary SQL equivalent. The full mapping/case list
is in `audit-final.json`; it is not a revised acceptance metric.

Thus the 60-point exact-score difference between C and A is **not a measured
60-point semantic-correctness improvement**. C contains pre-authored SQL and
policy conditions; A has schema without those conditions, and B generates text
from schema without inspecting source rows. The comparison supports reusing
explicit reviewed query definitions in this fixed task, not general automatic
ontology quality or adoption of NVIDIA's complete Agent.

B's error supplied positional `?` SQL with named parameters. C's three T08
failures used the literal type label `"str"` as the method binding instead of
method A; its SQL executed but returned the wrong answer. No automatic repair,
question rewrite, retry or post-run threshold change concealed these failures.
C's existing reviewer is Codex, not an independent human researcher. Human
maintenance minutes and a 25% human-effort reduction remain unmeasured.

Measured provider usage, including B generation: 539,133 input tokens (473,216
cache hit, 65,917 cache miss) and 25,917 output tokens. At the
[published rates observed on 2026-11-12](https://api-docs.deepseek.com/quick_start/pricing/),
the all-off-peak/all-peak envelope is **USD 0.026857–0.053715**, excluding the two
calibration calls. This is a usage-based estimate, not an invoice. Costs were not
filled with zero when unknown.

## Actual upstream deployment

Built backend, Next.js frontend and MCP from fixed NVIDIA source commit
`fc43a82600e18b19d159c52023f54f5572f537ac`. All 12 previously audited source files
matched their frozen hashes. Postgres migrations and frontend migrations ran.
Local immutable image IDs are in the committed summary; the backing DB image's
registry digest is retained. Builds used upstream Dockerfiles and lockfiles;
apt updates and upstream build-time package resolution are not hermetic rebuilds.

The dedicated Colima profile is `pero-152`, with its own Docker context. Backend,
ingestion and Postgres have no host-published ports and only an internal network.
Frontend and MCP publish to randomly selected loopback ports through a separate
edge network. The edge network is not an outbound filtering gateway. Upstream
model endpoints use disabled local placeholders and no real keys. All source
rows/accounts/passwords are synthetic and task-owned.

Observed through actual services, not mocked transports:

- **14 API/session/token checks passed:** missing session and forged identity
  return 401; real login/read, token creation/read, current role downgrade (write
  403, read 200), expired token 401, revocation and post-revocation 401. Expiry is
  injected in the real test DB, not reached by sleeping. Expired token management
  returns 404 rather than deleting an already unavailable token.
- **23 OAuth/MCP checks passed:** missing/invalid token refusal, dynamic client
  registration, real signed consent + PKCE code exchange, UserInfo, MCP
  initialization/notification, discovery of nine tools and actual
  `check_readiness` invocation, current role downgrade, injected OAuth expiry,
  restored token, authorization-server outage (500, not false success or expiry),
  recovery, revocation, revoked UserInfo/MCP refusal and authorization-code reuse
  refusal. This does not certify external SSO or a production reverse proxy.
- **Real PostgreSQL read role:** SELECT returned count 2 / sum 6 before and
  after probes. DDL, DELETE, catalog access, server-file read and a multi-statement
  DELETE were denied. This tests that dedicated database role, not arbitrary
  extensions or general multi-tenant row/column isolation.
- **Vault fail-closed FAILED:** with only `VAULT_ADDR` set, authenticated
  connection creation returned **201** and the real catalog stored the synthetic
  password in plaintext. No actual Vault server or real secret was used.
  The reproducible gate exits **1**; this failure is not marked passed.

The deployment generator was then replayed into a new project/database. Its auth,
OAuth and partial-Vault probes were rerun; final replay receipts are retained
separately. Development attempts are also retained: missing signed `oauth_query`,
missing MCP session ID and an incomplete readiness wait were probe corrections,
not upstream fixes. Reusing an OAuth code invalidated its issued grant, so the
final probe verifies explicit revocation before the separate reuse negative.

## Replay and remaining decision

Use an already running **dedicated** Docker context. Download the official source
archive for the above exact commit and extract it. The deployment generator checks
the frozen source hashes before building; it generates only synthetic private
runtime credentials. Its JSON files must not be committed or shared publicly.

```sh
python3 experiments/data-semantics/deploy_upstream.py --source /absolute/pinned/source \
  --context colima-pero-152 --output /absolute/new/deployment --partial-vault
python3 experiments/data-semantics/upstream_probe.py --deployment /absolute/new/deployment \
  --context colima-pero-152 --output /absolute/new/auth --partial-vault
# The previous command is expected to exit 1 for the observed Vault gate failure.
python3 experiments/data-semantics/oauth_probe.py --deployment /absolute/new/deployment \
  --context colima-pero-152 --output /absolute/new/oauth
```

For a new explicitly authorized model run, supply the provider key through the
process environment. The CLI never reads dotenv automatically. Do not rerun a
model merely to inspect historical evidence:

```sh
python3 experiments/data-semantics/evaluate.py --endpoint https://api.deepseek.com/chat/completions \
  --api-key-env DEEPSEEK_API_KEY --model deepseek-flash --non-thinking --output /absolute/new/model
python3 experiments/data-semantics/summarize.py /absolute/new/model --output /absolute/new/audit.json
python3 -m unittest discover -s experiments/data-semantics -p 'test_*.py' -v
```

The receipt auditor independently reconciled all 270 attempts with saved requests,
provider replies, full result rows, unchanged inputs and database identity; all
273 replies have measured usage. The five concept/loopback transport tests passed.
A negative control changed one provider response in a separate copied evidence
directory: the audit refused it, while the original evidence hash stayed unchanged.
The committed result summary is a compact report; raw responses and private
runtime files stay in ignored evidence directories.

The missing proof is now explicit: Vault fail-closed is demonstrably unmet;
human review/maintenance benefits, general isolation/egress and external SSO remain
unverified. Correcting or gating the upstream credential fallback would need a
separately reviewed implementation and another live acceptance run before
full-service adoption. No source patch, new Pero adapter, production credentials,
scientific acceptance or issue closure is implied by this experiment.
