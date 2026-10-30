---
kind: incident
status: resolved
github_issue: 50
github_state: open
github_url: https://github.com/phodal/pero/issues/50
---

# Recover MCP settings after configuration and transport failures

Read-only review of PR #53 head `c170a8e` identified two recovery defects that
the successful CI and first-stage UI acceptance did not exercise.

1. A later operator server with the same name as a stored managed connector
   caused the Host to reject both reading settings and replacing them, including
   removal. New sessions failed with an instruction to repair settings, but the
   UI could not perform that repair. A real Host fixture reproduced the lockout.
2. A rejected Desktop IPC call becomes a generic error event. The MCP page only
   settled its MCP-specific responses, leaving the request pending and controls
   disabled. A sandboxed headless Electron fixture reproduced the stuck Reload
   action. Disconnection requires the same pending-state reconciliation.

The review also found a receipt-ordering problem: the UI suite wrote success
before Electron and fixture cleanup. A cleanup failure could leave a successful
JSON artifact even though the process correctly failed.

## Correction boundary

- Keep managed configuration structurally valid and operator values private, but
  separate safe settings retrieval from execution admission. Validate replacement
  configurations and revisions before persistence; conflicting execution stays
  fail-closed until the user repairs it.
- Settle only correlated generic errors, or invalidate pending work on Host
  disconnection. Keep drafts until explicit cancellation. A lost save response
  has an unknown outcome: require a reload before retry, never replay it silently.
- Emit a successful acceptance receipt only after cleanup succeeds. Preserve
  diagnostic evidence and a failing exit status on cleanup failure.

## Acceptance

- [x] Operator-name collision can be inspected and removed through real Host
      requests without exposing operator configuration or bypassing revisions.
- [x] Actual UI transport rejection releases busy state and permits recovery;
      unrelated errors do not settle MCP work, and drafts are retained.
- [x] Disconnect/lost-save outcomes require reconciliation before another write.
- [x] Cleanup failure cannot produce a successful receipt.
- [ ] Existing full UI workflow, contract checks and exact-head CI pass.

These are first-stage recovery fixes, not the later live MCP catalog, per-tool
policy, credentials or MCP Apps work. No real model call or secret is needed.

## Verified correction

The real Host fixture now reads the colliding managed entry, rejects a stale
revision, permits current-revision removal and starts a new session afterwards
with the operator entry preserved. Execution before repair remains rejected.

The complete sandboxed headless Electron suite passed all **18** groups on the
unchanged final test source. Transport rejection clears busy state, retains the
draft, ignores an unrelated error and blocks replay until real Host reload.
Disconnection preserves the draft and requires reconciliation. The original
CRUD/search/grant/restart/import/locale/theme scenarios remain covered.

An explicit negative run completed real Electron and fixture cleanup, then
injected a cleanup failure. It exited with status 1, retained the failure record
and produced no success receipt. The following exact-source positive run exited
0 and wrote its receipt only after cleanup. This negative check is an opt-in
fixture mode, not an additional always-on CI job.

Local Rust tests (76), generated/type/locale/icon checks and Host acceptance
passed. Full headed exact-head CI is the remaining publication gate; its final
receipt belongs in the PR rather than another documentation-only rerun.
