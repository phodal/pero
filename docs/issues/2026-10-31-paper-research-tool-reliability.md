---
kind: issue
status: open
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

## Repair direction (not implemented by this investigation)

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
