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
