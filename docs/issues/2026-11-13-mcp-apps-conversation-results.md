---
kind: issue
status: open
date: 2026-11-13
github_issue: 218
github_state: open
github_url: https://github.com/phodal/pero/issues/218
---

## Merge review: inline error correlation — 2026-11-13

The Electron shell assigns transport UUIDs to MCP panel requests, but its error
forwarding did not restore the caller's `mcp-inline-*` identity. Rust matches
local tool-row failures against that original ID, so a denied session or panel
startup failure could leave the row loading without its retry action. Preserve
the existing unique transport identity and map every result/error back to the
caller at this boundary. Verify through the actual Electron session ingress;
this must not execute another tool or model turn.

Verified after the fix through the real Electron Workbench/Host/ACP acceptance:
a missing conversation returns `mcp_error` with the original
`mcp-inline-unavailable` ID. The official demo's successful conversation flow
still passes with three fixture model requests and two actual tool calls;
the rejected adoption adds neither. Core TypeScript and Desktop build pass.

# feat(mcp-apps): 将真实工具结果接入会话流，并安全恢复历史视图

## 目标与范围

让 Agent 已完成的 MCP 工具调用直接在原会话工具行中呈现标准交互视图。视图使用该次调用的真实输入、结果和身份；展开、关闭、再次展开及恢复历史均不重新执行初始工具。用户通过视图发起的后续调用继续经过原 Host / Harness 的权限、审批和执行链路。

这是现有 MCP Apps Runtime 工作的下一阶段。MCP Apps 是工具结果的交互表示，不是 Pero 应用商店中的独立 App，也不创建第二个 Agent 会话。首版以会话内 inline 为产品入口；复杂内容可沿既有 Inspector 容器扩展，但不另建 MCP Apps 导航、连接管理器或 Plugin Registry。

本 issue 只交付“原始调用 → 会话视图 → 安全历史回看”。完整开发者平台、Run/Artifact 绑定、跨宿主认证等单独推进，避免用一个大而模糊的 SDK issue 覆盖所有后续工作。

## 分析依据与当前事实

核查日期：2026-11-13。检查了当前工作区及正在实施的 MCP Apps worktree、ADR 0027/0036、Runtime、MCP registry、ACP 投影和会话面板。以下是本地源码与既有验证记录的核对，不代表这些改动已合并，也不代表本 issue 的会话流已经实现。

| 能力 | 当前事实 | 本 issue 的处理 |
| --- | --- | --- |
| 标准协议与 Runtime | `packages/mcp-apps` 已直接封装官方 AppBridge；Host 回调提供工具、资源、外链与撤销 | 继续复用，不重写消息协议 |
| 沙箱与授权 | 已有独立来源、CSP、同服务器资源绑定、generation 与会话权限链 | 接入会话时保持同一个 owner |
| Agent Plugin | ADR 0027 已定义独立插件、MCP Servers、Skills 和会话冻结装配 | UI 跟随标准 Tool/Resource 发现，不增加平行 manifest |
| 产品入口 | 通过会话“工具与资源”显式打开；该入口会执行一次初始工具 | 保留显式入口；自动呈现必须消费已完成结果 |
| 官方示例与 Notebook | 当前实施任务已报告未经改写的官方 demo 在 Rust Host → Go ACP → MCP 链路通过，初始/交互调用均经 ask 且无模型请求；Notebook 改进仍在整理，本次未独立复跑 | 作为前置基础，不能替代完整会话入口验收 |
| 自动会话呈现 | 普通 Agent 调用尚未形成可渲染结果回执并接入 timeline slot | 本 issue 的主交付 |
| 历史与实时权限 | 当前视图 binding 是运行期能力，未完成跨重启会话视图恢复 | 保存展示快照；历史不恢复旧权限 |

已搜索本地记录及 GitHub 当前 open issues，未发现同范围的活动 issue。历史 #50 已关闭；本 issue 不重开 MCP 管理/连接基础工作。现有 `docs/exec-plans/2026-11-13-mcp-apps-runtime.md` 是 Runtime 实施进度，本文件是这一后续问题的唯一活动本地 tracker。

### 真正需要补齐的链路

