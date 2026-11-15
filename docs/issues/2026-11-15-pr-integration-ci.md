---
kind: progress_note
date: 2026-11-15
pull_request: https://github.com/phodal/pero/pull/222
---

# PR integration: Native test compilation

PR #222 CI run `43662094607`, Native job `132653537018`, failed compiling the
existing `skills_fold_into_customize_when_connectors_are_enabled` test with
Rust `E0282` at `crates/pero-ui/src/apps.rs:634`. The closure calls `name.into()`
without an inferable input type. This file was byte-identical to the current
master baseline `11b2d60d8`; the Worker recovery changes do not own the defect.

Annotate the existing test closure's `name` argument as `&str`. Preserve all
assertions and the Native gate. Production UI, Worker behavior and dependencies
are unchanged. This is a supporting CI note, not another active issue tracker.

Validation uses the CI's pinned nightly and command:
`node scripts/cargo.mjs +nightly-2026-10-28 test --locked -p pero-ui --features native --lib`.
All 82 Native library cases passed locally after preparing the generated fonts
with the existing `scripts/build/fonts.mjs` step, matching the CI prerequisite.
The remote CI rerun remains required before merging #222.
