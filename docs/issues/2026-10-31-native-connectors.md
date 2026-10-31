---
kind: issue
status: resolved
---

# Native Connectors has no management transport or sidebar entry

The user's Native GPUI/Wry preview loads the Connectors App, but requests to
`/host/connectors` fall through to the static asset handler. A POST returns 503
(`Method refused`); the App rewrites every HTTP failure as
`MCP_SERVICE_NOT_INSTALLED`. The empty directory is therefore a failed request,
not evidence that the Point catalog is missing.

The observed process loads `target/debug/Pero Native.app`, the debug stdio Host,
and the default `~/.pero/native-preview` profile. Electron Main composes the
existing management owner and ACP MCP endpoint; native does not. Neither sidebar
variant has a Connectors shortcut above Apps.

Repair the native composition using the existing connector owner, App grant,
OS credentials, ACP session identities and portable worker. Keep the UI an App.
Verify from the sidebar through catalog, configuration, credentials, grants,
actual loopback calls and restart. Electron fixture evidence alone does not
accept the native path. Preserve personal configuration and the pre-existing
Cargo.lock path-patch changes.

Zed reference (`~/test/zed`): `Project::local` constructs its
`ContextServerStore`; settings reads that same store, and the Agent registry
subscribes to it. `ContextServerStatus` distinguishes starting/running/stopped,
errors and authentication. stdio/HTTP clients are implementations under that
owner. There is no separately installed management service requirement. Pero
retains its existing owner and worker instead of copying Zed's Project/Agent
architecture; both desktop compositions must instantiate that owner.

## Result

Native now composes the same manager and MCP endpoint, serves the privileged
App route, uses macOS Keychain and retires owned children. The App distinguishes
Host errors and offers reload. Both sidebars open its retained App directly
above Apps. Original product marks and semantic glyphs are restored; catalog
cards and the Computer Use/App Use guides have compact, content-driven heights.

Real Native acceptance passed full directory comparison, UI import/configure,
credentials, tool selection, denied access, two ACP-to-native loopback calls,
Keychain restart and dark/Chinese/narrow layout. Electron regression also passed.
The directory has 110 entries, of which 106 appear on catalog shelves; four
custom templates/built-ins retain their original separate entry points.
No personal Point connection definitions were overwritten or imported silently.
See [verification](../fitness/connectors.md) for artifacts and remaining limits.
