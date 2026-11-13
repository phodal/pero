---
kind: execution_plan
date: 2026-11-13
status: implemented_with_recorded_limits
---

# Versioned domain task package: Virtual Cell CPU comparison

This is the canonical task record for the P1 domain-workflow slice. Audit at
base `c4f4ecdaf85b0a23dc3b04e1581bd680bba67b23` found an existing real CPU
ComparisonHistory, immutable Workbench input/output artifacts, frozen split and
versioned numerical evaluator. The missing pieces were a cohesive runnable
package, reusable model endpoint state, Host environment listing and independent
arithmetic check. LCMS2Yield already had pinned inference code/weight identities
but no prepared local inference stack; its resolved input mismatch tracker is
not reopened. Scientific connector discovery is a query adapter, not model
execution, and is unchanged.

## Implemented path

- The domain `TaskPackage` declares method/model versions, standard-library CPU
  requirements, input/parameter schemas, outputs, check scope and method guidance.
  Its content digest includes actual implementation hashes and is frozen per run.
- Existing Workbench import validates/fixes dataset, task spec, split and input
  identity. Parameters, units, seed, thresholds and data content remain owned by
  their existing scientific types; there is no second input or asset database.
- A bounded App Agent Plugin mounts existing App Use tools `import-inputs` and
  `comparison-step` with 12 calls per connection. Its typed task commands invoke
  the same model/comparison/check owners as the UI; Host retains ACP, grants and
  tool budget admission. Actual Agent/provider invocation remains unverified.
- Host Environments recognizes `virtual-cell.comparison` and offers its existing
  inspection/preparation flow. Compatible observed Python minors are bound under
  the existing exact-minor observation contract. Python below 3.10 is blocked.
  Observation remains metadata evidence, not managed EnvironmentUse admission.
- The Host-owned App backend loads the empirical additive model's frozen training
  view. `ModelState` defines stopped/starting/ready/in_use/stopping/failed; each
  ready use retains its input and prediction digest. It has no weights or GPU.
- ComparisonHistory remains the execution owner: CPU child, cancellation,
  observed exit, logs, immutable predictions/evaluation, history and rerun.
  A selected failed or mismatched endpoint cannot silently disappear from a run.
- The standalone independent checker recomputes equal-batch ΔMSE and complete
  denominator/summary values from exported input/prediction evidence, also
  checking endpoint provenance. A content-addressed receipt is linked to the run.
- The product UI exposes CPU sample/import, method/environment requirements,
  endpoint preparation/use/unload, execution, separate check, export and rerun.
  Endpoint disconnect does not claim a remote process stopped.

## Stable consumption boundaries

This slice consumes current AppStore backend supervision, Host runtime Python
selection/preparation, Workbench artifact identity, ComparisonHistory and the
existing evaluator. It creates no general Agent loop, scheduler, retry policy,
approval queue, Compute placement, environment lifecycle or artifact store.
Data remains the owner for future downloaded assets; this method requires none.
Shared kernel, remote Compute and provenance work can consume the task package's
fixed declaration and existing run/input/output references without adopting an
App-local scheduler. New domain methods should adapt their actual runner and
input/output contracts, then supply their own requirements and checks; do not
register a directory entry as if it were runnable.

Remote configuration uses only explicit Host deployment variables, forwarded
only to Virtual Cell: `PERO_VIRTUAL_CELL_MODEL_URL` and optional
`PERO_VIRTUAL_CELL_MODEL_TOKEN`. It connects to the same narrow model contract
after matching input is separately provisioned and started. It neither provisions
remote resources nor falls back to another model; credentials are absent from
run declarations/exports. Two loopback App services verify the connection path;
no external model account or GPU endpoint has been accepted.

## UI migration

The comparison run header migrates page-local Toolbar object actions to shared
InspectorHeader. New package/model content uses ContentSection, MetadataList,
Disclosure, Button and Feedback; no local control skins or color tokens are
added. Existing original inputs, status, failure denominators, export, cancel,
history and selected-object behavior are preserved. Electron selectors follow
the shared object header. Evidence and unverified surfaces are recorded in the
[verification report](../fitness/domain-workflows.md).
