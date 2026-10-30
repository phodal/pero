# Local baseline comparison

Issue: https://github.com/phodal/pero/issues/58

## Outcome

A researcher imports a prepared public perturbation dataset, runs the existing
CPU baselines, inspects method and condition results, and independently reruns
the exported inputs. Explicit reruns create separate local records; reopening
the App never starts a calculation.

This is an App-local extension of Virtual Cell, not a new Compute Job, Worker,
artifact platform, model or Agent workflow. Issues #59 and #60 are independent.
The existing evaluator owns scientific validation. Results remain condition
means, non-blind, execution isolation unverified and not human-reviewed.

## Ownership and boundaries

- Rust Host retains App process supervision, authenticated proxy and data-root
  authority. Fixed Python comparison children remain in the existing App
  process group; no arbitrary command or path is accepted from the interface.
- Workbench retains immutable input/output artifacts. A comparison record adds
  the identity and observed lifecycle of one explicit local attempt, even when
  its output digest matches an earlier run.
- The evaluator remains the sole owner of baseline generation, compatibility
  checks, condition denominators and scoring. Raw predictions are saved, not
  replaced by a natural-language success claim.
- The UI observes backend state. Cancellation is requested first and confirmed
  only after execution termination is observed. Interrupted recovery never
  automatically replays the method or trusts an unfinished output.
- Runtime remains standard-library Python. Preparation-only matrix dependencies
  do not enter the bundled App runtime.
- Local comparison start is enabled only on macOS/Linux, where Host owns the
  descendant process group. Windows can read history and exports but cannot
  start this new subprocess until descendant cleanup is supported and verified.
- The fixed public dataset is downloaded only after a user action. Download,
  local verification and cancellation have distinct intents; observing status
  never starts network traffic. A verified raw H5AD is not a prepared input.

## Public input preparation gate

The chosen candidate is the fixed scPerturb v1.0 Zenodo record
[7041849](https://zenodo.org/records/7041849), file
`NormanWeissman2019_filtered.h5ad`, 698,680,199 bytes, published MD5
`c870e6967d91c017d9da827bab183cd6`. The record's embedded rights metadata states
CC BY 4.0. Attribution and a description of transformations must accompany the
prepared package. It is a harmonized derivative of GEO GSE133344, not a claim to
reproduce every preprocessing decision or figure of the original paper.

Source selection and license have been checked; the actual H5AD has not yet
been downloaded or validated. Inspection must establish its checksum, shape,
columns, count scale, source-row identity, guide mapping and control support
before a concrete recipe is frozen or model scores are read.

The user requested a manual in-App download to their own machine, and approved
reusing an existing matching local source instead of fetching it again. The
download writes only into the Host-owned App data root; the product does not
automatically scan another application's cache. Partial files are never ready,
and publication requires exact size, MD5 and SHA256. Failed cache verification
does not silently become a network download; a new explicit retry is required.

The pinned scPerturb processing notebook maps `no_reads_found` to `control`.
Therefore the harmonized perturbation label alone does not establish a valid
negative control. Every observed label/guide combination needs an explicit
target, negative-control or excluded disposition. Missing and ambiguous labels
are audited, not silently renamed. Real gemgroup strata are retained.

The proposed preparation sequence is inspect, freeze a reviewed recipe, then
prepare. Condition selection and training-only feature rules are fixed before
evaluation. Per-cell normalization uses the full source-gene library sum before
condition/batch aggregation. The adapter reuses existing dataset/spec/split
validation and preserves all excluded-condition reasons.

Before any scores were computed, the user approved the explicit
`NegCtrl0_NegCtrl0;NegCtrl0_NegCtrl0` negative control, exclusion of conditions
whose targets are not measured, and a 0.05 relative-skill screening threshold.
That threshold is only the existing non-blind point-estimate marker: it is not
an issue-completion gate, a statistical significance claim or scientific proof.
The actual full mapping and recipe still require source-based validation.

The existing HTTP envelope remains at most 16 MiB and the numeric budget remains
`genes * (2 * conditions + total_strata) <= 2_000_000`. The separate CLI bound
remains 512 MiB. Preparation must operate in sparse/chunked passes rather than
densifying the full source. Raw H5AD and generated large data files are not
committed as part of this implementation.

The real source uses CSC storage. Row-slicing backed AnnData was observed to
load full sparse arrays, so the adapter instead reads direct CSC chunks capped
at 65,536 nonzero entries. This block size is part of the frozen recipe;
floating-point accumulation is not promised to be invariant to arbitrary block
sizes. Independent small-column and complete raw-count probes are distinct from
final acceptance of this adapter's complete inspect/freeze/prepare path.

## Delivery steps

1. Explicit source download/local verification and an offline preparation
   adapter, with source/recipe provenance and transformation tests.
2. Named local comparison model, fixed subprocess runner, observed cancellation,
   persistence/recovery, HTTP routes and independent CLI recomputation.
3. Baseline comparison mode within the existing App: input, start/cancel,
   history/rerun, method/condition results, source references and export.
4. Actual public-data preparation and two real runs with predeclared numerical
   tolerance, retained old results and independently recomputed scores.
5. Actual Desktop verification of start/results, incompatible input, failure,
   cancellation, history/reopen and export, including light/dark/narrow layouts.

## Completion evidence

Development fixtures prove only transformation and application behavior. They
cannot replace the fixed public-data and actual Desktop acceptance in #58.
Historical Point reports and the bundled PBMC atlas are not this run's evidence.

Record source and recipe digests, method source hashes, environment, real logs,
exit observations, raw predictions/evaluation, measured resource use, repeated
run comparison and independent revalidation. Retain failed or cancelled runs
and complete condition denominators. Do not close #58 until its real-data and
Desktop requirements are verified.
