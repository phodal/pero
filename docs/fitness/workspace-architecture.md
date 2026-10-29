---
kind: verification_report
date: 2026-10-29
---

# Workspace navigation and layout architecture

Target: macOS arm64, development Electron, L0/L1. Decision:
[ADR 0013](../adr/0013-workspace-content-tabs.md).

The refactor replaces numeric navigation and independent active-content fields
with `WorkspaceNavigation`: one ordered open list and one named Page/Content
route. `ConversationTab` names Chat and Logs; legacy numbers remain only in the
read-only Wasm diagnostic snapshot. `AppCatalog` owns availability, not selection.

UI actions, Host events and observed source changes reconcile content and carry
out activation. Render no longer opens content, changes conversation scope or
applies execution configuration. Native and Wasm delivery supply the actual
Window at the event boundary. Task pagination follows the mounted list's prepaint.

`WorkspaceLayout` owns effective sidebar/Chat dimensions, narrow-window behavior
and App visibility. The App surface combines that plan with its actual prepaint
bounds; saved width remains a Host-owned preference.

The source rules covered in this slice are:

- Ordinary remote snapshots update data without opening a Workbench route.
  The route decides Task list/detail presentation. Details become actionable
  only when the route, adapter selection and loaded detail identify the same Task.
- History replay preserves an explicitly opened Conversation, including an
  empty draft opened while initial history is pending. A Conversation page
  without content adopts its restored selection.
- Repository discovery can merge Project aliases into one canonical identity.
  Open order and selection survive; correcting identity does not reopen the Host
  source. Removing background sources keeps the current utility page visible.
- The Apps navigation entry opens the library. Its retained content tab restores
  the existing iframe and edited document. Closing content does not delete or
  stop its source.

## Frozen source verification

Base: `10d1d32`. Exact source tree:
`614ca73460fbdf9fa8f8d6b64ea2cc1b86c721eb`.

The selected architecture files and three related Electron scripts were exported
into an independent source snapshot. Concurrent App Use, context preview and App
write implementations were excluded; the two ChatAction dispatch branches needed
only by those parallel features were omitted against the baseline ChatPanel.
The snapshot had a separate build directory, disposable profiles and loopback
fixtures. It used the same local GPUI Kit checkout as the development build.

| Level | Check | Observed result |
| --- | --- | --- |
| L0 | `npm run build` | Passed: Apps, both Wasm entries, Host, Worker, Web and Desktop |
| L0 | `npm run check` | Passed: TypeScript, theme, 536 bilingual messages, contracts and 48 icons |
| L0 | `npm test` | Passed, including 30 navigation scenarios and 13 pure-layout scenarios |
| L0 | Native `pero-ui` check | Passed; compilation only |
| L1 | `tests/e2e/workbench.mjs` | Streaming, permissions, scroll, reload, delayed initial history, locale and themes passed |
| L1 | `tests/e2e/sidebar.mjs` | Held HTTP selection, background Task observation, project scope, settings and recovery passed |
| L1 | `tests/e2e/workspace.mjs` | Ten content/Chat/layout/retained-document workflows passed |
| L1 | `tests/e2e/apps.mjs` | Actual Python calculation/import, library/tab return, retained inputs and disable/restart passed |
| L1 | `tests/e2e/local-roadmap.mjs` | Workspace switch, pending Cloud, ACP fixture file effect and recovery passed |
| L1 | `tests/e2e/local-execution.mjs` | Enrollment, one completed Worker/ACP fixture Run, restart, Stop/Resume and account recovery passed |

Electron suites ran sequentially in hidden real windows. All six reported no
frontend errors. Captures were inspected for the task list after a background
selection update, the narrow shared Chat and the App library with its retained
content tab. These are development fixture results, not real-provider or package
acceptance.

Evidence is retained in `test-results/workspace-architecture/`: `verification.json`
contains commands and source identity, `source.patch` reproduces the selected
delta against the base, and each suite has its log and captures. In particular:
`workbench/history-retained-draft.png`,
`sidebar/05-observed-task-keeps-list.png`, `workspace/narrow-chat.png` and
`apps/app-library-retained-tab.png` show the added routing checks.

## Limits

The mixed working tree also contains parallel App work. Its initial TypeScript
check encountered incomplete App write wiring, and its new App Chat transport
was ahead of its Desktop build. After that wiring was available, the assembled
working tree passed `npm run check` (538 bilingual messages), `npm run build`,
`tests/e2e/workspace.mjs` and `tests/e2e/apps.mjs`, with no frontend errors in
either suite. Those additional logs and captures are in the evidence folder's
`integrated/` directory. The frozen-source results remain independent of these
parallel features; the integration rerun does not certify App Use/context/write
operations.

Native was compiled but not exercised as a running preview. No native WebView,
arbitrary website embedding, free pane docking, persisted content tabs, new
execution authority or signed package was added or verified.
