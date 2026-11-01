# Claim, reproduction plan and checker records

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
- **implementation**: repository, resolved commit (not an annotated tag-object ID),
  source blob identity, files/call sites and whether
  it is author code or a third-party implementation. Record its definition
  separately when it differs from the paper.
- **open questions**: version correspondence, missing assets, ambiguous definitions
  and the evidence required to resolve them.

## ReproductionSpec (only when a computation is proposed)

Freeze the particular check, input provenance and implementation identities,
environment, method/command, resource limit, output layout and comparison rule.
For experiments also freeze required dataset split, preprocessing, checkpoint,
seed/repetitions and exclusions. Exact source availability does not supply missing
weights, original trajectories or private data. Record adaptations explicitly.
The PC-Gym Python ReproductionSpec implements only its fixed case.

## Independent checker

Consume primitive outputs whose meaning and dimensions have been established.
Validate once at the input boundary, then calculate with typed domain values.
Keep the metric definition separate from the candidate implementation. A separately
launched process can make recomputation inspectable; it is not automatically
protected from the candidate or an independent scientific evaluation.

Record input identity, counts/scope, computed value, reference, difference and
comparison policy. Use exact equality where justified. A tolerance or confidence
rule requires a rationale and must not be chosen to make observed results pass.
Undefined metrics, missing observations or incompatible conditions are explicit
outcomes rather than zeros or discarded records.

Keep four judgments separate: what the source supports; whether execution
completed; whether the scoped check agrees; whether the published scientific
claim has enough evidence for acceptance. A source-only algebraic check can
support a narrow identity while benchmark reproduction stays unverified.
