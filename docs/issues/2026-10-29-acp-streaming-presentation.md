---
kind: incident
status: resolved
---

# ACP reasoning, tool parameters and session titles lost their intended presentation

Reasoning disclosures were centered, expanded reasoning used answer styling,
and Search output competed with the answer at the same visual weight. Qoder
also sends an initial text content block containing the same JSON as rawInput.
Pero interpreted that parameter copy as a structured result and opened a tall
reader for a two-property input. Hover tooltips repeated the visible tool title.

The Host already retained session_info_update events, but Conversation did not
apply their title field. Consequently a provider-reported title could not reach
the tab or sidebar, including after history replay. The inspected Qoder weather
history did not contain any such title notification; that provider behavior is
separate from Pero's missing consumer.

## Resolution

ThinkingState owns automatic expansion and deliberate user choices. Shared Chat
uses left-aligned, muted disclosures and muted reasoning Markdown. Tool text uses
a smaller caption size, retaining links, selection and the complete source.

ToolTranscript owns incremental rawInput, content and rawOutput. Absent fields
preserve previous values; explicit null clears them. An input-equivalent JSON
content block is excluded from the result presentation. Structured output wins
over the raw fallback. Parameters have their own collapsed disclosure and never
create a result reader. Small structured results and short source views use a
height based on content. Existing Host permission choices appear by the current
tool group; early requests naming older tools remain above the composer.

ConversationTitle applies explicit agent titles over the immediate prompt title.
Timestamp-only metadata does not clear a title; an explicit empty/null title
restores the prompt fallback. History replay uses the same transition.

Verification: [ACP streaming presentation](../fitness/streaming-presentation.md).
