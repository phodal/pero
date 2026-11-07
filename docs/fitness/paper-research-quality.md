# Autonomous research quality gate (#143)

Status: **evaluation tooling implemented; live-provider and independent human
scientific acceptance not run**. Base: `bc20ef9f4e0a31802f0eafc4ec6e3b0066a149be`.
This supplements [autonomous research](paper-autonomous-research.md), not its
existing implementation/fixture evidence. A successful execution is not a
successful quality review, and neither closes the rest of #143.

## Fixed cases and evidence

`tests/runtime/research-quality/cases.json` freezes two questions, seed versions,
reviewer reference sets, evidence requirements and engineering thresholds:

- `attention-parallelism`: layer parallelism versus autoregressive decoding,
  dense attention cost and a bounded sparse alternative.
- `attention-context`: long-context cost, cross-segment reuse, sparse attention
  and restrictions on both alternatives.

Only each case's question, scope and seed go to the research backend. Reference
answers and expected papers stay out of the model prompt. This is open discovery
against a small historical reference set, not general literature recall. Public
search results can change; actual queries, provider failures, candidates,
original versions, read windows and checkpoint are retained for each attempt.
The second case also uses the original Transformer as its sole supplied seed.

The reference sources were independently inspected by an assistant at their
versioned official PDFs. This is **not** a human review of model output:

