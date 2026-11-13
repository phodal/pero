---
kind: verification_report
date: 2026-11-05
---

# Conversation artifacts

This increment gives ordinary conversations an explicit list of delivered outputs
and versioned previews. It reuses the shared Chat, Host session identity and
`ContentDocument` reader and Scientific Viewer renderers. An artifact is a delivered snapshot, not an execution
Run or a scientific verification verdict.

## Scope and ownership

`SessionArtifact` owns a stable item ID and consecutive versions. Each version
records SHA-256, byte count, format, capture time and its source reference. The
profile-owned Host store retains the catalog and captured bytes independently of
open document tabs and current workspace files. Reading a saved version checks
its bytes against the recorded digest and size.

Direct text snapshots are limited to 2 MiB. File deliveries support UTF-8 text,
Markdown, JSON/JSONL, code, CSV/TSV, PNG/JPEG/GIF/WebP/SVG, PDF, HTML and saved
notebooks up to 10 MiB. The snapshot is captured when delivered; it does not claim
to be a creation-time execution snapshot or a complete dependency record.

Adding a saved version to a prompt uses Host `artifacts.context`: raster images
retain their original bytes as image context; text files up to 128,000 bytes
retain their exact text. PDFs and larger text files produce an explicit
reference-only context with the selected version, digest and read-only Host
snapshot path. The existing per-turn context limits still apply. A reference
does not claim the model has read the file or substitute the original workspace
file for the selected snapshot.

Scientific Viewer receives one exact version through the App's same-origin
`/host/artifacts/<thread>/<artifact>/<version>` route. Shells consume the private
`artifact_snapshot_result` before publishing public events, read the verified
Host snapshot and return bytes plus filename, digest and media headers. The
private descriptor is not an App API. Static resources use `apps.resolve_static`
without preparing or starting Python. The existing AppUse input grants remain
bound to AppUse tasks; ordinary artifact preview does not create such a task.

The shared `deliver_artifact` MCP tool accepts `path`, optional `title` and
optional `artifact_id`. Supplying an existing item ID creates its next version;
omitting it creates a new item. The tool supplies no conversation argument:
the actual MCP caller comes from the existing Host-injected `x-pero-thread`
header. Native and Electron use the same MCP definition. The Host owns original
session workspace admission, file reading and persistence. A relative path is
resolved inside that workspace, and a canonical path outside it is refused.

Delivery is independent of which conversation or App panel is visible. The MCP
adapter requires the existing Host event projection to show a running caller;
cancelled, finished and unknown callers cannot dispatch. Manual Host import into
a historical conversation remains available. Delivery uses the calling Agent's
existing permission policy and adds no App task, separate
approval prompt or execution system. A lost/closed request does not authorize
automatic resubmission: the Host may already have captured the version.

Source message/tool IDs are attribution references rather than trusted
attestation that an execution produced the content. Saving, hashing and rendering
an artifact do not verify its numbers, citations or scientific conclusions.
App-owned records retain their existing owners; this slice does not copy them
into a second scientific database or add a general workflow/capsule system.

## Source and loopback evidence

On 2026-11-05, the following command passed all 29 cases, including delivery and
the existing App Use, plugin, App context, bounded-research and content-read
regressions:

```sh
node --test desktop/src/main/artifact-delivery.test.ts desktop/src/main/apps-frames.test.ts desktop/src/main/app-use.test.ts desktop/src/main/app-agent-plugin.test.ts desktop/src/main/app-context.test.ts desktop/src/main/control-lab-goal.test.ts desktop/src/main/content-artifacts.test.ts
```

The delivery checks exercise the actual loopback MCP adapter and shared Host
receipt transport:

- A plain conversation can discover and call delivery without a selected App.
- The transport uses the actual caller even when another conversation is selected.
- Conversation arguments and malformed delivery fields are rejected before dispatch.
- An unwired shell does not advertise or accept delivery.
- Cancelled, finished and unknown callers cannot dispatch delivery, while another
  selected conversation does not prevent a running caller from delivering.
- Host receipts correlate by both request and conversation; failed, aborted and
  closed waits reject, and late receipts cannot revive them.
