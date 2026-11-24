---
kind: issue
status: resolved
date: 2026-11-24
updated: 2026-11-24
---

# Chrome site approval followed by a document-changed failure

In the Native app, Browser Use approved `https://x.com` for the selected chat,
then `observe` on the explicit background tab failed with “The selected Chrome
tab or document changed.” Two immediate retries failed the same way while the
tab remained listed at `https://x.com/notifications` and site access was
`allowed`.

The extension accepts a tab stamp only when Chrome reports the whole tab as
`complete`. Chrome can report `loading` for a child frame while the top page
and its URL have not changed. The existing top-frame navigation listener and
URL-change listener already advance the document revision. A transient child
frame load should not invalidate the selected top document or turn site
approval into a failed read.

Acceptance: approve an inactive Chrome tab for one chat, read it with an
explicit tab ID and `background: true` while a child frame is loading, and
confirm top-level navigation still invalidates an old document stamp.

The extension now admits the current top page when its URL and revision are
stable and Chrome has no different pending top URL. A child frame's loading
state no longer blocks the request. The headed Chrome for Testing fixture
held a child-frame response open, observed `tab.status = loading`, granted
site access, and read the page with `background: true`. The full Electron,
Host, deterministic ACP, and extension suite passed on the second run at
`test-results/chrome-relay/result.json`; an earlier run passed this new case
but later failed in a JavaScript dialog assertion. The suite still exercises
navigation, reload, and stale document references. Native sheet presentation
and the user's live X tab were not rerun for this fix.
