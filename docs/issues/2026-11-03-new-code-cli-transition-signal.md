---
kind: incident
status: resolved
---

# File-backed state input avoids a host Node argument failure

The actual CLI/ACP two-repository new-code fixture created its request, session
binding and both worktrees, then its original state-store process exited with
SIGKILL and no diagnostic while parsing an inline JSON payload. No transition
was counted as successful and no state file was edited directly.

Further isolation reproduced the same failure outside Harness: on this host,
Node file entrypoints with a sufficiently large JSON argument could terminate
before their first statement, with both Node 22 and 26. A Node `-e` entrypoint
accepted the same input. Smaller original-script fixtures passed. This narrows
the failing boundary but does not identify the host or Node root cause; it is
not evidence of a Harness process-kill defect or a confirmed upstream bug.

The explicit P08 source migration adds mutually exclusive `--payload-file` and
existing `--payload` inputs to transition/annotate. The file contains input JSON;
the original CLI remains the only owner of state transitions, revisions and
events. Skill guidance selects a request-local input file for large objects.
The migration checks exact before/after SHA-256 and is idempotent. It does not
change Harness hooks, publish verification or process cancellation.

Verification: six migration tests passed, including real Node JSON-file input,
inline compatibility, ambiguous input and malformed JSON rejection. The selected
plugin's 62 original Node tests passed. The opt-in actual CLI/ACP race regression
passed with two real Git repositories and local bare remotes: write guard,
failing tests and Stop continuation, repair, independent agent reads, stale-HEAD
publish refusal, retest, local publication, explicit completion and cleanup.
Its HTTP model is a loopback fixture, not real-model development acceptance.

This incident is resolved by the verified input-path workaround. The underlying
host SIGKILL cause remains unknown; no general Node runtime fix is claimed.