- Private snapshot descriptors are consumed even after their request ends.
- The Electron App route serves real temporary snapshot bytes and media headers,
  rejects foreign App origins and unsupported requests, and resolves App enable
  state without invoking backend startup. Only Electron's file transport and the
  Host request port are substituted in these route tests.
- Existing bounded content reads remain scoped to their source conversation.

`npm run check` passed TypeScript, generated theme/design, bilingual messages,
generated contracts and shared-icon checks. `node tests/contracts/host.mjs`
passed Host protocol conformance, observing 40 of 97 declared event kinds. That
base suite does not trigger the artifact event kinds; the integration below
exercises the real artifact success and error paths separately.

The unit/loopback transport tests use a supplied Host port; they do not establish
Native presentation, real Agent delivery or packaged Desktop acceptance.

## Actual Host and ACP-fixture integration

`node tests/runtime/session-artifacts.mjs` passed against the newly built
`target/debug/pero-host` on 2026-11-05. It starts an isolated Host profile and the
existing ACP fixture without a model request. The MCP client uses the exact
endpoint and caller header injected by Host into the fixture's actual ACP
`session/new` configuration. Shared `DesktopAppUse` and `HostArtifactDelivery`
dispatch to the real Rust file store and return its receipts.

The run proves exact historical versions, original session workspace binding
after UI workspace changes, background delivery while another Chat is selected,
outside-file and foreign-item rejection, cancelled-caller rejection, and reading
the retained snapshot after Host restart and source-file removal. It also rejects
a new text import after its destination conversation is deleted.

The rich-format run delivers Python, CSV, SVG, PNG, HTML, PDF and `.ipynb` files
through that same MCP endpoint and compares each resolved Host snapshot with its
original bytes, size, media and SHA-256. PNG versions 1 and 2 remain distinct
after restart and removal of all source files. Context requests preserve raster
image bytes and small table text; PDF and larger CSV context explicitly carry
only the fixed snapshot reference. Foreign artifacts and unavailable versions
return private failure envelopes without a path. Every artifact request and
response is validated against the generated schema.

It records the Host binary digest and all 19 observed checks at
`test-results/session-artifacts-host/result.json`. Temporary profiles, source
files and fixture processes are cleaned up by the script.

This is real local Host/MCP I/O with a fixture conversation. It does not exercise
a model choosing the tool, Native/Electron UI or scientific acceptance.

`tests/fixtures/session-artifact-agent.mjs` keeps the original Markdown scenario.
A prompt containing `rich` or `丰富` additionally selects its rich scenario:
seven synthetic files are written inside Host's actual session workspace and
delivered with real MCP calls. Repeating that scenario supplies each returned
artifact ID and creates new versions of those same items. Its test-owned
`agent-state.json` records delivery receipts for UI inspection; saved Notebook
outputs and displayed numbers remain synthetic, unverified fixtures.

## Rich renderer and Native evidence

The production Scientific Viewer artifact entry shares its renderers with the
existing file viewer. `node apps/scientific-viewer/test/artifact-browser.mjs`
and the same command with `PERO_VIEWER_BROWSER=webkit` pass in Chromium and
WebKit. The fixture substitutes only Host bytes and SDK Chat replies. It checks
Markdown, CodeMirror, CSV table/graph, image bytes, sandboxed HTML, PDF.js canvas
and extracted page text, and saved Notebook cells, code and outputs. It checks
pending, failed and successful compose acknowledgements, actual SDK themes,
320px overflow, digest rejection and retry. Screenshots and separate engine
results are in `test-results/session-artifacts-viewer/`.

Native acceptance on 2026-11-05 used the newly built `pero-native`, real local
Host and the local ACP fixture in `test-results/session-artifacts-rich-native/`.
The isolated bundle, profile, App installation and workspace do not use the
user's ordinary Native Preview profile. The Host wrapper establishes the real
session working directory; `session_created` and fixture receipts record it.
This is ordinary Chat, with no App Use task or model/provider request.

Observed through the running Native UI:

- Seven actual file deliveries populate one conversation. Python source, PNG/SVG,
  CSV, PDF, HTML and saved Notebook render through Scientific Viewer. Saving the
  ordinary assistant reply creates an eighth Markdown artifact and previews it.
