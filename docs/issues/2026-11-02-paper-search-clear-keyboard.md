---
kind: issue
status: open
github_issue: 101
github_state: open
github_url: https://github.com/phodal/pero/issues/101
---

# Enter on Clear search submits instead of clearing

## Problem and evidence

At `18bc86fa737e582c6c5595efe36db488f2ccf89b`, Paper Library's Clear search
button works with a mouse or Space but submits a search when activated with
Enter. Keyboard users cannot rely on the focused button's declared action.

Reproduced twice on 2026-11-02 in a macOS browser preview of the unchanged
Paper App bundle, connected to the actual Python backend with an independent,
empty local data directory:

1. Select Local and type `keyboardprobe` into Search saved text.
2. Press Tab and verify that Clear search has focus.
3. Press Enter.

The query remains, focus stays on Clear search, and the UI displays
`0 / 0 matching passages`. The local request log records
`POST /api/library/search`. Expected: clear the query/results, return focus to
the search input, and issue no search request.

Controls: mouse-clicking Clear search and pressing Space on it both clear the
query and restore input focus. Enter inside the input still searches.

The form-level Enter handler in `apps/paper-agent/ui-src/library-search.tsx`
receives bubbled button key events, prevents default button activation, and
calls `submit()`. The shared Button defaults to `type="button"`. The current
`tests/e2e/paper-search-flow.mjs` covers mouse clearing but not keyboard clearing.

## Duplicate check

Searched local issue notes and GitHub issues/PRs, including closed items.
No matching issue was found. PR #88 covers PDF anchors and mouse clearing;
open PR #99 concerns source acquisition and does not change `library-search.tsx`.

## Accepted scope

The input owns explicit Enter search handling, preserving composition handling
and the submission path needed by the App sandbox. Other form controls retain
native keyboard activation. Behavioral assertions cover the existing Paper
search fixture; no backend, shared SDK, ranking, or Reader changes are included.

Acceptance:

- Enter and Space on Clear search clear query/results, restore input focus,
  and send no search request.
- Mouse clearing remains unchanged.
- Enter in the input searches once; composing Enter does not search.
- The input submission path still works inside the existing App sandbox.

## Verification boundary

Paper TypeScript and App build pass. A macOS browser preview verifies Enter,
Space and mouse clearing, restored input focus, and input Enter searching.
The real Python backend's request logs show no extra search on clearing.
The unused Reader asset is an explicit placeholder, and no model is called.
Full Desktop regression and simulated composition acceptance are pending;
no physical IME or cross-platform acceptance is claimed. Local screenshots
live outside the source repository in `../evidence/paper-keyboard/`.

Submitted as [Issue #101](https://github.com/phodal/pero/issues/101) on
2026-11-02. The maintainer [invited a PR](https://github.com/phodal/pero/issues/101#issuecomment-6571697980).
The GitHub issue remains open until the fix is accepted upstream.
