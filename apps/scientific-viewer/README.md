# Scientific Viewer in Pero

The original Point Scientific Viewer runs inside Pero with its unchanged panel,
Node backend, examples, Mol*, RDKit and PDF engines. Pero owns App installation,
data, workspace, Agent Sessions, credentials and approvals. No Point service or
Point checkout is used at runtime.

Build the App and shared SDK from an explicit Point source checkout:

```sh
POINT_ROOT=/absolute/path/to/point node scripts/build/scientific-viewer.mjs
```

The Point checkout needs the Scientific Viewer and App SDK npm dependencies.
The build runs the original App production builder, checks its declaration and
creates the generated App package in this directory. Generated runtime/native
assets are not source files. The build receipt records original inputs, the
Point revision and file hashes. Workbench payloads include this optional App;
users may disable or uninstall it. Existing data is not replaced by a rebuild.

Alternatively, install the built original Point App directory through Pero's
**Install from folder** action. Both paths use the same adapter and Host authority.

Compatible workflows include scientific tables/structures/spectra, PDF quotation
and figure evidence, App-scoped literature records, and workspace-scoped review
Agent start, reconciliation, events, cancellation, explicit retry and Session
selection. Restoring an existing Agent Session uses ACP `session/load` only
when the selected Harness advertises support. Unsupported load or a changed
Harness configuration fails explicitly without creating a replacement Session.

Evidence and computed descriptors keep the original unverified/not-reviewed
labels. Review exports retain `client-reported-host-ledger`; they are not Host
attestations or scientific acceptance. Public search still contacts only the
user-selected original providers. No automatic Project knowledge promotion occurs.

See [verification and limits](../../docs/fitness/scientific-viewer.md) and the
[shared compatibility contract](../../packages/point-app/README.md).
