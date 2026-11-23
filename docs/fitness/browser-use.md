---
kind: verification_report
date: 2026-11-22
level: local-runtime
---

# Browser Use

In Electron, open an ordinary Workbench chat and an HTTP(S) Web tab. Select **Workbench →
Allow Browser Use for This Tab…**. The confirmation shows the site origin and
the live tab title. The toolbar displays **Browser Use allowed** until the
grant ends. **Workbench → Stop Browser Use** revokes it.

The grant belongs to the selected conversation, the live tab instance and its
exact origin, including the scheme and port. It applies while the tab is in a
visible workspace pane and the conversation is selected and running. A hidden
authorized tab can be listed, selected, or closed from the same conversation. Closing
the tab or conversation, cancelling from Chat, leaving the origin, or
resetting the Desktop connection revokes the grant. A different tab on the
same origin needs its own approval. The grant is in memory.

## macOS Pero Native

保留一个普通聊天，在工作台打开 HTTP(S) Web 标签并显示聊天栏。在标签工具栏选择 **允许操作此浏览器标签页…**，
确认当前聊天与站点。允许后，点击同一个位置的 **已允许 Agent 操作** 撤销。
聊天内的 Agent 通过 `browser_use` 操作工作台内的网页。

Native 支持标签清单、观察、定位、条件等待、同源 iframe、同源地址导航、可信鼠标与键盘
输入、表单操作和会话附件上传。第六批的容器限定、placeholder 和插槽定位、滚入视口、
修饰键、逐键输入及多文件上传同时用于 Native 和 Electron。逐键输入接受英文字母、
数字与空格。它在每次按键间检查焦点，`fill` 可一次填写其他纯文本。

第七批接入 Native 的 `open`、`activate`、`closeTab`、`back`、`forward`、`reload`、
`scroll` 和 `screenshot`。新标签有独立实例 ID，即使打开相同地址也单独授权。
历史操作先检查目标来源，然后等待 WebKit 完成导航。滚轮使用新鲜观察 ID，截图支持可见
视口和像素矩形，复用 Electron 的 PNG MCP 图片与证据文件格式。截图前后通过 WebKit
帧树检查来源，覆盖封闭 Shadow DOM 内的 iframe。WebKit 未提供所需帧元数据时拒绝截图。
网页触发的新标签回执和下载回执（含 Blob）由 Electron 提供。

Native 验收使用实际的 Workbench、Host 与确定性 ACP 代理。测试夹具从授权边界提供确认，
并通过页面事件自带的 `isTrusted`、独立读取和文件内容检查结果。回环服务器还验证了
同源地址返回的跨源重定向。验收覆盖新增能力、可信单击和双击与悬停、两个真实附件内容、
授权前后的工具状态和本地回执。Electron 的全量验收也运行同一组第六批场景。
运行方法为构建带 `native-probe` 的 `pero-native` 和 Native 连接器，再执行
`node tests/e2e/native-browser-use.mjs`。

## 第七批与 @Chrome 插件对照

使用同一套回环网页，在实际 Chrome 扩展会话与 Native Workbench 上检查核心行为。
Chrome 测试标签已关闭。

| 场景 | @Chrome 插件 | macOS Native |
| --- | --- | --- |
| 标签 | 同一 URL 有两个标签 ID，草稿隔离，关闭后回到原标签 | 同址独立，显式切换和关闭，新标签未经授权时不可操作 |
| 历史 | 返回、前进和刷新均检查页面实际变化 | 返回和前进检查当前 URL，刷新重新请求页面并清除测试草稿 |
| 滚轮 | 页面收到 `isTrusted=true`，滚动至 Y=1046 | 页面收到可信滚轮且视口移动，第二次使用旧观察被拒绝 |
| 截图 | JPEG 视口 1680×672、裁剪 120×48、整页 1680×2400 均取到了图像 | 视口和区域 PNG 核对尺寸、裁剪颜色、哈希和回执，跨源帧及越界裁剪被拒绝 |

Native 验收通过实际的 GPUI、Rust Host、确定性 ACP 和 WebKit，测试夹具在既有授权
边界提供用户选项。该验收未覆盖旧版 macOS 的 WebKit。

## Electron restart regression

Run `npm run test:browser-use` from a source checkout to build the Host,
Workbench Wasm, web renderer and Electron bundle before running the regression.
Use `PERO_CONTENT_TEST_ROOT` for an already staged build. The suite checks that
two tabs with the same URL are checkpointed under separate IDs, reappear under
those IDs after restart, and restore independent Chromium form values.

## Native Workbench and external Chrome

