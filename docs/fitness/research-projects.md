---
kind: verification_report
date: 2026-11-02
---

# Local research Projects verification

Scope: [ADR 0028](../adr/0028-local-research-projects.md). This record distinguishes
implemented source and deterministic checks from actual desktop and scientific
acceptance.

## Implemented source

- Stable local research identity, title, goal, optional directory and App resource
  references live in `pero-contracts::research_project`.
- The existing runtime settings path persists
  `WorkbenchPreferences.research_projects`; missing fields restore as an empty
  list. It preserves other settings through the existing writer.
- The workbench overlays saved research entries on the existing directory/shared
  catalog and retains their shared-project association and known checkouts.
- Overview presents the goal and linked records. The existing task, source,
  execution and settings paths retain their roles.
- A Host-acquired public catalog lists Paper papers/studies and Control Lab/Lab
  experiments. Records open in their owning App. Linking, unlinking and explicit
  reference updates change project preferences, not the source objects.
- Catalog loading, unavailable objects, changed observations and read errors are
  explicit states. Catalog observations do not prove scientific validity.

## Completed deterministic evidence

- `node scripts/cargo.mjs test -p pero-contracts research_project`: two tests
  passed. They cover valid/invalid identity and text, optional absolute directory,
  supported App/kind references, stable identity across edits, relinking a new
  revision and unlinking the selected association.
- `node scripts/cargo.mjs test -p pero-runtime settings::tests::preferences_survive_restart_and_preserve_other_settings`:
  passed. The existing temp-file check covers older preferences without the new
  field and persists/reloads a research project while preserving unrelated
  settings.

- `node scripts/cargo.mjs test -p pero-ui --lib research_catalog_preserves_stable_identity_and_unrelated_workspaces`:
  passed. One value table covers title/directory changes with a stable research
  key, directory-free projects, replacement of an existing directory entry while
  retaining its shared ID, unrelated local entries, and shared Projects with
  multiple checkout aliases.

## Acceptance boundaries

An observed catalog revision identifies the public record summary returned by
its owning App. Except for paper content digests, it does not establish a
frozen full source/result version. Reopening a link follows the current App
record; a changed revision requires explicit project-reference update.

No test in the deterministic evidence above establishes real-provider Agent
execution, solver accuracy, reproducibility of a scientific claim, physical Lab
behavior, shared Cloud research Projects, packaged Desktop installation or
production deployment.

## Desktop runtime evidence — passed 2026-11-02

`node tests/e2e/research-projects.mjs` passed against isolated real Electron,
Host and the actual Paper, Control Lab and Lab backends. Synthetic papers and
unexecuted experiment plans were seeded through their existing APIs; no model,
solver or physical experiment was run.

The pointer/keyboard flow verified:

- Creating a project without a directory or account, required-name recovery,
  editing the research goal and retaining identity after renaming.
- Explicitly linking three App records, opening each exact source object, and
  retaining those objects unchanged.
- A failed settings write preserves the saved project and editor draft; retry
  after restoring the file succeeds.
- A symbolic-link directory with a trailing slash is persisted using the Host's
  canonical path, and its actual ROADMAP is loaded.
- Restart persistence, explicit stale-reference update, unlinking without
  deleting the original record, and visible missing-source recovery.
- Light/dark and minimum-window layouts. Screenshots were opened and inspected;
  renderer page errors were zero. Evidence:
  `test-results/research-projects/results.json` and the adjacent PNG files.

`node tests/e2e/local-project-start.mjs` also passed: first-run local browsing,
Overview-to-ROADMAP navigation, sidebar account entry, restart and dark/narrow
layouts remain available without login.

Wasm/web/Host/Desktop development builds, native UI compilation,
`npm run check`, the contracts/UI library tests, Host resource tests and runtime
settings persistence checks passed. Native compilation is separate from native
GUI acceptance. No installed release was rebuilt or production service changed.

