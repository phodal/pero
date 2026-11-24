---
kind: issue
status: in_progress
---

# Native appearance and global typography

Native initialized the system appearance as light and did not observe platform
changes. Workbench and Chat retained separate palette flags; Chat locale/context
updates reinstalled the global theme and reset the font size. Direct Kit theme
field writes left semantic tokens and the Base projection out of step. Fixed
10–14px declarations bypassed global text settings.

ADR 0015 defines a single appearance installation owner per GPUI application,
Host-owned preference persistence, and scoped typography. This issue tracks the
implementation and runtime checks; evidence belongs in
`docs/fitness/appearance.md`. Other retained-reader and Agent changes in the
working tree have separate owners and acceptance records.

Native acceptance also exposed duplicate accessibility IDs when search displayed
multiple font sections. Each rendered settings section now has a stable parent
ID so its stepper controls keep separate identity. Search must be exercised in
the native debug build as well as in Electron.

Settings follow-up found that the unstyled tree's internal virtual list had no
height. The panel now sizes that list explicitly. The first numeric control also
registered the editor focus twice in native accessibility; Pero now composes
Kit Input and step buttons, with `FontSize` owning the bounds. Web's default
dialog confirmation closed Settings on Enter before the input event could save;
Settings disables that confirmation behavior. These failures are exercised by
real keyboard/input and native-window checks in the appearance evidence.

The next compact-layout check found that the Web dialog's generic scrolling
body let Settings grow past the viewport. Its own scroll handle therefore had
no scroll range, and category selection could leave the target below the
clipped surface. Settings uses the bounded dialog content slot; the regression
check now proves viewport containment and a real edit of the scrolled-to field.
Escape handling also explicitly consumes a cleared search so the enclosing
dialog cannot close on the same action. See the interaction refinement in the
appearance verification record.

The user also reported that the whole workbench remained too spacious. The
shared geometry now uses compact rows/controls, a shorter tab strip and smaller
page/section insets across navigation, forms and shared Chat. Single-line input
frames use the shared style rather than the multiline-only height setter.
Usage details remain in a popover on the composer toolbar. No font preference
or appearance persistence behavior changes in this density correction.

## 2026-10-30 source table follow-up

Adopting Kit's actual DataTable exposed table-specific theme tokens that were
still using Kit defaults: the dark body was black and header labels had low
contrast. The existing appearance installer now maps table surface, header,
footer, hover, selection and row borders from the resolved Pero palette through
`Theme::update`. The source reader does not install a separate widget theme.
Actual light/dark/minimum-width screenshots are part of the content-reader
acceptance. This follow-up does not close the other native appearance gates.

Kit paints a selected-cell overlay after its contents. An opaque accent fill
therefore covered the value. The table selection token now uses translucent
focus ink; the separate focus border keeps selection visible without masking
text. This is specific to Kit's overlay semantics, not a second palette.

## 2026-11-18 generated chart palette

The shared Rust palette rejected `chart-1` when loading the new categorical
chart colors from DESIGN.md. Electron Workbench and the macOS Native origin
probe both failed at startup on `dc65fe341`. The ordinary Linux gate passed
its generation checks without exercising that Rust input. [Full CI evidence](https://github.com/phodal/pero/actions/runs/44005175096)

The parser now recognizes all six chart tokens in both themes and still rejects
unknown palette fields. GPUI's available five chart slots read from the same
parsed palette. Ordinary CI exercises this parser without GPUI or Wasm
compilation. The working-tree repair at `dc65fe341` passed both headless palette
tests and all three Native-feature appearance tests on macOS arm64. The theme
generator freshness check also passed. A development Native build with
`native-probe` passed `node tests/e2e/native-webview.mjs` on macOS 27.2.1 arm64.
The hidden GPUI workbench loaded the generated palette, mounted a real Wry
page, retained its form, traversed history and released the view. Evidence is
in `test-results/native-webview/result.json`. The development Electron
Workbench also passed the renderer and Host readiness probe with one built-in
App. The full Electron acceptance matrix, packaged Native app and visual
acceptance remain unverified for this repair.

## 2026-11-22 App 语言跟随

在中文 macOS Native 开发壳中观察到「自定义」面板使用英文。Electron 复现时从
宿主消息读到的旧调色板缺少 `chart-1` 至 `chart-6`。AppProvider 连同语言、
主题模式和活动状态一起丢弃了消息。SDK 现在从相应明暗主题补齐旧版图表颜色；
可选外观快照无效时，仍接收有效的独立语言和活动字段。
回归覆盖旧版调色板、无效颜色、字号及后续语言变化。使用旧壳和重建的 App
复验了 Native 的中文首次打开，以及 Electron 的英文切换中文与深色窄窗。

## 2026-11-24 Native App 字号比例

用户反馈：在 Native 设置里调大界面字号后，WebView App 的文字与界面比例增长不协调。
进一步确认主要是 App 标题比正文放大得更多。共享标题和章节字阶按正文的倍数
增长：界面字号 14 → 24 时，Notebook 正文 14 → 24px，文档标题 24 → 41px。
标题与正文的差距从 10px 增至约 17px，h1/h2 的相对字号也按倍数增长。
修正目标是保留默认层级，并让标题、章节和正文随字号设置增加相同像素数；
在真实 Native WebView 和浏览器 App 中检查放大后的层级与排版。
