# Cursor Agents 内容视图能力及 Pero 对照

2026-11-07，安装包静态分析。对象与 [PR View 分析](cursor-pr-view-implementation.md)
相同：Cursor 3.29.9，commit `306d153d51d714882ab7b1bc49649cab624e8a30`。
依据 `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.js`
内保留的模块名、schema、路由与 renderer registry。没有执行 Cursor 远端服务，
注册表中的实现存在不代表当前账号、平台或 feature gate 已开放。

## 共同机制

它们是类型化的内容页，而非一个通用“附件 HTML”容器。注册表 `nhn` 的每项包含
`schema`、`renderer`、`icon`、`defaultLabel`，部分带 `iconRenderer`、`scrollOwner`、
`alwaysMounted` 或 `keepMountedAfterFirstActivation`。`Ut` 枚举包含下面 **22 类**。

入口也不只有链接：Markdown/引用 chip、命令、文件发现、Agent 状态、分支状态和
恢复的 descriptor 都能进入。一个目标先确定身份和所属工作区/Agent，再决定复用、
预览、固定、激活与持久化。URL 识别、后台发现和抢占焦点是三个不同决定。

## 全部内容类型

| 注册类型 | 代码可确认的能力与身份 | Pero 可复用的现有承载与差距 |
| --- | --- | --- |
| `pr` | PR URL/分支身份，Changes、Description、Commits、Checks、Reviews；状态图标；首次激活后保留 | 只读页、后台发现、显式刷新和恢复之外，消息用已有摘要显示状态色和 `#编号`。子视图、选中文件和本地已读随身份保存，head 变化后过期。活动路由每 60 秒刷新。不含合并、审批、行内评审写入、像素滚动、GitHub viewed API 和 server stream |
| `projectPrs` | 项目级 PR 列表，独立稳定 App tab；renderer 管滚动 | 项目 Sources 用只读 `gh pr list` 按仓库列出打开、关闭或全部，最多 30 条，点一行打开现有 PR 页。没有 queued/ready/merged 分组、相对时间、stack 和 blocker |
| `file` | `filePath`、行列 selection、`code/diff`、preview、ownerAgentId | 工作区相对路径可带 `:line` 或 `:start-end`，以预览打开现有文件并选中对应行。绝对路径和 `..` 拒绝 |
| `agentFiles` | `bcId`、owner、带 requestId 的远端文件和 selection | `vscode-remote://background-composer+<id>/<path>` 解析为远程文件。没有映射时停在不可用，不拼到本机路径 |
| `plan` | planId/标题/所属 Agent；计划 registry、编辑及 Build；`.cursor/plans` 文件有专门重定向 | 只承认 `docs/exec-plans/` 下的 Markdown，含子目录。打开即编辑；执行把正文交给对话，并要求不提交、不推送。没有 plan registry、todos 模型和 Build 控件 |
| `canvas` | 本地 canvasPath 或云端地址、sourceResource、rendered/source、previewEpoch | Scientific Viewer、版本化产物与隔离 HTML 已能承载部分结果；云端分享/画布编辑不能只靠通用 iframe 获得 |
| `browser` | browserId、initialUrl、owner、agentControlled、preview/transient、激活后持久化策略；有设计模式相关代码 | 普通 HTTP(S) 仍走隔离 Web 页。链接偏好可改为外部浏览器，中键或平台修饰键反转。没有 design mode、临时页和浏览器 agent 所有权 |
| `terminal` | 持久化终端 ID/运行实例 ID、工作区组、owner、Agent 控制标记；终端引用重定向 | `pero-terminal://<id>` 聚焦已有终端。不启动 shell，也不发送命令 |
| `output` | outputChannelId、outputOpenRequestId 定位输出通道 | `pero-output://<thread>/<tool>` 展开已有工具输出并聚焦该会话 |
| `diff` | lastTurn/uncommitted/allChanges/unstaged/staged/branch，commitRange 和指定文件 reveal | `pero-changes://<thread>/(turn\|worktree)[/path]` 和 diff 文件按钮揭示已有变更记录里的文件 |
| `agentChanges` | bcId/owner 关联的 Agent 变更 | 现有会话/Worker 变更来源；不与本地工作树或远端 PR 状态混为一谈 |
| `vnc` | 按 bcId 连接 Worker Desktop；首次激活后保留 | 现有 Computer Use/环境能力是不同执行边界；不能据注册表宣称已有远端桌面流 |
| `agentVnc` | 与 Agent 关联的远端桌面，复用 VNC renderer | 同上；应由已有环境/授权层拥有会话和控制权 |
| `sideChat` | 独立子聊天身份，关闭时有运行状态与 discard 判断，首次激活后保留 | 现有 App Chat/共享会话；关闭视图不应隐式停止或删除任务 |
| `agentChat` | Agent 聊天页，首次激活后保留 | 现有 Workspace Conversation 和会话恢复 |
| `context` | Project 稳定 tab、按 section 定位、renderer 管滚动 | 现有研究项目和来源 App 的 location；本次保留 App 解释其自身深链 |
| `agentContext` | Agent 上下文页 | 现有上下文引用、来源快照、Session 能力信息；可进一步统一可回溯的来源跳转 |
| `environmentSetup` | 独立环境配置页 | 现有 Environments App 和 Host 的环境准备状态，不需要另造一套配置 owner |
| `machine` | bcId 关联机器指标页 | 现有 Worker/环境状态可作为入口；需要真实指标源才能呈现指标 |
| `voiceCallTranscript` | agentId、callId、owner 关联语音通话记录 | 当前没有据此验证的语音记录内容源；后续按通话记录身份接入 |
| `gallery` | 内部组件演示页，组件/图标/状态等目录 | Pero 组件库与交互目录；这是内部设计工具，不是自动识别用户产物的功能 |
| `colorReference` | 语义色彩参考页，无业务 props | Pero token 源/生成器与组件目录；同样是内部参考页 |

