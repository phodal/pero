---
kind: incident
status: resolved
---

# Chrome Relay ended the top-document watch on iframe navigation

The headed Chrome fixture reloaded a watched iframe, then navigated it to a
new URL. The top-document `cdpReadEvents` cursor returned an ended-stream
error even though the top page was unchanged. Chrome can report a loading
tab during subframe navigation. Relay used that signal as a document
revision and invalidated the tab's CDP state.

Relay now invalidates the document on top-frame navigation and retains the
tab URL change signal for same-document top-level URL changes. The headed
Chrome fixture confirms that iframe navigation preserves the watch and
invalidates the old iframe handle. A top-level reload invalidates the watch.
