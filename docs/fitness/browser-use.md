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
Native 也可通过 `download` 把已观察的同源 HTTP(S) 或 Blob 链接保存为会话 Artifact。
HTTP(S) 下载使用该 WebKit 标签的登录态，拒绝重定向，文件上限为 10 MiB。
`click` 可带 `expectPopup: true`，等待网页打开新标签并在动作回执中记录标签 ID。
同源目标使用独立标签实例和授权，跨源目标在发出页面请求前拒绝。等待上限为五秒，
届时若无新标签事件，回执记为 `notObserved`。Electron 也支持下载按钮触发的原生下载事件。

WebKit 的 `alert`、`confirm` 和 `prompt` 显示为当前工作台窗口的原生对话框。
浏览器工具可在当前标签及同源授权下读取和处理它们。旧对话框 ID 会被拒绝，
`promptText` 不写入动作回执。

Native 验收使用实际的 Workbench、Host 与确定性 ACP 代理。测试夹具从授权边界提供确认，
并通过页面事件自带的 `isTrusted`、独立读取和文件内容检查结果。回环服务器还验证了
同源地址返回的跨源重定向。验收覆盖新增能力、可信单击和双击与悬停、两个真实附件内容、
授权前后的工具状态和本地回执。Electron 的全量验收也运行同一组第六批场景。
Native 回环验收另核对了需 HttpOnly Cookie 的 CSV、页面生成的 Blob、Artifact 字节和
哈希，以及跨源重定向的目标从未被访问。Chrome Relay 也通过既有下载回归。
新标签验收核对了同源 `_blank` 链接打开后的页面内容、授权前的拒绝、跨源 `window.open`
请求计数为零，以及无新标签时的超时回执。工具结果与保存的动作回执一致。
Native Python REPL 验收关闭了 `alert`，接受和取消了 `confirm`，并向 `prompt` 提交
含中文和 emoji 的文本。回环服务器独立核对了 WebKit 脚本的返回值和请求次数。
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

## Full-page screenshots

Pass `fullPage: true` to `browser_use` screenshot on an embedded Electron tab
or a tab from the paired Chrome profile. Full-page capture and viewport cropping are
mutually exclusive. Chromium captures the whole laid-out document while
preserving its scroll position. The receipt includes `fullPage`, PNG
dimensions and SHA-256. Page dimensions and encoded bytes are bounded. All
frames must match the page's origin. Embedded Native WebKit supports viewport
and clipped screenshots.

On macOS, the Electron Browser Use and headed Chrome Relay suites observed
the offscreen fixture marker in the returned PNG, matched its hash to the
saved evidence and rejected a frame outside the authorized origin. The Chrome
suite used the built unpacked extension and a scripted ACP agent. Evidence is
in `test-results/browser-use/browser-full-page.png` and
`test-results/chrome-relay/full-page.png`.

## Native startup and explicit pairing

On 2026-11-24, the debug Native Workbench built from `3e40a59f8` with the
startup fix restored an ordinary fixture conversation after restarting an
isolated profile. Browser Settings showed **Chrome 尚未配对到当前会话** and
offered **在 Chrome 中配对**. The IDs of the existing Chrome pairing windows
were identical before launch and after the Settings check. The headed
`tests/e2e/chrome-sidebar.mjs` suite confirmed that an explicit pairing ticket
connects in a normal Chrome window, then exercised the existing sidebar and
Collector paths. The Native Settings review used the dark theme at default
size. The installed app and extension were outside this verification.

## Native Workbench and external Chrome, historical protocol 2

### Native startup connection and settings — 2026-11-24

The debug macOS Native Preview used a separate data directory at
`/private/tmp/pero-chrome-settings-review` and the installed Pero Chrome
extension. Selecting its ordinary conversation connected Chrome without a
manual menu action. In the real Native settings window, **浏览器设置** showed
**Chrome 已连接到当前会话**; the conversation titlebar had no Chrome entry.
**断开 Chrome** changed the status to **Chrome 已断开**. After quitting and
restarting the same preview, Settings again showed connected without clicking
Reconnect. `node scripts/cargo.mjs +nightly-2026-10-28 build --locked -p
pero-ui --features native --bin pero-native` and focused Native titleband and
connection-state tests passed. This is development Native acceptance for
connection state and UI. The installed release was not replaced, and this run
did not re-exercise per-tab approval or a browser page action.

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

