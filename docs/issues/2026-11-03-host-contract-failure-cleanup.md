---
kind: issue
status: open
date: 2026-11-03
---

# Host contract failure leaves its working directory owned

Windows CI run 41574184230, job 125716903706, built and passed Rust tests but
failed Host contracts at `rmSync(temp)` with EBUSY. The contract catch stored
its original error for a later report, while finally removed the working
directory without stopping the active Host. The cleanup exception masked the
original error. Successful stops also waited for process exit, not stdio close.
The log does not identify the original contract error or prove that EBUSY was
only transient; Windows build evidence upload was skipped.

Retain ownership of each launched Host through finally. End stdin and await an
idempotent ChildProcess close promise before removing the temporary directory.
Record process and cleanup failures alongside the original contract error, so
cleanup never turns failure into success or obscures diagnostics. No removal
retry, delay or widened timeout is used.

The regression executes the real contract script with a real Node child whose
cwd is the test directory, induces its early event-wait failure, and verifies
that child close precedes directory removal. It also injects a cleanup error and
requires both errors in the failed report. Both cases fail on the old code and
pass with the fix. The ordinary fast CI job already includes scripts/ci/*.test.mjs.
Native Windows Host contract validation remains required; this test proves
ownership and diagnostic preservation, not the hidden original contract cause.

Review also reproduced an asynchronous stdin EPIPE: a live Host closed fd 0
before the next contract write. The harness now records this error, rejects
pending event waits and retains the failed result while finally awaits owned
close. A real-child regression reaches the write and releases the child over IPC
only after the pipe error, verifying diagnostics and cwd removal without sleep.
