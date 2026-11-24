---
kind: incident
status: resolved
---

# Electron crashed when a captured iframe detached

The embedded Browser Use regression removed an out-of-process iframe with an
active network capture. In repeated runs, the Electron 45.1.0 main process exited
with `SIGBUS` in `v8impl::Finalizer::ResetEnv()`. The test lost the Workbench
before it could ask for the remaining buffered events. The real Chrome Relay
and signed Native Chrome probe passed the same scenario.

Skipping cleanup commands to the removed session alone still reproduced the
crash. Deferring the remaining auto-attach cleanup to the next event-loop
turn let the detach notification return first. The full embedded Electron
regression then passed, including reading the existing cursor, refusing the
response body, revocation and restarting the Workbench.
