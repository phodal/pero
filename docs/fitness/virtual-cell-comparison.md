---
kind: verification_report
github_issue: 58
github_state: open
github_url: https://github.com/phodal/pero/issues/58
---

# Virtual Cell local comparison acceptance

Implementation: [Draft PR #62](https://github.com/phodal/pero/pull/62).
This record separates actual public-data computation from synthetic Desktop
development acceptance. It is not scientific approval or a claim of blind testing.

## Fixed public source and inspected identity

The original local H5AD matched scPerturb v1.0
[Zenodo 7041849](https://zenodo.org/records/7041849):

- `NormanWeissman2019_filtered.h5ad`, 698,680,199 bytes.
- Published MD5: `c870e6967d91c017d9da827bab183cd6`.
- Locally measured SHA256: `efde6f5301fe256725dce1d980f37bd96a13481a9a16135515897368e631affc`.
- CC BY 4.0, checked in the record's rights metadata; derived from GEO GSE133344
  and Norman et al., DOI `10.1126/science.aax4438`.

The cached original was reused read-only, not downloaded again or copied into
Git. Older derived Point reports were not used as this run's input or result.

An independent complete count audit inspected 361,582,621 stored CSC entries in
111,445 cells and 33,694 genes. Stored values were finite, nonnegative integers
(1–3,718); column row indices were ordered and unique. Every full-library sum
was positive (3,679–64,352). This independent probe and the final adapter are
different programs and are not interchangeable evidence.

## Formal preparation and pre-registered decisions

Exact preparation/CLI source commit: `61abefa8c82da43e4746d27ff050456f99e3bd28`.
Formal inspect exited successfully in 8.967 seconds, measured peak RSS
273,743,872 bytes. Its 111,445 library sums matched the independent oracle exactly.
Inspection digest:
`sha256:432c410a20f87db9cdded5b9483a8352c5a02b2a2340fe58fd4354be8c993e1b`.

Before the current run's scores, the user approved the explicit
`NegCtrl0_NegCtrl0;NegCtrl0_NegCtrl0` control, exclusion of unmeasured-target
conditions, and 0.05 relative-skill screening. That marker is neither statistical
significance nor an issue pass threshold. The fixed recipe also records the
65,536-nnz block size; arbitrary block sizes are not promised to be bit-identical.

All 290 source label/guide pairs have dispositions: 280 perturbation mappings,
one selected negative control and nine exclusions. The six suffixed guide IDs
for HOXC13, ZBTB10 and TGFBR2/IGDCC3 retain their full strings. Target assignments
follow the pinned scPerturb transformation's first `__` component, not a guessed
interpretation of `_1`/`_2`; corresponding original GEO label counts were checked.
See [the exact upstream transformation](https://github.com/sanderlab/scPerturb/blob/b69f72a070a92bcbaf41e7f9897b11598109ab48/dataset_processing/notebooks/data_processing_JS.ipynb#L887-L918).
These suffixes are not asserted to denote biological replicates.

129 double perturbations met the fixed support rules; fixed hashing selected 24.
With 36 component singles and one control, the prepared data has 61 conditions,
all covering the same eight batches. Doubles split into 13 train / 5 validation /
6 test. The adapter retained 27,742 cells; 24,961 training-plus-control cells
contributed to feature fitting. There are 256 selected genes.

Frozen recipe digest:
`sha256:de30d57478c7ba9aaf4a09af007e8e504a222adeddb9eb6d870b1eefefc6eec4`.
It was written at `2026-10-30T14:18:47.536258Z`, before current-run scoring.
The bundle is 2,100,107 bytes; its escaped HTTP envelope is 2,205,480 bytes against
the unchanged 16,777,216-byte limit. Numeric values total 156,160 / 2,000,000.

## Actual repeated computation

Two new preparation directories produced identical bytes for all eight output
files. Two independent CLI comparisons of the same frozen bundle also produced
identical canonical bytes, meeting the predeclared exact local rerun criterion.
The common comparison file SHA256 is
`b6b5ac6167bd48fef8441e865d52c4abbc7e1feee5711efab5e7952efc162f5f`.

Each baseline evaluated all six test combinations. Median skill relative to
additive was approximately -5.4212482379 for control and -3.3179481279 for
train_mean; both are below the screening marker. Additive is the reference.
These descriptive results do not establish general biological prediction quality.

Preparation took 23.69 / 23.67 seconds, with peak RSS approximately 300 / 315 MB.
CLI comparison took 0.113 / 0.105 seconds, with peak RSS approximately 45 MB.
Subprocesses had a 600-second wall-clock timeout; no live enforced memory cap is
claimed. Source files were not modified, and no model provider was called.

The full recipe, audit, input and comparison outputs are retained in the local
verification workspace, not bundled as large repository files. The exported
App result includes the frozen bundle and source/recipe provenance for independent
recomputation; follow the [preparation guide](../../apps/virtual-cell/tools/norman/README.md).

## Desktop and CI boundary

First integrated CI `41066946545` completed 15/17 jobs. Actual Electron
development suites passed six comparison groups and seven transfer groups,
including real Python exit/termination, distinct rerun identities, export/CLI
comparison, request-loss reconciliation and complete cleanup. Their inputs are
explicitly synthetic/loopback, not the actual Norman snapshot.

That run exposed a Windows typechecker launcher path and a stale MCP footer
shortcut test after master's Settings redesign. Both have follow-up fixes; new
integrated CI and real-data Desktop screenshots/interaction evidence remain
pending. #58 is not closed, and the PR is not ready to merge on this record alone.

Historical Point score output was accidentally encountered during annotation
research. It was recorded as information exposure, not used for mapping,
selection or threshold changes. No claim of complete prior-score blindness is
made. Results remain non-blind, execution isolation unverified, independently
unvalidated and not human-scientifically accepted.
