# Manuscript evidence contract

This is a proposed record convention. It is not an implemented Pero API, a
scientific acceptance policy or an execution authorization. Apply only the records
needed by the task; a one-sentence copy edit does not require a research database.

## One owner for each fact

Source libraries own source identity and delivered passages. Experiment owners
own attempts, raw outputs and checks. A manuscript references those records and
owns its text, claims and revisions. The build owner records actual process effects.
Host owns sessions, permissions, process lifecycle and cancellation.

Use existing IDs when real records are available. A filesystem-only input uses
an identified file revision and locator. Never fill an unavailable App ID with a
locally invented equivalent, or label a model assertion as a tool receipt.

## Minimum useful concepts

| Concept | Carries | Invariant |
| --- | --- | --- |
| ManuscriptRevision | Entry source, content/asset manifest, optional parent revision, evidence references | It identifies the actual candidate text and build inputs. |
| EvidenceRef | Existing observation/attempt reference, or local file identity and exact locator | A summary is not a replacement for its underlying source. |
| ManuscriptClaim | Statement, manuscript location, evidence refs, scope and support assessment | Support applies to this wording and these evidence versions. |
| BuildAttempt | Source manifest, command, environment, process outcome, diagnostics, output refs | A PDF belongs to the inputs that actually produced it. |
| ReviewFinding | Candidate/build identity, text/page location, evidence, severity, correction | Changed inputs cannot inherit a current review without reassessment. |

These concepts would become immutable domain values in an implementation. Parse
external input once at its boundary; avoid parallel copies of their invariants in
handlers, MCP adapters and tests. Pass IDs/time as values rather than reading them
inside pure transitions.

## Claims and references

Bind material empirical, methodological, novelty and literature assertions. Ordinary
connective prose needs no artificial claim ID. Keep assumptions and proposals named
as such; they do not count as observed results.

For each material claim retain:

- Exact statement and source-file section/label/range in the manuscript revision.
- Supporting and conflicting evidence refs, version and inspected scope.
- Population, comparison, method conditions and uncertainty that limit its meaning.
- Support judgment: supported, partial, unsupported, conflicting or not reviewed.
- How that judgment was obtained: model review, accountable human or a named
  deterministic check with its actual scope. Record identity only when known.

A recorded source read proves what was delivered. It does not by itself prove the
claim is supported. Bibliographic identity, metadata, semantic support and numerical
traceability are separate questions. A failed metadata lookup is not proof a work
does not exist; an exact quotation match is not proof of entailment.

## Numerical results

Point to the actual file digest and cell/JSON pointer/row selection. Reuse metric
definitions and evaluation populations from their owner. Retain units, aggregation,
coverage, failure policy, split, seeds and uncertainty when relevant. The denominator
is absent for quantities where it has no meaning, such as a structural parameter count.

A derived quantity records its formula or code revision, actual inputs and rounding.
For example, 86 completed cases out of 89 imply approximately 96.63 percent, not
86 percent. This is an arithmetic illustration, not an empirical result.

Synthetic/model-generated values are labelled and cannot be promoted to completed
measurements. A result from simulation can support a simulation claim, within its
conditions; that is different from LLM-synthesized numbers or field measurements.

## Build and review identity

Freeze TeX, BibTeX, referenced figures/styles and relevant build settings for the
candidate. The execution shell records the real input manifest and output hashes.
Use ordinary revision hashes; this does not require a new journal or signing system.

If text changes after a successful build, the old PDF remains available under its
old source revision. A preview must expose that it is historical until a new build
succeeds. PDF page findings reference that build, not merely a mutable filename.

A check or review record states its actual inputs, scope, method and outcome.
Keep process failed/cancelled, a failed check, a missing tool and a semantic
uncertainty distinct. Checks are pass, fail, not run or inconclusive for a named
scope. Human acceptance is a separate optional decision, never inferred from them.

## Filesystem handoff

When no domain store exists, an authorized paper workspace can hold:

```text
paper/
  main.tex
  sections/
  references.bib
  figures/
  paper-plan.md
  claims.json
  inputs.json
  builds/<attempt>/
  reviews/<revision>/
```

Create only relevant files. Maintain actual locators rather than requiring this
layout in an existing repository. Working drafts may retain visible gaps; a
submission package must state unresolved blockers and cannot claim readiness
merely because the source compiles.