## Project navigation — 2026-11-08

Base `1c938e68` with local project UI changes. The project catalog now uses the
shared GPUI list row and groups research projects separately from workspaces and
shared projects. The project header uses the shared dropdown to switch projects.
Project routes remain in navigation history. The window tab strip and its
keyboard cycling use task tabs alongside the existing pane tab behavior.

Research projects open to the goal and an action to link or open materials.
Existing paper, study and experiment links moved from Overview to Materials &
Experiments. The same link revisions, source navigation, recovery and unlink
behavior still apply. Repository and PR browsing has its own clearly named tab.
Local workspaces retain their ROADMAP path under View project tasks. The workspace
path is shown in the overview and execution body so the tab row stays in place.

The running macOS Native Preview was inspected while switching from `pero` to
`pero-ws-b`. The dropdown opened below the heading, showed the current selection
and switched directly to the target overview. The title bar had no project tabs
and the chat toggle was present. The settings and execution headers were checked
visually after moving the path into the page body.

The isolated Electron local-start flow covered keyboard switching to a second
workspace and reading its own ROADMAP without a Cloud account. It also checked
that switching to Settings keeps the tab row in place. The light menu and
narrow dark overview screenshots were inspected in `test-results/local-project-start/`.

The research Projects Electron suite passed using an isolated Python 3.12
environment with the dependencies pinned by Paper, Control Lab and Lab.
Set `PERO_RESEARCH_TEST_PYTHON_ENV` to the prepared environment root when running
`node tests/e2e/research-projects.mjs`. Synthetic records exercised association,
exact source opening, settings-write recovery, restart persistence, stale
references and unlinking. The project overview and linked materials screenshots
were inspected in `test-results/research-projects-workspace-v1/`.

The UI unit suite and repository checks passed. Scientific execution, signed
packages and other Native platforms are outside this verification.

## Project Agent — 2026-11-14

Source: `8a0c5d445844b2571c5b97e55e59fe8df9347593` plus uncommitted Project Agent
changes, in the shared macOS ARM64 checkout. Concurrent PR-viewer changes were
preserved. This work did not switch branches, commit changes, run issue GC,
change production, or replace the installed Native application.

### Implemented ownership and UI

The existing saved ResearchProject owns the persistent goal, source directory
and App resource references. `ProjectSessionBinding` on the original
`session_created` journal binds one primary ACP conversation and its delegated
children. Host/ACP retain prompts, approvals, cancellation and exact-session
loading. The existing App Agent transcript projects execution state; there is
no Project scheduler or second Task/Run state machine.

The Project overview and Project Agent tab are real GPUI entry points. The page
shows the goal, main Agent, delegated work, status, observed tool receipt count,
bounded result excerpts and original errors. Users can open the original chat,
append instructions, cancel work and explicitly request an evidence summary.
The existing shared ChatPanel provides composing and permission cards.
Summaries attach frozen execution evidence through the existing context model;
the normal user message is concise. Existing controls and theme roles are used,
with no token or component migration.

Child sessions get retained detached Git worktrees, or dedicated task
directories for non-Git projects. The primary's acknowledged permission is
applied and confirmed before the child's first prompt. Original tool IDs,
statuses and output excerpts are included in model-facing evidence, with
explicit truncation. These observations do not independently validate a
scientific conclusion.

Actual UI verification exposed and fixed two existing-owner gaps: resolving an
approval now emits a source event so a running shell no longer remains shown as
needing input, and explicit ACP load suppresses historical conversation replay
already retained by Host. Current configuration observations and new turns
remain visible.

### Completed checks

- `node scripts/cargo.mjs test -p pero-contracts project_agent`: 4 passed.
- `node scripts/cargo.mjs test -p pero-runtime lifecycle_tests`: 26 passed,
  including exact-load replay, new prompt delivery, settings, cancellation,
  authentication and the existing workspace lease.
