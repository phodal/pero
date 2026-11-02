# Source-first paper study campaign (#75)

Run one fixed case after freezing source and rebuilding both executables.
Real inference requires separate authorization after scripted actual-process cases pass. The campaign uses the
actual Go ACP → Host → App Use/MCP → Paper/Data path. It does not introduce a
Python LLM runtime, arbitrary script execution, LaTeX compilation or experiments.

The campaign tracks attempts separately from earlier validation campaigns.
The runner requires a new `ProviderEvaluationPlan` for each real campaign. This
editable JSON binds configuration and accounting; it is **not** proof of human
consent, permission to send data to an endpoint, or permission to reuse an old
credential. Obtain the user's specific endpoint/model, input and budget approval
outside the runner first. Missing fields fail closed. Explicit `null` limits mean
no additional limit only when that is what the user actually approved. No default
DeepSeek endpoint/model or historical unlimited authorization is retained.
Reservations, failed/aborted attempts, usage, cancellation and existing guards are
recorded. Old v1 campaign ledgers are rejected, not migrated as authorization.

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
list/read/compare/image. The product now persists server-issued source observations and same-bundle source
reports (see [source reports](../../../docs/fitness/paper-source-reports.md)).
This campaign assessor still checks source reads/indexes and PDF report persistence;
it does not assert source-report creation/reopening. Do not infer that coverage
from an automated campaign pass.

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

## Configurable real-run preparation (not authorization)

The four closure cases are `standard`, `nonstandard-decline`, `ambiguity`, and
`injection`. All inspect without saving a bundle in turn one. `standard` then
explicitly confirms only the offered source/PDF; the other three receive a user
decline and must not attempt commit/start (even a rejected attempt fails the
assessment). Ambiguity/injection use the existing authored nonstandard page,
which contains unresolved attachments and untrusted instructions. Their distinct
prompts/rubrics are not proof that a model handled them until actual inference is
separately approved and assessed. These are consent-decline checks, not claims of
cancelling an already-running acquisition; domain/HTTP tests cover the latter.

A real invocation adds an absolute plan path after the Go executable. The plan
has exactly these fields:

- `schema`: `paper-study-plan.v1`; `confirmed`: explicit `true` (operator declaration only).
- `authorizationReference`: new reference to the specific external user decision;
  `sourceCommit`: exact committed 40-character SHA.
- `endpoint`: approved credential-free HTTPS URL; `model`: exact approved ID.
- `scenes`: explicit nonempty list of approved case names.
- `limits`: all of `maxSessions`, `maxRequests`, `maxTokens` must be present as
  positive integers or explicit `null`; `perTurnWallTimeMs` is a positive integer.

No example selects a provider or presumes approval. `maxRequests` and `maxTokens`
are passed to the existing Go CLI flags (explicit null maps to its 0/unlimited
semantics); maxSessions is enforced by the existing campaign reservation owner.
The HTTP retry setting remains zero. No fixed number of tokens, turns or sessions
is a scientific acceptance requirement. A changed plan cannot reuse its previous
ledger. The credential still arrives only through the non-echo stdin pipe;
never put it in the plan, argv or source. Real-run session output goes to a private
temporary directory (or the explicitly supplied private root), not the repository's
artifact directory. Only separately reviewed sanitized summaries may be published.

The plan/ledger and scripted-scenario tests do not start a real provider. Freeze
and build actual executables before running the separate actual-process fixture
campaign. Passing contract tests is not that process campaign and is not criteria
8–9 acceptance.

## Explicit Skill / text-only corrective composition

The four closure cases now explicitly invoke `/research-resource-import` in their
first direct user prompt, using the existing Go Skill hook. Scripted cases do not
manufacture `skill` list/read calls: the first provider request must contain the
exact installed Skill body injected by Go. The assessor separately requires a
persisted `user/message` with `source.kind=skill-invocation`, the expected name
and launch-time digest. `skillListed` and `digestValidatedRead` remain independent
natural-tool observations (normally false for this explicit path); ordinary user
wrapper text or a wrong digest cannot substitute for that source record.

For a text-only campaign the disposable installed Paper manifest exposes only
`list/read/compare` for `research-source-read`. The same declared schema enforces
alias and generic `app_write` validation before backend access; it does not just
hide a tool description. Image-enabled fixture cases keep the original image
operation. The Go provider's hard image-input guard is unchanged. This is a
campaign composition restriction, not a claim that every product Agent dynamically
projects its tools from model capabilities. It does not turn a declined image
into a successful visual reading or silently drop typed image content.

This correction follows a failed standard real-provider attempt: no Skill read
was observed, a source-image result was delivered to the text-only session, and
the next provider request was refused before a PDF report was produced. Its
failure remains failure. An explicit-Skill/text-only rerun is a changed evaluation
condition, not proof of natural plain-link routing or an unchanged-prompt model
improvement. Exact source/table/PDF/report assertions remain required.

Offline red tests first demonstrated the old image operation reaching the backend
and being accepted by the text-only declaration. Green coverage now checks both
alias/generic rejection with no backend fetch, enabled-image preservation,
explicit persisted source versus wrong digest/ordinary-user text, and the first
provider body versus only a slash token/catalogue. Thirteen Node tests including
cleanup pass. Actual-process validation must follow source freezing; no new
provider call was made by these regressions.
Existing Go `TestExplicit*` Skill tests and
`TestImageInputRejectsUnsafeMediaBeforeHTTP` also passed offline; the provider hard
guard was not modified. Independent review verified the persisted event fields,
exact injected-body formatting and both MCP rejection routes.

## Current-source synthetic permission controller (2026-11-02)

The four closure fixtures use `--approval ask` and an owned test-only ACP
controller. It matches each permission to the current session, pending tool-call
ID, exact scripted Paper tool/arguments and current prompt phase, once. A maximum
of 128 decisions is accepted per case. Turn one permits only inspection and
candidate context/proposal; decline turn permits none. Standard turn two permits
only the authored source/PDF acquisition, reading and report trajectory after
checking the observed original URLs against the exact approved arXiv version.
No Data downloads, generic app_write, image, shell, installation or execution
receive grants. Decisions and unexpected requests are retained in result.json.
This is a synthetic policy, not human approval or evidence of model judgment.

Current source `08f248cc` plus freshly rebuilt Host/Go initially failed all four
cases: master now honors explicit MCP `readOnlyHint:false`, while the old fixture
used `--approval never`. Inspection was correctly denied; the scripted provider
then mistook the denial text for JSON. These failures do not invalidate or update
historical real-provider evidence; they expose a stale test authorization setup.
The fixture now reports a terminal explicit denial instead of opaque HTTP 500.

Only these four synthetic cases have the bounded controller. Other historical
fixture modes stop explicitly until their own scope is reviewed. Real campaign
mode stops before reading credentials or starting a provider: this runner has no
human ACP permission responder. Synthetic grants must never be reused for real
inference, public networking or a different case.

Historical real-provider proof remains pinned to its recorded source and binary
hashes; these current scripted passes cannot establish current real-provider
end-to-end success. For real inference, use the existing product Host/ACP
permission UI to review individual requests. A headless campaign needs an explicit
human responder before it can proceed; a plan's `confirmed` flag is not a human
permission response.