1. `harness/go/mcp/access.go` 已保留工具目录的 UI 声明；连接发现不是从零开始。
2. `harness/go/mcp/tools.go` 目前只在 App audience 调用分支保存完整 MCP Result；普通模型调用的 canonical output 主要保留 `content` 与 `structuredContent`。
3. `harness/go/acp/server_history.go` 把结果投影为工具状态和展示内容，尚未携带完整的 UI 来源绑定与可供 View 消费的结果。不能从聊天文本、展示标题或规范化工具名反推这些身份。
4. `desktop/src/main/mcp-session-sources.ts` 的 `execute` 会调用初始工具，并为手动入口生成新的 `tool_call`。将它直接接到已完成工具行会二次执行业务操作。
5. `mountMcpApp` 已能接收输入和结果并挂载；需要新增的是执行到会话的数据接线与 slot 生命周期，而非另一个 Renderer。

## 技术选择与协议边界

**沿用官方 `ext-apps` + 现有 Host Adapter。** 当前仓库锁定 `ext-apps 1.7.5`、MCP SDK `1.32.2`。MCP-UI 的 `AppRenderer` 对 React Host 有价值，也支持仅通过回调接现有后端；Pero 当前 GPUI/Web Host 已有 AppBridge seam，本阶段引入它会重复接管资源和生命周期，没有明确收益。将其保留为未来替换实现的候选。

UI 资源关联以 **Tool 定义**的 `_meta.ui.resourceUri` 为准，Host 从该 Tool 所属 Server 读取资源，再向 View 投递本次输入和结果。仅在任意工具结果中放一个 URI 不构成标准接入。普通 `content` 始终保留，UI 初始化失败或宿主无 UI 能力时仍可完成基本任务。

`visibility` 是 model/app 的暴露范围，不是执行授权。保留 app-only 不进入模型目录、model-only 不可由 App 调用，以及同 Server 的调用边界；每次实际调用仍走已有 allow/ask/deny 与审批。

依赖继续按已验证组合锁定。MCP-UI 所查源码的 `ext-apps ^1.2.0` / MCP SDK `^1.27.1` 范围可覆盖 Pero 当前版本，不能据此宣称必然冲突。官方 2.x 包迁移另行验证：线协议兼容不等于不同代 Client/Schema/Bridge 实例可混用，本阶段不顺带升级全部依赖。

## 领域概念与状态归属

先命名概念再落代码；复用已有类型，确有缺口再补充，以下名称是设计语义而非要求新建三个 package。

| 概念 | 保存什么 / 谁创建 | 不承担什么 |
| --- | --- | --- |
| MCP 工具结果回执 | 执行 owner 在真实调用完成时产生：原始 tool-call ID、准确 Server/Tool 身份、当次连接代次、Tool UI 声明、实际输入和 MCP Result | 不由 iframe/展示文本构造，不启动工具 |
| 历史结果快照 | 既有会话历史 owner 保存可展示结果与来源；保留 View 所需数据与模型可见投影的区别 | 不保存可复用授权令牌，不以快照恢复执行能力 |
| 实时视图绑定 | 现有 Host 根据当前有效会话与 Server 为视图准入，后续工具调用沿原链路执行 | 不等同于历史结果，不新增授权状态机 |

MCP JSON 在协议入口校验一次并转换为类型化值；领域内部不以散落的 map/raw JSON 传递业务规则。状态转换遵循 `(state, input) -> (next state, effects)`，I/O 与时间留在 shell。需要 Host 事件扩展时使用既有协议生成路径；这是 Pero 的接线，不修改 MCP Apps 标准，也不要求任意外部 ACP Agent 自动具备这些数据。外部 Agent 不提供来源/结果能力时退回文本。

UI-only `_meta` 不进入模型上下文。结果保存沿用既有会话的数据范围、大小限制和日志规则；超过当前可保存范围时保留有来源的文本/不可交互回退，不通过重新调用初始工具“补齐”快照。

## 实施顺序

### A. 在真实执行边界保留结果身份

- [ ] 从真实 MCP 执行路径生成类型化结果回执，保留 Tool 定义 UI 声明、原始输入和 View 所需结果。
- [ ] 沿现有 Harness → ACP → Rust Host → 会话工具行传递、关联原始 tool-call ID；与普通结果投影分离。
- [ ] 在既有会话历史中保存可展示快照；UI-only 数据不能流入模型请求或普通日志。