- The existing Run transcript concept test passed with permission-resolution
  rows covering pending approvals, actual progress, cancelling and terminal
  outcomes.
- `node scripts/cargo.mjs +nightly-2026-10-28 test -p pero-host`: 58 passed;
  one existing prepared-Docker scientific test remained explicitly ignored.
- `npm run check` passed. Host, Wasm, Web and Electron development builds passed;
  `node scripts/cargo.mjs +nightly-2026-10-28 check -p pero-ui --features native`
  passed. Native compilation is separate from Native GUI acceptance.

`node tests/contracts/project-agent.mjs` passed eight Host/Harness integration
behaviors against a scripted loopback model and actual shell/Git effects:
read-only inheritance denies writes; full-access uses original approval cards;
primary MCP delegation yields isolated child evidence; follow-ups reach the
original child; missing-Agent admission can recover without an orphan
workspace; changed frozen input rejects request reuse; evidence summaries
inspect actual tool receipts; failure, signal-based cancellation and restart
preserve the original identities. Results:
`test-results/project-agent-contract/results.json`.

`node tests/e2e/project-agent.mjs` passed in actual isolated Electron, Rust Host,
Go Harness, MCP and shell with the same scripted loopback model. Pointer and
keyboard actions covered the discoverable entry, main conversation creation,
permission selection, actual child approval cards, running-to-cancelled flow,
instructions, summary, provider failure, refresh failure retaining results and
draft, and recovery. Restart restored all bindings; an explicit instruction
loaded the original ACP ID, appended the real evidence file, and added exactly
one user/assistant turn without duplicating prior messages. Renderer errors
were zero. The combined entry is `npm run test:project-agent`.

Final screenshots were opened and inspected in
`test-results/project-agent/`: `02-child-evidence.png`,
`04-running.png`, `06-evidence-summary.png`,
`06-refresh-error-retains-draft.png`, `08-narrow-dark.png`,
`approval-6.png` and `09-restored-original-conversations.png`.
The light project page retains direct row actions before long result excerpts;
the dark minimum-window page remains readable after closing the chat with its
visible control. Narrow mode can show the full chat, then return to the project
without losing the instruction draft. Failed, cancelled and completed work have
distinct text states; the existing approval card remains in the original chat.
Results: `test-results/project-agent/results.json`.

### Real provider evidence and remaining limits

A separate real DeepSeek Flash smoke made 5 actual provider HTTP attempts. The
primary naturally delegated exactly one bounded proof task through
`project_work`; the child inherited Full access, received an actual Allow once
reply, and wrote `project-proof.txt` inside its retained worktree. The shell
receipt completed with exit code 0 and the expected text was independently read
by the acceptance script. The primary summary cited the original child and
tool receipt while identifying unverified claims. The original tracked source
diff was empty. Results: `test-results/project-agent-real/results.json`.

The real-provider smoke has no GUI component; the Electron GUI evidence uses a
scripted model. Native GUI, signed packages and other platforms remain
unverified. This is local Project coordination, not shared Project sync or a
remote Task/Run dispatch integration. The first version requires the same Agent
when inheriting an advertised permission policy; incompatible cross-Agent
mapping fails explicitly. Worktrees start from committed HEAD, retain their
changes and are not merged automatically. Non-Git task directories start empty.
Interrupted work is not replayed automatically; original ACP load must be
supported for follow-up after restart. Summaries are explicitly requested, and
this proof task establishes no general research or scientific acceptance.

### Extraction and design review — 2026-11-14

The Project Agent changes were extracted from the shared checkout into the
`codex/project-agent` worktree for separate commits. Concurrent PR-viewer,
protocol and build-tool edits were excluded. The earlier checks and captures
above describe the original shared checkout; independent checks after
extraction passed the four contract cases, 26 ACP lifecycle cases, 58 Host
cases (one existing Docker case ignored), the approval transcript concept
case, repository checks and Native UI compilation. Ignored dependencies and generated font/Wasm
assets were reused locally; none are part of the extracted commits.