Electron Desktop and macOS Native use the same local Relay and ACP
conversation tool. Relay protocol 3 pairs the selected ordinary conversation
with a Chrome profile. `tabs` lists its regular HTTP(S) tabs across windows.
The same result includes `chrome.state`. Read it independently of the tab count.
Use `status` with `provider: "chrome"` or open **Chrome connection status**
in the Workbench menu to check the selected conversation's connection.
The pairing permits tab discovery. The first page operation for an origin
prompts in the Workbench. A one-turn approval or decline ends with the
agent's turn. Always allow and Block are stored in the Workbench profile,
keyed by scheme, host and port. `tabs` and `status` report `siteAccess`.
Chrome site permissions lists the saved rules. Clearing them ends the current
Chrome pairing. A saved Block also prevents sharing the site with a Cloud run.
`handoff` releases an individual tab and leaves it open for the user. For
Chrome it detaches that tab's debugger and keeps other tabs in the pairing
available. A new pairing can grant access to the tab again.
Page operations require a current document. Pass an explicit `chrome:`
`tabId` with `background: true` to read or operate an inactive tab without
selecting it. The default requires the tab to be active. JavaScript dialog
handling and opening a tab through `open` use the active-tab path.
Extension 0.3.9 can run requests to different Chrome tabs together. Use
explicit tab IDs and await dependent operations in order on each tab. A
conflicting operation on the same tab returns an error. Older extensions
continue with a single Relay request at a time.
The extension attaches Chrome's debugger only when a page operation needs it.
Stop and take over or Disconnect Chrome releases the attached tabs.
With extension 0.3.3, `click` with `expectPopup: true` reports the first
HTTP(S) navigation target Chrome attributes to the selected tab during input
and the five-second observation window. The receipt includes its `chrome:`
ID. After the new tab loads, the paired conversation can use that ID and
request site approval if needed. If no event is observed, the click outcome
is recorded separately from `popup.kind: notObserved`.

Extension 0.3.4 also supports JavaScript dialogs on the active tab in the
paired Chrome profile. `getJsDialog` returns the current dialog ID, type and
bounded message. Use that ID with `handleJsDialog` and `decision` of `accept`
or `dismiss`. Accepting a `prompt` requires `promptText`. `alert` and
`beforeunload` support `dismiss`, which keeps the current page open when
dismissing `beforeunload`. The dialog ID expires when the dialog closes.
Chrome can hold a renderer input response while a dialog is open. Relay
returns control on the dialog event so the next request can handle it, then
settles the original input before the next page operation. Dialog action
receipts record the decision and ID. The prompt answer stays out of the receipt.

### Browser Developer Mode

In Electron, enable **Workbench → Browser Developer Mode**. It works with an
authorized embedded Chromium tab or paired Chrome 0.3.7 or newer. Native
offers the toggle in its Chrome menu for paired Chrome tabs. Each capture
asks for separate approval and remains bound to the current tab and document.
The mode resets when the Workbench exits.

`browser_use` action `diagnose` takes an optional `captureMs` of 100–4000,
defaulting to 750. It returns console messages, runtime errors, network
status and timing, and Chromium performance metrics. Network entries include
only same-origin URLs, with query strings and fragments omitted. Use
`style: { selector: "h1", properties: ["color"] }` to inspect computed CSS
and `profile: true` to request a CPU sample. When the attached driver lacks
the Profiler domain, the result includes `profileUnavailable: true` with the
other observations. The Chrome and Electron fixtures independently assert
that the expected console, network, runtime and CSS values reach ACP. The
embedded Chromium fixture also checks a named function in its CPU sample.

`cdpSend` runs a read-only command on the approved Chromium tab. Pass
`command: { method: "Page.getLayoutMetrics" }`, `Performance.getMetrics`, or
`DOM.getDocument`. The DOM command supports depth 0 or 1. Extension 0.3.12
adds `Page.getFrameTree` and `Page.getResourceTree`. Both return the tree for
the approved document and its same-origin HTTP(S) frames. The resource tree
includes same-origin resource URLs and their Chromium metadata. Replies are
limited to 32 KiB. Paired Chrome requires extension 0.3.11 or newer for the
original three commands and event cursor.

`cdpReadEvents` reads Chromium's recent console calls and uncaught exceptions
from the top document. Pass `methods` to filter and the returned `cursor` as
`after` to read the next events with the same filter. Use `hasMore` to page
through results and `truncated` to detect when the buffer could not cover the
requested range. The cursor expires when the page reloads or the debugger
detaches. Each read requires approval. Ordinary JavaScript evaluation is
outside these actions.

`cdpListTargets` discovers directly related out-of-process iframe targets in
Electron Chromium or paired Chrome with extension 0.3.14 or newer. It
defaults to the approved origin. Add exact origins to `fromOrigins` to request
separate approvals before seeing a cross-origin iframe. With `cdpSend`, pass
the returned `id` and `origin` as `target` to use a supported Page, DOM or
Performance command. Each call asks for approval for the target origin. The
target identifier expires when the child reloads or navigates, when the top
document changes, or when a new discovery replaces it. Same-process iframes
remain available through `observe`, `query` and `act` with a frame selector.

With extension 0.3.15 or Electron, pass `depth` from 2 to 4 to follow nested
out-of-process frames. Discovery walks approved ancestors and returns
`parentId` on descendants. With `cdpReadEvents`, pass the same `target` to
read recent console calls and uncaught exceptions from the selected iframe.
Its cursor is tied to the target's discovery and its ancestors' documents.