### B. 在原工具行挂载已有 Runtime

- [ ] 复用会话工具行及受管 Web slot，以原始输入/结果调用 `mountMcpApp`；不调用手动面板的 `execute`。
- [ ] 默认在会话结果位置直接提供可用视图；来源/诊断按需展开。长内容使用容器内滚动与实际尺寸通知，不增加固定整页高度或第二层应用壳。
- [ ] 展开、关闭、切换、再次展开保持同一结果身份。关闭/隐藏时按现有生命周期撤销视图 binding；这不取消后台业务任务，也不删除结果。
- [ ] 局部初始化/资源失败保留普通结果和恢复动作；重试只重取资源/重挂载视图，不重放初始工具。

### C. 恢复历史并维持授权边界

- [ ] 重开聊天或重启后，先恢复已保存的结果和来源；不调用工具、不发模型请求。恢复历史只读快照不必执行资源 HTML；执行 HTML 本身不构成权限恢复。
- [ ] 缺少当前有效绑定时，历史仍可读，并明确“历史结果，当前不可交互”。首版允许这种回退，不承诺跨进程自动恢复实时交互。
- [ ] 有效会话内的后续 UI 工具调用继续走既有 policy/approval；Server 代次变化、会话关闭或权限撤销后旧绑定立即不可用。
- [ ] 仅声明实际支持的 Host capability。当前以 inline 为基线；未接通的消息提交、模型上下文更新、panel/fullscreen 等不得假报支持。

### D. 真实产品验收

- [ ] 冻结并运行未经改写的官方 Vanilla JS demo（当前实施任务使用 `@modelcontextprotocol/server-basic-vanillajs@2.0.4`），记录版本与完整链路证据。
- [ ] Notebook 固定修订 Inspector 通过同一个会话结果入口；领域修订、内容与科学状态继续由 Notebook 拥有。
- [ ] 在完整 Electron Workbench 中从真实工具结果打开、交互、关闭和重开；另记录实际 Native GPUI 运行面的结果。独立 iframe、浏览器和 Native 结论分别报告。

以上按 concern 拆成小提交/PR，不以一次大规模全层重写交付。

## 验收表

| 场景 | 必须观察到的结果 |
| --- | --- |
| 带效果计数的初始工具 | Agent 调用后，展示/展开/重开/恢复历史，初始工具的效果计数始终为 **1** |
| 输入/结果与原调用对应 | UI 消费原始 tool-call 的输入和 Result，`structuredContent` 不从展示文本重建 |
| 两个 Server 声明同一 `ui://` | 资源、输入、结果和后续调用均不串 Server；沿用既有隔离规则 |
| app-only / model-only | 目录暴露与调用准入分别正确；model-only 初始工具的真实结果仍可呈现其 UI，但 UI 不能反向调用 model-only 工具；visibility 不替代 policy |
| UI 后续 allow / ask / deny | allow 正常执行；ask 使用既有 Chat 审批；deny 不到达 Server。关闭视图取消其尚未派发的待审批请求，迟到批准不能触发调用；已派发调用沿既有取消/效果未知规则处理 |
| Server 重连或会话失效 | 旧 binding 被拒绝；保留可展示的历史结果，不借旧快照授予新权限 |
| 无 UI / 初始化失败 / 资源不可用 | 文本结果仍可读，错误贴近当前工具行；恢复动作不重跑初始工具 |
| 进程重启后回看 | 恢复历史不产生工具效果或模型请求；无当前权限时明确不可交互 |
| 一次 UI 交互 | 可关联原始结果、后续工具调用及审批/执行记录，不建立第二套 Trace 系统 |
| 数据投影 | UI-only `_meta` 不出现在模型输入；凭据、临时 binding token 不进入历史/截图/普通日志 |
| 实际界面 | 按 DESIGN-REVIEW 检查明暗主题、窄窗、中文长标题、键盘/焦点、滚动与局部错误，附实际截图/回执 |

测试复用各概念现有表驱动测试；shell 只补真实链路证明。计数/事件/进程 readiness 作为等待条件，不用固定 sleep 等待自身状态。测试默认 loopback、动态端口、临时数据目录，不以真实模型、生产凭据或外部服务作为运行前提。

