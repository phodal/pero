# Offline Norman/scPerturb preparation

This **preparation-only** adapter builds a new scPerturb-derived local demonstration
for issue #58. It does not reproduce all preprocessing or figures from Norman et
al. (2019). It neither downloads files nor installs dependencies, runs models,
changes the App runtime, or raises any existing input limit.

**Current acceptance:** the adapter has synthetic sparse-cell validation, while
real-file checksums, metadata and a separate raw count scan have been checked
read-only. Final-code inspection and end-to-end preparation validation remain
outstanding; no real frozen recipe, public-data bundle or baseline result is
included. Synthetic tests are not real-data acceptance.

Before seeing scores, on 2026-10-30 the user approved the exact control guide
`NegCtrl0_NegCtrl0;NegCtrl0_NegCtrl0`, excluding the other control guides rather
than pooling them, excluding conditions with unmeasured targets, and explicitly
setting `min_skill=0.05` only for the existing non-blind screening rule. These
pre-declared choices still need the complete reviewed mapping and final-code
inspection before a real recipe can be frozen; the CLI has no threshold default.

## Pinned source and environment

[`backend/data_sources/norman.json`](../../backend/data_sources/norman.json) records the verified scPerturb v1.0
[Zenodo record 7041849](https://zenodo.org/records/7041849), file
`NormanWeissman2019_filtered.h5ad`, 698,680,199 bytes, MD5
`c870e6967d91c017d9da827bab183cd6`, and CC BY 4.0 license. Preserve attribution to
Norman et al., [DOI 10.1126/science.aax4438](https://doi.org/10.1126/science.aax4438),
GEO GSE133344, and the scPerturb record with redistributed derived artifacts.
The tool verifies size, MD5 and SHA256 before opening H5AD. The SHA256
`efde6f5301fe256725dce1d980f37bd96a13481a9a16135515897368e631affc`
was observed on a local cached file matching the official size/MD5; it is **not**
claimed to be a Zenodo-published checksum. Initial read-only observation found
111,445 cells × 33,694 genes, CSC `X`, required obs fields, and gemgroups 1–8.
The manifest has one runtime-packaged owner shared by this tool and the App.
It uses `X`, not a guessed layer or `raw.X`. Initial metadata inspection found
`C3orf72`, `C19orf26`, and `KIAA1804` absent from the measured gene index; their
mappings must be explicitly excluded, not repaired by guessing aliases.

Use a **separate, already-provisioned preparation environment** with Python,
numpy, scipy, pandas, h5py and anndata. Missing dependencies produce a structured
`preparation_dependency_missing` error; the App and evaluator remain stdlib-only.
Exact installed versions, Python version, source checksum, and preparation code
hashes are recorded in the inspection and must match preparation. Dependency
installation and downloading the 698 MB source require an authorized environment;
the existing local cache was reused for read-only inspection, without downloading it again.

The adapter reads CSC `data` and `indices` directly, with at most **65,536
nonzeros per slice**, including genes larger than one chunk. Only `indptr` (one
integer per gene plus one) is loaded whole. A first pass validates counts and
strictly increasing per-column row indices and sums full-gene library sizes;
a second streams training/control moments including implicit zeros; the final
aggregation reads only the selected 256 genes. No whole matrix is densified or
loaded, and no CSR intermediate or source copy is written. The count reader is
also exercised with bounded in-memory CSC arrays in synthetic tests. The
production 65,536-nnz limit is explicitly frozen in the recipe. Changing chunk
size can change float64 reduction rounding and the ranking of near-tied
variances; cross-chunk numerical agreement is approximate in general. The
small test fixture's identical bundles are not a universal bitwise-invariance
claim. Exact variance ties use lexical gene order; no approximate tie threshold
is introduced.

A local probe exposed why AnnData backed **row slicing must not be used**:
two 256-row slices each took about 5.2 seconds and reached about 2.97 GiB RSS,
because it loaded full CSC data/indices internally. Direct 32-column probes
read 173,963 and 307,214 nonzeros in 0.0042/0.0062 seconds with about 61 MiB
process peak RSS. These are narrow reader probes, **not** a full preparation
benchmark. Full-source validation, exact chunked-reader peak RSS, end-to-end
time, disk availability and output sizes must still be measured before
freezing a real recipe. The prepared JSON needs no scientific dependencies.

## Inspect, review, freeze, then prepare

Run from `apps/virtual-cell`. Keep raw and generated data outside Git; the local
`tools/norman/data/` directory is ignored. Do not commit the H5AD or generated
bundle. Every command requires a **new output directory**. Failures retain a
`failure.json` report instead of silently relaxing a rule.

```sh
python tools/norman/prepare.py inspect \
  --source tools/norman/data/NormanWeissman2019_filtered.h5ad \
  --out tools/norman/data/inspection-01
```

Inspect `inspection.json` before editing a separate copy of
`mapping-template.json`. Inspection validates required fields (`perturbation`,
`guide_id`, `gemgroup`, `good_coverage`, `number_of_cells`), gene uniqueness,
nonnegative finite integer counts, sorted unique CSC row indices, and full-library
sums. Invalid/duplicate/unsorted sparse indices fail rather than being silently
reordered or merged. It reports **every**
source perturbation/guide group, original and eligible batch counts, overlapping
QC exclusions, and duplicate barcodes. Identity is the original zero-based row
index; upstream barcodes are not assumed globally unique. Batch integer values
are represented as decimal strings. Coverage accepts bool or exact numeric 0/1;
number-of-cells accepts nonnegative integers, not strings or booleans. Unexpected
encodings fail inspection; a new explicit adapter review is needed to change them.

For **every** observed perturbation/guide pair, review and fill:

- `kind`: `negative_control`, `perturbation`, or `exclude`;
- `targets`: the exact measured gene identifiers, with no guessed alias repair
  (one/two for perturbations, empty otherwise);
- `evidence`: the source and explanation supporting the annotation, or the
  exclusion reason. Empty evidence is rejected.

The pinned upstream notebook maps `no_reads_found` to `control`. Therefore,
`perturbation == control` is **never sufficient**. Confirm the actual guide is a
negative control against source evidence and actual batch/cell support. Known
unassigned/no-read guide labels cannot be accepted, even with a control mapping.
No string parser infers target genes from a perturbation name. Missing/ambiguous
targets, duplicate mappings, or an incomplete mapping denominator fail closed.
The human review supplies guide biology; the tool cannot prove it from a label.

```sh
python tools/norman/prepare.py freeze \
  --inspection tools/norman/data/inspection-01/inspection.json \
  --mapping tools/norman/data/reviewed-mapping.json \
  --min-skill "$MIN_SKILL" \
  --out tools/norman/data/recipe-01

# Review and retain recipe.json BEFORE evaluating any model.
python tools/norman/prepare.py prepare \
  --source tools/norman/data/NormanWeissman2019_filtered.h5ad \
  --recipe tools/norman/data/recipe-01/recipe.json \
  --out tools/norman/data/prepared-01
```

The frozen recipe embeds the complete inspection and reviewed mapping, all
condition-selection dispositions, exact selected conditions and split
assignments, preprocessing rules, and content digest. A changed source, code,
environment, or recipe requires a new inspection/review; existing outputs are
never overwritten. The inspector cannot be replaced with a historical report.

### Pre-registered recipe v1

1. Retain positive full-library sums, good coverage, exactly one cell, and a
   reviewed assigned guide. Keep exclusion counts and all source inventory.
2. Canonicalize target order, not gene identity. Require at least 20 cells per
   selected condition, available component singles, and the **same batch set**
   for every selected double, both singles and reviewed control. Do not drop
   unmatched batches to manufacture support.
3. Select exactly 24 eligible doubles by ascending SHA256 of UTF-8
   `58:<canonical-condition-id>` (ID breaks ties); include their singles/control
   and **all** eligible cells. Other eligible conditions remain in the audit
   denominator. Insufficient support is a hard error, not permission to reduce
   the panel or threshold.
4. Use existing `freeze_split`: seed 58, validation 0.20, test 0.25, min_cells 20.
   A one-column zero-valued **metadata-only scaffold** selects identities before
   feature fitting; it is neither exported nor treated as expression data. Final
   dataset/spec digests are recomputed and assignments must be identical.
5. Normalize each cell by the sum across **all source genes**, then log1p CP10k.
   Fit population variance using only selected **training plus control cells**.
   Include measured targets from all selected condition identities, fill to
   exactly 256 genes by descending variance then gene-name tie-break, and sort
   the final gene axis lexicographically. Held-out expression does not fit
   features. Controls are explicitly included; the spec records this choice.
6. Accumulate float64 batch means, equal-batch condition means and cell-weighted
   pooled means. Round each output only once to six decimals. Keep stable source
   row ordering, and sort conditions, batches and guide IDs.

No model score enters these choices. The task spec fixes all three existing
baselines, median delta-MSE, and additive reference. The researcher must supply
`--min-skill` (strictly between 0 and 1, **no default**) before evaluating models;
set `MIN_SKILL` in the command above to that explicitly pre-declared value. It is
frozen in the recipe and task spec, not inferred from results. A selected
threshold is only the existing non-blind point-estimate screening rule, **not**
a completion criterion for issue #58. No baseline needs to exceed it to complete
this local comparison scenario; it does not establish scientific sufficiency. Time and biological replication remain unknown; gemgroup is a
technical batch, not an independent biological replicate.

## Outputs and independent execution

`prepared-01` contains `dataset.json`, `spec.json`, `split.json`, `bundle.json`,
`recipe.json`, repeated `inspection.json`, `audit.json`, and `status.json`.
The audit binds source/recipe/code/environment, selected row-identity digest,
feature-fit scope, gene order, complete filtering/selection denominators, and
artifact digests. The dataset source embeds the full sealed recipe and row audit,
so importing/exporting `bundle.json` alone preserves license, checksums, full
source inventory and excluded denominators. `prepared_not_evaluated` means
exactly that.

The tool checks the existing 2,000,000 numeric-value limit and the **actual
serialized** bundle and escaped `{"documents":["..."]}` import envelope against
16 MiB. It also checks dataset/spec/split bytes against the 512 MiB CLI limit.
Import `bundle.json` in the App, or evaluate independently with the existing CLI:

```sh
python backend/cli.py evaluate \
  --dataset tools/norman/data/prepared-01/dataset.json \
  --spec tools/norman/data/prepared-01/spec.json \
  --split tools/norman/data/prepared-01/split.json \
  --out tools/norman/data/evaluation-01.json
```

Re-evaluate the same frozen JSON into a new path to compare deterministic
results without rewriting the old artifact. Results remain `non_blind`, with
unverified isolation, uncomputed uncertainty, and no independent dataset or
scientific acceptance claim. Real-data preparation, repeat-run verification and
actual Desktop demonstration remain separate outstanding acceptance steps.

Synthetic checks (no H5AD, downloads, or installation):

```sh
PYTHONDONTWRITEBYTECODE=1 python -m unittest discover \
  -s test -p test_norman_preparation.py -v
```