On macOS 27.2.1, the release-mode Pero Native Preview and Google Chrome for
Testing 156.0.8078.4 ran with isolated profiles. The Native build used
`a5d918c42` with the menu placement fix and concurrent worktree changes.
The actual **Chrome → Copy
Chrome pairing code** menu copied the code from the ordinary conversation
view. The unpacked Pero extension accepted the code and reported that it
was awaiting tab approval. At that point the Native Agent had no tab access.

After reviewing and allowing the first tab, the deterministic ACP Agent
filled a field and clicked the fixture’s button through the real Rust Host
and `browser_use`. An independent loopback request from the page reported
`isTrusted=true`, and the Native profile stored the matching click receipt.
Switching to another tab at the same origin exposed only the original,
inactive grant and page operations were refused. After revoking in Chrome,
the second tab received a distinct ID only after a new pairing and approval.

**Stop and take over** in the extension and **Chrome → Disconnect Chrome**
in Native both invalidated the respective grant for the same conversation.
Chrome showed **Disconnected**, removed its debugger indicator, and kept
both tabs open. The checks and receipt are in
`test-results/native-chrome-relay/result.json`.

## Electron Runtime

### External Chrome extension and Relay

The [Pero Chrome extension](../../packages/chrome-extension/README.md) adapts
Point’s pairing and tab review flow. Electron Desktop and macOS Native use the
same local Relay and the same ACP conversation tool. Pairing binds the
connection to the selected ordinary conversation. Chrome grants access only
after the user reviews and approves each live tab. A page operation
requires the approved origin, an active tab in its Chrome window, and a
current observation. Pero uses the existing Browser Use observation and
action receipts.

`node tests/e2e/chrome-relay.mjs` exercises the production Electron Workbench
Relay, real Host and deterministic ACP Agent with headed Google Chrome for
Testing. It loads the actual unpacked extension in a temporary Chrome profile.
The suite checks pairing without tab access, explicit tab approval, an
independently observed trusted click after filling and its stored receipt,
viewport and cropped PNG hashes, upload of a conversation attachment,
authenticated and Blob download Artifacts, tab switching and closing, and
back, forward and reload. It checks isolation from other tabs and conversations,
foreign-origin rejection, replay protection and debugger release on revocation.
Evidence is written to `test-results/chrome-relay/`.

For real Codex on macOS, build the extension, install the signed Native bundle
with the `native-probe` binary and run
`node tests/e2e/native-repl-agent.mjs --chrome` with
`PERO_NATIVE_REPL_REAL_AGENT=1` and `PERO_NATIVE_REPL_INSTALLED_APP`.
The probe pairs headed Chrome for Testing through the Native connector and
reviews the fixture tab in the actual extension. Codex uses bundled CPython
across two cells. The test independently checks the trusted click and the
image-only marker read by Codex, plus the PNG hash in both the Host evidence
and Codex's ACP transcript. Evidence is written to
`target/computer-verification/native-chrome-repl-codex/`.

### Embedded browser

Point revision `2449d4b98b38a8839ce741fd1039af201e63d6a7` supplied
`browser/src/browser-dom-semantics.mjs` and the isolated-world approach from
`browser/src/browser-expanded-dom.mjs`. The adapted TypeScript is part of
Pero's Electron Desktop build. `WebPages` owns the existing
`WebContentsView`; Rust Host owns the ACP session and its approval policy.
The existing authenticated Desktop MCP connection carries `browser_use`.

The tool supports status, document observation, trusted Chromium clicks,
double-clicks and hover, named keyboard input, viewport wheel scrolling,
viewport screenshots, plain-text filling and same-origin navigation.
Observation issues opaque refs to the current document. Input consumes the
observation. Pointer actions recheck the node's identity and semantic label
and hit-test its visible point. `dblclick` checks the same target and point
again after the first click. A press focuses an observed element and sends a named key
such as Enter, Tab, Escape or an arrow. Scrolling uses the current observation
ID and bounded X/Y wheel deltas. Desktop uses a short-lived Chromium debugger
attachment for fixed input commands. The tool accepts page content as data.
Observation omits password, hidden and credential-autocomplete inputs. For a
visible file input it exposes an actionable reference and label without any
selected filenames or local paths.
Direct navigation rejects foreign origins and cancels
cross-origin HTTP redirects before the foreign site receives a request.
A navigation initiated independently by the page or the user ends the grant
if it leaves the origin.

### Independent tabs, history and files