With extension 0.3.16 or Electron, `Network.enable`, `Network.disable`,
`Network.getResponseBody`, and `cdpReadEvents` with `timeoutMs` also accept an
iframe `target`. Keep the target with its returned capture cursor and request
IDs. One child capture and the top-document capture can run side by side.
Starting another child capture replaces the previous child capture.
Navigation or detachment of the child or an ancestor, a fresh target
discovery, and turning off Developer Mode end the child capture.

With extension 0.3.17 or Electron, after the debugger reports that an iframe
target detached, `cdpReadEvents` can page its buffered events using the same
approved target and cursor. Such replies include `detached: true`. Detachment
ends collection and response-body access. The buffer expires at the original
one-minute deadline. Disabling Network or Developer Mode, changing the top
document or pairing, or starting a new discovery or child capture clears it.

With extension 0.3.18 or Electron, use `cdpReadEvents` with
`Target.attachedToTarget`, `Target.targetInfoChanged`, or
`Target.detachedFromTarget` to watch direct out-of-process iframes. The first
read starts a one-minute stream and returns a checkpoint. Pass the checkpoint
as `after` on subsequent reads. Use `fromOrigins` to request approval for
additional origins, and keep the approved origin set with the cursor. A frame
whose origin was unknown at attachment appears once Chromium supplies an
approved URL. The events share a stream-local `targetId`. Event URLs omit
queries and fragments. A
new watch, navigation of the top document, expiry, debugger release, or
revocation discards the watch. Read Runtime and Network events separately.

With extension 0.3.19 or Electron, take `targetId` and `origin` from an
attach or update event and pass them as `target: { id: targetId, origin }`
to `cdpSend` or `cdpReadEvents`. Pero binds the handle to the iframe document
when returning the event. Reloading, detaching, or ending the watch expires
the handle. After a change to the iframe URL, read its update for the new
handle. `cdpListTargets` remains available to rediscover a reloaded iframe.

