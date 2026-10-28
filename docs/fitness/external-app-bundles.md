# External App bundles

Domain implementations stay in their owning repositories. Pero consumes already
built artifacts through `--app-bundle`; it does not install their source under
`apps/` or invoke an external build script. Products may also be defined outside
Pero. Runtime copying to a distribution is delivery, not source vendoring.

The owner-built directory contains `app-bundle.json`:

```json
{
  "schemaVersion": 1,
  "name": "sample",
  "files": ["app.json", "dist/index.html", "backend/server.mjs", "LICENSE"]
}
```

Every listed entry is an explicit relative regular file, including all runtime
resources and licenses. Unlisted neighbors are not copied. `app.json` follows the
Pero Host contract: one HTML panel and an optional backend with `type: node` and
`entry: backend/server.mjs`, or the existing Python declaration. The owner adapts
its package to that contract; a Point manifest cannot be used unchanged. The
Rust Host remains the authority for runtime manifest validation and grants.

Node backends receive `PERO_APP_DATA`, `PERO_APP_TOKEN` and `PERO_APP_NAME`.
They listen on loopback port zero and write `{"port":12345}` with their actual
bound port as the first stdout line. They authenticate `X-Pero-App-Token`.
The backend's stdout is reserved for readiness; diagnostics go to stderr.
The Host owns shutdown, including the backend process group on Unix.

An external Product uses the existing Product fields plus `node: bundled` (or
explicit `system` for development). Python policy remains compatible with
existing products. Supplying a Node App without a Node policy fails the build.

```sh
npm run build:product -- \
  --config /external/product.json \
  --app-bundle /external/built-app \
  --node /external/relocatable-node \
  --output /external/distribution
```

Repeat `--app-bundle` for additional included Apps. The supplied Node directory
contains `bin/node`, its dependencies and licenses; no runtime is downloaded.
Bundled policies use only their staged executable, without system fallback.
The builder runs each copied runtime to check relocation. `--package` uses the
existing macOS packager; this command alone stages a development distribution.

## Verification

`npm run test:product` covers Product runtime policies, explicit artifact paths,
missing declared entry files, exclusion of unlisted source, relocation after the
input directory is removed, and refusal of escaping files. Runtime shell tests
(`node scripts/cargo.mjs test -p pero-runtime apps::`) exercise both actual
Python and Node backends: authentication, persistent file effects, disable/stop,
restart and fresh tokens. `npm run check` checks TypeScript and existing contracts.

On 2026-10-28, an additional local Electron trial bundled Point's existing
`packages/modernization/cobol-analysis/src/index.mjs` outside this checkout.
The real product builder consumed that external bundle and an external product
configuration. With the input bundle renamed away, the staged product opened
its independent App frame and proxied a request to its Host-owned Node backend.
Analysis of Point's `FEE-QUOTE.cbl` returned program `FEE-QUOTE` and COPY dependency
`QUOTE-IN`, exactly matching a direct call to Point's `architectureFacts`.
The App frame had neither product nor workbench preload globals.

This observation uses system Node and a minimal verification panel. It verifies
lexical analysis and the external build/runtime seam. It does not verify the
full COBOL workbench, conversion, domain Agent tools, compiler execution,
Point authorization integration, a DMG, or business acceptance. No Point source
or COBOL-specific adapter was added to the Pero repository. The attempted standalone workbench/exporter was withdrawn. A production
Point exporter and Host adapter are not included in this implementation.