The user rejected the current UI. Working controls and readable screenshots
do not establish an acceptable information hierarchy: the status report
occupies the primary space and compresses the actual Agent conversation.
A read-only running Cursor review captured Library, List, Board, the primary
conversation and its compact Agent roster. The proposed conversation-centered
revision is recorded in the existing Project Agent execution plan. No redesign
or Cursor backend behavior is claimed by this review. Keyboard-only operation,
screen-reader behavior, dark mode and narrow-window behavior in Cursor were
not verified.

## Conversation-centered Project Agent — 2026-11-14

Source: `codex/project-agent` at `3df2db4d6` plus the UI revision in this
worktree. Build outputs and dependencies are isolated from the concurrent PR
checkout. No production deployment or installed-app replacement was performed.

The old report and separate instruction form have been replaced by the existing
central ChatPanel, compact primary/child navigation in the global sidebar, and
Project materials on the right. Real artifacts use the original conversation
catalog and Scientific Viewer. Research projects enter this view by default;
Overview remains available. Component/consumer migration is recorded in the
existing Project Agent task record. No theme or icon generation sources changed.

### Checks and observed behavior

- `npm run check` passed (1,250 bilingual messages and 86 shared icons).
- Nightly Rust tests passed: 49 Native-feature Chat cases and one real inline
  image integration case, including bound-session continuation/retarget
  admission; the ordinary suite passed 33 UI cases, 36 Chat core cases and 58
  Host cases with one existing prepared-Docker case ignored.
- Wasm, Host, Go Harness, Scientific Viewer, Web and Electron development builds
  passed. Native UI compilation passed separately.
- Actual isolated Electron L1 acceptance passed all 10 behaviors with 16
  scripted loopback model calls, actual Rust Host/Go Harness/MCP/shell effects
  and zero page errors. The primary stays selected during background child
  creation. Left navigation opens the original child in the central composer;
  real approval cards, append and stop controls use their existing owners.
- The summary was saved through the real message action as a versioned artifact
  with source message ID and SHA-256. Its actual Scientific Viewer preview was
  opened on the right, and switching Materials/Artifacts retained the central
  chat. The narrow resource header no longer overlaps; identity/version
  controls are beneath the titleband.
- Provider failure retained original errors; refresh failure retained the prior
  sessions and composer draft. Left navigation, theme changes and minimum
  window materials/back preserved the draft. Requested 920px width was clamped
  by Electron's existing 1000px window minimum; this is 1000px evidence.
- Restart restored Project membership, original history and the saved artifact.
  Direct input in the same composer loaded the original ACP session ID and
  appended exactly one user/assistant turn, without replaying old messages.
  An externally created session is marked Connecting before it is focused;
  successful creation no longer triggers a duplicate ordinary new-session call.

Electron receipts: `test-results/project-agent/results.json`. Inspected captures
include `01-ready-light.png`, `02-child-evidence.png`,
`06-saved-summary-artifact.png`, `08-narrow-dark.png`,
`08-narrow-materials-dark.png` and `09-restored-original-conversations.png`.
These show real development surfaces with explicitly scripted task text.

Actual macOS Native L1 checks separately observed central main/child Chat,
left navigation, right materials, light/dark hierarchy and a real shell follow-up
after restart with the same ACP identity and no duplicated history. Captures
and receipts are in `test-results/project-agent-redesign-native/`, including
`02-main-light.png`, `03-child-light.png`, `04-resumed-followup-light.png`,
`06-child-dark.png` and `native-followup-verification.json`.

### Limits

The final compact artifact header and Scientific Viewer preview were observed
in Electron. Native's isolated profile did not enable Viewer; its narrow-window
interaction was blocked by the macOS lock screen. Final Native compilation is
separate from these unverified interactions. No lock-screen bypass was attempted.
The new UI was not tested with a real model or in a signed release package;
these scripted flows do not establish scientific acceptance. Full keyboard-only
and screen-reader acceptance remain outside this run.

