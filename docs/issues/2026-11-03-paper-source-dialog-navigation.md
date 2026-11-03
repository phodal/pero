---
kind: issue
status: resolved
---

# Saved source dialog obstructs matched PDF navigation

ResearchSources forwarded matched-PDF navigation without closing its modal. The
Library bundle stays mounted when hidden, so its native dialog remained in the
top layer and blocked the newly opened reader.

Saved-source navigation now returns whether the requested paper actually opened.
The source dialog closes only on explicit success. SourceBrowser awaits that
result, keeps its busy guard throughout navigation, and shows a readable error
for failure or rejection without dismissing the dialog. Existing non-dialog void
callbacks remain supported. Failed Library refresh after successful navigation
does not incorrectly report the paper as unopened.

Non-browser component tests cover pending/success/false/rejection, duplicate
navigation while pending, exact PDF focus, failed paper retrieval, failed full
paper loading, and failed refresh after successful opening. Browser verification
was not run in this repair environment.
