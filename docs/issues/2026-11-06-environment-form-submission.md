---
kind: incident
date: 2026-11-06
status: resolved
---

# Environment creation did not submit inside the App frame

Actual Electron verification of the revised Environments page found that a
valid form received a pointer click but no submit event or Host request. The
workbench App iframe intentionally omits `allow-forms`; Chromium blocks native
submission before React's onSubmit. The jsdom suite dispatches submit directly
and therefore did not establish the actual product path.

Keep the sandbox policy. The page explicitly validates the form and calls the
existing Host request from pointer or non-composing Enter. Native submit also
uses that same function. IME confirmation remains suppressed. No new execution
or cross-App authority is added. The real Electron preparation suite checks the
Host create response before accepting preparation and binding.

Verification results are recorded in the existing
[local environment report](../fitness/local-environment-preparation.md).
