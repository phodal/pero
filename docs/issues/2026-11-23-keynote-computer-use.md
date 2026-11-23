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