- `tabs` lists only instances authorized for this conversation. Use `tabId`
  to select an instance, `activate` to show it, and `closeTab` to close it.
  `open` creates a new instance of a same-origin URL, even if the URL is
  already open. The new instance needs its own user approval. Chromium history
  and form state are restored per instance when reopening the workspace.
- `click` can also open a same-origin HTTP(S) tab through a `target="_blank"`
  link or a page call to `window.open(url)`. Set `expectPopup: true` to wait up
  to five seconds for the popup. The click receipt records the first observed
  popup and returns the independent `tabId` with `authorized: false` when it
  opens. The user must then grant that tab from the Workbench menu.
- `back`, `forward` and `reload` use the selected instance's Chromium history.
  Each operation checks the origin and yields a receipt for the destination.
- `files` lists the conversation's frozen attachments. `upload` sets one of
  these files on an observed file input using its `fileRef`. Submitting the
  form remains a separate action. Supported attachments follow the existing
  Composer and Host file-reference rules.
- `download` fetches an observed same-origin HTTP(S) link using the tab's
  Chromium session and follows same-origin redirects. It can also click an
  observed Blob link with a `download` attribute, or a button that starts a
  native Chromium download. Native events must come from the authorized tab
  and initiator origin. The captured source URLs must stay on that origin.
  The operation waits up to 20 seconds and accepts up to 10 MiB. The existing
  Host Artifact delivery freezes the download in the current conversation and
  returns its version and digest. Desktop removes temporary staging files.

### Locators, forms and frame scope

- `locate` takes an exact role and optional accessible name, label, text, or
  test ID. It requires a unique visible match. An actionable result carries an
  opaque reference for the current observation.
- `observe` lists visible iframes with a title or test ID. Pass their selectors
  in the `frame` path on `observe`, `locate` or `wait` to read the same-origin
  document. Paths support up to four iframe levels. References bind the actual
  nested document. A frame reload invalidates them even at the same URL.
  Trusted pointer input translates through the visible frame bounds.
- Form state exposes disabled status, checked or mixed state, safe text values,
  and bounded option metadata. `setChecked` updates native checkboxes and can
  select a radio. `selectOption` accepts a value or an array of up to 64 values
  in `value`. It replaces the selection, and an empty array clears a native
  multiple select. A single select requires exactly one enabled option. All
  requested values must be unique and refer to enabled, unambiguous options.
  `fill` writes plain text to native inputs and editable `contenteditable`
  hosts. It preserves line breaks and treats markup as text.
- `wait` uses the same locator and accepts visible, hidden, enabled, checked,
  exact value and exact text conditions. The default deadline is five seconds
  and the maximum is ten. A match returns the observation. A timeout returns
  `matched: false` with a receipt and no actionable reference.

For example, locate the Mode combobox in the Details frame:

```json
{
  "action": "locate",
  "frame": [{"by": "title", "value": "Details"}],
  "locator": {"by": "role", "role": "combobox", "name": "Mode"}
}
```

The Desktop profile stores observation JSON and paired intent/result records
under `browser-use-evidence/`. An action receipt links the observation and
reference used, or records the navigation destination. A viewport screenshot
returns MCP image content and stores the same PNG with dimensions, byte count
and SHA-256 in its receipt. The optional `clip` records `{x, y, width, height}`
in image pixels relative to the top-left of the viewport. The full rectangle
must fit inside the visible viewport. Both capture modes require that every
frame have the approved origin. The fill intent omits the input text. Later observations can include text the page itself
renders. A dispatch receipt records that the operation was delivered, and a
separate observation can check the page effect. Session deletion removes the
associated evidence.

## Observed on macOS

The Desktop main bundle was built from the Browser Use working-tree changes on
`0e892f6d5` in an isolated directory, using the existing Workbench renderer
and Rust Host builds. `npm run test:browser-use` ran against actual Electron
WebContentsView instances and the real Rust Host with a deterministic ACP
fixture. The confirmation response was supplied by the test. It verified
default denial, cancellation and acceptance of the confirmation, the toolbar
indicator, tab and conversation scope, stale references, a fill followed by a
click, an independent Chromium DOM read of the resulting output, same-origin
navigation and persisted observations and receipts. The other loopback
origin received zero requests from the rejected link and redirect. Explicit
revocation, user navigation to another origin and tab closure ended access.

The inspected Workbench screenshot shows the toolbar authorization state.
Electron's renderer capture does not composite the separate browser child.
`test-results/browser-use/result.json` records the functional results.
`npm run check` and `npm run test:app-use:unit` passed.
The older `web-documents.mjs` suite timed out at its coordinate-based click
back to the conversation. The same failure reproduced with an isolated
Desktop bundle built from unmodified `0e892f6d5`, using the same renderer and Host.

