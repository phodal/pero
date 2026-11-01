---
kind: issue
status: resolved
---

# Paper research tools fail repeatedly and Chat summaries omit saved citations

## Observed behavior

2026-10-31, actual native built-in Pero Agent session, inspected read-only from
its Host journal and persisted Paper report after the user's screenshots.
The first research turn made 25 tool calls; eight failed (32% of calls in this
one turn, not a measured overall Harness or task failure rate):

| Failure | Count | Owning boundary |
| --- | --- | --- |
| `app_use inventory` returns `APP_SURFACE_UNAVAILABLE` | 1 | Native advertises the general App UI tool although its supplied ports only support bounded semantic context reads. |
| Requested PDF line ranges exceed 4,800 characters | 2 | A valid line interval is rejected as a whole instead of returning a bounded original-text window and a continuation. |
| Evidence quotation fails exact passage matching | 4 | Two note failures contain literal escaped line endings; two finalization failures alter the original quotation. |
| Finalization omits `studyId` | 1 | The generic write schema cannot express per-action domain requirements directly. |

The Agent recovered enough to save the report. Its five sections contain 18
evidence entries; matrix cells contain four more entries. These counts include
repeated references and do not claim 22 unique sources. The corresponding final
Chat summary contains no Markdown citation links. Persisted report evidence and
the model-written final Chat summary are separate projections. The existing
Paper report view renders source buttons, but shared Chat has no deterministic
handoff from the saved report to those citation actions.

This is a real-provider journey; prior fixture success did not establish its
reliability. There is no evidence here of a provider transport failure, missing
saved citations, or grounds to relax exact quotation validation.

## Repair direction (implemented; verification below)

- Advertise the native MCP capabilities that are actually available; retain the
  existing selected/running-session authorization and declared data tools.
- Return bounded original PDF text with explicit continuation for oversized
  line selections while preserving offsets and the evidence budget.
- Provide source-bound quotation selections/copyable locators so the model need
  not reproduce JSON-escaped line endings; keep exact source validation.
- Carry saved-report citation actions into the shared conversation presentation,
  with source navigation verified in Electron and native. Do not rely solely on
  an extra prompt asking the model to write citation links.

Use this as the canonical active tracker for the observed research journey.
The earlier shared-Chat integration record tracks its delivered fixture scope;
this record tracks the real-provider reliability and citation presentation gaps.


## Resolution (2026-11-01)

Native advertises only supported App tools. Schema-specific declarations expose
required parameters; PDF reads page original text rather than rejecting large
valid line intervals. Numbered passage lines allow exact quotation selection
without rewriting CRLF. A dedicated follow-up input derives frozen source scope
from the selected parent; report boilerplate derives from the authoritative
study. Explicit mismatches and invalid evidence remain rejected.

Saved-report source links are rendered in shared Chat independently of model
prose, and resolve through persisted exact evidence into the PDF. Native source
clicks also work after recreating the App view. Shared App Use skill and research
prompts now distinguish data tools, UI tools, identity roles and reading modes.

Real built-in Pero/deepseek-chat acceptance passed on the original 13-page PDF:
Electron first question (10 calls, zero failures), follow-up (9 calls, two
recoverable parameter errors), and native GPUI/Wry (8 calls, zero failures).
Reports, parent linkage and real source clicks/highlights passed. These samples
do not establish a general Harness failure rate. Exact quotation rejection was
retained in negative tests; no scientific verification claim was added.

See [the maintained verification record](../fitness/paper-harness-journey.md#shared-chat-citations-and-built-in-pero-2026-11-01)
for limits, reproducible commands and local artifact locations. This tracker is
resolved for the observed failures; the broader provider/model quality problem
must be measured separately rather than inferred from one screenshot.
