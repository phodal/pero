---
name: molecular-report
description: Prepare SMILES, MOL or SDF records for Pero Scientific Viewer and report actual RDKit structure checks, descriptors and drawings. Use for molecular structure or descriptor requests, not ordinary chemical equation typesetting.
---

# Molecular reports

Keep the supplied molecular representation as the source. For a named compound,
identify the intended structure before computing; unresolved isomer, protonation,
salt or stereochemistry choices remain explicit. Do not silently replace invalid
records or guess experimental properties from a plausible structure.

## Compute with the existing worker

Use the Scientific Viewer environment and its `backend/worker.py` when a permitted
execution tool is available. Resolve the App location and Python from the current
workspace/runtime context; do not assume a developer's absolute path or install
packages into an unrelated environment. If unavailable, provide the requested
source format and say RDKit was not run. When runtime context supplies the worker
and environment, invoke them directly; inspect source only to resolve an interface
or execution failure.

The worker reads one JSON object from stdin and writes JSON to stdout:

```json
{"format":"smiles","records":["CCO","C[C@H](O)C(=O)O","invalid@@"]}
```

- Only `format` and `records` are accepted. `format` is `smiles`, `mol` or `sdf`.
- Each record is molecular text, never a path or Python expression. SMILES records
  contain only SMILES: names, comments and CXSMILES are not supported here.
- For MOL/SDF, each record is one MOL block with its original header/blank title.
  Split SDF at delimiter lines before calling; do not pass a whole multi-record SDF
  as one record. Prefer SMILES when a user has not requested coordinates.
- Preserve charge, isotopes, disconnected components and stereo markers. A 2D
  drawing is computed geometry, not a measured or energy-minimized conformation.
- The worker accepts 1–200 records, at most 32 KiB each and 1 MiB per request.
  Choose an explicit subset or batches when needed; do not silently omit records.

For example, with runtime-provided executable paths:

```sh
"$PYTHON" "$SCIENTIFIC_VIEWER/backend/worker.py" < molecules.request.json > molecules.result.json
```

Save the full result locally when drawings would overwhelm tool output. Read the
engine/version and row outcomes from that actual result; do not recreate them
from memory. Existing file/shell permissions still apply.

## Present the result in the conversation

The result has `engine:{name,version}` and ordered `rows`. A successful row has
`input`, `svg`, and `descriptors`; a failed row has `input` and `error`. Report
partial failures alongside successful rows. A zero exit code alone does not mean
all molecules passed. A top-level error or missing dependency means computation
failed; do not fill absent descriptors with zero.

Use `table_render`, when advertised, for a compact derived dataset containing the
original input, row status and the requested actual descriptor values. Keep null
or missing values for failed rows and retain their error text. Describe the RDKit
version, calculation and result file as the source; a hash binds the supplied
bytes but does not independently prove their experimental origin.

The worker provides MolWt, ExactMolWt, MolLogP, TPSA, NumHDonors, NumHAcceptors and
NumRotatableBonds. MolWt is average molar mass (g/mol); ExactMolWt is isotope-specific
molecular mass (Da). TPSA is Å², MolLogP is a calculated dimensionless estimate, and the remaining values
are counts. Do not relabel these as experimental measurements or infer toxicity,
synthesis feasibility, physical stability or biological activity from parsing.

For drawings, retain each actual SVG with its input and engine version. Use an
advertised artifact-delivery tool when available; otherwise report the saved file
and its display limitation. Do not invent an inline molecule receipt, paste SVG
as LaTeX or claim a drawing was displayed merely because it was generated.
