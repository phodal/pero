# Notebook Canvas owner contract

This implements bounded, declared data views inside Notebook. It does not embed arbitrary App panels, scripts, URLs or origins. Data is the first real consumer: its dataset inspector displays identity, archived state and immutable version digests, and its archive/restore action changes dataset metadata through the existing `Dataset.edit` transition. Files and versions are retained.

## Owners and admission

- Installed `app.json` declarations opt in through `contributes.canvases`. Each view names a read projection, a receipt-status endpoint, an input schema and a subset of existing declared writes. Read/status paths are restricted to `/internal/canvas/`; actions require dedicated `/api/canvas/` writes. Ordinary panels and existing API permissions remain unchanged.
- Host projects only public App/view/action metadata to Notebook. It revalidates enabled installation, exact declaration revision, declared panel/view and input/action schemas at use time. No backend token, executable path or HTML is given to Notebook.
- Notebook's authenticated `/internal/canvas/source` verifies the exact saved entry, revision, block and binding using `NotebookDocument.block`, including Notes and every procedure root. A write requires the latest saved revision. Receipts are excluded from source authority.
- Each mount gets an independent ephemeral Host instance. Late mount responses, unmount and inactive App transitions release that instance. Unused instances expire after 30 minutes. Removal or changed installation blocks subsequent reads/writes without rewriting the saved binding.
- Electron Main and Native Rust accept only public mount/read/release/action/status/cancel requests. They privately prepare the action, display the existing trusted shell confirmation, then submit its one-use ticket. An App cannot supply a ticket or answer a dialog. No Agent session or permission is reused or auto-approved.

## Read-only boundary

`readOnly` is restrictive input, not an authenticated user identity or an editor permission. The Host stores it immutably for that instance and rejects writes from that instance. Historical saved revisions cannot write, regardless of the flag. A compromised Notebook could request a new editable instance for an otherwise current saved binding. It still cannot execute without a separate explicit trusted shell confirmation of the exact saved source and action. This implementation does not claim a trusted per-editor read-only principal that the platform does not have.

## Results and interrupted operations

Data atomically saves its metadata change and operation receipt in the existing catalog replacement. The same operation with the same inputs returns the original receipt; different inputs are rejected. Status reads receive the complete original envelope, including parameters, and cannot reinterpret an old receipt as another action. The Host verifies the returned operation, completion state and exact envelope digest before constructing its provenance record. Current Data envelopes use compact sorted-key UTF-8 JSON with ASCII identities and boolean parameters.

Before dispatch, Host persists the exact source, action and envelope in its managed App recovery journal. It never persists tickets or consent. A new mount can discover previous operations for the same entry/block/binding and inspect Data's receipt without write permission, including after an App switch or Host restart. Provenance uses the original immutable source revision. Missing or interrupted owner status stays unknown; cancellation after dispatch does not claim rollback. An unresolved operation blocks a different new operation for that binding. The journal holds at most 128 records and only evicts resolved records; it refuses new dispatch rather than dropping unresolved evidence. Data's actual receipts remain in its catalog.

A freshly returned receipt is an owning App's report, not independent scientific verification. Bytes retained in or imported into a Notebook are explicitly labelled unverified records. They never grant authority and are never silently discarded.

## Verification and remaining acceptance

Focused Python tests cover real Data atomic replay and changed-parameter rejection, saved-source checks across all Notebook roots, history/read-only behavior and token-gated HTTP routing. React/DOM tests cover inline owner data, repeated clicks, cleanup, independent instances, read-only controls and remounted recovery. Electron tests cover foreign origin/private-consent rejection and the existing trusted confirmation isolation.

`tests/contracts/app-canvas.mjs` runs the real Host with installed copies of the actual Data and Notebook backends, verifies protocol schemas, and exercises approval/denial, real mutation, replay, release, restart/read-only recovery, changed parameters and disabled Apps. Rust unit tests cover declaration opt-in, instance state, durable recovery and native consent scope. Cargo and local Chromium execution were unavailable in the implementation environment; Rust compilation, this real Host contract, Native rendering and browser/GUI visual acceptance must pass CI before those surfaces are claimed verified. No CSP relaxation was made.
