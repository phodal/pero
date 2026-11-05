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

## Current limits

Notebook displays saved cells and outputs; there is no shared live kernel,
execution control or kernel collaboration in this increment. HTML is a static
sandboxed preview. Markdown does not freeze relative image dependencies;
missing images remain visibly unavailable, while separately delivered image
artifacts retain their own bytes. PDF and large-file contexts are explicit
references, not a claim that the model read the entire file. Scientific results
remain unverified.

The UI run uses a synthetic ACP agent with real Host/MCP I/O. Real-provider tool
selection, signed packages and non-macOS Native acceptance remain untested.
After restart, the existing historical fixture conversation cannot send a new
turn; continuing modification was verified before restart in its live session.
