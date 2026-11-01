---
kind: analysis
status: resolved
date: 2026-11-01
---

# Repeated cancellation interrupted PC-Gym cleanup

The POSIX CLI restored its previous SIGTERM handler before terminating and waiting
for its worker. A second App cancel or close could then kill the CLI during that
wait, leaving the worker and a running receipt/lock behind.

A real stdlib-only worker marks receipt of the owner's first terminate signal and
continues running. Sending the second signal after that marker reproduced owner
exit -15 with the worker still present, a running receipt and the retained lock.
The marker synchronizes the cleanup window; this is not a timed-sleep assumption.

The existing owner now treats repeated SIGTERM idempotently and restores the
caller's handler only after worker cleanup and receipt persistence. The same test
passes: the stubborn worker is killed and reaped, the receipt is cancelled, and
the lock is removed. No scientific engine is used. Windows TerminateProcess does
not share POSIX signal semantics and remains unverified; the shipped App still
has local compute disabled.

A follow-up review found that repeated SIGINT (CLI interrupt) still used Python's
unguarded KeyboardInterrupt handler. The same synchronized fixture reproduced
SIGINT→SIGINT and SIGTERM→SIGINT interrupting cleanup, leaving the worker present
and the receipt/lock unresolved. Both signals now use the same idempotent handler;
both previous handlers are restored after cleanup and persistence. The real
process regression covers all four SIGTERM/SIGINT pairs and handler restoration.
