# Cursor 剩余内容视图的实现

2026-11-07。对象与 [PR View](cursor-pr-view-implementation.md)、
[22 类注册表](cursor-content-view-capabilities.md) 相同：Cursor 3.29.9，
`workbench.glass.main.js` SHA-256
`59988e055f545a76aa11b38f27562b7ecdaa885d59a2e8805114d28aa76fb6a1`。
只读静态分析，没有登录、改包或调用 Cursor 远端。特性开关的默认值不代表当前账号已开放。

偏移是 Python 解码后的零基字符偏移。同一行号往往覆盖一整段打包模块。

## PR 链接呈现

`i$k`（`pull-request-link-content.tsx`，15083959）先用 `jk` 解析身份。
原文是编号、`#编号` 或与 canonical URL 相同的地址时，显示压缩为 `#编号`；
其它说明文字保留。图标先按 provider：GitHub 用 `logo-github`，Origin 用 `cursor-logo`。

消息渲染 `QFn`（14161 / 22776949）把这个结果交给 `GHl`。`GHl`（3116 / 18684694）
用 lifecycle store 的 `getLifecycle(canonicalUrl)`，再经 `e8n` 选状态图标；
没有已知状态时回退 provider 图标。`C9i` 在 `poll` 为真时订阅该 URL 的 lifecycle。

悬浮卡 `X2g` 展示标题、`#编号`、状态徽章（Open / Draft / Merged / Closed）、
作者头像和 “Opened … ago”。标题来自 metadata，否则用 lifecycle 里已缓存的 title。
链接本身被包进 hover card，点击仍走打开决策，不在卡片里合并或审批。

## 打开偏好和临时标签

偏好项是两项：`inApp` = “Inside Cursor”，`externalBrowser` = “Default Browser”
（18100 / 25878454）。枚举 `PrReviewOpenSurfaceMode` 有 `IN_APP` 与 `EXTERNAL_BROWSER`。

`bJv`（18053 / 25397361）比较保存的 surface 和修饰键：

```text
externalBrowser !== (middle button || Cmd on macOS || Ctrl elsewhere)
```

两边不同才进外部浏览器，相同则留在应用内。中键由 `onAuxClick` 拦截。
超时或没有偏好时使用空 snapshot，不把未知偏好当成外部打开。
明确的外部打开仍走 `openerService.open(..., {openExternal:true})`。

临时标签由 `glass_temporary_pr_tabs` 控制。`l2c` 已有目标则只揭示；
否则替换当前临时标签，没有临时标签才追加。`RJv` 在开启时写入 `preview: true`
并挂上 `onDoubleClick`。用户拖动或跨组转移时 `_9C` 调用 `pin`。
固定不是双击的唯一路径。

## 阅读位置和“已查看”

PR schema（18108 / 27003710）持久化的是身份和子视图，不是滚动条：

`prUrl`、`repoUrl`、`repoPath`、`branchName`、`ownerAgentId`、`prTitle`、
`prStatusIcon`、`preview`、`subview`（`diffs | description | ci | commits | reviews`）、
`mergeConflictTarget`。

`QvE`（22378 / 33578680）把当前子视图写回 tab props，缺省 `diffs`。
隐藏的子视图会退回 diffs。`Pr` 注册了 `keepMountedAfterFirstActivation`，
同一次进程里切走再回来保留已挂载的 diff 模型。schema 里没有选中文件或滚动偏移；
这次没有看到重启后恢复像素级阅读位置的字段。文件列表点击会让 diff model `scroll` 到该文件。

“已查看”是文件状态，不是本地勾选：

- 过滤项 `showViewedFiles`，文案 “Files marked as viewed”。
- 行上 `viewedStatus === "viewed"` 会被该过滤隐藏。
- 菜单是 “Mark file as viewed” / “Mark file as not viewed”，走 `onToggleViewed`。
- 本地键 `cursor/glass.prFileViewState`。
- Origin RPC：`FileViewedState { file_path, version_id, stale }`，以及
  `ListFileViewedStates`、`MarkFileAsViewed`、`UnmarkFileAsViewed`、
  目录和全部文件的 mark/unmark。