- Adding PNG v1 produces a real image context. Quoting PDF page 1 adds its
  extracted text and the exact PDF v1 reference to the original composer. The
  next actual ACP prompt contains the original 848 PNG bytes, rather than a
  filename or a later image. Its PDF reference names v1 explicitly.
- That second prompt produces v2 for all seven original items. PNG v1 and v2
  remain visually distinct, and returning from v1 expands its original delivery
  tool rather than the latest delivery.
- After closing and relaunching Native and moving all source files out of the
  original workspace, retained versions still render from Host snapshots.
- Deliberately damaging only the isolated PNG v2 snapshot produces a visible
  read failure and Retry. Restoring the original bytes and clicking Retry
  displays the image again. The retained file was restored exactly.
- Dark and light themes and an actual 1000px-wide Native window were inspected.
  The compact preview occupies the conversation region; Return to source
  restores the conversation. Notebook warnings remain visible.
- Tab exposes a visible focus outline on SVG zoom controls; Return changes zoom
  to 125%. The final embedded toolbar keeps only selection/page quotations;
  whole-artifact context has one outer action. A final PDF quotation queues the
  exact v2 reference and a short file/version title, without putting internal
  IDs or hashes into the visible draft.

Native inspection caught two platform faults that Chromium checks alone missed:
the navigation handler refused the sandboxed HTML `about:srcdoc`, and JupyterLab
called `requestIdleCallback`, absent in WKWebView. The artifact page now permits
that exact embedded document, while the iframe retains an empty sandbox and
script-free CSP. The standalone Notebook entry supplies the missing scheduler,
retains widgets across theme changes and exposes loading/failure/retry states.
The repaired Native HTML displays its script canary unchanged; Notebook v2
shows the saved `value = 9` code and output `9`, without starting a kernel.

Native screenshots include `code-dark.png`, `image-dark.png`, `csv-dark.png`,
`pdf-dark.png`, `pdf-context.png`, `image-v1-after-update.png`, `source-v1.png`,
`narrow-image.png`, `html-light.png`, `notebook-light.png`, `snapshot-error.png`
and `snapshot-recovered.png`, plus `svg-keyboard-zoom.png` and
`final-pdf-context.png`. `result.json` separates file assertions from
manual CUA observations; `binaries.json` records the tested binaries. Screenshot
files and isolated profiles are local verification output, not source assets.

`npm run check`, Native build, Wasm checks, Web build and all 22 shared Chat
unit tests pass. Native builds/tests use the repository's existing
`+nightly-2026-10-28` toolchain; the default stable toolchain cannot compile the
existing GPUI macOS `map_or_default` calls. Existing dead-code and generated
Wasm eval warnings remain.

## Finder-style browsing

The 2026-11-05 Finder increment replaces the fixed small catalog above the reader
with Icons (default), List and Gallery. Chat owns the selected exact version and
Host-backed `artifact_view` preference. Native and Web reuse one browser page for
the current conversation and update its typed catalog through App context. No
new artifact storage or execution route is introduced.

Single click selects; double click or Space opens quick look; Esc/Back restores
the selected item, focus and scroll. Gallery places the shared reader above a
horizontal film strip. Actual images and small text snapshots supply thumbnails;
PDF, Notebook, CSV and HTML use the shared content icons. Import is in the plus
menu; the optional path field can be cancelled. Source return, Update and
whole-artifact context remain outer Chat actions. Source/PDF quotations carry an
explicit artifact/version target through the same Host context admission.

Native inspection used the retained eight-item rich profile above and the newly
built binaries, separately recorded in
`test-results/session-artifact-finder-native/binaries-accepted.json`:

- Icons, List and Gallery preserve the selected PNG historical version. Space
  and Esc return to the selected item with a single visible thumbnail ring.
- The saved List preference survives Native/Host restart. Original source files
  remain relocated; previews still use retained Host snapshots.
- Light and dark layouts, a 1002px-wide window, narrow source return, import
  cancellation, code quick look and the centered image canvas were inspected.
- A PDF v2 page quotation reaches the original composer and receives actual
  success acknowledgement. PNG v1 whole-artifact context retains v1 identity.
