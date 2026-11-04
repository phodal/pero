# PR #125 test alignment and viewer repair

Verification report, 2026-11-04, based on `2741e645`.

The recurring failures were not all environment failures. Several tests still
expected UI removed or deliberately changed on master: the PaperList projection,
Read version/source/evidence controls, a duplicate attachment chip, compact App
chat and a generic TeX `completed` response. The tests now follow the shipped
LibraryPapers/SavedTextReading projections, rendered document identity, inline
file mention, expanded chat and `source_available` response. No production
acceptance flag, timeout budget or test skip was loosened for these updates.

The old numeric-zoom source regex is replaced by complete Viewer/Pages component
execution through plugin seams. It checks deferred saved zoom, citation priority,
focus arriving before layout and no double restore. The pinned plugin viewport
contract remains covered separately.

Scientific Viewer's MathJax dependency also has a real browser-bundle defect:
its lazy TeX loader refers to CommonJS `global` and `__dirname`. Browser build
defines map these to `globalThis` and an empty directory without adding Node
privileges. A test bundles and executes the actual dependency graph with string
code generation disabled. The Desktop suite additionally waits for notebook
mathematics to render rather than moving past asynchronous initialization.

## Coverage changes and limits

The structured-reading Desktop suite no longer drives retired Read-page controls.
It retains selected original-source navigation, typed/raw evidence checks, Library
report reopening and the first document's offline restart. Report creation is now
an authenticated API step, not a claim of a Reader UI action.

**The complete second-bundle GUI and restart journey was removed.** Multi-bundle
scope ownership and pending-refresh behavior retain domain/component checks;
these are not equivalent end-to-end coverage. Restoring a current-product GUI
journey for that scenario remains acceptance debt, not a completed verification.

Chromium/Xorg could not create sockets in this assistant workspace (EPERM).
No GUI test or screenshot is claimed to have passed here, and no user Mac was
used. Updated Desktop suites require actual CI execution; syntax checks and the
component/domain results below do not establish their success.

## Executed checks

- Full Fast contract command from CI: 104/104 passed.
- App and Scientific Viewer build contracts: 9/9 passed, including actual viewer
  production bundling and MathJax dependency initialization.
- Scientific Viewer unit suite: 17/17 passed.
- Paper UI/Docling bridge/availability: 16/16 passed.
- Installed Paper Host schema and prepared-write contracts: 6/6 passed.
- Source-report domain/persistence suite: 11/11 passed.
- Paper and Scientific Viewer TypeScript; core TypeScript; generated contracts,
  theme, design and locale checks passed.
- Changed Desktop E2E script syntax and `git diff --check` passed.

These results are distinct from the still-pending new-head CI and Desktop GUI
acceptance. They do not establish full scientific correctness or release readiness.