`glass_pr_viewed` 在默认表里是 `default: true`，但这次没有搜到
`checkFeatureGate("glass_pr_viewed")` 调用点。不能据此声称每个账号都会显示该标记。

## 自动更新

两套机制，都不是工作台自己扫消息：

1. `StreamPullRequestUpdates` 是 server stream。请求带 `pr_urls`，事件是
   `updated { pr_url, metadata_changed }` 或 heartbeat。
   `glass_pr_realtime_updates` 默认 **关闭**。开启且 PR tab 处于活动、面板可见时，
   内容里才按 URL 订阅，并刷新 checks。
2. `glass_pr_tab_self_heal_refresh` 在 tab 活动时比较
   `commitCount`、`headSha`、`reviewCount`、`reviewDecision`。
   快照变化才刷新 checks、commits 或 reviews；reviews 选择可被单独重置。
   间隔默认 5 分钟，夹在 1 分钟和 60 分钟之间（`F8_`，22378 / 33578073）。
   刷新指示有 1 秒去抖（`O8_ = 1000`）。

显式刷新仍把 `skipCache: true` 传给读取。失败保留上一份内容的行为在
[PR View](cursor-pr-view-implementation.md) 的 repository service 里。

## 项目 PR 列表

`ProjectPrs` 的 schema 是空对象 `{}`。稳定的是 tab kind，不是某一条 PR。
注册为 scroll 归 renderer，并且 `keepMountedAfterFirstActivation`。
项目页 section 枚举含 `prs`（与 tasks、overview、topics、agents 并列）。

索引分组是 `queued | ready | draft | closed | merged`（22396 / 33922476）。
一行有 `#编号`、标题、状态色、`+additions -deletions`、相对时间、stack 位置和 blocker 悬浮。
打开一行进入已有 PR tab，不是第二套详情页。

`glass_projects_pr_index` 默认 **关闭**。关闭时部分路径改走 agent PR 记录，
并且 ProjectPrs tab 会被跳过持久化。因此“项目级索引”和“当前 agent 的 PR 记录”
在包里是两条数据路径。

## 来源跳转

`i$s`（`openFileInStableTabRouting.js`，18053 / 25388487）按顺序决定，不按扩展名分发：

1. 缺失文件且 scheme 是默认 scheme 时，改成 untitled，保留 selection。
2. 终端 URI 交给 `lJv`：`{kind:"terminal", terminalId, transcriptUri?}`。
   只有旁边的 URI 确实是文件时才带 transcript。这里不启动 shell，也不写入命令。
3. `cursorWorker` / background agent 路径先做工作区映射和同步。
   `ready` 用解析后的 URI；`unmapped` 且像 store 路径时返回
   `{kind:"unavailable-store-file"}`，不改写成任意本机路径。
4. 目录进目录视图。
5. `s9C` 识别计划文件则 `{kind:"plan", planRedirect}`。
6. `PLs` 把 canvas source/bundle 解析成 `{kind:"canvas"}`。
7. 其余才是 file，带 selection、editorType、targetIndex。

计划文件判定 `DJ`：scheme 为 `cursorPlan`，或路径以 `.plan.md` 结尾且位于
`~/.cursor/plans/`（`Iye` = `home/.cursor/plans`）。`s9C` 查 plan registry；
没有登记且不允许 `registerExistingPlan` 时返回 `unregistered`，路由结果是 noop。
登记成功才得到 `planId` 和标题。

远端文件链接 `Tjk`（2391 / 15117533）只改写
`vscode-remote://background-composer+<id>/<path>#Lstart[-Lend]`。
结果是 `<id>#file=<path>&L=start[-end]`，并且要能解析成 cloud file。
其它 URL 原样留下。

Markdown 还承认自定义标签，而不是把它们当成本机文件：

- `shell`：`shell_tool_call_id`
- `diff`：`edit_tool_call_id`
- `textreference`：`path`、`start`、`end`
- `preview`：url/title/description/image

