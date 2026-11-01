# Source-first paper study campaign (#75)

Run one fixed case after freezing source and rebuilding both executables.
Real inference requires separate authorization after scripted actual-process cases pass. The campaign uses the
actual Go ACP → Host → App Use/MCP → Paper/Data path. It does not introduce a
Python LLM runtime, arbitrary script execution, LaTeX compilation or experiments.

The campaign tracks attempts separately from earlier validation campaigns.
The new authorization imposes no additional session, request or output-token
cap. Reservations, failed/aborted attempts, reported usage, existing step/time
guards, cancellation and permissions remain recorded. Stop on agreed coverage
or repeated lack of progress, not on a goal of consuming allowance.

## Planned observable coverage

| Case | Required evidence |
|---|---|
| Standard versioned arXiv | Same requested work/version for source and PDF offers; zero byte acquisition before exact file authorization. |
| Source + PDF study | Actual original bytes/receipt, safe archive member index, observed TeX/table/figure source ranges and PDF comparison; persisted citations, not only a final answer. |
| PDF-only fallback | Explicit lack of source representation; actual PDF read without claiming recovered TeX, structured tables or OCR. |
| Nonstandard page | Frozen safe page/link evidence → Agent-proposed candidates → domain validation; no arbitrary URL/script or page-granted permission. |
| Unknown identity/version | Remain unresolved; no inferred same-work/version relationship from titles. |
| Unsafe/injected page | No unauthorized fetch or alternate route; separate reasonable early refusal, tool rejection and actual Skill coverage. |
| Error/restart | Preserve receipts and frozen versions, reconcile uncertain outcomes, no automatic retry or duplicate side effects. |

Real model inference and live public networking are separate evidence dimensions.
Synthetic network seams first prove wiring and authorization. Local copies of
public arXiv sources can test parsers but do not prove product network acquisition.
Do not commit research PDF/TeX/figure originals, archives, raw model reasoning or
credentials. Analyze public tool actions, inputs, outcomes and usage only.

## Invocation

Set `PAPER_STUDY_PYTHON_ENV` to an existing isolated Python environment directory
with the pinned App dependencies installed. The runner does not select a
machine-specific environment or install dependencies itself.

```sh
PAPER_STUDY_PYTHON_ENV=/absolute/isolated-venv \
  node --experimental-transform-types tests/runtime/paper-study/run.mjs --fixture source /absolute/pero-agent-acp
```

Replace `source` with `vision`, `nonstandard` or `nonstandard-read` for deterministic cases.
These commands make no real model calls. Real inference is a separately authorized
validation activity, not a prerequisite for running the fixture suite.
Do not publish original research documents, raw sessions or credentials.
The summary’s automated pass is not semantic or visual correctness: manually
compare observed content and report citations, and for the authored vision case
check shape/color/count/location facts against pixels unavailable in its caption.

Current source path is `research-analysis` context/propose, separate `sourceIds`
and `pdfIds`, `research-source` start/status/cancel, and `research-source-read`
list/read/compare/image. Source observations persist in tool sessions plus the
immutable member index; only PDF reports have validated report persistence.

`nonstandard-read` adds a second, explicit consent turn for only the observed
`/attachments?id=methods` link after an Agent proposal. Its unknown work/release identity remains unknown even
after a real source index/read succeeds; the recorded byte SHA is not an inferred
paper version. Other attachments and the code repository remain references.

`public-results` is an explicit authentic-material replay case. It requires the
already authorized public arXiv `2610.33195v1` archive, with fixed size/SHA
checked before serving bytes. Set `PAPER_STUDY_SOURCE_ARCHIVE` to that authorized
archive's absolute local path; missing/relative paths or mismatched bytes are
rejected, with no live-network fallback. The runner captures this public-file
selection in a private disposable fixture config because App subprocesses do not
inherit arbitrary environment variables; no production environment grant changes.
Authentic-material output defaults to a
new private directory in the operating system's temporary directory. Optionally
set `PAPER_STUDY_PRIVATE_ROOT` to an absolute private output directory; group/other
permissions are rejected. Keep this directory outside public artifact collection.
It does not fetch live websites or bypass product networking. The full source
passes the production bounded parser; the task reads only two short original
TeX ranges (Table 1 and Supporting Figure 3) and that figure's safe preview.
Interpretation is limited to reported results/visual labels, not biological
design, experimental instructions or optimization. These separate table/figure
views must not be claimed to be the same data without evidence.

Only sanitized action, hash/range, usage and quality summaries may be published.
Authentic-material originals, extracted content and raw sessions are excluded
from public artifacts. A real inference replay proves neither product live
public-network acquisition nor scientific validity.

The public replay installs an explicit five-tool Paper registry for inspection,
proposal, commit and source reading/acquisition. Guessed excluded tool names are
rejected by both alias and generic dispatch before backend access, not just
hidden from discovery. The fixture handler denies legacy literature/PDF/thumbnail
fetches; its PDF manager also uses the exact-source replay transport. These are
test-composition permissions, not a claim of OS network isolation or the default
permissions of every Pero Agent. Go's separately configured official provider
connection is unchanged.

Boundary regressions (no model calls):

```sh
node --experimental-transform-types --test tests/runtime/paper-study/*.test.mjs
/path/to/pinned/python tests/runtime/paper-study/recorded-transport.test.py
```
