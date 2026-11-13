---
kind: progress_note
date: 2026-11-13
pull_request: https://github.com/phodal/pero/pull/225
---

# Scientific workflow integration CI

The first combined run is
https://github.com/phodal/pero/actions/runs/43402683471 at head `06c89aa64`.
This note distinguishes integration regressions from inherited failures; it does
not open another active incident for previously tracked reference or CI drift.

## Observed failures

- Standalone Harness Bazel declaration verification: the newly combined ACP,
  scienceenv and Reviewer BUILD declarations differ from Gazelle's canonical
  ordering/format. Regenerate those declarations without changing test scope.
- Official DSH reference comparison: three existing comparison pairs pin the
  old local `acp/prompt.go` or `acp/server.go` hash. Reviewer and shared science
  intentionally change those local files. Review the behavior, document the
  local difference and update receipts while retaining all pairs/landmarks.
- Root frozen npm translation: the publication-provenance export changes the
  Notebook package manifest, which is a frozen-cache input even though package
  versions/dependencies are unchanged. Regenerate the existing translation
  cache; do not disable frozen validation.
- Fast CI contracts: the native Computer Use OS matrix is now an array, while
  one assertion still assumes a regex string. Nine Paper navigation checks use
  a shallow component harness which does not traverse the LibraryPapers scope
  slot. Those files are byte-identical to base `60c800888`; its CI run
  https://github.com/phodal/pero/actions/runs/43400863949 already fails this
  fast-contract shard. Update the test harness/assertion to the real component
  contract, without changing production behavior or dropping cases.

Each correction is a separate concern and keeps the original CI gate enabled.

## Review findings

The automated review identified three recoverability defects before merge:

- Partial remote output collection retains some files but hides its retry action
  because the UI treats any retained output as collection completion.
- Reproduction exports recreate a directly invoked workspace script without its
  executable permission, causing the retained invocation to fail with EACCES.
- Truncated HTTP model responses raise protocol exceptions outside the existing
  failure transition, leaving an endpoint stuck in starting or in-use state.

These findings require explicit completion/permission/error facts at the
existing boundaries, without another retry or execution owner.

## Corrections and local checks

- Frozen npm cache regenerated from the current package manifest; seven strict
  root Bazel checks and ten server tests pass.
- Four Harness BUILD declarations regenerated; Gazelle diff, ACP build and all
  40 standalone Bazel race targets pass.
- Three reviewed local-source receipts refreshed; all 17 references extract
  successfully and all 18 AST comparison tests pass.
- Fast CI component/matrix contracts corrected; 147 cases pass with five macOS
  platform skips. Production components and CI policy are unchanged.
- Collection completion is an owner-derived fact distinct from retained files;
  the existing browser journey retains downloads and retries after refresh.
- Executable permission is observed only for recorded workspace code and restored
  in reproduction exports. Actual direct-script recording/export/replay passes;
  input data stays non-executable and legacy receipts stay compatible.
- HTTP protocol failures are normalized at the endpoint boundary. Real truncated
  chunked-response tests cover startup and prediction recovery; all 74 Virtual
  Cell backend cases pass.

The final Rust rerun uses an independent build directory. A shared cache was
observed returning metadata from the older original checkout (missing the
integration's existing types); no production source change is made for that
local build-cache condition.

Final combined verification and remaining scientific/platform boundaries are in
[the integration report](../fitness/science-p0-p1-integration.md).
