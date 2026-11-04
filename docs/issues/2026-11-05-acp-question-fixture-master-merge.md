---
kind: issue
status: resolved
date: 2026-11-05
---

# ACP question fixture does not compile after the master merge

CI run `41902835870` fails to compile `pero-runtime` tests: the branch's
`tests/runtime/acp_user_questions.rs` constructs `AgentConfig` without the
`session_instructions` field added on master. The production type and the
existing lifecycle fixture already supply this field. This is a branch-owned
merge integration failure, independent of the unchanged Paper fixtures and
Scientific Viewer browser test.

Supply empty session instructions in the question fixture, matching its
non-App agent and the existing lifecycle fixture. Keep all RPC, cancellation
and question-correlation assertions. Verify the runtime tests with the actual
Node fixture process.

The fixture now supplies `String::new()`. The complete macOS arm64
`cargo test -p pero-runtime --lib` run passes 109 tests, with one existing
ignored test and no failures. This includes the real Node-process question
and ACP lifecycle cases. An initial filename-based filter selected zero tests
and is not counted as verification. The compiler also reports a local
`rust-objcopy` debug-stripping warning; it does not prevent compilation or
execution.

Hosted Linux run `41904997858`, job `126837511823`, confirms the same 109
runtime tests pass with one ignored and no failures at `1de9c25f`. The other
Rust package and remote test groups also pass. The containing core job remains
red because the Paper PDF fixtures lack `scope.onBeginSelection` and the
research import backend cannot import `view`; this repair does not address
those separate failures.
