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
