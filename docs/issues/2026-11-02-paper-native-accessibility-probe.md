---
kind: analysis
status: open
date: 2026-11-02
github_issue: 77
github_state: open
github_url: https://github.com/phodal/pero/issues/77
---

# Native Paper dialog accessibility probe did not expose controls

## Observed failure

[PR #97's first full Desktop run](https://github.com/phodal/pero/actions/runs/41363881233/job/125021384287)
passed the native AbortSignal and normal owner-close cases. The positive probe
found one visible native Paper dialog and verified that excluding the exact
fixture Electron PID removed it. The owned-window screenshot shows the authored
warning and Run once button. AT-SPI registry capability was available, but the
last observation contained no elements and was marked truncated. Waiting for
the authored nonce failed; no native action was submitted and no approval or
worker execution was established.

Artifact `13106757047` retains lifecycle, capability, ownership and owned-dialog
evidence. Its JPEG SHA-256 is
`6a1e4225564c8aac6e292e29d56b084d2cf33032128f904283bd1ce5e719fa0d`.
The screenshot provenance records revision
`0a3548e7ae61a796af5c6b6e85bf44df83837070`. No unrelated desktop capture,
credentials, paper source or scientific result is included in this record.

## Pinned source diagnosis and bounded retry

An empty `NO_AT_BRIDGE` is not itself disabling: the
[GNOME 2.52.0 bridge](https://github.com/GNOME/at-spi2-core/blob/AT_SPI2_CORE_2_52_0/atk-adaptor/bridge.c)
checks whether the value converts to integer one. Removing the empty variable
alone is therefore not a demonstrated correction.

[Electron 45.1.0 pins Chromium 156.0.8078.49](https://github.com/electron/electron/blob/v45.1.0/DEPS).
That Chromium's
[GTK initialization](https://github.com/chromium/chromium/blob/156.0.8078.49/ui/gtk/gtk_ui.cc)
sets `NO_AT_BRIDGE=1` itself and removes `GTK_MODULES`, reserving initialization
for AuraLinux. Its
[AuraLinux enablement](https://github.com/chromium/chromium/blob/156.0.8078.49/ui/accessibility/platform/atk_util_auralinux.cc)
recognizes `ACCESSIBILITY_ENABLED=1` before consulting desktop accessibility
settings; its [bridge initialization](https://github.com/chromium/chromium/blob/156.0.8078.49/ui/accessibility/platform/atk_util_auralinux_gtk.cc)
then clears `NO_AT_BRIDGE` and initializes the adaptor. D-Bus registry reachability
does not prove the application enabled or exported its tree. Electron's
[public enablement API](https://github.com/electron/electron/blob/v45.1.0/docs/api/app.md#appsetaccessibilitysupportenabledenabled-macos-windows)
is documented for macOS/Windows, not this Linux fixture.

The single next probe supplies the pinned-supported `ACCESSIBILITY_ENABLED=1`
only to the existing disposable D-Bus fixture child. It records actual
Electron/Chromium/Node versions and observed bridge environment. A deterministic
regression executes the real child launch options with inherited accessibility
disabled and confirms the parent environment is unchanged.

This is a source-grounded startup configuration correction, **not a verified
native-dialog fix**: Chromium's ATK root may still omit the GTK dialog. All
existing owner, nonce, native role/button, complete-tree, semantic receipt and
production-result gates remain. No longer wait, synthetic decision, keyboard or
pixel fallback, driver/root patch, or geometry relaxation is introduced. If the
same owned dialog still lacks an accessible tree, stop this capability probe
rather than expanding it. Host-to-worker and forced-destroy acceptance remain
separate; #77 and scientific acceptance remain open.