## 后续路线：本 issue 不以这些能力作为关闭条件

1. **人机共同操作**：`ui/message`、`ui/update-model-context` 接到现有 Composer/会话 owner；明确用户审阅、忙碌与取消语义。不能让 iframe 自建 Agent 或把“已填草稿”回报为“已发送”。
2. **领域对象绑定**：Task/Run/Artifact 的稳定引用与结果复核由实际 owner 接线；后台状态刷新按已有事件能力接入，不增加通用调度器。
3. **Plugin 作者工具**：独立 Plugin 示例、资源构建/预览模板和类型化接口；标准 `App` / React hooks 优先直接复用官方 SDK。React/Vue 不是 Host Runtime 的依赖要求。
4. **显示与互操作**：panel/fullscreen、文件选择等逐项协商并提供回退；同一个自有 Plugin 在至少一个独立外部 Host 验证，再扩大兼容矩阵。官方 demo 在 Pero 通过只证明这一方向的互操作。
5. **其他消费者与分发**：Data Viewer、可写 CI Inspector、跨 Plugin 工作流与 npm/市场发布各自限定范围，不从 Notebook 只读示例推断已经完成。

## 参考与证据边界

- [MCP Apps 官方 SDK / Host、View、Server 分工](https://apps.extensions.modelcontextprotocol.io/api/)。
- [标准 Tool UI 声明、visibility 与资源发现，固定官方源码](https://github.com/modelcontextprotocol/ext-apps/blob/ea3e9d0e624a20bc1c51310292f09d9b8ed17161/specification/2026-01-26/apps.mdx)。
- [MCP-UI AppRenderer：可选 Client 与 Host 回调](https://mcpui.dev/guide/client/app-renderer)。
- [MCP-UI 依赖快照](https://github.com/MCP-UI-Org/mcp-ui/blob/2b10490910943640deeb2d9012ad417d4c0e9025/sdks/typescript/client/package.json)。
- [Zed #58470](https://github.com/zed-industries/zed/discussions/58470) 是 ACP 会话内 MCP Apps 的功能提案，不是已交付实现；可参考它的 Host 归属与结果关联思路。
- [Zed 已实现的工具视图生命周期，固定源码](https://github.com/zed-industries/zed/blob/48741fd17d0dec28be6ad664b0a06dc7202086be/crates/agent_ui/src/entry_view_state.rs)：可借鉴 live/history/materialize 分离，避免展开触发重执行。
- 仓库依据：`docs/adr/0027-app-agent-plugins.md`、`docs/adr/0036-mcp-apps-host-runtime.md`、`docs/exec-plans/2026-11-13-mcp-apps-runtime.md`、`docs/fitness/mcp-apps.md`，以及正在实施的 `docs/design-docs/mcp-apps-conversation.md`。

本次交付是分析与后续 issue，未执行新的 Runtime/产品验收；当前 Runtime 的已有本地验证与本 issue 的待执行验收分别记录。


## 2026-11-13 implementation and CI receipt follow-up

PR #217 now includes the public SDK Surface, standard theme adapter, container size
policy and shared panel/recorded-result consumers. Actual Electron conversation
acceptance with the unmodified official demo passed after SDK integration.
Historical live-binding recovery remains separate; this issue is kept open.

CI at SDK head `c1bea070` rejected two full-file source receipts for
`harness/go/mcp/tools.go`: `mcp-tool-capability` and `mcp-structured-output-gap`.
Conversation commit `fef46c64f` added resource identity and original-result capture
to other declarations in that file. The selected `ListTools` and `fromMCPResult`
functions are byte-identical to base `7f10d0919`; the remaining 15 right-side
receipts match. This is caused by the PR, not a claimed baseline failure.

Refresh only the two reviewed file hashes and source note. Preserve the official
DSH pin, all 17 pairs, landmarks and fail-closed hash/availability checks; rerun
the exact reference comparison before treating the failure as fixed.

Local rerun with the pinned official source and generated TypeScript grammar
passed after the receipt refresh: 17 `cross_language_review_required`, zero
unavailable selectors, exit 0. This restores extraction for review; it does not
claim algorithmic equivalence or weaken hash checks. The runner used Python 3.14
locally; remote CI's Python 3.12 result remains a separate observation.
