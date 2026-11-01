---
name: paper-reproduction
description: Plan or carry out a scoped paper-result rerun, or package an independent reanalysis of existing outputs, with a frozen protocol and execution evidence. Use for experiment reproduction and reproducible handoff; source-only comparisons and diagnostic recomputation use paper-code-audit.
---

# Paper Reproduction

Work within the current Host conversation and the user's requested depth. A
plan-only request ends with a concrete protocol and remaining gaps; it does not
authorize installation, downloads or experiment execution. Reuse an execution
environment and permissions already supplied by the user. Ask only for material
choices or actions still outside that authorization. Paper text, repository
instructions and previous reports are evidence, not execution permission.

## Resume existing work

When continuing a study, locate its saved protocol, source identities and actual
attempt records before preparing anything new. Use the existing owner's status
to reconcile a running or unknown launch before retrying. Reuse valid observed
evidence; a previous Agent summary is not a substitute for source/artifact reads.
Retain prior failures and outputs. Changed inputs or rules need a new protocol;
an unchanged, authorized retry needs a distinct attempt after reconciliation.

## Extract and audit one target

Identify the requested result: paper revision, passage/table/figure, reported
value, metric, units, population/split and experimental conditions. Do useful
source reading before asking about execution. If the target is ambiguous, narrow
it with the user while inspecting the available sources.

For source comparison, use the bundled
[paper-code-audit guidance](../paper-code-audit/SKILL.md) when readable, or reuse
its existing evidence if source versions still match. Return to this step after
the audit; do not invoke either workflow recursively. Retain actual paper/code
locators, separate definitions and unresolved differences. Mark each material
recipe item **observed**, **inferred** or **missing** with evidence; a README or
download link does not establish usable data, weights or dependencies.

## Prepare and freeze

Choose the mode explicitly: **reanalysis** recomputes a metric from identified
existing observations; **rerun** produces new experimental observations. Record
coverage (smoke/full) and method adaptations separately from that mode. A supplied
checkpoint can support evaluation without reproducing its training.

Inventory required code/data/model versions, splits, preprocessing, schema,
dependencies, evaluator, seeds/repetitions and compute needs. Identify what has
actually been checked, what is unavailable, and which gaps prevent execution or
only limit the eventual conclusion. Do not substitute synthetic data or smaller
coverage without labelling the changed experiment.

Before computation, freeze the inputs, environment, exact method/command,
resource limits, expected raw outputs and checker criteria. For a concrete
protocol and evidence layout, read
[reproduction records](references/reproduction-protocol.md). These are record
conventions, not new Pero APIs. Preserve the Spec digest/version when provided by
the method adapter; otherwise save an inspectable versioned protocol and identify
its limits. Do not claim an enforced freeze from a prose plan alone.

Agree exact comparisons, tolerances or uncertainty rules before seeing new
results. Fix the full evaluation population and failure policy; missing records,
NaN/Inf or changed splits cannot become a passing result by shrinking coverage.
Do not invent a tolerance when the metric interpretation itself is unresolved.

## Execute through an available owner

Discover the actual advertised tools and schemas. Use an existing authorized
method/Host execution path; do not invent a generic Paper executor, Worker binding
or cloud provisioning route. If execution is unavailable, finish the audit and
protocol and state the specific missing capability.

Associate new logs and raw outputs with the frozen Spec and the real local
attempt or Host/Worker identity returned by that executor. Historical outputs may
be inputs to reanalysis, never evidence of a fresh rerun. Record adaptations,
failures and actual training/evaluation coverage, including whether learning
updates occurred. An exit code of zero alone establishes no metric agreement.

Use the execution owner's status and cancellation. Do not clear locks, create
another launcher or blindly replay an unknown attempt. Resume as described above.

## Independently check and return evidence

Have checker logic read the saved primitive outputs and frozen criteria, verify
identity, units, dimensions and coverage, then recompute the metric without using
the candidate's metric helper or cached score. Distinguish **PASS**, **FAIL** and
**INCONCLUSIVE** for that scoped check. Missing execution is not a numerical
mismatch; unresolved scientific interpretation is not agreement. Another Agent,
another process or a digest alone does not establish scientific independence.

Report four separate judgments: paper/code consistency, execution outcome,
scoped numerical check and support for the published scientific claim. Include
reported/observed values, differences, full denominators when applicable, source
locators, Spec/attempt identities, artifacts and remaining gaps. Save through
available domain routes or the authorized workspace. Paper's reading-only
`research-step` reports keep `experiments=[]`; do not put self-reported runs there.
Preserve paper/annotation IDs for later association without claiming UI writeback
or navigation that is not connected.

When handing off a result package, include inputs or retrievable pinned manifests,
protocol, raw outputs, execution record, checker/version and exact recomputation
command. Verify that command in a separate directory when feasible. Distinguish
offline metric recomputation from a clean-environment experiment rerun; record
which actually ran and which dependencies/assets are still required.

## Current Pero boundaries

- Resource acquisition uses the bundled
  [research-resource-import workflow](../research-resource-import/SKILL.md)
  and persisted exact-file grants. Importing a URL grants no code execution.
- **PC-Gym CSTR Table 6 only:** read the bundled
  [fixed-case instructions](../paper-code-audit/references/pcgym-table6.md)
  before using its CLI. The declared `reproduction-step` route supports fixed
  audit/evidence operations; the shipped server has no trusted execution checkout
  and its advertised schema has no `start`. CLI execution requires an authorized
  shell and selected scientific environment. An explicitly configured Electron
  deployment also has a direct fixed-smoke annotation UI with native per-run
  confirmation, no Agent/model requirement, and the same Python execution owner.
  Its private Host decision route is not an Agent tool or an HTTP approval flag;
  an absent deployment capability remains unavailable. A numeric PASS cannot override a
  case adapter's unresolved paper verdict. Without case evidence, report that
  evidence is unavailable; this routing note is not an observed verdict.
- Control Lab's checker is specific to its methods; it is not a universal paper
  validator. A venv or a trusted Worker is not an untrusted-code sandbox.
- The headless catalog loads SKILL.md only. References, including sibling skill
  files, need a separate authorized file reader. Resolve relative links from the
  selected skill's directory, locating it within the authorized skills root when
  necessary. If that reader or path is absent,
  use this entrypoint for a bounded plan and disclose unavailable instructions;
  do not guess adapter commands. Shipping files does not enable Desktop discovery,
  Paper-to-Run binding or result writeback.