- Two additional synthetic Markdown files of exactly 70,000 bytes each were
  manually imported in this isolated profile, bringing it to ten items. With A
  attached, quoting a real selected word in B exceeds the existing aggregate
  text limit. Viewer displays one rejection, while the draft and A attachment
  remain unchanged. Removing A and retrying that same selection inserts B v1
  and the selected text, clears the error and reports success.
- The last selected item scrolls into view in Icons. Gallery still automatically
  reveals the selected film tile. Final captures include `handoff-gallery.png`,
  `capacity-rejected-final.png`, `capacity-recovered-final.png` and
  `selected-last-item-visible.png`.

The acknowledgement check caught and fixed an early-success bug: queueing a
Composer insertion is insufficient evidence of admission. `ComposerDraft` now
admits the complete proposed addition as values before UI edits; actual insertion
completion determines the reply. Active edits retain their existing undo path.
The incident is recorded in
`docs/issues/2026-11-05-artifact-compose-ack.md`.

Production browser CUA checks separately cover empty/invalid context, quotation
failure and retry, 360px dark overflow, exact scroll/focus restoration, gallery
zoom and a 300px two-column keyboard layout. External append/select of a ninth
item was verified in Safari; the selected tile is fully visible without manual
scrolling. See `test-results/session-artifacts-finder/result.json` and its
additional keyboard/append screenshots. This browser fixture substitutes catalog,
Host bytes and parent replies; Native checks above use the real local Host.

The final Native build, full Wasm build, Web build, `npm run check`, 23 shared
Chat unit tests and 23 Viewer concept/byte tests pass. Design comparison is in
`test-results/artifact-finder-design/design-qa.md`; full and normalized Native
captures are local evidence, not committed product assets. An existing Notebook
MathJax console error remains outside this layout change; saved code/output
rendering does not certify mathematical typesetting.

## Artifact presentation and provenance — 2026-11-07

Files browses the live workspace, Artifacts opens saved versions, and Diff
reviews recorded changes. Chat links back to the saved version associated
with a delivery. The Notebook reader can open a separate working copy.

The shared artifact pane adds expand and restore in its output header. The
expanded pane uses the Chat content region and keeps the browser view, exact
version and split-width preference. Narrow windows use the existing single
pane. Go to source and a successfully added prompt context bring Chat back
into view. Scientific Viewer adds Version details next to version navigation.
It shows the selected snapshot's format, exact byte count, saved time, origin
and SHA-256 from the Host catalog. This is capture metadata. An execution log
or review outcome would need a link to the record that owns that evidence.

Verification on macOS against `3eec45a6` plus the shared-pane changes:

- `npm run check`, Scientific Viewer typecheck/build, pinned Native build and
  Wasm/Web/Desktop builds passed. GPUI Kit was taken from the CI revision
  `7591a35ec` because the local upstream checkout had moved ahead of the
  repository's patch set.
- `node apps/scientific-viewer/test/artifact-browser.mjs` passed all nine
  checks in Chromium and WebKit with fixture Host bytes. Version details
  matched two distinct CSV snapshots. Enter and Tab reached the details,
  and Escape closed them and restored trigger focus. The captured Chromium
  state is `test-results/session-artifacts-viewer/version-details.png`.
- `node tests/e2e/workspace-files.mjs` passed in Electron with a real local
  Host. After registering v2, the test opened v1, checked its retained bytes,
  expanded the actual reader and restored its original width. Add to prompt
  returned to the focused composer with the v1 attachment and no submission.
  The Files reader retained its previous selection. The captured expanded
  state is `test-results/workspace-files/artifact-expanded.png`.
- A newly built Native preview with an isolated copy of the synthetic ACP
  profile rendered `results.csv` v2 with value 9 and v1 with value 7. Expand,
  version details, restore and Go to source were exercised in the actual
  window. The v1 details showed 58 B, the recorded path and SHA-256. The
  original v1 delivery opened when returning to Chat. This run covers the
  light Native development window with a real local Host. Dark Native,
  installed distributions, live model delivery and scientific validation
  were outside this verification.

### Open deliveries from the transcript

Chat shows a compact filename and version button beside each successful
`deliver_artifact` call, even when the process group is collapsed. It matches
the receipt's conversation, artifact ID, version and digest against the Host
catalog. Opening a button presents that exact version in the current reader
without changing the saved Icons, List or Gallery preference. The lower
navigation now uses Deliveries and Code changes. Files remains the workspace
browser. Deliveries from Diff explicitly returns to Artifacts.

