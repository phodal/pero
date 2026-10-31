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
ordinary conversation. They now share the documented second-row pointer
gesture, and the retained-history test accounts for the added control row.
Navigation, conversation scope, asynchronous response and replay assertions
are unchanged. These are real pointer gestures, not internal action injection.

Syntax and frontend checks pass. The next exact-head hosted Desktop run must
confirm the updated targets. No user-desktop interaction is needed or allowed
for this verification. The Control Lab screenshots from the preceding failed
run were inspected separately; they do not establish a passing full suite.
