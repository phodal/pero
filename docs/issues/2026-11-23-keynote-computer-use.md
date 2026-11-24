---
kind: incident
status: active
---

# Keynote Computer Use misses slide content and hides screenshots

The native chat identified Keynote and captured the current slide, but its AX
observation did not include the navigator or the canvas content. The active
text-only route could not inspect the screenshot pixels, and the chat did not
render the recorded JPEG. A follow-up against the same slide confirmed that
Keynote can expose both the outline and the canvas through AX, including through
the scroll areas' `AXContents` attributes.

Expanding successive siblings from a whole-window observation also failed
because each expansion replaced the only snapshot. A failed expansion then
discarded the latest valid snapshot. Read-only expansion should retain the
whole-window basis within the current observation sequence. Input should still
consume the session's snapshots and require the latest observation.

## Local verification

- The rebuilt macOS helper returned the slide navigator, 44 slide rows and
  canvas text from the same open Keynote window. Local OCR of its screenshot
  found the Chinese slide heading and “Test Agent.” The read-only sequence
  accepted two expansions from the same window basis with a rejected reference
  between them. The original missing AX branches did not recur during the
  comparison with the previous helper.
- The loopback MCP check offloaded a large AX tree while keeping its OCR and
  image independently available. The signed Native test copy displayed an ACP
  JPEG fixture in the collapsed tool group. The conversation image registry
  also passed its replay and cross-conversation isolation test.
- The signed test copy launched Host and Harness successfully. macOS reported
  that the newly signed helper lacked Accessibility and Screen Recording.
  A Keynote call from the signed App with fresh grants remains to be verified.

## Cross-application comparison

The local macOS helper and Codex Computer Use observed the same windows in
read-only checks. PowerPoint and TextEdit used owned fixture documents.

| App | Codex Computer Use | Pero Computer Use |
| --- | --- | --- |
| PowerPoint | AX exposed the thumbnail and editor. Screenshot pixels showed the title, body, and image-only marker. | AX exposed the same areas. The 1600 × 900 screenshot showed the three markers, and OCR recovered all three after initialization. A cold call returned the screenshot without OCR after the four-second budget. |
| Feishu | AX exposed the message view, composer, and sidebar. A window screenshot was returned. | AX exposed the same landmarks. The default observation was truncated and withheld the screenshot. At 4096 nodes and depth 64, it returned 1203 nodes, reached depth 40, and returned the screenshot. Warm OCR also recognized visible navigation labels. |
| TextEdit | AX exposed the editable document and full fixture text. A window screenshot was returned. | AX exposed the same fixture text, and the screenshot and warm OCR both succeeded. |

Two subtrees of the PowerPoint window expanded successfully from the same
whole-window observation. This comparison exercised local tool results and did
not run a hosted model or change data in Feishu.

## Compact and incremental observations

- In the same Feishu window, the raw tree had 1,200 nodes at depth 39. The
  default projection returned 368 nodes at depth 13. The element JSON fell
  from about 361 KB to 115 KB. The default call returned a screenshot and
  retained the conversation pane, search, composer, and sidebar landmarks.
- PowerPoint kept the slide editor and thumbnail pane while reducing the
  tree from 124 to 109 nodes. TextEdit kept the entire fixture text.
- An unchanged Feishu observation returned zero changed nodes. A stale
  baseline returned a full current observation. The owned AppKit fixture
  proved that a click yielded a delta with the updated count, and that
  clipping the output to one node still allowed an ordinary window capture
  while a secure control outside that output blocked capture.
- Larger tool results include a bounded inline tree preview that leads
  with focused and selected controls. The complete structured result remains
  available through its conversation artifact.

The comparable behavior is compact accessibility output and option-driven
incremental reads. At that stage, the PowerPoint cold OCR limit still applied. A
standalone CPU-only Vision probe read the image marker but took about 47
seconds, so this change retains the bounded OCR path.

## Default deltas and checked AX reads

- AX distinguishes successfully empty or unsupported attributes from native
  errors and malformed arrays. A failed or incomplete security-relevant
  scan withholds pixels. The regression suite checks empty, absent, failed,
  malformed, and clipped input. An owned AppKit window confirmed an ordinary
  clipped observation can still include a screenshot and a secure control
  outside the returned projection still blocks capture.
- The first complete whole-window read returns the tree. The next compatible
  read returns a delta by default. `disable_diffing` requests a full tree.
  Structural deltas supply the current element order. The macOS driver retains
  IDs for AX identities in the same window, and input still binds to the
  latest observation.
- Codex and the rebuilt Pero helper both captured the same PowerPoint fixture
  and the same Feishu window. Opening the PowerPoint Notes pane produced an
  incremental response in both. Pero returned nine changed or added nodes,
  retained the editor and Notes button IDs, and reported the pane's removal on
  close. The compact preview of the actual window includes disabled and
  settable states, actions, and secondary actions.