## PR #231 UI polish — 2026-11-14

The branch was synchronized with current master (including PR discussions)
before UI refinement. The central duplicate artifact header and redundant Main
Agent shortcut are removed. The right materials inspector has a wider reading
column and compact accessible link/refresh actions; the full resources page is
unchanged. Shared user turns have a neutral tonal surface rather than an input
outline, and selected sessions use the existing accent foreground/surface pair.

Repository checks, Wasm/Host/Web development builds, 49 Native-feature Chat
unit cases plus one image integration case, and Native UI compilation passed.
Actual Electron Project Agent acceptance passed all 10 flows with zero page
errors after the control/surface changes; final selection-color screenshots
were also captured in the same `test-results/project-agent/` directory. The
model remains scripted; actual shell, MCP, approvals, artifact preview and exact
ACP restart continuation are exercised. These changes have no additional Native
GUI acceptance beyond the earlier observed scope and final compilation.

GitHub PR: https://github.com/phodal/pero/pull/231. Captures are local ignored
artifacts; the connected GitHub API has no image-attachment upload operation.

PR #231's initial remote Bazel job exposed a stale rules_js input hash for the
added package.json test script. Regenerating with `bazel run @npm//:sync`
changed only that hash; `bazel test --config=ci //:checks` then passed all seven
checks. The existing lockfile incident record contains the recurrence. Remote
CI after the repair is not claimed complete by these local results.


## Default Agent with right Overview — 2026-11-14

Source: `codex/project-agent`, parent `1417f4faf`, with the entry/inspector
change in this revision. Actual macOS Electron acceptance passed all 11 flows
with zero renderer errors. In addition to the existing Host/Harness/MCP/shell
coverage, this run checked:

- Project entry shows the central Agent and right Overview directly.
- Goal editing is bounded inside the right inspector. Cancel retains the
  original central conversation and its unsent draft.
- The right Project views menu opens Tasks; selecting its Overview tab returns
  to the central Agent without clearing the draft.
- Restart restores the project Agent and right context without test-driven
  project navigation, then resumes the exact original ACP session.

`npm run check`, Wasm and Web development builds and Native UI compilation
passed. Final captures inspected include
`test-results/project-agent/01-overview-editor-right.png` and
`09-restored-original-conversations.png`; the final header uses the existing
bundled dots icon and a named Edit goal command. No new token or artwork was
added. The existing real artifact preview, failure recovery and dark/minimum
window flows also passed in the same run.

This is entry/interaction acceptance in Electron. The latest inspector changes
have no new Native GUI, signed-package or screen-reader acceptance. The model
is scripted; raw JSON visible in these fixture replies is explicitly scripted
assistant content, not evidence that a real model produces that layout. The
current broad user bubbles, prominent Projects selection and Composer density
remain visible differences from Cursor. Detailed observations and proposed
shared-component work are in the existing execution plan; matching Cursor's
visual quality is not claimed by a passing behavior suite.

## Cursor-style shared Chat and Project chrome — 2026-11-14

Source: `a216c597f` and its three preceding style commits, plus this verification
revision. User bubbles now fit content on the right, shared navigation selection
uses a neutral fill without an accent outline, Project headers occupy the
existing titleband and the Composer rests on one line with multiline expansion.

Verification completed:

- `npm run check`: TypeScript, theme/design/SDK generation, locales, contracts
  and shared icon checks pass. Catalog typecheck and all three design-token
  tests pass. Sources, not generated outputs, own the new radius/navigation role.
- Native-feature Chat: 49 cases pass. UI: 33 cases pass. Wasm/Web development
  builds and actual macOS Native binary build pass.
