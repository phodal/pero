---
kind: incident
status: in_progress
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

The retained Kit patch now scopes nested root and paragraph IDs by their owning
block. The real Electron five-tab flow with multiple embedded HTML paragraphs
passes; Native and Wasm builds pass. The final real Native retry is pending:
macOS is locked and CUA cannot unlock it. This record remains active until
Reviews is exercised again in the actual Native window. No GitHub issue opened.
