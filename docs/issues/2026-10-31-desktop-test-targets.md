---
kind: incident
status: active
date: 2026-10-31
---

# Desktop acceptance targets after the workbench layout update

At head `07bd485`, CI 41159021572 passed 17 jobs but its Desktop matrix
reported four selector failures. The Control Lab suite completed all four
real solver cases, exports, themes and restart checks before its missing-engine
assertion matched both the overall error and the selected trial error.
Both messages are valid evidence; acceptance now checks each in its own scope.

Upstream placed Insights before New chat. Three older workbench suites still
clicked the former first-row coordinate and opened Insights instead of an
ordinary conversation. A later master update (`690f959`) moved search into
the window chrome, shifting those controls again. CI 41161402554 therefore
failed before entering the Apps despite the preceding coordinate correction.

Acceptance now observes GPUI's actual prepaint bounds for New chat, session
rows by stable session ID, and enabled App Open buttons by App identity.
The existing diagnostics expose these presentation-only bounds; each render
clears stale targets. Shared helpers wait for finite nonempty bounds and then
click their center. No hard-coded row or toolbar offsets remain for these
actions. The probes do not claim to detect occlusion; callers still navigate
to the visible catalog or sidebar and assert the resulting state.
Navigation, conversation scope, asynchronous response and replay assertions
are unchanged. These are real pointer gestures, not internal action injection.

JavaScript syntax and frontend checks pass. Rust compilation and the next
exact-head hosted Desktop run must
confirm the updated targets. No user-desktop interaction is needed or allowed
for this verification. The Control Lab screenshots from the preceding failed
run were inspected separately; they do not establish a passing full suite.
