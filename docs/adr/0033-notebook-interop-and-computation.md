# 0033: Notebook Interop and computational runtime selection

Date: 2026-11-11
Status: implementation decision for #180; coordinating maintainer owns integration
and issue closure. This does not approve a new default upstream service.

Extends [ADR-0032](0032-ai4s-notebook-block-editor.md),
[App Use](0014-app-use.md), [Projects](0028-local-research-projects.md) and
[environment capabilities](0030-compute-environment-capabilities.md).

## Problem and decision

A continuous research record crosses editor, source, kernel, verifier and Project
owners. Installing another Notebook stack wholesale would duplicate execution
and Agent authority. Selection therefore follows actual same-input probes and
one real cross-App flow, documented in the [cards](../fitness/notebook-runtime-cards.md).

Keep the existing Pero Notebook as the Lab Notebook App and existing Science
Kernel/Task/Run/domain Apps as execution owners. Prefer **Jupyter file/kernel
modules** when a concrete computational compatibility requirement needs a new
seam. Do not install JupyterLab, AI/MCP, marimo or nteract by default now.

Implement **NotebookDescriptor**, a saved Entry projection, via Notebook's
authenticated `describe-notebook` App Use data route. No global Host enum,
parallel database, Agent or kernel is introduced.

- `descriptor` names app/kind/id/title, capabilities, location and formats.
  Unsupported execute/cancel actions are explicit nulls.
- `resourceRef.revision` identifies the observed saved version, always pinned in
  the reply. `snapshot.sha256` hashes serialized UTF-8 document bytes, separately
  from resource version. Reassembled `read-entry` chunks at that revision recover
  the bytes. Fixed-version locations open the existing read-only revision UI.
- Existing Paper/Control snapshots retain file/export hashes, method/input
  identity, verifier identity and checks. Full document reads carry parameters,
  Findings and provenance. The projection does not invent attribution, time or
  environment bindings absent from the owning receipt.
- Existing `apply-edits` keeps Host grants and `baseRevision`; reference proposals
  use existing review. Execute/cancel remain with domain Apps. Completion,
  PASS/FAIL/unknown verification and human/scientific acceptance remain separate.
- JSON exchanges the complete Entry; `.ipynb` applies to an embedded document,
  HTML is a publication snapshot, XLSX covers worksheet values/formulas/names.
  None silently replaces a complete evidence record with a lossy format.

Changed saved inputs invalidate the Canvas binding; a new binding creates a new
frozen experiment. Old Findings keep old trials/reports. Failed verification is
retained as completed execution with FAIL. Projects store links only. Data,
Paper, Simulation and Domain Notebook representations remain Views unless they
have independent object lifecycles, runtime isolation or data contracts.

## Alternatives and evidence

All three computational candidates produce the same CSV result SHA-256
`2d9047bf8dcd664e94816f9f04a758eef2c2ce6df4e5f5aec1cbfc062f386006`.
The cards pin source commits, licenses/NOTICE, dependency/advisory inventories,
actual UI/protocol measurements and unverified scope.

| Alternative | Decision and reason |
| --- | --- |
| New kernel inside Lab Notebook | Reject: editing is not execution authority; existing owners already cover it. |
| Full JupyterLab+AI default | Reject: actual Server/kernel/UI and 17-tool MCP discovery work, but MCP is separate authority outside Jupyter token protection. Reuse modules at a concrete seam; no model/provider acceptance is implied. |
| marimo default migration | Retain as optional reactive-App candidate. Actual editor runs/reloads; CLI cancellation still needs forced kill and earlier offline export depends on CDN assets. No broad editor migration is justified. |
| nteract as another Host | Reject: native protocol works but reformats source, owns its environment pool and has unresolved source-lock advisory matches. Require binary-specific triage and Host lifecycle/permission design first. |
| Global six-type protocol/sidebar | Reject: most types are Views. Interop v0 is a small App-local projection and pinned location. |

Real-owner acceptance covers Paper citation → Notebook → PI 8 s PASS / 2 s FAIL
→ unchanged Finding → persisted Project reference, including restart and old
revision/source/trial retrieval. Existing solver stderr warnings remain recorded.
This is an authored engineering check, not scientific acceptance.

The old nbconvert 7.17.0 research pin was replaced by 7.17.1 after advisory lookup;
comparison/Lab probes were rerun. No-match inventories are not full security
clearance. nteract source matches are not all mapped to reachable compiled code;
none of these upstream binaries is distributed by this decision.

## Migration and phased delivery

1. **#180, current changes:** land App-local descriptor/revision navigation,
   extended existing Canvas acceptance, cards and this ADR as small commits.
   Existing Entry/reference schemas, import/export, Project and verifier owners
   are preserved. No stored-data migration; old entries are described on read.
2. **Regular CI:** Notebook core/typecheck/build and existing Canvas job, with a
   10-minute test-step cap. Dependency preparation and slow upstream/OS/model
   probes remain separate. Coordinating integration owns PR creation, screenshots,
   remote checks and the final seven-item checkbox/closure audit.
3. **Conditional later issue/PR:** only for demonstrated Jupyter semantics or
   reactive-App demand. Add one supported file/kernel capability using existing
   Task/Run/artifact/environment seams. Freeze input/code/environment/output,
   preserve original source and reference owner verification. Coordinate any
   environment work with #163; this change does not modify that owner.
4. **Before upstream distribution:** a separate adoption PR must resolve binary/
   feature-specific advisories, licenses/NOTICE/dependencies, signed packages,
   offline assets, grants, cancellation and cleanup on supported OSes. CRDT,
   ACP providers and multiuser editing need their own demand/acceptance; not P0.

No speculative adapter or service is added for phase 3/4. Rejection of default
adoption completes this research decision; it does not claim unverified paths
work or leave a promised default integration unfinished.