- In an isolated light macOS Native window with the retained ACP fixture
  profile and a real local Host, both collapsed process groups exposed their
  seven deliveries. The CSV buttons opened v1 and v2 directly in List mode,
  showing 7 and 9 respectively. Go to source on v2 opened the second group's
  tool record. Starting in Files, Diff → Deliveries returned to Artifacts.
- The Native build, standalone Chat Wasm check, Scientific Viewer
  typecheck/build and ten Chromium and WebKit checks passed.
  The fixture browser directly opens the old CSV version from List and reopens
  it after Escape. Repository-wide build checks were also attempted while
  separate Settings edits were in progress. The full Wasm build stopped on
  Settings/Engram errors, and the first TypeScript check stopped on an
  unrelated MCP settings test.

### Present a delivery and follow its evidence

`deliver_artifact` can request `side` or `expanded` when asked to display a
new delivery. Host returns the request only after saving the snapshot. Chat
acts on it only while that conversation is visible and running. Background
deliveries still enter the catalog and can be opened from the transcript.
The request does not persist a browser preference or confirm rendering.

A delivery can name up to 16 related snapshots in the same conversation.
Each link pins an artifact ID and version and declares one role: input, code,
execution log, environment, or review material. Host refuses missing and
foreign versions before publishing the delivery. Links belong to the new
version and are supplied explicitly when its inputs or run change. Review
material carries no verdict. A Paper export additionally exposes its actual
checkpoint and other saved exports with the same program and checkpoint, even
when their catalog items already have newer versions.

- The Electron acceptance runs an isolated ACP fixture and the real Host.
  Ordinary delivery kept the reader closed. The side request opened v2 and
  its input link opened v1. The expanded request opened v3 in a larger
  reader while retaining the List preference. See
  `test-results/artifact-presentation/{side,linked-input,expanded}.png`.
- The real Host/MCP test retained the v2 relationship after restart,
  rejected an unavailable version and a foreign conversation's relationship,
  and confirmed that v3 had no relationship when none was supplied.
- Viewer Chromium and WebKit each passed 12 checks. The older report's
  checkpoint opened the older research log and excluded a different program.
  The browser fixture separately covered explicit role links.
- Repository checks, focused Rust tests, full Wasm/Web/Desktop builds and
  Electron Workspace Files acceptance passed. The live presentation scenario
  was exercised in Electron. An isolated Native launch did not load the
  fixture Agent, so it did not verify the new presentation request there.
  The subsequent Native rebuild stopped while the shared artifact toolbar
  was being changed concurrently.

### Inline, lower pane, live Notebook and external run evidence

Artifact links in the transcript open the exact frozen version in a rich
reader under the delivery. The file header groups the name, version, details
and inline controls. Clicking the active delivery again collapses the preview.
Open in pane moves the selected version to the separate reader.
`deliver_artifact` accepts `inline` and `below`. The lower pane has a vertical
resize handle, independent scrolling and the same version and context actions
as the side pane.
Very narrow windows use the compact reader fallback.

Start Python kernel creates an App-owned Jupyter kernel only when requested.
The selected code cell can be edited and run, and execution updates its
output while preserving variables between cells. Interrupt, restart and close
control the process. The downloadable working copy includes executed cells
and their outputs. The original snapshot and the working copy are separately
labeled. Python is the supported kernel. Other languages use the saved preview.

External systems can publish a UTF-8 sidecar called
`<output filename>.pero-run.json` beside an output in the conversation's
workspace. On an ordinary file delivery, Host checks the output digest and
each referenced workspace file, then saves the receipt and evidence and pins
their exact versions in the delivered artifact. Invalid, stale and
out-of-workspace references fail before catalog publication. The manifest
format is versioned. Evidence paths are relative to the session workspace.

```json
{
  "schema_version": 1,
  "system": "solver",
  "run_id": "example-1",
  "outcome": "succeeded",
  "output_sha256": "<lowercase SHA-256 of the output bytes>",
  "evidence": [
    {"path": "run.log", "role": "execution_log", "sha256": "<lowercase SHA-256 of the log bytes>"}
  ]
}
```

