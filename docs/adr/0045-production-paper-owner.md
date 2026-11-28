# 0045: Production Paper owner and durable run receipts

Date: 2026-11-28

Status: accepted for the production wiring after P0.7. Leave issue 256 open; reference it only with Refs. The harness in ADR 0044 remains the in-memory composition. This decision wires the running control-plane binary.

## Decision

`server/cmd/server` supplies a `PersistedPaper` backed by the control-plane database. That value is both the Paper reader and the Paper importer. When the database is absent, the reader is not installed and the device routes stay unmounted.

A PDF import is decided by `paperdomain.Place`. The revision is the SHA-256 of the bytes. The Paper id is minted as `rev_` plus random bytes. An id shaped as `paper-` or `doc-` plus a digest prefix is rejected. The same digest in the same project returns the stored id. The owner host is `pero-paper`, and the local project is the shared project id.

The device desk reserves one upload before import. A second finalize waits. `devicetransfer.Finalize` returns the stored commit, with `created` set to false, when the digest matches. A replay with size zero returns `interrupted`. A replay above 32 MiB returns `over_limit`. A cancel that arrives while that reservation is held does not report success; once the import has committed, cancel returns conflict. After a successful import, and after a failed finalize, the desk drops the PDF bytes. The domain row keeps the bytes that were accepted. In-flight uploads are capped per project and globally, and uploads and handles older than 15 minutes are dropped.

Run observation stays on `persistedRuns` and the existing Run table. This slice does not create a Run. Receipts for effects other than `none` are rows in `run_observation_receipts`, so a restarted process still returns the stored decision. Status observations are not receipts.

`PERO_PROTOCOL_ROOT`, when set, serves the harness page and its four SDK modules on the same origin as the API. Unset, the binary serves no harness files.

## Residual

Safari on a physical iPad and Android Chrome or WebView are not part of this decision. Two control-plane processes can still pass the receipt check before either insert lands; the unique row makes the second insert conflict and the observation is recomputed from the stored row. The cancel itself is the existing owner.
