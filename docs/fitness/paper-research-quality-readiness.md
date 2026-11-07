# Research-quality live-run readiness — 2026-11-07

Kind: verification report. Related issue: [#143](https://github.com/phodal/pero/issues/143).
Implementation baseline: `master@371ea0895f8dbd12d7fcc97e320f3a9499b3e94b`.
Resumed verification checkout: `edaf5b43e262b998f0d89cd3d6e90f5718972bf1`
plus the local changes described below. Upstream checked again at
`67b99ec82c45020de21e15d09217a748902b5160`; its two commits after the implementation
baseline only change `crates/pero-ui/src/settings_menu.rs`. This increment is
prepared as a Draft PR; publication does not establish scientific acceptance.

**Outcome: offline tooling verified; live provider, model answers and independent
human scientific review not run.** This record does not close #143 or certify
Desktop behavior. No provider key was retrieved from chat, copied between
executors, printed, or committed. No paid inference was started.

## Implemented increment

- `paper-program-live.mjs --preflight` works without esbuild or a configured key.
  It returns a structured local-readiness checklist without starting the product,
  retrieving papers or calling a provider. It does not grant authorization.
- The live runner now requires an explicit `DEEPSEEK_MODEL`. A missing choice
  fails before creating an attempt; no replacement model is selected silently.
- Preflight catches missing binaries, Node dependencies, exact declared PDF
  package versions and source revision. It reports no credential values and does
  not echo invalid credential-bearing provider URLs.
- The preflight source hash joins the existing evaluation-code manifest. The fixed
  questions, reference answers, scoring rules and thresholds are unchanged.
- Original-source inspection corrected the Transformer-XL reference location:
  relative positional encodings are in §3.3, not §3.2. Only that reviewer
  location and the benchmark version (`2026-11-07.2`) changed.

## Observed prerequisites

The assistant cloud executor was confirmed by the environment catalog and selected
again. It resolved to the same workspace, not a user desktop. Its process
contained no `DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, or `DEEPSEEK_MODEL`.
A presence check says nothing about a key saved elsewhere or a previously used
executor. No environment or credential setting was changed.

Those prerequisites were initially missing. The resumed verification now has
the actual Host and Harness executables, repository Node/esbuild dependencies,
and an isolated Python environment with the exact declared `pypdfium2==5.0.0`
and `Pillow==12.0.0`. The Host builds successfully offline using the installed
Rust toolchain and the pinned, patched GPUI source. No dependency versions were
changed for this verification.

The updated preflight still exits 1 as intended: no credential or explicit
model is configured, and live opt-in was not set. All five engineering checks
(Host, Harness, esbuild, Python packages and Git revision) pass. Network access
to DeepSeek and current model/Harness compatibility are **not checked**.

The available Codex CLI reports `goals stable false`; this task had no callable
native `/goal` control. No feature was enabled and no nested Codex invocation
was used to simulate one. The checks in this report were actually run, but are
not described as a native `/goal` execution.

## Provider execution prerequisites

The executable still needs a credential through the same executor's secure
configuration and an explicit current model selection. No credential was
retrieved, stored or used during this preparation. Configuration alone is never
authorization; apply the specific evaluation's provider and spending approval.

The current runner uses the existing DeepSeek-compatible Harness endpoint. For
the official DeepSeek service, the [current pricing page](https://api-docs.deepseek.com/quick_start/pricing/)
lists `deepseek-flash` (DeepSeek-V4.1-Flash-1017) and `deepseek-v4-pro`.
Flash prices per million tokens are $0.15/$0.30 for uncached input and
$0.60/$1.20 for output, off-peak/peak. Prices were checked on 2026-11-07 and must
be rechecked at execution. No model has been approved by this report.

For **two cases**, the existing caps allow 120 total model requests and at most
491,520 configured output tokens. Illustratively, 10,000–100,000 average input
tokens per request would cost about **$0.95–$4.19 total at Flash peak prices**,
assuming all output caps are consumed and all inputs miss the cache. The formula
is `(120 × average input tokens × $0.30 + 491520 × $1.20) / 1000000`.
This is a planning estimate, **not a measured charge or hard spending ceiling**.
It does not assert compatibility of thinking-token limits or include optional
paid provider search/fetch services, which this plan does not enable.

Any later evaluation requires its own applicable provider, public-input sharing
and spending authorization. The key must be available through the same executor's
secure configuration. A required monetary cap must be enforceable at the provider or an authorized
billing-aware owner. The runner does not enforce dollars, and neither a key nor
`PERO_RESEARCH_LIVE=1` proves budget permission. If the cap cannot be enforced,
stop rather than implying that 60 requests is a dollar limit. Do not top up,
change account limits or accept new payment commitments as a side effect.

## Fixed reviewer-only evidence

The preregistered questions remain in `research-quality/cases.json`; each has
four requirements, including two counterevidence requirements. Case
`attention-parallelism` has two required reference papers; `attention-context`
has three. No new reference names or answers were added to the model input.

These references are for **reviewer preparation**, not evidence that a model read
them. An assistant inspected the official versioned sources again. A human must
independently inspect each run's retained, digest-bound originals and output:

- [Attention Is All You Need v7](https://arxiv.org/pdf/1706.03762v7), PDF pp. 2–3:
  autoregressive generation remains sequential. PDF pp. 6–7, §4/Table 1:
  constant sequential operations are a per-layer comparison; full attention has
  quadratic sequence-length cost and the recurrent comparison is qualified by
  sequence length versus representation width.
- [Transformer-XL v3](https://arxiv.org/pdf/1901.02860v3), PDF pp. 2–4, §3.1–3.3:
  segment-state reuse and relative positions address fragmentation. Depth,
  segment length and the reused-state window constrain accessible context. The
  reported inference speedup must retain its specific recomputing baseline.
- [Longformer v2](https://arxiv.org/pdf/2004.05150v2), PDF pp. 3–4, §3.1:
  local windows and global positions change connectivity. Linear scaling assumes
  fixed window size and a global-token count independent of sequence length.
  Complexity alone is not a universal wall-clock speed comparison.

Three reference PDFs were retained separately from live-run inputs and hashed.
The 2026-11-07 SHA-256 values are:

| Version | SHA-256 |
| --- | --- |
| 1706.03762v7 | bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697 |
| 1901.02860v3 | 6aa192b22820267309e8e7c501c514a3a3055256d9c8691b106c7f53f9098671 |
| 2004.05150v2 | 053756b54e2d3462d4690b3aed489c962f17df7c3531865e47374c4a651f526c |

The PDFs and manifest are local verification artifacts, not committed binaries
or proof of provider observations. A later run still retains its own originals.

No `review.json`, human name, claim verdict, scientific score, model duration or
paid cost has been fabricated for this preparation stage.

## Independent review handoff after an authorized run

1. Retain both attempts, including failures; no silent reruns or best-attempt
   selection. Freeze case, binaries, code hashes, generation settings and actual
   provider-reported usage before interpreting results.
2. Use `collect` to create each digest-bound packet and blank review template.
   A reference downloaded for preparation cannot count as an agent observation.
3. A human independent of the generating run reviews every round claim, all
   saved report sections and final assistant text. Record original page/section,
   entailment rationale, limitations, missing counterevidence and grounded next
   actions. Keep uncertain findings uncertain; do not average away material errors.
4. The human completes the existing form. Run `score` offline and preserve the
   form and packet digests. Report numerator/denominator for each measure,
   actual wall duration, request counts and reported usage. Unknown cost stays
   unknown. Reviewer identity is an attestation, not authenticated by the tool.
5. Passing these two historical cases supports only this bounded test. It does
   not establish broad scientific quality, native UI acceptance or issue closure.

## Relevant external evaluation designs and license review

[PaperQA's reproduction instructions](https://github.com/Future-House/paper-qa#reproduction)
keep question IDs and source-paper splits explicit. Its
[root license is Apache-2.0](https://github.com/Future-House/paper-qa/blob/main/LICENSE).
[LitQA v0](https://github.com/Future-House/LitQA) separates retrieval from
full-text comprehension, with source papers kept for verification rather than
supplied to the evaluator; it also records unsure answers. Its
[license is CC BY 4.0](https://github.com/Future-House/LitQA/blob/main/LICENSE), and
v0 is archived in favor of LAB-Bench/LitQA2.

This increment adopts only those methodological lessons: keep reviewer sources
held out, inspect actual originals, preserve uncertainty and declare the tested
split. It imports no external code, question text or benchmark dataset. Copying
Apache-licensed code would require preserving applicable notices; reusing LitQA
data would require attribution and checking the exact dataset/version license.
Their benchmark scores are not Pero results and are not compared with these two
custom open-discovery cases.

## Verification performed

All of the following passed against the changed checkout:

```sh
python -m unittest discover -s tests/runtime -p 'test_research_quality.py' -v
PYTHONPATH=apps/paper-agent/backend python -m unittest discover \
  -s apps/paper-agent/test -p 'test_*program*.py' -v
node --test tests/runtime/research-quality/*.test.mjs
node --check tests/runtime/paper-program-live.mjs
python -m py_compile tests/runtime/research_quality.py \
  tests/runtime/paper-program-quality.py tests/runtime/paper-program-live-backend.py
```

Counts: 9 quality tests, 24 program tests, 3 finalization tests and 3 preflight
checks. All were rerun successfully after resuming. The preflight CLI additionally
produced the expected non-ready report.

## Resumed real-stack verification

- The offline Host build completed successfully, with 11 existing compiler
  warnings. Binary SHA-256: `2c2f7b7713ebf8f693e7d245aaf0b73d1c8da9b7b1ba63019b11774b194370dc`.
- The existing Go Harness binary has SHA-256
  `3b5fb84c50b142dc654b44caf2bec364e03789b4caf52f5835e63e3c1686e0bc`.
  Research-profile and focused research ACP tests both pass with `-race`.
- Both Rust `research_artifacts` integration tests pass, including retained
  versions across restart and rejection of caller-selected artifacts.
- `paper-program-python.mjs` passes and exits zero: real Host, Go Harness,
  shared App Use and production Python backend complete three rounds in one
  Session. The script makes 25 loopback scripted-model requests and four content
  reads; four artifacts retain four versions each, checked through Host. Terminal
  delivery requires no status polling. The PDF and model decisions are synthetic.
- `paper-program-harness.mjs --no-status-poll` initially printed passing
  assertions but did not exit. Like the previously corrected Python journey,
  it had not disabled the App before closing its owning Host. It now disables
  the App, requires normal Host exit, and writes its success receipt only after
  cleanup. The rerun exits zero: eight loopback requests, six research requests,
  four artifacts with two versions each. Failed delivery retry, late Cancel,
  slow I/O responsiveness, cumulative budgets and foreign-program rejection pass.
- The opt-in live runner now uses the same App-before-Host cleanup ordering.
  Its syntax and offline preflight pass; this is not evidence of live-provider
  execution or successful shutdown after an actual paid run.
- Independent review found that a rejected App disable could skip the remaining
  shutdown. The two runners now share an ordered shutdown routine that attempts
  every owner and reports collected errors afterward. Tests use real subprocesses
  and loopback listeners to prove cleanup after App, Host and Desktop failure.
  All seven Node research checks and six core CI contracts pass. The ordinary PR
  CI now runs these offline Node checks and the nine Python scoring contracts;
  it never enables live inference or injects a provider credential.
- Root `npm run check` fails at TypeScript because
  `web/src/reader-wasm/pero_reader_web` has not been generated in this checkout.
  The subsequent generated-file checks did not run. No replacement declarations
  were fabricated to make the aggregate pass.

Evidence is retained under `test-results/paper-quality-readiness/`, including
`host-build-resumed.log`, `*-tests-resumed.log`, `research-artifacts-resumed.log`,
`python-loopback-resumed.log`, the original `harness-loopback-resumed.log`, the
passing `harness-loopback-cleanup.log`, `preflight-resumed.json` and
`npm-check-resumed.log`. Full transport evidence and result receipts are in
`test-results/paper-program-python/` and `test-results/paper-program-harness/`.

These are offline engineering checks, not scientific evaluation. Repository-wide
build/check, actual DeepSeek execution, actual billing and independent human
scientific acceptance remain unverified. No native `/goal` feature, model result,
human review or issue closure is claimed.