For local commands, `scripts/record-external-run.mjs` generates v2 sidecars
for changed outputs; Host continues accepting existing v1 receipts. From the
workspace, run:

```sh
node /path/to/pero/scripts/record-external-run.mjs solver run-1 report.csv \
  --input parameters.json -- python3 simulate.py parameters.json report.csv
```

Then deliver `report.csv`. The v2 receipt records the exact command and argument
array, workspace-relative output path, start/finish times, exit code, terminating
signal and cancellation request. It retains stdout/stderr and pre-run copies of
explicit `--input` / `--code` files with their hashes and original `source_path`.
A direct Python or Node script in the first argument is captured as code
automatically; flags, imported modules and implicit data require explicit file
selection. Unchanged outputs keep their earlier producing receipt.

`environment.json` records the observed platform, architecture and wrapper Node
version. A direct Python command is probed using that interpreter for its actual
executable, version, implementation and installed distribution names/versions.
Other commands report Python as unobserved unless `--python <executable>` selects
a related interpreter; that observation is labeled separately from the command
interpreter. Failed probes remain unavailable. This metadata is an observation,
not a dependency lock or proof that every installed package was used. Environment
variables, package index credentials and account state are not captured.

Every invocation also writes `.pero/run-records/<system>/<run-id>/run.json` and
its own sidecar, marked `output_kind: "run_report"`. This wrapper report exports
evidence; replaying the child command does not recreate the report. Deliver it to retain linked logs even when failure,
cancellation or a missing executable produced no output file. A child that exits
zero after receiving cancellation remains cancelled. A successful process with
no changed output retains a successful process outcome in its report, while the
wrapper exits nonzero because there is no requested output to deliver. Run IDs
are unique within the workspace and system. Native providers with their own
exporters may write the compatible sidecar without using this wrapper; they
remain responsible for the reported execution facts.

Acceptance on macOS arm64:

- Electron with a real Host and local ACP fixture exercised ordinary delivery
  and exact versions inline, below, side-by-side and expanded. With the
  opt-in Python test prefix it used the real Scientific Viewer backend and
  Jupyter kernel, observed shared variables and streamed output, interrupted a
  running cell, restarted the kernel and confirmed state reset.
- The Host test launched an external command through the wrapper, captured
  its output and related run record, environment and logs, and rejected a
  modified log while keeping the original saved bytes available.
- The Native binary built successfully. Its isolated window did not load the
  fixture conversation, so Native interactive acceptance remains open.

## Evidence inspector and Notebook cells — 2026-11-07

The inspector groups the selected snapshot's linked files under Code,
Execution log, Environment and Review. Messages shows the assistant reply
associated with the delivery. Tabs appear when their data is available.
An older input can be read in the inspector while the output stays selected
at its own version. The detail popover still shows full provenance. The
file header uses the shared content icons and a version badge. Narrow panes
put resource navigation above the toolbar so all layout actions remain
reachable. Inline figures fit both available dimensions before zooming.

The `present_artifact` MCP tool accepts a saved ID, exact version, and
placement in its active conversation. The Host verifies the snapshot, and
the tool can show it without registering another version. Inline requests
for an existing artifact appear at the end of the transcript. Ordinary
delivery still attaches an inline preview to its delivery tool.

The Scientific Viewer uses the shared Tabs and Textarea components.
Notebook's old cell picker is replaced by editable Python cells with
execution counts, a Run action and Shift+Enter. Each cell owns its visible
text, errors and images. Source and evidence tabs retain the working copy
and running kernel. Download exports the edited notebook separately from
the original snapshot.

Verification:

- macOS Electron light and dark runs opened a linked older input while
  retaining the current output version. They read the source message and
  automatically attached run log, environment and review. They moved a
  narrow side pane below Chat and back, presented existing versions without
  creating new ones, and displayed a complete inline PNG. The real local
  kernel ran two cells with shared state, rendered a PNG alongside text,
  streamed output, interrupted a busy cell and restarted with fresh state.
  Captures in `test-results/artifact-presentation/` include
  `inspector-evidence.png`, `inline-image.png` and `notebook-live.png`.
  The dark run saves the same views under `dark/`.
