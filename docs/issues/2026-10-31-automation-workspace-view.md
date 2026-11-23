---
kind: issue
status: in_progress
---

# Automation workspace view

Automations already has a Host execution core and Web management controller,
but its old menu uses a dialog and Native has no usable destination. The user
requires the bottom sidebar action to open a normal retained content tab, with
no popup, and requires the tabs to fill the unified titlebar.

The working implementation adds a builtin workspace item, reuses the Web
controller as a section, and bridges the same Host protocol from Native Wry.
In the isolated macOS preview, navigation and full-height tabs work, but the
first embedded Automation view is blank. Native asset loading/initialization
must be diagnosed before claiming the flow works. The test profile and app
are under `target/workbench-navigation-verification/`; the user's existing
profiles and running work are not the test profile.

## 2026-11-23 · Automation landing view

The embedded Automations App now uses the shared SDK Card with a native button
for each template. A successful empty list opens directly on template choices
and the existing New automation command. Populated lists bring search and status
filters together. Choosing a template still opens an editable, disabled draft.
The calendar keeps its own template command.

Observed in macOS Native Preview with the Chinese light theme: three named
templates, no empty search or counters, and a daily brief draft with initial
focus on Name and Enable after saving unchecked. Screenshot from the local
preview: `test-results/automations/native-first-automation.png`. The Chromium
fixture covers saving the first task, search and clearing filters, and closing
the first editor at a 420px window height. At 390px wide with dark theme and
enlarged text the fixture stacks the three cards without horizontal overflow.