With Chrome extension 0.3.13 or Electron, send `Network.enable` with
`cdpSend` to start a live capture and get its initial cursor. Perform a
page action and pass that cursor as `after` to `cdpReadEvents`. During a live
capture, omitting `after` returns an empty page and a checkpoint at the
current position. Use `timeoutMs` up to 4000 to wait for the first matching
event. Events include top-document console and exceptions, same-origin
request starts, responses, and loading completion or failure. Network
events include request IDs and paths with queries and fragments removed.
Use `Network.getResponseBody` with the request ID from a completed request
to read a text or JSON body of up to 16 KiB. `Network.disable` stops the
capture and discards the buffer. A capture also ends after one minute,
when Developer Mode is turned off, on navigation or debugger release,
or when a new capture or `diagnose` takes over the debugger domains.
The Workbench asks for approval on each request. The method names and
event lifecycle follow the [CDP Network domain](https://chromedevtools.github.io/devtools-protocol/tot/Network/).

Codex exposes permitted CDP commands and event cursors on a tab in
[Browser Developer mode](https://learn.chatgpt.com/docs/whats-new).
On 2026-11-24, the connected Codex Chrome extension returned frame and
resource trees on an owned loopback page. After `Network.enable` and a click,
its numeric cursor paged `Network.requestWillBeSent`,
`Network.responseReceived`, and `Network.loadingFinished`. The corresponding
request ID returned the page's HTTP 202 JSON via `Network.getResponseBody`.
`readEvents()` without a cursor returned an empty page and a checkpoint at
the current position. Pero now uses the checkpoint behavior during live
capture. Without a live capture, its original Runtime replay returns recent
events when called without a cursor.

That Codex fixture returned both iframe contents in the DOM snapshot.
Raw `Page.getFrameTree` listed the same-origin child and
`Target.attachedToTarget` reported an iframe session. Raw
`Target.setAutoAttach` was refused and sending `Page.getFrameTree` to the
reported child session returned an unattached-session error. The child
selector exists in the documented tab capability, and this run verified the
attachment event.

A follow-up Codex Chrome fixture created an out-of-process iframe and a
dedicated Worker after taking a cursor. Codex reported the iframe's attachment
with an empty URL, then reported its committed URL through
`Target.targetInfoChanged`. The iframe session query again returned an
unattached-session error. This fixture returned no Worker attachment event.
A separate Chrome for Testing probe using the native `chrome.debugger` API
observed the same URL transition and successfully routed `Page.getFrameTree`
through the iframe's flat session. The selector stopped working when auto
attach was disabled. Origin admission therefore needs the committed child
document rather than the initial attachment event.
[Chrome debugger flat sessions](https://developer.chrome.com/docs/extensions/reference/api/debugger#attach-to-related-targets)

In the Codex Chrome workload fixture,
`Performance.getMetrics` returned 36 metrics after enabling the domain.
`Profiler.enable` returned CDP error `-32601` with method unavailable,
matching Pero's extension transport. Chrome's
[extension debugger domain list](https://developer.chrome.com/docs/extensions/reference/api/debugger#restricted-domains)
includes Performance. The embedded Chromium Profiler remains a separate
capability. A page can also opt into the
[JS Self-Profiling API](https://wicg.github.io/js-self-profiling/) with
Document Policy. That requires cooperation from the site.

### Browser Site Tools

Enable **Browser Site Tools** in the Electron Workbench menu or the macOS
Native Chrome menu. Electron supports an authorized embedded Web tab and
both shells support an approved site in the paired Chrome profile. For Chrome,
use extension 0.3.10 or later and pass the explicit `chrome:` tab ID. Chrome must
make WebMCP available to the page. The loopback fixture enables the feature
with a Chrome startup flag. Availability on regular sites follows the
[Chrome WebMCP rollout](https://developer.chrome.com/docs/ai/webmcp).
`listSiteTools` discovers WebMCP registrations in the
approved document and its same-origin frames. It returns the browser's tool
schema and a document-bound ID. Request partner-frame tools by listing the
exact origins in `fromOrigins`. The user reviews those origins before
discovery, and Chromium lists the tools each partner has exposed to the page.
`callSiteTool` uses the returned ID and an `input`
object. The Workbench shows the origin, frame when applicable, tool name and
arguments before dispatch. Run discovery again after navigation or reload.
Each dispatch returns a receipt. If the tool's outcome is unclear, inspect
the page before calling it again.

The Electron and Chrome Relay fixtures register real WebMCP tools in a page
and in same-origin and cross-origin frames. Both check the returned schemas,
private partner tools staying private, separate discovery and call consent,
independent page effects, a saved receipt and a stale ID after reload.
On macOS, `node tests/e2e/native-chrome-site-tools.mjs` uses the Native probe
build, Chrome for Testing, and Python REPL. Set `PERO_NATIVE_REPL_INSTALLED_APP`
to use the signed probe bundle and its packaged extension and Python. Set
`PERO_NATIVE_SITE_TOOLS_MANUAL=1` to respond directly to the two approval
sheets. The test checks that the approved action is the only page mutation
and saves a receipt. The combined signed macOS candidate passed this check on
2026-11-24. Evidence is written to `test-results/native-chrome-site-tools/result.json`.

### Chromium accessibility snapshots

`getAXState` reads Chromium's native accessibility tree in an authorized
Electron Web tab or paired Chrome tab (extension 0.3.8 or later). It includes
same-origin frames under their owner nodes. A full result contains
`snapshotId`, `rootId` and `nodes`; each node's `children` lists its
children in order. Pass the latest `snapshotId` as `since` to get only
`upserted` nodes and `removed` IDs. If the document or baseline changed,
the response is a fresh full tree with `baselineReset: true`.

Use `observe` and `locate` for action refs. AX reads leave those refs
available and omit form values. An observation is bounded by node count,
depth and same-origin frame count, with `truncated` when the limit is reached.
The same browser fixture checks real AX roles, table cells, frame ancestry,
delta insertion and removal, a trusted DOM-ref click and reset after reload.

### Chrome Relay acceptance

`node tests/e2e/chrome-relay.mjs` exercises the production Electron Workbench
Relay, real Host and deterministic ACP Agent with headed Google Chrome for
Testing. It loads the actual unpacked extension in a temporary Chrome profile.
The suite checks listing tabs on two origins in separate Chrome windows
immediately after pairing, approval before observation, lazy debugger
attachment, one-turn and persistent permissions, settings reset, an
approved background read while a child frame keeps the tab loading,
independently observed trusted click after filling and its stored receipt,
viewport and cropped PNG hashes, upload of a conversation attachment,
authenticated and Blob download Artifacts, tab switching and closing, and
back, forward and reload. It also follows an actual `target="_blank"` link
and a delayed cross-site `window.open` by the IDs in their saved receipts.
An ordinary click checks the timeout result. Dialog coverage verifies the
page's confirmation result (including across two REPL cells), the Unicode
prompt answer, the alert callback, and that cancelling `beforeunload` leaves the document in place. It also checks
that an expired ID or invalid answer cannot close a live dialog. The suite checks isolation from other conversations,
inactive tab rejection on the default path, trusted input and reload on an
explicitly addressed inactive tab, cross-origin guardrails, replay protection
and debugger release on disconnect.
The parallel fixture holds one navigation response while another tab
completes trusted input, both through browser MCP calls and through
`javascript_repl`. Use `node tests/e2e/native-chrome-parallel.mjs` with a
Native probe build and rebuilt connectors to run the same fixture through
the Native Python REPL. On 2026-11-24 the combined signed macOS candidate
passed using its bundled Python, the rebuilt extension and headed Chrome.
The peer tab completed trusted input and released the held navigation, and
an overlapping observation on the navigating tab was rejected.
The same suite compares the optional observation tree against the Codex
in-app browser snapshot on one shared fixture, checks the flat nodes and
references, and verifies that only same-origin iframe contents appear.
It distinguishes an unpaired session, a pending or expired pairing code,
a protocol mismatch, a connected profile with zero web tabs, and a disconnect.
The large-page fixture checks that the tree stays inline beside the content
reference. The suite also checks scoped actions after reload, read-only
queries that leave refs usable, and handing off a tab while it remains open.
Evidence is written to `test-results/chrome-relay/`.

The Chrome Relay and Electron Browser Use suites exercise layout metrics,
performance metrics, the shallow DOM reply, and origin-scoped frame and
resource trees. They check that a Runtime
cursor skips previously read events, excludes same-origin iframe console
messages and expires after reload. The Chrome suite also checks that reads
fail with Developer Mode off or when the user declines the capture.
Both suites also click a loopback fixture, page mixed console and network
events, read the completed HTTP 202 JSON response, reject body access after
a cross-origin redirect, and verify capture expiry when Developer Mode is
turned off or `Network.disable` runs.
The out-of-process iframe fixture uses a separate loopback hostname. Both
suites check that discovery is scoped by origin, an approved child returns
its own DOM, and navigation invalidates the old child identifier. The Chrome
suite also rejects discovery when the child-origin approval is declined.
The nested case verifies that discovery skips a branch under an unapproved
ancestor, only the target's own Runtime events are returned, and a cursor
from a different iframe is rejected.
Both suites capture the top document and a child together and check that their
network events and response bodies stay separate. They also check a child
read timeout, continued top-document access after stopping the child, and
revocation of child access when Developer Mode is turned off.

### Chrome and embedded browser from an SSH Workbench

An ordinary SSH Workbench chat can operate an explicitly shared local web tab
over the existing authenticated reverse-loopback App Use tunnel. The
Workbench consent shows the SSH host and the scope. Embedded web tabs use
their existing site grant. Chrome pairs to the selected SSH chat once and
lists regular tabs in the paired Chrome profile. The desktop keeps its
Chrome debugger and Browser Use evidence. The SSH route excludes
`files`, `upload` and `download` from the tool schema and rejects raw calls
to those actions.

`tests/e2e/browser-use-ssh.mjs` ran with the Electron development build,
the OpenSSH server in a Colima Linux arm64 VM, and the Linux Rust Host
and deterministic Python ACP Agent. The test supplied both choices at the
Workbench consent boundary. Refusing Chrome access yielded no ticket.
The Linux Agent used Browser Use on the granted embedded tab and the paired
Chrome profile in separate turns. The loopback web server recorded one trusted
click in each engine. The Agent verified each DOM effect and compared the
received PNG digest with its receipt. Revocation removed access in both lanes.
The result is in `test-results/browser-use-ssh/`.

To rerun, configure the remote Host's Agent entry to run
`tests/fixtures/browser-use-ssh-acp.py` on the SSH machine. Use the matching
local SSH configuration and Workbench profile with the development Desktop
and Chrome extension built.

```sh
PERO_SSH_CONFIG=/path/to/ssh.config PERO_TEST_SSH_PROFILE=/path/to/profile.json \
  node tests/e2e/browser-use-ssh.mjs
```

### External Chrome from Native Workbench

The Native development workbench used its connector and
headed Chrome for Testing with a scripted ACP agent. Without any per-tab
action in Chrome, the conversation listed both fixture windows and observed
actual page text. Native exit disconnected the extension. Evidence is in
`test-results/native-chrome-pairing/`.

On 2026-11-24 the normal macOS arm64 release recipe built Pero 0.1.2 from
`9a227bc65`. Both app signatures passed strict verification after mounting
the ad-hoc-signed DMG. The ordinary release executable passed portable startup
with an empty profile and bundled Node, Rust Host, Apps and CPython 3.12.16.

A separately signed copy with the optimized `native-probe` executable ran
the WKWebView Browser Use suite, the concurrent Chrome tab suite and the
WebMCP approval suite with the extension loaded directly from the app
payload. The Chrome suites verified that `sys.executable` resolved to the
bundled Python. WebMCP was verified on Chrome for Testing with the feature
enabled and the fixture's real macOS approval sheet. The ACP agent was the
deterministic test fixture. Evidence is in `test-results/native-browser-release/`.

The Native CDP check loads extension 0.3.11 from the signed app payload and
uses the app's bundled Python. The fixture dismisses the first macOS
approval sheet and accepts the following requests. It verifies all three
commands, paged console and exception events, iframe exclusion, the cursor
being rejected after reload, and the stored receipt for the click that
generated a new event. The test uses the separately signed `native-probe`
copy and a deterministic ACP Agent. Run it with
`PERO_NATIVE_REPL_INSTALLED_APP=/path/to/Pero.app node tests/e2e/native-chrome-site-tools.mjs --cdp`.
Evidence is in `test-results/native-chrome-cdp/result.json`.

For extension 0.3.13, append `--cdp-live` to the same command. The signed
probe copy uses its bundled Python and verifies that the Native approval sheet
mentions same-origin response content. It declines the first start request,
then checks scoped frame and resource trees, live network event pagination,
the HTTP 202 JSON body, cross-origin redirect rejection, and that stopping the
capture prevents further body access. Evidence is in
`test-results/native-chrome-cdp-live/result.json`.

For extension 0.3.14, use `--cdp-targets`. The signed probe separately
reviews the loopback iframe's origin and checks that a declined review
releases no child identifiers. It then reads the approved iframe's DOM and
waits for a replacement child document before checking the old identifier.
Evidence is in `test-results/native-chrome-cdp-targets/result.json`.

For extension 0.3.15, use `--cdp-target-tree`. The signed Native probe finds
the grandchild through its approved parent, queries its DOM, and verifies
separate console and exception replay for the two child targets. A cursor
from the direct child is rejected when used on the grandchild. Evidence is
in `test-results/native-chrome-cdp-target-tree/result.json`.

For extension 0.3.16, use `--cdp-target-network`. The signed Native probe
verifies that declining the child origin prevents starting a capture, then
approves the child, reads its HTTP 202 response, and verifies response access
ends when the capture stops. Evidence is in
`test-results/native-chrome-cdp-target-network/result.json`.

For extension 0.3.17, use `--cdp-target-detach`. The signed Native probe
removes the iframe through Browser Use, pages its buffered network events
with the existing cursor, and verifies that a response body read is refused.
Chrome independently confirms the fixture removed the iframe. Evidence is in
`test-results/native-chrome-cdp-target-detach/result.json`.

For extension 0.3.18, use `--cdp-target-lifecycle`. The signed Native probe
takes a checkpoint, opens two new cross-origin frames, and reads the attach,
update and detach events for the approved frame. Chrome independently checks
that both fixture frames were removed. Evidence is in
`test-results/native-chrome-cdp-target-lifecycle/result.json`.

With extension 0.3.19, `--cdp-target-routing` also uses the event handle to
read the iframe document and its Runtime console through Native Python REPL,
then confirms that the handle is rejected after the iframe is removed.
Evidence is in `test-results/native-chrome-cdp-target-routing/result.json`.

For real Codex on macOS, build the extension, install the signed Native bundle
with the `native-probe` binary and run
`node tests/e2e/native-repl-agent.mjs --chrome` with
`PERO_NATIVE_REPL_REAL_AGENT=1` and `PERO_NATIVE_REPL_INSTALLED_APP`.
The probe pairs headed Chrome for Testing through the Native connector.
Codex uses bundled CPython
across two cells. The test independently checks the trusted click and the
image-only marker read by Codex, plus the PNG hash in both the Host evidence
and Codex's ACP transcript. Evidence is written to
`target/computer-verification/native-chrome-repl-codex/`.

### Cloud Run browser transport

The isolated Runtime Gateway accepts one duplex Desktop attachment per live
Run. The Desktop authenticates with the Cloud Client that currently holds the
Task claim. Browser requests come from the Agent Pod whose identity matches
the Run's active lease and binding in an online TokenReview. The Desktop owns
browser selection and action admission. The gateway delivers one call at a
time, closes the attachment on loss of Run authority and does not replay
requests whose effects may be unknown.

`TestCloudBrowserFollowsClaimAndRuntimeChannel` uses real PostgreSQL and
full-duplex HTTP with fixture Desktop, Worker and Pod peers. It exercises
same-project non-owner rejection, wrong-Pod rejection, single attachment,
single-flight calls, response delivery and cancellation during an in-flight
call. The TokenReview endpoint is a loopback fixture.

The operator opts in with `runtime.browser_use: true` in the isolated recipe.
The recipe passes `PERO_AGENT_BROWSER_USE=1` to the Agent. The fixed Go ACP
process exposes the `browser_use` function for status, observation, locating,
clicking and filling on the shared tab. The Pod shim uses the rotating projected
token. Text recipes receive bounded text results. The process fixture
`TestAgentConnectCLIWithGoACP/browser` ran the real ACP and connector binaries
with a loopback TLS control endpoint and scripted provider. It verified the
tool result returned to the next provider request and the default lane has no
Browser Use function.
Cloud observations accept `includeTree` and keep the tree at the top-level
document. An iframe appears as a boundary without its contents.

A vision recipe can additionally opt in with `runtime.browser_screenshots`.
The share confirmation discloses the screenshot transfer. `screenshot` returns
the visible viewport or a requested clip as PNG. The Go Agent checks the PNG
against the Desktop receipt. The provider receives the receipt as a tool
result and the inline PNG in the next vision message. The ACP stream carries
the receipt. Text recipes refuse screenshot calls.

In Electron Workbench, select the claimed Run in Cloud Tasks. Use Workbench →
Share This Tab with Cloud Run for the embedded Web tab, or Share Active Chrome
Tab with Cloud Run for the active tab in the paired Chrome profile's last
focused window. The confirmation shows the task, Cloud origin and page origin.
The embedded toolbar marks the tab as shared. The stop action and Workbench
emergency shortcut release the Cloud share. The Chrome extension's Disconnect
action also releases a Cloud share of that profile.

In macOS Native Workbench, pair Chrome from an ordinary conversation and open
the claimed Run. Its execution card offers **Share Active Chrome Tab with Cloud
Run**. The confirmation identifies the task and both origins and discloses
whether screenshots can reach the model. After approval the card marks the
share as active and offers **Stop Cloud Browser Sharing**. Both shells recheck
the tab, origin and pairing after the confirmation.

With `PERO_TEST_CLOUD_BROWSER_ELECTRON` set to the absolute path of
`tests/e2e/browser-use-cloud.mjs`, the same Go test launches the Electron
Workbench and a headed Chrome fixture against that real Gateway and PostgreSQL
fixture. It verifies both choices at the consent boundary, one trusted click in
each browser with independent page and server effects, file and other-tab
rejection, Chrome window and tab switching, and revocation.
It also verifies that the mock provider receives the same SHA-256 as each
browser receipt. A separate real Go ACP process test verified the same bytes
using `PERO_TEST_CLOUD_SCREENSHOT` with each browser-produced PNG, and an image
larger than the ACP frame limit.
With `PERO_TEST_CLOUD_BROWSER_NATIVE` pointing to the same script, the
`native-probe` build drives the actual Native Workbench, connector and headed
Chrome against the same PostgreSQL/Gateway fixture. The probe supplies the
dialog decision at the confirmation boundary. It verifies refusal before
approval and after switching to a different tab during confirmation, a trusted
click with an independent page effect, a PNG matching the fixture model's
SHA-256, and stream revocation while the ordinary Chrome pairing stays connected.
The screenshot and receipt are under `test-results/browser-use-cloud/`.
This ran in a development build with a loopback Pod identity fixture.
Hosted Kubernetes, an external vision model and a signed Workbench build still
require verification.

On 2026-11-23, a read-only preflight of `app.openpero.com` returned 200 for
health and both existing client and operator APIs. The shared Project source
route and Browser Use readiness route returned plain-text 404. After the
operator-approved upgrade to `20261123T120905Z-898caf18`, the authorized client
received a shared source list and a different Project returned 403. Health,
client identity and operator task listing remained available. Migration 019
was present, the pre-upgrade dump was readable and the previous container was
retained. The deployed service has no isolated runtime configuration, so the
Browser Use readiness route still returns 404. No Task was dispatched.
The read-only API receipts are in `test-results/cloud-browser-hosted/`.

The hosted Nginx vhost now forwards Run requests without buffering or retries.
The prior vhost stalled before answering a still-open streaming request. A
loopback test with Nginx 1.25.3, the hosted version, verified the new vhost with
TLS and the Desktop connector. A synthetic 1 MiB screenshot reply and a 3 MiB
provider request passed; the ordinary API still rejected bodies above 512 KiB.
Both Workbench vision fixtures then passed the Go race test through the same
runtime location over loopback HTTP. Electron delivered a trusted click per
browser. Native refused the tab switch during confirmation and clicked the
approved Chrome tab. All three PNG hashes matched the fixture provider, and
sharing stopped in both shells. The test overlay only routed the fixture's
requests through Nginx. The live vhost passed its syntax and HTTPS health checks
after reload. The live server still has no isolated profile mounted.

The 2026-11-24 read-only recheck returned 200 for health, client identity
and operator task listing. With the operator credential, the Browser Use
readiness path still returned a plain-text 404, as did a control path with
an unknown endpoint. No hosted Run or vision call was started.

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
ID and bounded X/Y wheel deltas. The granted tab keeps a Chromium debugger
attached for fixed input commands and JavaScript dialog events. Revoking the
grant or closing the tab releases the debugger. The tool accepts page content as data.
Observation omits password, hidden and credential-autocomplete inputs. For a
visible file input it exposes an actionable reference and label without any
selected filenames or local paths.
Direct navigation rejects foreign origins and cancels
cross-origin HTTP redirects before the foreign site receives a request.
A navigation initiated independently by the page or the user ends the grant
if it leaves the origin.

Use `getJsDialog` and `handleJsDialog` to inspect and answer an embedded
Chromium `confirm`, or dismiss an `alert`. Dialogs use the existing grant
for the visible tab, and dialog IDs expire when their dialog closes. A delayed
dialog remains discoverable after the click returns. When a page opens a dialog
while loading, Browser Use returns before the load finishes so the next call can
answer the dialog. Electron rejects
`window.prompt()` in the renderer and automatically cancels navigation when
the page prevents unload. The paired Chrome provider supports both dialog types.
The Electron acceptance suite verifies page callbacks, navigation resuming
after a dismissed alert, stale IDs and debugger release on revocation. The
test replaces native message-box presentation while preserving the renderer
and debugger dialog lifecycle.

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
- `query` uses the same locator and scope for read-only access to matching
  elements. It returns a count and bounded node details without action refs.
  Set `limit: 0` for a count alone. A query leaves the current refs usable.
- `observe` lists visible iframes with a title or test ID. Pass their selectors
  in the `frame` path on `observe`, `locate` or `wait` to read the same-origin
  document. Paths support up to four iframe levels. References bind the actual
  nested document. A frame reload invalidates them even at the same URL.
  Trusted pointer input translates through the visible frame bounds.
- Set `includeTree: true` on `observe` to add a compact indented `tree` with
  semantic nesting, including same-origin iframe contents. The observation
  still returns its existing `nodes`, refs, and iframe selectors. To operate
  inside an iframe, observe or locate within its `frame` path. A tree that
  reaches its own output or traversal limit has `treeTruncated: true`.
  The MCP reply includes the tree inline even when the complete observation
  is stored behind a `content_reference`.
- `act` resolves its locator and runs its `operation` using a fresh reference.
  It accepts the same frame and container scope as `locate`. Set `timeoutMs`
  to wait for the target to appear. Each call resolves the target again.
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

## Project sources from Chrome Collector

Chrome Collector can save reviewed page text or a selection to a local or shared
Project. Choose the destination in **Save to** before saving. The Project's
**Materials → Web sources** section opens the excerpt, collection reason and
research question independently of the paired conversation. Local captures
stay in the current profile. Choose **Shared Project** to store the reviewed
capture in Cloud for members of that Project. The destination is bound to the
selected Cloud service and account. Retrying an identical capture in the same
Project returns its original receipt.

`node tests/e2e/chrome-sidebar.mjs` uses a headed Chromium extension, the
actual Relay and Rust Host, and a deterministic paired conversation.
It verified the original conversation Artifact path through the fixture,
then saved a Unicode selection with a reason and question to a Project.
Host's digest matched the preview bytes. The original record survived a
Host restart. An identical retry returned the same receipt, while changed
content under that capture ID and access from a second Project were refused.
A separate running macOS Native development build opened a source seeded by
the same Host command and displayed its URL, edited text, reason and question.

Extension 0.3.6 freezes a reviewed Project save in extension session storage
until Collector receives its receipt. The test disconnected the Relay after
the real Host saved the source, navigated the source tab, reopened Collector
and restarted the Host. A different conversation could not recover the save.
After pairing the original conversation, **Recover save** returned the same
receipt, and the Project still contained one matching source. Closing the
Chrome browser session clears the pending draft.

The optional `TestSharedWebSourcesNativeChromeToMaterials` test uses two
independent macOS Native profiles with separate client identities, headed
Chromium, and the real Cloud API backed by PostgreSQL. It saves a Unicode
selection through Collector and reads the same capture and digest through the
second profile's Materials view. The companion API test verifies that another
Project cannot read the capture and that an edited retry is rejected. The test
uses a loopback source page and a development build.

On 2026-11-24, extension 0.3.20 added **添加到 Pero** to the HTTP(S) page and
selection context menu. A real Chrome right-click opened Collector in its own
window with the clicked selection scope; the disconnected state displayed the
pairing error without a save. The Chrome + Host Collector test passed
context-route capture, local Project receipt and recovery. With an isolated
PostgreSQL test database, `TestSharedWebSourcesNativeChromeToMaterials` passed
the context-route selection save and an independent Native Materials read.
`test-results/native-shared-project-sources/collector.png` shows the saved
shared Project receipt. The actual context-menu click and shared Project save
were verified in separate isolated runs; the installed extension and the
user's Project were not modified. Later Native repeat runs timed out before
the pairing file was created and did not reach capture; the latest Native
repeat is not green.

Build Native with `--features native-probe`, the connector helpers and the
Chrome extension, then run the tests from the repo root with
`PERO_TEST_DATABASE_URL` set to a test database.

```sh
PERO_TEST_SHARED_SOURCES_NATIVE="$PWD/tests/e2e/native-shared-project-sources.mjs" \
  go -C server test -race ./internal/httpapi -run '^TestSharedWebSources' -v
```

Set `PERO_TEST_SHARED_SOURCES_APP` to an ad-hoc-signed Native app bundle with
the probe binary to run the same test against the bundled Host, Node and
Chrome extension. This lane uses the macOS Keychain and starts the reader
again without supplying a token. It asserts the same client identity, source
bytes and receipt after relaunch, then removes the two fixture credentials.
This passed in an isolated copy of the Native bundle. Evidence is under
`test-results/installed-shared-project-sources/`. The Cloud API was a loopback
fixture. A hosted deployment still needs acceptance.
# Signed Native Chrome REPL verification

The signed Native candidate ran the real Codex agent over the bundled Python
REPL and the actual unpacked extension in Chrome for Testing. One pairing
exposed both ordinary fixture tabs in the isolated profile. The fixture origin
had one saved site approval. The agent clicked the first tab, read its
canvas-only code from a screenshot, then activated the second tab and located
its control. The local server recorded exactly one trusted click. Host evidence
recorded both tab IDs and matched the image delivered in the ACP transcript.