- The macOS Native development window opened a historical image in Chat
  and moved it below Chat with the toolbar. The historical Notebook opened
  inline, started its local kernel and showed a changed result after direct
  editing and Shift+Enter. Clipboard editing was not verified in Native.
- The loopback Host suite accepted an existing version in the calling
  conversation, rejected missing or foreign versions and verified external
  sidecars. The Scientific Viewer browser suite passed in Chromium and
  WebKit.

## Current limits

Live execution supports a local Python kernel and a downloadable working
copy. Other notebook languages use the saved preview. HTML uses an isolated
static preview. Markdown previews render images present in the snapshot,
and separately delivered image artifacts retain their own bytes. PDF and
large-file contexts are explicit references. Scientific results remain
unverified.

The UI run uses a synthetic ACP agent with real Host/MCP I/O. Real-provider tool
selection, signed packages and non-macOS Native acceptance remain untested.
After restart, the existing historical fixture conversation cannot send a new
turn; continuing modification was verified before restart in its live session.

## Integrated review verification (2026-11-05)

PR #135 was integrated with master `951fb071de0aaef9373e85902880f93287c41487`.
The following checks were rerun on the repaired code ending at `9245a8c3` in an
isolated Linux checkout. Earlier Native screenshots above are historical
evidence for the original branch, not screenshots of these review fixes.

- `node scripts/build/wasm.mjs`: passed all workbench, chat, reader and content
  builds with the pinned `nightly-2026-10-28` toolchain.
- `npm run check`: passed TypeScript, generated theme/design, 966 bilingual
  messages, protocol generation and 78 shared icons.
- `node scripts/cargo.mjs test -p pero-contracts -p pero-runtime -p pero-host
  -p pero-chat-ui -p pero-ui --lib`: 258 passed, one ignored. This default
  feature set does not compile the GPUI-gated Composer code.
- `npm test`: the full default-feature Rust suite passed 336 tests with one
  ignored, including Host and Worker binaries and remote-worker integration.
- `node scripts/cargo.mjs test -p pero-chat-ui --features native --lib`: 25
  passed, including all three ComposerDraft admission tests. This executes
  Native-feature unit tests, not a graphical Native acceptance session.
- The seven Desktop delivery/frame/App-use/context/content test files listed
  above plus `tests/build/product-shutdown.test.mjs`: 36 passed.
- `npm --prefix apps/scientific-viewer test`: 23 passed; Viewer typecheck and
  production build passed.
- A DOM event-bubbling probe using the actual ArtifactBrowser and TablePreview
  components passed chart-arrow, selector and file-navigation checks. The
  original Gallery code failed that probe by changing the selected artifact.
- `node tests/runtime/session-artifacts.mjs`: passed with the rebuilt real
  Host and synthetic ACP fixture, including exact retained versions, actual
  caller identity, original workspace, context bytes and restart persistence.
  Host SHA-256: `c23fa14d804e76c229fd92bcbdbbc30bd0b6e41a24489401327cce23da435dc9`.

Native unit compilation used official Rust 1.99.1, the repository-pinned GPUI
checkout, and required Debian development libraries extracted into an isolated
build sysroot. No user-computer state was used or changed.

The expanded production Gallery keyboard scenario is committed in
`apps/scientific-viewer/test/artifact-browser.mjs`. Its Chromium run was attempted,
but the browser exited before any assertion because Unix socket creation was
denied (`process_singleton_posix.cc`, `Operation not permitted`). This is an
unverified browser acceptance gap, not a passing test or a code-test failure.
New Native graphical screenshots, real-provider selection, signed packages and
non-Linux platform acceptance were not established by this integration run.

## Workspace comparisons — 2026-11-06

Source: master `01ec7f0d7edcbded4a214b91b56d99cd93c261e0` plus the current
uncommitted changes. The local DeepSeek Harness reference is `fcc0ad4621`:
`workspace-changes` captures Git trees around a turn; `ui-deliverables` keeps
explicit presentation separate. Its ACP route lacks the native presentation
hooks. Pero therefore observes the real workspace in the Rust ACP runtime,
inside the existing workspace write lease, without inferring edits from tool
names or reply prose.

