---
kind: issue
status: resolved
date: 2026-11-03
---

# Workbench `Invalid session request` banner cannot be dismissed

While Data was open and Chat was waiting on App environment preparation, the
workbench showed a sticky red banner with the English text
`Invalid session request`. The banner had no close control. Navigating within
Data did not clear it; only starting a new chat or certain preference saves
cleared `Workbench.error`.

Host emits this as a threadless `error` event when a session command fails to
decode as `HostCommand`, or when `delete` receives an empty/oversized thread id.
The workbench stores `message_key` or raw `text` and renders `#workbench-error`
without a dismiss action. The related Chat notice
“An App environment is being prepared; retry when installation finishes” is a
separate `session_error` and already exposes Retry when the draft is closed.

## Fix

- Add a Dismiss control on `#workbench-error` that clears `Workbench.error`.
- Emit `error.invalid_session` as a `message_key` so Chinese UI does not show
  the English host literal.