- Feishu returned an unchanged observation in Codex and zero changed nodes
  in Pero. Pero retained all 531 element IDs over the two observations. This
  read-only comparison did not store or publish Feishu's content.

## Standalone screenshots and deferred OCR

- The macOS AppKit fixture accepted input against a screenshot-only pixel
  anchor, independently confirmed the click, and returned a durable receipt.
  The next AX read kept the previous whole-window delta baseline. A secure
  field outside the returned tree blocked both combined and standalone
  capture.
- PowerPoint returned a 1600 × 900 fixture screenshot with OCR pending.
  Reading the same screenshot ID later found the image-only marker and slide
  title. A different conversation could not retrieve that result.
- Feishu returned 356 projected nodes, a separate 1311 × 1010 screenshot,
  and zero changes from the pre-screenshot AX baseline in this run. Codex
  returned 213 numbered nodes and a separate screenshot. Its tree includes
  app-level menu nodes, so counts describe these returned projections.
- The loopback MCP check delivered real AppKit JPEG bytes, re-observed two
  changed nodes after one screenshot-anchored background click, and replayed
  its durable receipt. A transport fixture separately covered pending OCR and
  text delivery for that same screenshot ID. The staged
  signed Pero app passed the local Native ACP/MCP REPL fixture. Its helper
  had no detected macOS grants through Launch Services, so this did not
  establish updated-package desktop image input to a hosted model. The helper
  already in `/Applications` had both grants and observed the AppKit fixture
  with AX and pixels using its existing combined operation.

## Per-application access on macOS

- A signed Native test copy showed and persisted a grant for one owned AppKit
  application. Revoking it persisted an empty list while leaving Computer Use
  enabled. The final dark-mode settings view kept Refresh and Stop above the
  application list after refresh. The earlier light-mode view was also inspected.
- The rebuilt helper's real AppKit test verified empty discovery with a legacy
  enabled setting, a positive grant for one fixture, denial of its neighbor,
  and invalidation of the old window reference after revocation. The original
  executed receipt remained queryable. The Host contract separately verified
  that a non-revoked grant survives restart.
- The signed test copy had no macOS Accessibility or Screen Recording grants.
  Its Settings checks therefore cover application discovery and persistence.
  The action effects were verified with the rebuilt helper and the already
  authorized test runner.

## Parallel background Computer Use on macOS

- Two owned AppKit applications received real background input through the
  shared MCP bridge. A JavaScript REPL cell in an unselected conversation
  clicked the second app while the first app was still holding its button.
  The foreground action and second owner of the same app were rejected.
- Stopping one conversation released its held input, left an unknown journal
  receipt, and let the other conversation finish its own input. Revoking one
  bundle grant interrupted only the owning worker. The other worker finished
  input and reused its runtime reference with the updated allowed app list.
- The signed test helper started two independent Launch Services socket
  connections. Stopping one left the other runtime usable. The bundled
  Native Python REPL also passed its Chat, Host and ACP/MCP fixture.
  The staged helper reported no OS grants, so GUI input in this comparison
  used the rebuilt helper with the already authorized test runner.

## Text selection and formatted paste

- A real AppKit editor independently reported the UTF-16 range after exact
  selection and the zero-length caret after cursor placement. The tests
  cover duplicate and overlapping matches, adjacent context, and Unicode.
- Codex pasted an HTML fragment into the same rich editor fixture and exposed
  the bold span in its AX observation. The rebuilt Pero helper pasted Unicode
  text and both HTML and Markdown; the fixture independently inspected its
  attributed text and confirmed both bold spans. Clipboard fingerprints of
  every available representation matched the initial clipboard after each
  action and after cancellation of a paste the editor ignored.
- Background key delivery reached the fixture but failed to invoke its Paste
  handler. Pero advertises formatted paste with foreground delivery on
  macOS. The helper checks the observed window is still the focused
  foreground window immediately before sending Paste.

## Native vision acceptance

- The new AppKit fixture draws a randomly outlined tile and a confirmation
  code that appears after the correct click. Neither code is exposed by AX or
  supplied to the model as text. The installed Native REPL test disables OCR,
  requires a screenshot-anchored background click, checks exactly one
  selection in the fixture, and matches both native images to the Host journal.
- The rebuilt helper with the authorized test runner returned both real
  screenshots. The fixture independently recorded one background click on
  the intended tile, and the second screenshot showed its confirmation code.
- A signed staged Pero launched its bundled Python. Real Codex read the
  WKWebView screenshot's random code after the page received a trusted click.
  Native screenshot acquisition stopped before input when macOS returned
  `kAXErrorAPIDisabled` for the staged companion. Both staged permission
  preflights were undetected. The previously installed companion reported
  both permissions, but uses a different ad hoc signing identity. The staged
  model-guided native click remains unverified.
