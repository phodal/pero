---
kind: incident
status: resolved
date: 2026-11-07
---

# Native PR Reviews crashes on embedded HTML

Opening the Reviews tab of public phodal/pero PR #164 in the real macOS
Native build panicked in GPUI Kit `text/inline_flow.rs:498`: an inline flow
with two items received a layout fragment addressing item 2.

The comments include nested HTML details, summaries, pictures and paragraphs.
HTML paragraphs have no source spans and therefore share the fallback `p`
element identity. Unscoped nested roots allow sibling inline flows to share
one frame cache; each request replaces that cache's measurement inputs before
all measurement callbacks run. This can pair a paragraph with another one's
layout. Markdown-only fixture reviews did not exercise this path.

Fix ownership at the rendered HTML block identity, preserving rich Markdown
and the shared layout cache. Verify multiple HTML paragraphs in Desktop and
repeat all five tabs against the real public PR in Native.

The retained Kit patch scopes nested root and paragraph IDs by their owning
block. The real Electron rich-HTML regression and Native/Wasm builds pass.
After the user unlocked macOS, the actual Native development build at source
`02f2a3d1` reopened public PR #164 and passed all five sections. Reviews rendered
and scrolled through CodeRabbit's embedded HTML walkthrough and table; returning
from the other sections and refreshing Reviews also completed without a panic.
The process log contains no panic. Captures are retained, uncommitted, under
`test-results/pull-requests/native-reviews-html.png` and
`native-changes-real.png`. No GitHub issue was opened.