输出页 schema 是 `outputChannelId?` 与 `outputOpenRequestId?`。
`ZUT` 用这两个字段打开通道；`sHT` 在任一字段变化时视为不同打开请求。
内容从 OutputChannels 描述符里选择，不重新执行产生该输出的工具。

Diff schema 的范围是 `lastTurn | uncommitted | allChanges | unstaged | staged | branch`，
另有 commit range 和 `presentationRequest { requestId, filterScope, filePath, revealMode: "current-filter" }`。
指定文件是在当前筛选下揭示，不另建一种 diff 页。

## 计划、Canvas、浏览器

计划 tab props：`planId?`、`planTitle?`、`ownerAgentId?`、`planAgentId?`。
`plan-tab-content-model.js` 通过 `agentReference.createPlanContentModelReference(planId)`
取模型；没有模型时回退读盘。快照含 markdown、解析后的 `{name, overview, todos}`、
dirty、readonly、loading、error。脏标记跟文本文件的 dirty 事件走，干净时磁盘变化会重载。
构建入口在 `plan-build-controls.react.js`，编辑器是计划自己的 editor，不是任意 Markdown 预览。

Canvas props：`canvasPath`、`sourceResource`、`sourceAgentId`、`local`、
`ownerAgentId`、`canvasShareUrl`、`cloudCanvasAddress`、`cloudCanvasTitle`、
`previewEpoch`、`viewMode: rendered | source`。`PLs`（14149 / 22261670）
对 source 文件返回 `{kind:"source"}`，对 bundle 引用返回 canvas 目录下的 bundle。
分享、删除分享和复制链接是独立回调，不由通用 iframe 获得。

Browser props：`browserId`、`initialUrl?`、`ownerAgentId?`、`agentControlled?`、
`persistencePolicy: "afterActivation"?`、`preview?`、`transient?`。
打开命令可带 `designMode`、`transient`、`inactive`、`preserveFocus`。
浏览器属于另一个 agent 时，这次打开改为不抢焦点。`designMode` 是浏览器打开参数，
不是文件预览的一种后缀。

## 远端桌面、机器和语音

这些注册存在，但都要求已有会话身份，不能从链接猜出来：

| 类型 | 身份 | 这次能确认的内容 |
| --- | --- | --- |
| `Vnc` | 可选 `bcId` | 首次激活后保留；连接、剪贴板和首帧在独立 hook 里 |
| `AgentVnc` | `bcId`，可选 label / `ownerAgentId` | 复用 VNC renderer |
| `Machine` | 必填 `bcId`，可选 label / owner | 默认标题 “Machine Metrics”，图标 `chart-line`；内容里有内存图 |
| `VoiceCallTranscript` | 必填 `agentId`、`callId`、`ownerAgentId` | 渲染通话记录，可复制 call id，链接走普通打开 |

没有这些 id 的工作区不会得到对应页。包内有实现，不等于本机账号能打开远端桌面或历史通话。

## 对 Pero 的边界

可对齐的是身份和跳转，不是把 Cursor 的 RPC 搬过来：

- 消息里的 PR 链接用已有 `PullRequestRef` 显示 `#编号`；状态图标和悬浮标题只在已有 snapshot 或列表摘要上出现。
- 子视图、选中文件和“已查看”集合随 PR 身份持久化。Pero 没有 GitHub viewed API，标记应是本地阅读状态，并在 head 变化后标成过期，而不是声称与 GitHub 同步。
- 打开中的 PR 用有界轮询刷新快照字段；没有 Cursor 那条 server stream 就不实现订阅。
- 应用内 / 外部浏览器是偏好加修饰键反转，显式 “在 GitHub 打开” 不变。
- 临时预览、双击和拖动都调用已有 `promote`，离开预览。右键 pin 仍是标签前缀，不是第二条预览系统。
- 项目列表是仓库上的只读 `gh pr list`，按 GitHub 状态分组，点一行打开现有 PR 页。
- 文件、终端、输出、变更范围、远端文件和计划文件走一个 `SourceTarget`，分别交给现有 Host 文件、终端、工具输出、变更视图和计划文档。远端路径解析失败时停在不可用，不映射到本机路径。
- 计划只承认 `docs/exec-plans/**/*.md`。正文里的勾选待办显示在计划条上，执行仍把正文交给对话。Canvas 编辑分享、持续远端桌面、机器指标和通话记录没有对应生产源，不建空页。

