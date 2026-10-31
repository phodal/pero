---
kind: incident
status: open
date: 2026-10-31
---

# CI delays integration failures behind serial acceptance

A passing CI run took about 30 minutes although repository caches hit. Linux
combined compilation with 22 minutes of serial Desktop scenarios. An unbounded
scenario could hide subsequent failures until the job timeout. Meanwhile master
changed beneath a long-running PR, requiring another full run and exposing
unrelated generated-file and fixture integration failures late.

The fix separates independent Desktop scenarios, reuses an exact-revision runtime
artifact, caches previously uncached pinned tools/independent Cargo targets,
and retains complete mode-specific gates. The user subsequently requested normal
Linux-only CI, with all platforms retained in daily/manual full runs. Each scenario has its own timing/failure
receipt and bounded test-owned cleanup. The first split run still took 16m07s with cold build caches and found three
Control Lab failures. The user then authorized ordinary critical smokes with
slow complete scenarios in daily/manual runs. A later cold run still took 14m58s, so the user authorized moving complete
Desktop compilation and GUI to daily/manual too. Ordinary runs now check
independent types, core runtime and real stdio/permission/recovery contracts.
All tests remain in the full tier;
moving a failing test is not treated as fixing it.

Baseline fixes included here do not reduce coverage: Windows npm is launched via
Node rather than executing a `.cmd` file directly; the ACP presentation fixture
explicitly accepts the existing built-in HTTP connector configuration; MCP user
server assertions still independently validate that built-in connector. The
source TypeSpec generator initially removed orphan Terminal types found only in
the generated output. A later master added the actual Terminal source and
implementation: the fast contract gate detected the changed merge input in 19
seconds, before compilation. After synchronizing that master, regeneration now
retains its complete Terminal contract. This early failure is not a passing
ten-minute CI measurement.

That master also introduced an external Point SDK/runtime build prerequisite
without a CI supplier. At the user’s request the unused external adapter, its
private Project binary and dedicated routes were removed, rather than bypassing
the build check or copying external source. Ordinary Pero App installation,
preparation, backend permissions and Terminal remain. Desktop builds and runtime
artifacts no longer require a Point checkout.

The first independent-core run exposed a real Worker journal ownership race:
closing the owner's file descriptor does not release a Unix flock while a
forked/duplicated descriptor still refers to the same open-file description.
A deterministic duplicate-descriptor regression fails on the prior code without
sleep or parallel scheduling assumptions. A private non-cloneable lock guard
now explicitly unlocks at the owner boundary, including errors after acquisition;
a failed acquisition never creates that guard. The regression retains exclusive
ownership and proves an old alias cannot release a subsequent owner's lock.
The original durable-claim and cross-platform reopening assertions remain.
See the [flock ownership contract](https://man7.org/linux/man-pages/man2/flock.2.html).
This is a correctness repair, not a retry or removal of the failing test.

The incident remains open until real Actions measurements demonstrate the target
and full coverage on the new exact head. See `docs/fitness/ci-feedback.md` for the
baseline, coverage mapping, cold/warm distinction and measurement procedure.
