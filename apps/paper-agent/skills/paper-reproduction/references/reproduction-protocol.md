# Reproduction protocol and evidence records

Read when preparing execution or a reproducible handoff. These records describe
scientific evidence, not a new API, scheduler or replacement execution state
machine. Use an existing method's typed Spec/checker when available. Record
inapplicable fields with a reason and unknowns explicitly.

ResearchClaim and CodeAudit belong to the
[audit records](../../paper-code-audit/references/audit-contract.md). Reuse those
records and source identities rather than copying another claim schema here.

## ReproductionSpec

Before running, capture the following in the adapter's immutable Spec or an
inspectable versioned file for an otherwise authorized method:

| Concept | Evidence to preserve |
| --- | --- |
| Target | Claim/source revision and locator, reported value, conditions, mode (reanalysis/rerun), coverage (smoke/full) and method adaptations |
| Code | Repository, resolved commit, relevant source/driver hashes, local changes and method deviations |
| Data/model | Actual files or pinned manifests/digests, split, schema, preprocessing, checkpoint and availability checks |
| Environment | Selected interpreter/runtime, dependency lock or actual inventory, relevant hardware and unresolved portability limits |
| Method | Exact command/entrypoint, parameters, seed list/repetitions, training and evaluation budget |
| Metric | Formula, units/scale, measurement grain, aggregation/weighting, registered population and exclusions |
| Criteria | Exact reference or justified tolerance/uncertainty, required coverage, invalid/missing-data handling, checker version/hash |
| Execution | Authorized owner/environment, time/compute limits, output location and required raw artifacts |

For ML targets, trace the reported result to the training recipe and evaluation
path, including defaults overridden by call sites. Distinguish inspected dataset
schema from an untested link. Published seeds or checkpoints that are absent
cannot be reconstructed by assumption. A dependency inventory describes the
observed environment; it does not prove the authors' environment was recovered.

Derive identities from the actual saved content using the method's established
serialization/digest rules. Do not guess a digest or retrofit a new serialization
onto an existing adapter. A local digest binds bytes; it does not attest who ran
them. If no enforcing adapter exists, call the saved file a versioned protocol,
not an enforced immutable runtime contract.

Changing data/split, code, metric interpretation, environment or acceptance rules
creates a new version. An authorized retry of an unchanged protocol has a new
attempt identity; first resolve any unknown previous launch. Keep failed attempts
and reasons for all changes. Never adjust the baseline or tolerance to fit a run.

## ExecutionBinding

Preserve the actual executor's Spec identity, request/attempt identity, observed
execution state, environment receipt, commands, logs and raw-artifact hashes.
Retain its status vocabulary; do not create a competing Task/Run state machine.
A local CLI attempt is not a remote Worker Run. Mark any unavailable binding
explicitly rather than manufacturing IDs or treating Agent text as a receipt.

Keep outputs from this attempt separate from pre-existing result files. Historical
data may be valid reanalysis input if labelled and identified, but does not prove
new training. A smoke run must report requested and actual coverage; rollout
collection without parameter updates does not establish learning.

## VerificationReport

The checker reads the saved raw data independently of the candidate's metric
helper. Establish record meaning and validate identity, type, dimensions, units,
split and completeness at that boundary before reducing values.

Report the Spec and attempt, raw input hashes, checker version, each criterion,
computed/reference values, difference and verdict. Retain integer numerators and
the entire registered denominator for rates. Count missing/invalid observations;
do not silently discard failures, treat undefined metrics as zero or collapse
distinct measurement grains into one score.

- **PASS**: the scoped criterion was evaluable and met its frozen rule.
- **FAIL**: a checkable rule was violated; distinguish artifact-integrity failure,
  invalid observations and metric disagreement in the reason.
- **INCONCLUSIVE**: evidence or interpretation is insufficient to decide.

Use the adapter's more specific outcomes when present. Keep source consistency,
execution state, numerical verification and scientific acceptance separate. An
unresolved definition can permit diagnostic arithmetic without permitting a
paper-level PASS. Conversely, one missing training asset need not invalidate a
proven algebraic identity or supported source-audit finding.

## Handoff and iteration

A useful layout is `protocol`, `sources`, `attempts/<actual-id>` (logs, receipt,
raw outputs), `verification` and a checker entrypoint; use an existing adapter's
layout instead of imposing this suggestion. Include source locators, data access
requirements, dependency information and commands. Do not export credentials;
identify omitted private/licensed/large inputs and preserve their manifests.
Give the handoff's checker command relative to the package root, such as
`python checker.py`, with its runtime requirements. Record the actual validation
interpreter separately; another researcher should not need its local absolute path.

Run the exported checker on the packaged observations in a separate directory
when feasible, recording the result. This proves only that those observations
can be rechecked with that environment. A clean rerun additionally needs the
method, data/model assets, dependencies and fresh execution evidence. Never label
an offline checker test as fresh training or whole-paper replication.

Relate the report to actual paper/document/passage/annotation identities when
available. Use only supported write routes; otherwise deliver artifact paths and
the association record. A proposed correction is a new protocol/attempt, not a
replacement of the original failed result.

## Fixed real-source reanalysis: Fisher Table III

The installed backend includes a bounded standard-library case for Fisher (1936),
DOI `10.1111/j.1469-1809.1936.tb02137.x`. It recomputes the Table III sepal-length
within-species sum of squares from all 50 setosa and 50 versicolor Table I
observations. This is one numerical result, not a rerun of the full paper or
the PC-Gym experiment. The existing PC-Gym verdict stays `INCONCLUSIVE`.

Obtain the authorized original PDF separately from the
[university-hosted scan](https://lgross.utk.edu/Math589Fall2020/RAFisher1936measurementsFlowerTaxa.pdf).
The CLI does not download, install or request a model. It requires the exact
reviewed PDF SHA-256 `d3a49aaa4f2d283931544f58cb12b1174f537642b83def7ae9119a1d8717b740`.
Set `PYTHONPATH` to the installed Paper App's `backend` directory, then use:

```sh
python -m paper_agent.fisher_reproduction prepare \
  --pdf /absolute/fisher1936.pdf --output /absolute/new-fisher-case
python -m paper_agent.fisher_reproduction run \
  --bundle /absolute/new-fisher-case --spec-sha <returned-spec-id> --confirm-execution
python -I -S /absolute/new-fisher-case/attempts/<returned-attempt-id>/verify.py
```

Prepare requires the existing PDFium/Pillow reader; computation and independent
verification use only Python's standard library. Preparation freezes the real
PDF region, reviewed data, interpreter, implementation and absolute tolerance
(`0.00005 cm²`, half the printed fourth decimal; configurable at prepare time).
Each explicit rerun creates a new attempt. The checker computes exact raw
moments independently of the primary float centered-sum implementation.

The bundle's `paper-store` is a separate disposable Paper data home. Original and
linked result notes use the existing `PdfAnchor` and immutable annotation store.
The CLI does not write to the user's current App data or bypass native approval.
This case is not connected to the PC-Gym-only **Run once** button or public App
execution routes. A saved annotation is not evidence of a tested Desktop UI.