## File 内还有内容投影

`file-tab-content.react.js` 不是一个纯代码编辑器。包中能确认 Markdown 预览、
`GlassPdfPreview`、图像、`glass-video-preview.react.js`、`glass-audio-preview.react.js`、
SVG 预览、TeX 预览以及 CSV/分隔符解析与表格相关代码。它们通常仍属于 `file`，
不是每种格式都增加一个 workspace tab kind。

SVG 用独立 eligibility/utils 路径，净化规则禁止 script/foreignObject；TeX eligibility
包含 `.tex/.latex/.ltx`，渲染代码识别公式/定理等结构。这些证据不能证明它调用了
完整 LaTeX 编译器。媒体失败有本地回退。Pero 应沿用 ContentDocument/格式投影和
Scientific Viewer 的既有分工，保留来源与版本，不按后缀伪装计算成功。

## 路由比后缀匹配更重要

`openFileInStableTabRouting.js` 的 `i$s` 路由可确认：

1. 解析带行列的文件引用与终端引用。
2. Agent store / Worker 文件先交来源环境的路径解析与同步服务。
3. 目录进入目录视图；未找到与暂不可同步有不同结果。
4. 计划文件通过 plan registry 识别并重定向。
5. `canvasLinkTarget.js` 的 `PLs` 把 source/bundle 引用解析成 Canvas 身份。
6. 其余才进入 File，并保留 selection、editorType 和 targetIndex。

`glass-open-code-editor-from-file-tab.js` 还区分 preview 与正式 tab；跳转到代码位置
不必制造新的永久标签。`glass-tab-scope.js` 按 ownerAgentId/workspaceGroupKey
确定来源范围，Browser 还区分用户页面、Agent 控制与临时页面。

这些都说明不宜建立“扩展名 -> 任意 React/HTML”的第二个插件框架。内容身份、
来源解析、打开意图、生命周期和渲染器各用已有 owner。

## 本次 Pero 泛化

`content_link::WorkspaceLink` 现在统一表达 `PullRequest/App/Web/External`。
Chat、ContentReader、PR 描述/评审和上下文引用均经同一 Workbench 分派入口。
本地文件相对链接仍由 `ContentLink` 带来源解析，并经 Host 读取；独立 reader
没有 Workbench 时，只能外部打开已知网页/PR/邮件，不能获得 App 导航权限。

- PR 优先于普通 Web，子页面地址归一后复用一个 PR tab。
- HTTP(S) 复用现有隔离 WebDocument 引擎，重复打开保留表单和页面状态。
- App location 由所属 App 解释；链接不授予工具权限。
- mailto 继续外部打开；未知 scheme 不交给操作系统执行。
- 窄窗 PR/Web 以内容为主，并提供返回会话入口；不改已保存的 dock 偏好。
- 明确的“Open in GitHub”按钮仍使用外部浏览器。

链接呈现、阅读记录、活动页刷新、项目列表、来源跳转和计划执行的落地边界，见
[剩余内容视图实现](cursor-remaining-content-views.md)。Canvas 分享、持续远端桌面、
机器指标和语音记录仍然没有生产来源，没有为它们添加空页。

验证与未覆盖范围见 [PR 内容页验收](../docs/fitness/pull-request-view.md)。