`WorkspaceChanges` owns NUL numstat parsing, counts, rename and binary metadata.
`FileComparison` owns diff coordinates and deletion/addition pairing. Runtime
`ChangesStore` captures trees using a private index and object directory. A
turn compares its actual starting tree with its final tree; the explicit current
workspace action compares HEAD with the working tree. Original index bytes and
refs are preserved. Host owns catalog and lazy comparison requests; metadata is
journaled with the conversation and retained snapshots can be reopened after
Host restart. Scientific or execution acceptance is not inferred from a diff.

The shared Chat moves review to a compact `Diff N +added −deleted` control beside
permissions. It replaces the top `Artifacts 0` row and duplicate inline change
cards. The output pane retains the existing delivered-file browser and adds a
flat changed-file list, history/scope menu, local errors, and unified/side-by-side
comparisons with line numbers. Saving a reply still uses the existing artifact
registration/version/source-navigation path; the compact copy/save actions only
appear on a normally completed final reply. Thinking and adjacent tools share a
process disclosure; approvals and failures remain directly reachable.

The composer density and surface migration is recorded in
[the composer fitness record](zed-composer-batch-2.md#composer-density-and-conversation-surface--2026-11-06).

### Scope and limits

Automatic snapshots cover local writable ACP turns in a Git repository, including
new, renamed, deleted, binary and preexisting dirty files. Git-ignored untracked
files, non-Git folders and remote read-only execution are outside this increment.
Hard session termination or an unacknowledged cancellation timeout can exit before
the final snapshot. Historical turns predating this implementation have no
recoverable baseline; users can explicitly inspect the current workspace against
HEAD. Current-workspace review requires a HEAD commit.

The catalog lists at most 500 paths while retaining full totals; comparisons are
bounded to 2 MiB and the UI to 5,000 rows with explicit notices. Snapshots survive
Host restart while the original repository/object store remains available. This
increment does not add snapshot garbage collection, ignored-file mutation hooks,
a repository-independent archive or diff editing/revert controls.

### Verification

macOS arm64, local development binaries; the ACP controller is synthetic, while
Git mutations, Host storage/transport and the production GPUI renderers are real.
`tests/e2e/workspace-changes.mjs` passes five-file turn detection, dirty baseline
preservation, net reverts, additions/deletions, binary metadata, renames, unchanged
user index bytes, permissions/Diff adjacency, lazy recorded comparisons,
side-by-side review, separately labeled current worktree, keyboard history
selection, and reopening the same recorded diff after Host/Electron restart.
Inspected final Electron captures in `test-results/workspace-changes/` include
`recorded-diff.png`, `current-worktree.png`, `dark.png` and `narrow.png`. The final
light screenshot has a white conversation background and a one-row compound
editor. Narrow mode uses the existing full-pane reader, with Close returning to
Chat. Red/green changes also retain signs and line numbers.

The existing `composer` suite passes advertised settings, context references,
undo, submission, permission decisions, themes and narrow layout, with an added
real edit/clear sequence proving multiline growth and shrinkage. `ime` passes
boundary keys, successive Pinyin, editing, shortcuts, and composition commit/cancel.
The contracts/runtime/Host tests pass 265 cases (one runtime test ignored);
Native-feature Chat/theme tests pass 32. `npm run check`, Host, Native, all Wasm
consumers, Web and Desktop builds pass. Existing Native dead-code/future-compat
and generated Wasm eval warnings remain.

CUA inspected an isolated copied-profile Native application, using the binaries
identified in `test-results/workspace-changes/native-launch.json`. Earlier in the
run, Diff opened the recorded file list and real Host patch beside the permission
control. After the density/background rebuild, its actual Native window visibly
shows a white conversation surface and the shortened one-row editor, retaining
its conversation and modified sidebar widths. The CUA screenshots are in the
conversation's tool output. This Native check establishes the visible shared
layout and restored preview; new provider execution, the history menu's Native
keyboard path, signed packages and other operating systems remain unverified.

Final shared-consumer regression also passes `streaming-presentation` and
`toolcalls` with no page errors, plus `product-chat` with nine checks and no page
errors. The Product test now opens the process disclosure before toggling a child
tool; compact multiline/wrapped drafts, cancellation, scope restoration and the
embedded permission card retain their prior assertions. Its existing CJS
`import.meta` build warning remains. Native capture of that Product shell was not
part of this run.
