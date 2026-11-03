---
kind: issue
status: resolved
---

# Paper answers cannot show inspected source figures

The existing source-image operation returns safe raster previews to the model,
but PDF figure members remain listed-only. A saved paper question supplies its
paper identity without a direct index of approved same-version figure sources.
Chat ignores image content in tool transcripts, so the model has no compact,
replayable reference for displaying an inspected image in its final answer.

Connect existing approved source reads, bounded PDFium figure rendering and the
shared Chat Markdown renderer. Keep original archive/member and derived image
hashes distinct. Preserve exact work/version matching and source observations;
no automatic acquisition, experiment or TeX compilation is required. The answer
must reference actual returned image bytes rather than an App-private API URL.
Acceptance includes a real saved TeX figure, MCP image delivery, inline answer
rendering and replay, independent conversations, and missing/invalid figures.

The actual text-only provider also rejected MCP images before generating an
answer. Its request projection now sends an unread-pixels notice alongside the
text metadata, retaining the real image in the journal/ACP transcript for Chat.
User image attachments still require declared image capability.

Resolved locally: the normal Pero Agent found the saved ablation figure,
returned its PNG through MCP and embedded its exact reference in the answer.
Native rendered the plot, caption and TeX location in light/dark and narrow
panels; process restart restored it without another inference or tool call.
Checks, source hashes and limits are recorded in
[Paper answer figures](../fitness/paper-answer-figures.md).
