# Point App compatibility — 2026-10-31

Development verification on macOS arm64. The role is an existing Point App
owner reusing a local domain workflow in Pero. Installation, enable state,
data directories, process cleanup and browser authorization remain owned by
Pero Host/Desktop. Point's business components and compiled modules are inputs.

Source inputs: Point `b45190a3db725953128b4a8a40e95a287aa9bfd7`, Pero base
`91de2e3d7d38ab097b9818dcb7df42e25e183de7`, plus this compatibility package.
The Pero checkout also contained concurrent Python-environment/App preparation
changes. Tests used the existing development Host, Desktop and web builds;
they are **not** claimed to be builds of clean HEAD. Exact pre-launch Host,
Desktop and web asset SHA-256 hashes are recorded in ignored
`test-results/point-apps/result.json`. Each generated package records copied
file hashes and the bundled SDK/dependency source digest in `point-build.json`.
Point's working tree was clean and unchanged by this work. Manifest checks and
the full Electron suite also passed from a temporary staged-source export,
using the same existing development artifacts.

## Results

| Point App | Actual result in Pero Electron |
| --- | --- |
| Welcome | Original heading rendered through the real App origin and Point SDK. |
| Ontology Explorer | Synthetic example analyzed, state retained across switching Apps, real zh/en and light/dark changes, 1000px window, keyboard clear action. |
| Virtual Cell | Original Python backend started by Rust Host; synthetic input imported and persisted; `control`, `train_mean`, `additive` evaluated 5/5 test combinations each with 0 failures. Full split is 12 candidates: 5 train, 2 validation, 5 test, 0 excluded. |

All three panel modules were byte-compared against Point's prebuilt modules.
No business source was edited or bundle rewritten. The page error list was
empty. Screenshots were captured and visually inspected, including the
Ontology narrow/dark/Chinese view and Virtual Cell calculation view.

The backend refused missing Pero tokens and caller-forged Point signatures.
The packaging contract refused Factory, Calendar, Map and Paper Agent instead
of silently dropping their permissions, backend types or contributions.
The manifest table also covers cross-App/Host paths, traversal, multiple
panels, fixed ports and unsupported backend configuration.

```sh
node --test packages/point-app/manifest.test.mjs
POINT_ROOT=/Users/phodal/ai/point node tests/e2e/point-apps.mjs
```

Generated install directories are in `test-results/point-apps/packages/`.
The isolated test profile, owned Host/backend processes and temporary source
packages are cleaned up. No user's installed Apps were changed, and no model
or external service was invoked.

## Remaining boundaries

This is a bounded owner-built adapter, not native Point manifest loading in
Pero's install dialog. First package the unchanged Point bundle with
`scripts/build/point-app.mjs`, then install the resulting directory normally.
One panel, own-App APIs and stdlib Python `ThreadingHTTPServer` are supported.
Point Host/Project APIs, events, Node/exec backends, Agent tools, App Use,
conversation binding and multi-panel Apps remain unsupported. Unsupported
manifest contracts fail at packaging; App Use requests explicitly report
unavailable. Point tokens follow light/dark but do not yet map Pero accent or
style-pack selection. The exact supported contract and CLI are in
[`packages/point-app/README.md`](../../packages/point-app/README.md).

No real-Agent, native Wry, signed/package installation, Windows/Linux,
scientific acceptance or production acceptance was established. Virtual Cell's
original output retains `isolation: unverified`, `acceptance: not_reviewed` and
insufficient scientific evidence; the synthetic calculation validates transport
and deterministic workflow only.
