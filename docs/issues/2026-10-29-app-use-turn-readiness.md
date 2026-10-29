---
kind: incident
status: resolved
---

# App Use could arrive before the Host turn event

During the actual Electron ACP → MCP → App acceptance flow, the third prompt in
an existing session failed with `APP_SESSION_INACTIVE`. The Agent reused its
loopback MCP connection immediately, while the Host's asynchronous event writer
had not yet delivered `turn_started` to Desktop. The session existed and the user
had submitted a new prompt; the two transports had different delivery timing.

Desktop now records a trusted prompt and waits on the actual Host turn-start
signal, with a five-second failure bound. Cancel/close interrupts that wait.
It does not authorize a turn from App-supplied data or insert a guessed sleep.
The repeated-turn, standing-read, revoke and reapproval scenarios passed in
`tests/e2e/app-use.mjs`. Results are recorded in `docs/fitness/app-use.md`.


## Product draft selection before Host readiness

Final Product regression reproduced a separate ordering defect twice. Shared
Chat creates its scoped draft as soon as its Wasm surface initializes. The new
selection intent was forwarded to `product:session`, whose readiness check
rejected it before the Host was ready. The UI interpreted that rejection as a
session error and closed an otherwise valid unsent draft. Later Host readiness
could not make that closed draft sendable.

The Product shell now sends local selection through `product:app-use`, matching
the Workbench boundary. Only actual session commands wait on Host readiness.
Acceptance holds the real Host's startup output behind a file signal, initializes
Chat first, then releases the Host and uses that same draft. This makes the
ordering explicit instead of relying on machine speed.

The gated-start Product flow passed: the pre-Host draft remained `draft`, kept
its identity and completed the complete App Use/context/file/write sequence.
