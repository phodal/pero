---
kind: incident
status: resolved
date: 2026-11-14
---

# PR opened-time rendering panics in Electron Wasm

The real Electron PR e2e stopped after the Host returned the branch PR note.
The first renderer panic was `std::time::SystemTime::now` not implemented on
`wasm32-unknown-unknown`, called by `ChatPanel::opened_phrase`. Rendering a PR
message chip therefore stopped the Wasm UI before the discussion flow could
run. The project PR list used the same unsupported native clock call.

Both PR displays now obtain Unix seconds from one shared UI-shell clock:
JavaScript `Date::now()` in Wasm, and `SystemTime` in Native. The existing pure
`opened_ago(opened_at, now)` contract still receives the observed timestamp;
there is no hardcoded time or epoch-zero fallback. This follows the platform
selection already used when creating chat IDs.

The PR discussion actions did not cause this clock defect. Rebuild the Wasm
artifacts and web bundle before rerunning the actual Electron flow. Pure date
tests or a Native build cannot establish that the Wasm panic is resolved.

The Wasm-target `pero-ui` check passes after the change, as do the 12 PR-domain
tests (including caller-supplied relative-time observations). The rebuilt actual
Electron window now renders the PR chip, opens the PR, and completes discussion
reply/error recovery, resolution and Agent-context submission without this
panic. Broader Web-link regression results are tracked separately in
[PR view verification](../fitness/pull-request-view.md).