- [Attention Is All You Need v7](https://arxiv.org/pdf/1706.03762v7): §3,
  PDF p. 2, says the decoder generates one element at a time. §4/Table 1,
  pp. 6–7, compares per-layer sequential operations and O(n²d) attention cost,
  with n < d qualifying the recurrent-layer cost comparison.
- [Transformer-XL v3](https://arxiv.org/pdf/1901.02860v3): §3.1–3.3,
  pp. 2–4, explains fixed-segment fragmentation and cached segment states.
  Context depends on depth, segment length and cache; §4.5/Table 9, p. 8,
  speedups refer to its stated recomputing vanilla baseline, not every decoder.
- [Longformer v2](https://arxiv.org/pdf/2004.05150v2): §3.1, pp. 3–4,
  describes local/global attention. O(nw) is linear in n only with fixed window,
  and combined linear scaling assumes global-token count independent of n.
  Sparse attention changes connectivity; asymptotic cost alone does not prove
  wall-clock superiority.

Equivalent originals or different versions require an explicit reviewer mapping
with reasons. Metadata-only discovery and downloaded-but-unread originals do
not count as read coverage. A failed acquisition remains a missing source.

## Offline readiness check

```sh
node tests/runtime/paper-program-live.mjs --preflight
```

This mode does not import esbuild, start Host/Harness, fetch sources or contact a
model. It reports credential **presence only**, explicit provider/model settings,
executable paths, Node resolution, pinned Python PDF dependencies and Git HEAD.
Exit 1 means a local prerequisite is missing. Exit 0 means only that those local
checks passed: it does not verify permission, available balance, network access,
model compatibility or an enforceable monetary limit. The report keeps those
boundaries explicit. It creates no live attempt or quality pass.

See the [2026-11-07 readiness record](paper-research-quality-readiness.md) for
current blockers, cost assumptions and reviewer handoff.

## Run and review

First build the existing Host/Harness and install the repository's declared
Node/Python dependencies using its normal development procedure. The runner
supports Linux/macOS suffixes and `PERO_RESEARCH_HOST`, `PERO_RESEARCH_AGENT`,
`PERO_RESEARCH_PYTHON` overrides. Overrides are absolute paths or paths relative
to the repository root, consistently in preflight and actual execution. Without
a Python override, the runner resolves `python` through PATH. This change did
not rebuild or run Host/Harness.

A live run requires explicit permission for the selected provider, sharing the
public research inputs, and the bounded model spend. Configure the key through
the existing secure environment mechanism; never paste it into a command,
source file, review artifact or chat. Merely having a key or setting this flag
is not permission to spend on someone else's behalf.

With that authorization and provider configuration already in place:

```sh
DEEPSEEK_MODEL="$APPROVED_RESEARCH_MODEL" \
  PERO_RESEARCH_LIVE=1 PERO_RESEARCH_CASE=attention-parallelism \
  node tests/runtime/paper-program-live.mjs
DEEPSEEK_MODEL="$APPROVED_RESEARCH_MODEL" \
  PERO_RESEARCH_LIVE=1 PERO_RESEARCH_CASE=attention-context \
  node tests/runtime/paper-program-live.mjs
```

`DEEPSEEK_BASE_URL` defaults to `https://api.deepseek.com`. `DEEPSEEK_MODEL`
has **no default** and must explicitly identify the approved model. The examples
use `APPROVED_RESEARCH_MODEL` only as a caller-supplied placeholder; no value is
provided or selected automatically. DeepSeek's [official change log](https://api-docs.deepseek.com/updates/)
scheduled retirement of `deepseek-chat` and `deepseek-reasoner` for 2026-07-24.
Do not silently replace a retired model with a differently priced model. Verify
the current model, compatibility and [prices](https://api-docs.deepseek.com/quick_start/pricing/)
before approval and live execution.
Each attempt has an isolated timestamped directory and no automatic retry.
The existing caps are 3 rounds, 4 searches, 12 candidates, 16 read actions,
3 downloads/30 MiB, 60 model requests, 100 App calls, 4096 output tokens per
request and 12 minutes. Request/token caps are **not a monetary spending cap**.
Do not run when a required money limit cannot be enforced by the provider.
Retain failures and partial outputs alongside successes; do not report only the
best attempt or silently rerun a failed case.

The runner traverses every round page and verifies a stable checkpoint. The
read API already starts at round zero; mutation responses default to the latest
round, and size-limited read responses can require further pages.
A Host `turn_finished` event or `agentrun status` response is not a persistence
barrier: status only queues asynchronous Paper observation. The runner waits up
to 45 seconds for terminal backend accounting and every final export slot to have
a matching session/program/checkpoint/digest artifact receipt. Earlier
checkpoint versions, unrelated runs and incomplete split exports cannot satisfy
that wait. Expiry saves failure evidence instead of a stale running/zero-count
result; polling does not start or retry inference.
`executionChecks.passed` describes only the operational journey. Scientific
acceptance remains `needs_independent_human_review`. It saves the frozen rubric,
case, model, provider origin, revision, evaluator file hashes, binary hashes,
generation flags, start/end time, raw events and production-store state. Failed
launches save `failure.json`, not a fabricated quality pass.

After a completed export, `quality/` contains:

- `packet.json`: digest-bound full claim list, actual observed passages and
  pages, saved reports, complete assistant text chunks, queries/jobs,
  candidate screening, per-round gaps/next actions, provenance and accounting.
- `sources/<sha256>.pdf`: retained originals checked against the Store's digest.
- `review-template.json`: entirely unreviewed human form. Copy to `review.json`.
  Recollecting replaces the template, never `review.json`.
- `status.json`: counts and integrity errors, never a scientific pass.

Export can also be repeated without any provider or source requests:

```sh
python tests/runtime/paper-program-quality.py collect RUN_DIRECTORY
python tests/runtime/paper-program-quality.py score \
  RUN_DIRECTORY/quality/packet.json RUN_DIRECTORY/quality/review.json \
  --output RUN_DIRECTORY/quality/score.json
```

An independent **human** opens the retained originals and saved reports, checks
all final assistant assertions, and fills every row. Unsupported extra report
claims go in `criticalErrors`; important missing evidence goes in
`additionalCriticalOmissions`. Each supported claim needs its actual source,
page/section and rationale. Each covered requirement needs supported claim IDs.
Each next action needs a reason grounded in the saved gap or evidence. Claim
`critical` defaults true; mark false only with a rationale that the assertion is
immaterial. This is a reviewer attestation, not authenticated identity checking.
An assistant must not fill this form and claim to be a human.

## Measurements and fail-closed decisions

All rates include numerator and denominator. Empty claim sets have no support
rate and cannot pass. Uncertain claims remain in the denominator; uncertain
counterevidence counts as omitted. Repeated round assertions remain visible,
but cannot manufacture new reference/requirement coverage.

- **Support rate:** supported round claims / all round claims; threshold ≥ 0.90.
- **Requirement coverage:** covered fixed requirements / all fixed requirements;
  threshold 1.00.
- **Counterevidence omission:** omitted or uncertain required counterevidence /
  required counterevidence; threshold 0.00.
- **Reference read coverage:** observed exact references or explicitly justified
  equivalents / registered references; threshold 1.00.
- **Citation integrity and grounded next actions:** reported separately. Any
  integrity error or ungrounded/uncertain next action blocks acceptance.
- **Material-error veto:** any unsupported/uncertain critical claim or recorded
  critical error/omission blocks acceptance, even at 90% aggregate support.

These are pre-registered engineering thresholds for two bounded cases, not
validated estimates of general scientific performance. The exact-quote check
only verifies citation location; the human decides entailment, stance, scope,
version equivalence and scientific adequacy. Missing/duplicate verdicts, wrong
packet digests, unseen originals, self-grading and fixture/failed runs cannot
qualify. Score-time original hashes are checked again.

Wall duration and Host request/App-call counts are measured. Saved Harness
`assistant/message` and `compaction/response` usage receipts supply token
subtotals. Totals remain null unless receipt coverage matches all reported model
attempts; failed calls may lack usage. ACP context occupancy is not billed tokens.
Provider-reported cost is the latest cumulative session snapshot, never a sum of
snapshots. Unreported cost stays null; no fabricated zero or guessed price is
presented as billed cost. Keep provider invoices separate if reconciling billing.

## Verification in the cloud workspace

Local verification used no user computer, model credential, live provider or
paid inference. Publication does not claim a release or issue closure.

Passed:

```sh
python -m unittest discover -s tests/runtime -p 'test_research_quality.py' -v
PYTHONPATH=apps/paper-agent/backend python -m unittest discover \
  -s apps/paper-agent/test -p 'test_*program*.py' -v
node --test tests/runtime/research-quality/*.test.mjs
node --check tests/runtime/paper-program-live.mjs
python -m py_compile tests/runtime/research_quality.py \
  tests/runtime/paper-program-quality.py tests/runtime/paper-program-live-backend.py
```

Nine new tests cover the scoring table, omitted/uncertain counterevidence,
material false claims at 90% support, metadata/unread/wrong-version coverage,
partial token usage/compaction, cumulative cost, and a three-round **real Store**
export with synthetic originals and production-shaped assistant events. That
export test detects changed original bytes and proves that the collector does
not mistake a last-round mutation response for the complete history. The existing 24 program tests also pass. Three Node tests use explicit signals
to hold back terminal accounting and artifact delivery, cover failed/cancelled
terminal states, and abort unfinished handoffs at the deadline. They verify the
waiter's behavior without a real provider or a timed sleep hoping a worker has
finished.
Independent assistant review found three defects before correction: wrong ACP
message-event extraction, missing material-error veto, and held-out paper names
in the model-visible scope. Regression tests/inputs now cover those corrections.

Still unverified: the modified live runner through actual Host/Harness/provider,
real scientific answers, actual model spend, independent human grading, Desktop
and other platforms, and repository-wide build/check suites. The offline tests
prove evaluation mechanics, not model quality. #143 remains open.
