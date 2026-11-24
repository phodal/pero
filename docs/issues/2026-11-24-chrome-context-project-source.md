---
kind: issue
status: resolved
date: 2026-11-24
updated: 2026-11-24
---

# Save a Chrome page to a Project from its context menu

The Project Materials view tells users to use Collector in paired Chrome, and
Collector already saves reviewed page or selection text to a local or shared
Project. Reaching it currently requires opening the extension side panel,
expanding More, opening Collector, choosing a capture scope, and reading the
current tab. The requested entry is a right-click action on the page.

Add **添加到 Pero** to Chrome's page and selection context menus. The action
opens a Collector window for the clicked tab and starts the matching page or
selection capture. The user reviews the text and explicitly chooses the shared Project
before saving; the existing Project source owner, receipt, and recovery path
remain authoritative.

Acceptance: the menu appears on an HTTP(S) page, page and selection captures
open the existing Collector editor, a reviewed source can be saved to a shared
Project and read from its Materials view, and a disconnected extension shows
the existing pairing error without writing a source.

Verified with unpacked extension 0.3.20 in headed Chrome for Testing: the
actual page context menu showed **添加到 Pero**, and selecting it opened a
Collector window with **Selected text** selected. The disconnected fixture
showed its existing pairing error and no editable source. The Chrome + Host
Collector test passed the context route, review, Project receipt and dropped
reply recovery. An isolated PostgreSQL API, headed Chrome and two independent
Native profiles passed the shared Project save/read path, including source
bytes and digest. Its saved-state screenshot was inspected at
`test-results/native-shared-project-sources/collector.png`. The user's live
shared Project and installed extension were not changed.

Later repeat runs of the Native fixture stopped before the Chrome pairing file
was created, so they did not exercise the changed capture route. The completed
isolated run and the current Chrome + Host route test are the functional
evidence; the latest Native repeat is not green.
