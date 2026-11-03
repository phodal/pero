---
kind: issue
status: resolved
---

# Native App failures show a raw error and a stretched Open button

The reported paper tab showed `unknown field frameOrigins, expected host` and
an Open button stretched across the entire content width. `native_app_content`
inserted the raw error directly into a flex column, without an error-state layout.
Existing Native App issue notes were checked; none tracked this failure layout.

The failure view now owns a readable heading, recovery instruction, compact
Retry action, and optional diagnostic details with bounded scrolling and copy
feedback. Refreshing resets the diagnostic disclosure. The App WebView no
longer renders a duplicate raw error; its parent owns the failure presentation.

The earlier schema error came from a debug development bundle selecting the
release Host. Unpackaged debug builds now resolve the debug Host, while release
previews and portable distributions retain their matching paths. Existing
PERO_NATIVE_HOST overrides still take precedence.

Verification is recorded in [Native Apps](../fitness/native-apps.md). The error
was replayed through an isolated stdio Host seam; no manifest policy was relaxed.