- Actual Electron Project Agent: all 12 flows pass, 16 scripted loopback model
  calls, actual Rust Host/Go Harness/MCP/shell and zero renderer errors. Added
  one-line → multiline → one-line checks without submitting the draft. Existing
  approval, cancellation, original ACP restart continuation, saved artifact
  preview, failure recovery and dark/minimum-window paths pass.
- Ordinary Electron Chat: stream, follow-up, stop, permission, long stream,
  reading-position retention, reload, history/draft retention, locale, dark and
  narrow flow pass with zero renderer/Host-event errors. Its fixed input click
  was replaced by the shared Composer's actual bounds after the layout change.
- Actual macOS Native development window: main/child selection, compact input,
  three-line draft expansion and clearing, and light/dark switching were
  observed using the real native controls. The isolated prior Native profile
  was copied for this visual check; no fresh Native tool execution is claimed.

Final inspected Electron captures are in `test-results/project-agent/`:
`01-overview-editor-right.png`, `01-multiline-composer.png`,
`09-restored-original-conversations.png`, `08-narrow-dark.png`,
`06-saved-summary-artifact.png` and `10-cursor-comparison-wide.png`.
The last uses 3840×2298 pixels / 1920×1149 logical pixels at 2× density, matching
the captured Cursor child-conversation reference. Actual Native captures are
`test-results/project-agent-cursor-native/02-multiline-dark.jpg` and
`03-child-light.jpg` (2880×1922 pixels / 1440×961 logical pixels at 2×).

`design-qa.md` records the paired-reference review, an initial double-fill
finding and its correction. No overlap of persistent controls was observed in
the inspected wide and minimum-window layouts. Native Viewer, Native minimum
window, full keyboard/screen-reader, real model and signed package acceptance
remain unverified in this iteration. Fixture markers and raw JSON belong to
scripted replies, not a claim about real-model output or scientific validation.

## Compact execution evidence and clean catalog — 2026-11-14

Source: `21f4bf2f2` plus this follow-up revision. The transcript retains readable
assistant prose and discloses exact same-turn tool receipt echoes through the
existing collapsed tool row. Unrelated or changed JSON remains visible. Original
messages and tool receipts remain in persisted history, and copy/save explicitly
operate on the original reply. Project catalog collection excludes implicit
delegated execution workspaces while preserving explicit saved projects.

Verification completed:

- Actual Electron Project Agent: all 14 flows pass, 16 scripted loopback model
  calls and zero renderer errors. New checks exercise initial collapse,
  expand/collapse, readable prose with the original receipt retained, catalog
  exclusion of all three child workspaces, and retained disclosure after restart.
  Existing approval, cancellation, artifact, failure recovery, dark/narrow and
  exact original ACP-session continuation flows pass.
- Native-feature Chat: all 50 cases pass, including exact receipt, streaming
  prefix, fenced receipt and unrelated/changed JSON cases. Repository checks,
  Wasm/Web builds and the actual Native development binary build pass.
- Ordinary Electron Chat passes streaming, follow-up, cancellation, permission,
  long stream, scroll retention, reload, history/draft retention, locale, dark
  and narrow flows with zero renderer or invalid Host-event errors.
- Actual macOS Native GUI inspection of the copied prior profile confirms both
  older child replies now retain their prose without the echoed JSON wall.
  Tool rows start collapsed; expanding shows the command, stdout and exit code.
  The catalog shows the one saved research project, with no child worktree rows.

Inspected Electron captures: `test-results/project-agent/02-child-evidence.png`,
`02-expanded-execution-evidence.png` and `06-clean-project-catalog.png`.
Native captures: `test-results/project-agent-cursor-native/04-evidence-collapsed.jpg`,
`05-evidence-expanded.jpg` and `06-clean-catalog.jpg`. Captures remain local,
ignored artifacts; no screenshot binaries are committed. Native inspection uses
persisted scripted execution history, not a new Native tool run. Real-model,
scientific acceptance, Native Viewer/minimum-window and signed-release scope
remain unverified.
