---
kind: feature
status: implemented
github_issue: 14
github_state: closed
github_url: https://github.com/phodal/pero/issues/14
---

# Project-first sidebar and task workspace

## Task detail/list flicker (2026-10-29)

The renderer optimistically changed `selected_task_id`, but the Desktop adapter
published the previous selection with `loading: true` before applying
`remote_select`. Every navigation could therefore flash back to the previous
screen until the HTTP response arrived. Queued polls could also overwrite the
optimistic selection. Selection must have one owner: the Cloud adapter applies
the requested selection before publishing loading, and the renderer displays its
snapshots without independently changing that field.

Reproduced in actual Electron by holding the task-detail HTTP response: after
opening task_1, the visible snapshot reverted to the list (`selected_task_id:
null`). The regression also holds the list response after Back to ensure the
detail does not return while waiting. After the fix, the full actual Electron
sidebar suite passed, including both held-response cases, queued-task device
setup without enrollment/dispatch, project scope, restart, light/dark and narrow
windows. Screenshots are in `test-results/sidebar/03-task-loading.png`,
`03-back-loading.png`, `03-queued-local-execution.png` and
`03-task-device-setup.png`. TypeScript/theme/locale/contracts checks, 14 UI unit
tests, the native UI check and Wasm/Web/Desktop development builds passed.
The running user Desktop must restart to load the changed main-process adapter.

## What and why

The sidebar currently separates Cloud tasks and infrastructure from local
sessions. A second session column takes space from the conversation. Routine
Host readiness and task totals repeat status without offering an action.

The approved design uses one sidebar, recent work grouped by project, and a
project workspace whose first tab is Tasks. Projects belongs directly below
New chat. Insights replaces the proposed Pulse name. Global preferences and
connections belong in a footer settings popover.

## Scope

- New chat, Projects, project-grouped recent sessions/tasks, Insights, Apps,
  and a fixed footer settings menu. Remove Cloud/Local groups and routine
  running/attention/Host-ready summaries.
- Project workspaces open Tasks first; preserve task creation, filtering,
  dispatch, progress, cancellation, source navigation and pagination.
- Project sources and execution resources use the existing owners. Agent
  configuration is named separately from execution environments. Do not
  invent environment provisioning, Playbook or a Desktop task marketplace.
- Global connections and execution resources open from the settings menu;
  language and appearance have second-level choices. Preferences use the
  Host settings store, including light/dark/system appearance.
- Insights shows actual actionable session/task state and links back to the
  owning record. It does not manufacture approvals or unsupported reminders.
- Preserve unrelated in-flight composer/native changes in the working tree.

## Acceptance

- One sidebar; Projects immediately below New chat; Insights naming is
  consistent in English, Chinese and the roadmap.
- Project selection opens its task view and never shows another project's
  tasks. Local history retains its original workspace grouping after replay.
- Sidebar collapse, recent work selection, new chat and task detail work.
- Settings menus work with pointer and keyboard, dismiss on Escape/outside
  click, and offer explicit language/appearance choices.
- Appearance and language survive restart; save failures have visible feedback.
- Light/dark, narrow windows, empty/error states and actual Desktop interactions
  are verified with screenshots and an isolated fixture profile.

## Verification

Implemented and verified locally on 2026-10-29, on the working tree based at
`bd15dd7`. Parallel work subsequently recorded local commits through `9549cfb`;
additional UI fixes remain in the working tree. This chat did not push or publish
an application/service release. GitHub issue #14 remains open for integration/review.

- `npm run check`: TypeScript, theme, 455 bilingual messages and protocol
  generation checks passed.
- Rust contracts/runtime/UI: 52 tests passed, including project identity,
  task status selection, preference persistence and existing ACP lifecycles.
- `node tests/contracts/host.mjs`: Host JSONL conformance and invalid preference,
  save/get/restart checks passed.
- `npm run test:sidebar`: actual Electron project scope/detail/back, configuration
  save without overwriting the task draft, cross-project pagination, Insights,
  footer menus, system/light/dark themes, restart, save-error recovery, history
  and narrow windows passed.
- Conversation and tool-call fixture suites passed after moving gestures to the
  single sidebar. Stream cancellation, approval, long-stream following, replay,
  structured tool results and attached context remain available.
- `npm run test:apps`: actual Virtual Cell Python computation, imported data,
  theme/locale, narrow layout, navigation retention, disable/re-enable and restart
  passed. Settings submenus no longer sit underneath the App iframe; the iframe
  document is retained while temporarily hidden during the menu.
- `npm run test:i18n`: Desktop preference restart and bridge-free browser
  language/appearance checks passed.
- `npm run test:remote-settings`: encrypted connection persistence, failure and
  disconnect recovery passed.

Screenshots and fixture snapshots are in `test-results/sidebar/` and
`test-results/apps/`. Visual comparison and boundaries are in
[design-qa.md](../../design-qa.md). These are L0/L1 development checks, not
packaged Desktop, production or real remote-compute acceptance.


## Duplicate local/shared Project groups (2026-10-29)

Observed: the sidebar showed two `pero` groups. The first represented the local
checkout and its conversations; the second represented shared Project `pero`.
The catalog merged only saved workspace bindings, so matching display names did
not establish identity. The actual checkout's origin is
`git@github.com:phodal/pero.git`, while the shared source declares owner `phodal`
and repository `pero`.

The Host now reports the opened checkout's actual origin as normalized repository
identity in its workspace event. The catalog reconciles that full identity with
an unambiguous shared repository mapping. Explicit saved bindings take priority;
a different owner/host or a repository serving multiple shared Projects remains
separate. Known workspace aliases retain their conversations in the reconciled
group, and selection follows the retained identity when metadata arrives.

Verification: six contract tests passed; three Project domain tests passed,
covering SSH/HTTPS normalization, same-name repositories under other owners,
ambiguous mappings and explicit binding precedence. A Host shell test initialized
a temporary Git checkout, read its actual configured origin and verified that a
non-repository directory supplies no repository identity. Native check, Host/Wasm/Web/Desktop development builds passed. The actual
Electron sidebar regression passed with no saved Project bindings: one `pero`
group contains local history and shared tasks. A second temporary checkout named
`pero` with origin `another-owner/pero` remained separate after the Host observed
its metadata. Existing task navigation, settings, restart, light/dark/system and
narrow-window checks also passed. Screenshots:
`test-results/sidebar/01-project-tasks.png` (merged group) and
`test-results/sidebar/13-distinct-repository-homonym.png` (distinct repository).
These are isolated development/fixture checks, not packaged release acceptance.
