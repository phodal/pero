# Claim and code-audit records

Use these concepts to make the comparison inspectable. Omit inapplicable fields
with a reason; do not invent missing values to populate a schema. These are
portable record conventions, not a new serialized Pero API or generic backend.

## ResearchClaim

- **source**: paper version and actual passage/table/formula locator. Preserve
  observed App IDs when available; an externally read HTML passage can have its
  own URL/section locator without pretending to be a frozen PDF annotation.
- **statement / reported value**: the precise subclaim and conditions. Distinguish
  a paper's number from a derived expectation and a newly measured result.
- **metric**: quantity, `metric_definition`, `measurement_grain`, units/scale,
  reduction/weighting, population/split and boundary/exclusion conventions.
  For rates, record integer counts and the denominator. For other quantities,
  identify the relevant dimensions, parameter scope or algebraic objects instead.
- **open questions**: ambiguous source definitions and the evidence required to
  resolve them.

## CodeAudit

For each judgment, retain:

- **claim**: the compared ResearchClaim and its paper locator.
- **implementation**: repository, resolved commit (not an annotated tag-object
  ID), source blob identity, files/lines or symbols/call sites, and whether this
  is author code or a later implementation.
- **comparison**: the separate paper/code definitions and observed evidence for
  agreement, disagreement, missing implementation or insufficient evidence.
- **gaps**: uncertain paper/commit correspondence, missing assets and what would
  resolve them. A matching function name or nearby value is not a matching method.

## Diagnostic recomputation

Retain input identity and provenance (original observations or synthetic probe),
the compared formulas, command/checker version, actual values and counts/scope,
comparison policy, result and limitations. This record supports the audited
subclaim; it does not assert that a published experiment was rerun.

## Reproduction handoff

If execution or a reusable result package is requested, carry these records into
the [reproduction records](../../paper-reproduction/references/reproduction-protocol.md).
That reference owns ReproductionSpec, ExecutionBinding, VerificationReport and
handoff requirements. An audit alone creates none of those runtime bindings.