The trusted-input and screenshot changes on `9161142dc` passed the same
Electron/Host/ACP suite using an isolated Desktop bundle. The local page only
changes the result after both a trusted pointer-down and a trusted click. A
trusted Enter updates a separate status, and Chromium reports a positive
scroll position after the wheel command. The fixture verifies stale-input
refusal, denial of Enter on a cross-origin form, refusal of all four operations
after revocation and denial of capture on a page embedding a foreign-origin frame. The MCP PNG
and the saved PNG match the receipt hash. The inspected viewport capture is
at `test-results/browser-use/browser-viewport.png`.

The locator, form, wait and iframe changes on `284cf5cd1` passed the same
Electron/Host/ACP suite using an isolated Desktop bundle. The suite verifies
exact role, label, text and test-ID matches, duplicate refusal, checkbox
state and idempotence, disabled-option refusal, selection and value readback,
waiting for an initially disabled control and asynchronously updated text,
hidden and timeout outcomes, and the nested iframe's fill, trusted Enter and
trusted click. It reads Chromium state independently, rejects the cross-origin
frame, rejects an old reference after a same-URL frame reload, and checks the
saved frame path and URL in the action receipt.

The independent tab, history and file changes on `6e00033de` were exercised
with a freshly built Workbench renderer and Rust Host. Two tabs at the same
URL kept different select values before and after restarting Electron.
The suite exercises activation, closing one tab, backward and forward
navigation, and a reload verified by a second HTTP request. It checks the
per-tab approval boundary and rejects history entries on another origin.

The Composer attachment arrived at the loopback server with its original
filename and bytes in Chromium's multipart form submission. A reference
absent from the conversation was rejected. The same-origin download followed
a redirect and used the tab's Chromium session cookie. The real Host emitted
the Artifact receipt, and the Workbench listed it. The suite compared the
stored snapshot bytes with the expected CSV and verified the receipt's
SHA-256 and staging cleanup. The foreign server received no requests from
the blocked new-tab and download redirects.

The fourth batch was exercised on `0fd0bf0d3` using a freshly built Desktop
main bundle and the same real Electron, Rust Host and ACP fixture. The page
observed a trusted hover and a trusted double-click with click details `1`
and `2`. A covered target was refused. When the first click removed the
target, the underlying button received no click. The suite verified
multiple selection, clearing, idempotence and refusal of disabled or
ambiguous options. It confirmed the editing host received literal multiline
text and the read-only host kept its original text. The clipped PNG matched
the fixture's background pixels on the Retina display and the dimensions and
SHA-256 in the MCP receipt and saved record. The suite also verified refusal
after revocation, outside the viewport and on a page with a foreign frame.
The captured region is at `test-results/browser-use/browser-clip.png`.

The fifth batch was exercised on `3dca970b4` with a rebuilt Desktop main
bundle and the real Electron, Rust Host and ACP fixture. A `target="_blank"`
link and a delayed `window.open` created distinct tabs at the same URL. An
observation of the new tab failed before its own approval and succeeded after
approval. The foreign popup was refused before the other server received a
request.

The fixture exercised a direct Blob link, a button that created and revoked a
Blob URL, and a form that produced an HTTP attachment after a same-origin
redirect. The Workbench listed all three Artifacts. The suite verified the
frozen bytes and SHA-256 for each, including the UTF-8 Blob payloads, and matched
the saved Browser Use receipts to the Host receipts. An oversized Blob and an
action that navigated away without downloading produced no Artifact. The
workspace had no remaining download staging directories.

This verification covers the Electron Workbench development build with a
fixture Agent. Native Wry, remote Worker, external Chrome/Relay, a real model
provider and packaged builds remain outside this implementation or verification.

## Installed Native and daily Chrome sidebar, 2026-11-23

The installed macOS app paired from Settings with the Phodal profile in Google
Chrome 157 and Pero Browser Use 0.3.0. The sidebar sent a multiplication prompt
to the selected Codex conversation. The account rejected its configured
6.2 Astra model. Selecting 5.6 Sol in that conversation and sending a new
prompt produced the assistant response `日常浏览器2747` for 41 × 67.

Collector read one explicitly approved loopback page. Native opened
`Collected page.md` v1 in that conversation's Artifacts and displayed the
original URL, `Amber observatory sample 739.`, and the reason entered in
Chrome. Disconnecting in Native returned the sidebar to the pairing prompt.
This run used the installed app with ephemeral Native secret storage and the
real Codex adapter. Local screenshots are in `test-results/chrome-sidebar/`.
