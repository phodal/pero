---
kind: issue
status: active
date: 2026-10-29
---

# Native release first-run verification

The first multi-OS release is being verified in Actions run 40784807820.
Regular CI run 40784799949 failed on Linux before compiling the UI: Cargo refused
its `--locked` build because the registry-based lock still needed the pinned
local GPUI patch resolution. The release workflow already performs that resolution;
regular Desktop CI did not. This is a build preparation mismatch, not a passing
native test or a released-package result.

The bounded fix adds the same `scripts/cargo.mjs check -p pero-contracts` step
before regular Desktop builds. It retains locked compilation after preparation.
The new CI run and remaining release platforms must be observed before closeout.

The first native launch then found Linux WebGPU initialization unavailable on the
headless runner. Regular CI also exposed canonical Windows device paths being
passed to Node/Git, plus a macOS Python test startup timeout. The shell now uses
`dunce::canonicalize` at path entry so ordinary Windows paths cross process and
JSON boundaries. The HTTP lifecycle fixture binds TCP directly and avoids
HTTPServer's reverse DNS lookup; it still waits for the backend readiness line.
The Linux launch check will explicitly select the CI software Vulkan adapter and
retain browser diagnostics. None of these failures is accepted as a passing gate.

Windows packaging also selected Git Bash GNU tar from PATH, which interpreted
`D:` as a remote archive host and cannot emit the intended ZIP. The Windows
packager now explicitly invokes System32/tar.exe (Windows bsdtar) with ZIP mode.
The earlier candidates remain unpublished; tags are not rewritten.
