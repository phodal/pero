---
kind: issue
status: resolved
date: 2026-10-30
---

# Electron aborts during macOS startup in the restricted command environment

## Observation

On macOS 27.0.1 arm64 with Electron 45.1.0, Electron diagnostic reports on
2026-10-30 repeatedly show `SIGABRT` during `NSApplication` initialization and
`HIServices` application registration, within about 0.3 seconds of launch. They
are attributed to the Codex process group. These are main-process startup
failures; they do not establish that a GPUI page or renderer crashed.

## Controlled comparison

A minimal Electron entry point prints on entering JavaScript, waits for
`app.whenReady()`, prints again and quits. The same binary, entry point and
command were run on the same machine:

- The restricted command environment aborted twice with signal 6 in about
  0.25 seconds, before the JavaScript entry-point print.
- With desktop access granted, the corrected entry point printed both messages
  and exited 0 in 0.16 seconds.

The first desktop-access attempt used an incorrect absolute `require` and
reached JavaScript but timed out after an application error. It is not counted
as the successful control; both final comparison runs used the corrected file.

For the two restricted launches, macOS `launchd` recorded sandbox-restricted
service lookups for the actual Electron PIDs, including
`com.apple.windowserver.active` and `com.apple.coreservices.launchservicesd`,
just before the abort. Other desktop services were also denied. Together with
the control, this identifies the restricted process environment as the cause
of these startup failures; the records do not isolate one denied service as
individually sufficient to cause the abort.

## Implications

Hidden Electron windows still need macOS desktop services. Run real Electron
acceptance in a context with authorized GUI access, or on a suitable isolated
desktop runner; do not repeatedly retry a denied launch. Unit and non-GUI tests
can stay in the restricted environment. Intentional `SIGKILL` recovery tests
and renderer crashes are separate events and must not be counted as this abort.

The minimal comparison does not validate the current full Desktop E2E suite,
the packaged app, or other reports with different stacks. The comparison used
an elevated command in the same Codex session, not an independent Terminal
session. No production configuration was changed.

## Launch guard and verification

The shared Electron test launcher now checks access to WindowServer and
LaunchServices before starting Electron on macOS. The direct native-framework
and packaged-release smoke entry points use the same check. The check requires
Python 3 and fails with a desktop-access explanation if it cannot run or if a
service lookup is denied; it does not relax the process restrictions.

On 2026-10-30, using the current macOS arm64 working tree:

- Two restricted runs of the workbench test failed at the preflight with
  `com.apple.windowserver.active: Permission denied`; no new Electron diagnostic
  report appeared. The full `npm run test:e2e` entry point also stopped at the
  same preflight.
- `npm run build`, `npm run check`, and the complete `npm run test:e2e` passed.
  The latter ran Workbench and tool calls in real hidden Electron windows with
  desktop access and reported no page errors. `npm run test:i18n` passed,
  including restart and the browser preview.
- Additional `npm run test:workspace` started successfully but failed its dock
  resize assertion: the App chat was floating, while that test attempted to
  drag a dock divider. It reported no page errors. This is separate from the
  startup fix; the earlier workspace test limitation is described in
  [floating App Chat verification](../fitness/floating-app-chat.md).

The native-framework and packaged-release smoke entry points were syntax
checked, not run as part of this verification. Linux/Windows, packaged release,
and visible-window acceptance are not established by the macOS checks above.
