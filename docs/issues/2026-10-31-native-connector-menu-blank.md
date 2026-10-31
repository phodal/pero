---
kind: issue
status: resolved
---

# Native connector menus hide the entire App

Opening the workspace tab dropdown or pane actions above Connectors blanks the
whole App while its GPUI menu is open. Reproduced in the actual Native Preview
on macOS on 2026-10-31. The provider catalog remains loaded; this is not a
connector request failure.

The legacy surface policy hides native children for every deferred popup,
because a plain Wry child paints above GPUI. Native App rendering then omits
the child entirely. Use Kit's existing native window composition so popup
menus can paint above a retained, visible WebView. Keep the existing coverage
policy for Electron's canvas/iframe composition and for explicit full overlays.

## Resolution and verification

Native selects Kit's existing Fast backend and WebView composition together.
The pure layout policy distinguishes composited surfaces from children above
the Workbench, leaving Electron's iframe coverage unchanged. The lock records
Fast 0.1.12 and its compatible taffy/unicode-properties versions. No upstream
patch or second App renderer was added.

Before removing the redundant Connectors tab dropdown and pane-actions buttons,
both were exercised in the actual loaded native directory: menus appeared above
the catalog without blanking it.

Native build, 47 UI concept tests, native App evaluation/retention/theme/restart,
native Web history/retention/teardown, Wasm compilation and `npm run check`
passed on macOS arm64. Existing App/Web automation receipts are under
`test-results/native-apps/` and `test-results/native-webview/`; the menu
checks were inspected through computer use. This does not establish other
operating systems or signed-package acceptance.
