---
name: paper-review
description: Review a scientific manuscript against its evidence. Use when the user asks for a critique, citation-support audit, numerical consistency check or PDF review.
---

# Review a manuscript

Review the requested scope without editing by default. Use the current manuscript,
actual source evidence and available build artifacts. A review is a set of
located findings, not a predicted acceptance probability.

## Bind the review scope

Identify the source revision, evidence revisions and PDF build when relevant.
Read the [shared evidence contract](../paper-write/references/evidence-contract.md) before
recording findings or check outcomes. Use the appropriate part of
[paper types](../paper-write/references/paper-types.md) for a technical review. Check only
current authoritative venue rules when compliance was requested.

Inspect prior findings for reuse, but reopen their sources when inputs changed.
Record whether the review is a self-review, another authorized reviewer or a
human review. A different prompt or model alone does not prove independence.
Use additional reviewers only when the current task authorizes them and the host
supports delegation; otherwise finish a bounded review with the available tools.

## Examine the requested dimensions

- Argument: contribution, actual scope, assumptions, alternative explanations and
  whether the results answer the research question.
- Evidence: inspect material claim-to-source relations, including contradictory
  passages and evidence limited to an abstract or a small study population.
- Results: trace material numbers to source cells or raw artifacts; recompute
  relevant comparisons, retaining units, denominators, failed cases and uncertainty.
- Citations: distinguish identity/metadata checks from support for the citing claim.
  Unavailable sources remain unverified rather than automatically false.
- Presentation: assess structure, terminology and readability without replacing
  the author's technical content or increasing claim strength.
- Rendered layout: inspect the actual PDF pages or images when requested and
  available. Source/caption review does not establish a visual figure review.

Choose the relevant dimensions; a wording review need not run every scientific
or submission check. For compiled layout, use the build workflow's actual outputs.

## Make findings actionable

Each material finding needs a source location or PDF page tied to its build,
the affected assertion, observed evidence, why it matters and a feasible correction.
Group duplicate findings. Prioritize invalid results or unsupported central claims
before presentation issues. Distinguish a source contradiction, a missing check and
an optional editorial preference.

Use deterministic checks for their declared scope and label semantic assessments
as review judgments. Do not infer semantic validity from matching hashes, known
source IDs, successful compilation or a checker's exit code alone.

## Deliver and resume

Return prioritized findings, reviewed scope, actual checks, unresolved gaps and
the next useful revision. If no material issue was found, identify the scope that
supports that statement. Do not imply that unseen sources or pages were reviewed.

When asked to apply fixes, return the affected findings to the writing/build stage
in the same task. New experimental evidence requires its existing execution owner.
An unavailable reviewer, failed build or pending author decision stays explicit;
do not repeat the same loop until a model score improves.

## Runtime availability

The headless catalog loads this entrypoint only. Supporting references require
an authorized file reader within the selected skills root. If unavailable, work
within this entrypoint and disclose the unread guidance; do not guess tool commands.