## Pero 落地对照

2026-11-07，对照的是上述静态结论和当前 `codex/pull-request-view` 工作树。
没有再次解开 Cursor 包，也没有打开 Native 窗口逐项点击。

| Cursor 行为 | Pero 现在 | 仍不同 |
| --- | --- | --- |
| 消息里压缩为 `#编号`，GitHub 图标和状态，悬浮标题、编号、状态、作者、打开时间 | 已有摘要时显示 GitHub 图标、状态色点、`#编号`。悬浮依次是标题、编号、状态、作者，以及由打开时间算出的相对时间或日期 | 没有作者头像。界面没有图片元素，不另拉 `github.com/{login}.png`。没有摘要时只有 `#编号` |
| schema 保存身份和子视图；已查看走服务端 version，可标 stale | 保存子视图、选中文件和本地 `{path, head}`。head 变化后标过期，可取消 | 不恢复像素滚动。不调用 GitHub viewed API |
| server stream 默认关；活动 tab 按变化字段自愈，默认 5 分钟，夹在 1–60 分钟 | 活动 PR 路由每 60 秒再读一次 `gh`。head 与提交数未变时保留文件和提交；检查指纹未变时保留检查；评审条数和结论未变时保留评审；正文未变时不重写描述。显式刷新和再次发现整份替换。离开路由即停止 | 没有 server stream。间隔是 60 秒，不是默认 5 分钟。轮询仍取整份快照，差量只发生在吸收进已打开的页时 |
| 应用内 / 外部浏览器，中键或 Cmd/Ctrl 反转；显式外部打开不变 | `LayoutPreferences.link_surface`，缺省应用内。中键或平台修饰键反转。GitHub 按钮仍 `open_url` | 与 Cursor 的打开决策相同 |
| 临时标签；双击或拖动后离开临时状态 | 链接打开的 PR 和引用文件使用 `OpenIntent::Preview`。已有标签只激活。双击和拖动都 `promote`，预览变为普通标签。右键 pin 仍只改前缀 | 没有独立的 temporary-tab 开关。`promote` 不是右键 pin |
| 项目 PR 索引，分组和一行上的计数、时间、stack | 仓库级只读 `gh pr list`，打开 / 关闭 / 全部，最多 30 条。同一仓库里出现多种状态时按 Open、Draft、Closed、Merged 分组。一行含状态、编号、标题、增删和相对打开时间。点一行以预览打开现有 PR | 没有 queued、ready、stack、blocker。这些字段不在 `gh pr list` 里，不用 reviewDecision 冒充 |
| 一个路由处理终端、远端文件、计划、输出和指定 diff | `SourceTarget` 分给现有终端、文件、工具输出、变更记录和计划文档。远端未映射保持不可用 | 不创建 untitled、目录页或 Canvas。变更范围是 turn/worktree，不是 staged/branch 全套。终端引用只聚焦已有标签 |
| 计划 registry、编辑器、Build、待办 | `docs/exec-plans/**/*.md` 打开为可编辑文档。计划条显示一级标题，以及正文里 `- [ ]` / `- [x]` 的完成数。执行把正文交给对话且不提交、不推送 | 没有 planId registry，也没有独立 Build 控件。其它 Markdown 仍是普通文件 |
| Canvas source/render、分享；浏览器 design mode、临时页、agent 所有权 | 普通 HTTP(S) 继续用隔离 Web 页，并服从链接偏好 | 仓库没有 Canvas 分享或画布编辑的生产源，不建空页。没有 design mode 或浏览器 agent 所有权 |
| VNC、机器指标、语音记录要求已有会话 id | 没有这些内容页 | `WorkspaceItem` 没有对应种类。隔离桌面属于 Computer Use 的执行边界，不是按会话 id 打开的内容视图。不建空页 |
