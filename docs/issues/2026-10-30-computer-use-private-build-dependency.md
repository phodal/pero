---
kind: incident
status: resolved
---

# Computer Use builds require private Point access

The Computer Use CI job fails on clean runners because
`scripts/build/computer.mjs` fetches `phodal/point` at its pinned revision.
That repository is private and the runners have no credentials. Linux is also
affected: its shared native types depend on the extracted Point core crate.
Earlier local checks reused the extracted source under ignored `target/`, so
they did not exercise this clean-build prerequisite.

The repair is to check in the native dependency closure under
`use/computer/vendor/point`, retain revision and license provenance, and use
local Cargo paths. Builds must require neither Point credentials nor a Point
checkout. Keep the existing three-platform CI checks enabled and verify from
a source-only directory with no extracted-source cache.

The source dependency closure is now checked in, and the fetch/extraction path
has been removed. A source-only build passes on macOS with Point access
explicitly denied. A fresh Linux aarch64 container with an empty Cargo cache
downloads only public registry dependencies, passes the same isolated build,
and passes the Xvfb/Tk input-effect suite using that isolated executable.
Native Clippy passes on macOS and cross-checks Windows GNU and Linux musl.
The vendored workspace's tests pass; the native lockfile needs no changes.

CI now runs the source-only build and existing X11 acceptance together. The
original failure is visible in
[master run 40982004604](https://github.com/phodal/pero/actions/runs/40982004604).
The repair at `22cffa3` was pushed to master and passed all three native jobs in
[Computer Use run 40986292506](https://github.com/phodal/pero/actions/runs/40986292506).
No check was skipped or changed to allow failure. Later package-isolation work
is recorded separately in the verification report.

This incident concerns build reproducibility; the
[native input incident](2026-10-30-computer-use-native-access.md) remains a
separate, resolved runtime problem.
