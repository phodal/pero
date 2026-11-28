---
kind: analysis
status: active
date: 2026-11-28
github_issue: 277
github_state: open
github_url: https://github.com/phodal/pero/issues/277
github_updated_at: 2026-11-28T14:54:39Z
related: https://github.com/phodal/pero/issues/249
---

# #277 durable Coding Worker 分析与实现清单

Issue #277 的目标是让一个共享 Project 中的真实 Coding Agent 完成可审查的代码交付。它要求保留分析、实现、审批、验证、重启、设备失联和跨设备接管的证据。

本记录基于 2026 年 11 月 28 日拉取的 Pero `ff005eb6`，以及 issue 中固定提交点的参考项目。参考 checkout 放在 `/Users/phodal/workspaces/pero-issue-277-references`，没有加入 Pero 仓库。

参考项目固定版本如下。

| 项目 | 上游 | 提交 |
| --- | --- | --- |
| Phleet | https://github.com/anurmatov/phleet | `94edddb02` |
| pi-temporal | https://github.com/temporalio/pi-temporal | `09d7c8257` |
| Durable Research Fleet | https://github.com/temporal-community/durable-research-fleet | `53609c431` |
| Pydantic AI | https://github.com/pydantic/pydantic-ai | `0fb8436a0` |
| OpenAI Agents Python | https://github.com/openai/openai-agents-python | `6afdd47b4` |
| Agent SDK Go | https://github.com/agenticenv/agent-sdk-go | `8dbb97f53` |
| Temporal AI integrations | https://github.com/temporalio/ai-integrations | `165fe93` |
| Temporal Python SDK | https://github.com/temporalio/sdk-python | `ce8cd4814` |

## Issue #277 的最新约束

截至 2026 年 11 月 28 日 22:54:39（北京时间），Issue 仍为 Open，已有两条评论。第一条评论把范围收敛为共享 Project 中的持久化 Coding Delivery，要求沿用现有 Project 授权、Task/Run、lease、receipt 和 Temporal 机制。第二条评论是对 Issue 质量和范围的评估，不改变实现验收标准。

第一条评论给出的验收重点如下。

- 从共享 Project 启动真实 DSH Go → Codex ACP 交付。编排器重启后仍可观察原 Run，提交重试只产生一份阶段 Run，首个 prompt 只投递一次。
- 审批等待期间重启编排器后，仍可打开同一候选。人工决定绑定 `gate_id + base_sha + patch_sha256`，重复决定只启动一次验证，越权、过期、拒绝或摘要不匹配时保持阻断。
- 独立验证器在干净工作区应用获批补丁，并可从同一 Delivery 定位分析方案、候选补丁、人工决定、确切 Run 与 `verified.json`。
- 保留双机失联对账和显式重派回归，覆盖对账前拒绝重派、对账后新 generation，以及旧代次续租和完成被拒绝。

这使得第一阶段的最小路径可以明确为“共享 Project → 固定基线 → DSH 只读分析 → Codex ACP 实现 → 人工审批 → 干净工作区验证 → 保留证据”。并行分解、Harness 步骤级恢复、长历史滚动、PR/CI 和定时入口属于后续阶段。

## 当前状态

Pero 已经具备以下基础能力。

| 能力 | 当前证据 | 对 #277 的意义 |
| --- | --- | --- |
| Project 授权与 Client 身份 | `server/internal/store`、`server/README.md` | Coding Workflow 继续沿用 Project owner，不新建一套权限 |
| Task、Run、generation、lease | `server/internal/store/run_operations.go`、`run_reconciliation.go` | 所有执行都绑定精确 Run，旧代次不能覆盖新代次 |
| Worker claim、renew、events、complete | `server/README.md`、`crates/pero-worker/src/control.rs` | Temporal Activity 可以调用现有控制面 |
| Worker journal 与不重放 prompt | `crates/pero-worker/src/journal.rs`、`src/main.rs` | 失联后的结果未知，保留原 Run 与本地证据 |
| ACP Agent、workspace lock、取消与清理 | `crates/pero-worker/src/executor.rs` | 可以承载 DSH Go 和 Codex ACP，但还没有统一的 Coding 阶段协议 |
| Go Temporal campaign | `server/internal/campaignruntime`、`docs/adr/0037-temporal-research-campaigns.md` | 已验证稳定 Workflow ID、精确 Run、review gate、continue-as-new 与 replay |
| Harness Session durability | `harness/go/session` | 有事件日志、checkpoint、恢复与子会话基础，但尚未接入 Coding Workflow |

当前基础不足以证明以下结论。

- 真实 DSH Go 与 Codex ACP 已经能在两个设备上完成一个完整 Coding 任务。
- ACP 的 session 或 thread 在 Worker 更换后可以恢复到同一个模型执行边界。
- 任意工具副作用都具备提交前 claim、结果保存和未知结果处理。
- Workflow 重启后不会重复阶段 prompt、审批、提交或独立验证。
- 代码补丁、workspace 版本、运行证据与人工批准已经绑定成一个候选版本。

## PR #265 与 #276 已经验证的能力

这两个 PR 已经把原分析中最重的端到端风险跑通，但它们尚未合入
`master`，所以当前应把它们视为待合并的验证证据和回归基线。

- PR #265 在共享 Project 中验证了 Campaign review、编排器重启、审批回执去重、真实 Electron/Rust Host/Worker/PostgreSQL/Temporal 链路和 Temporal replay。
- PR #276 在两台真实 Mac 上验证了 DSH Go → Codex ACP、只读权限协商、Worker 连接分区、对账后新 generation、旧租约迟到写入拒绝、人工审批以及干净工作区的 25 个 HTTP/SQLite 检查。
- 因此，#277 不需要重新设计一套通用 Coding state machine，也不需要重新证明基础的 Worker recovery。它需要把这两条已验证路径接到同一个共享 Project Delivery 视图和证据链上。

## 参考项目提炼

### Phleet

参考 checkout 是 `phleet@94edddb02`。

Phleet 提供了最完整的业务编排样例。它把 Agent 生命周期、动态 workflow 定义、任务委派、子 Workflow、并行 consensus review、人工 gate、失败通知、共享 memory 和版本化配置放在同一个 Temporal 体系中。

对 Pero 最有价值的能力如下。

- Delegate Activity 使用稳定任务标识等待 Agent 完成，并支持 incomplete response 的续接。
- Workflow definition 是版本化数据，可以由编辑器修改，运行中的 Workflow 继续使用已加载版本。
- `sequence`、`parallel`、`loop`、`branch`、`wait_for_signal`、`child_workflow` 和 `fire_and_forget` 已形成可组合控制流。
- 人工 gate 通过 signal 等待，审批身份和 gate 阶段由服务端限制。
- 失败通知有持久状态、重试次数、parked 状态和明确的失败原因分类。
- Search Attributes 将 issue、PR、阶段、gate 和运行状态暴露给观察面板。
- Durable delegation 在外部 Agent 回执丢失时保留 pending record，重启后继续等待原任务。

需要避免直接照搬的部分。

- Phleet 的 Activity 仍依赖 Agent 自己的容器和消息桥，不能替代 Pero Worker 的 Run lease 和 reconciliation。
- Phleet 的动态 JSON workflow 适合成熟的编排平台。#277 第一阶段应先固定 Coding 领域状态机和阶段类型。
- 委派 Activity 不能把“消息已发送”当成“代码已落盘”或“Run 已完成”。

### pi-temporal

参考 checkout 是 `pi-temporal@09d7c8257`。

Pi 的核心贡献是把“Agent 回合”拆成可恢复的最小边界，同时承认工具副作用无法凭空变成 exactly-once。

- Session 文件是对话的权威记录，Temporal Workflow 只保存控制状态和有界摘要。
- 一个 step 可以拆成 model call、每个 tool call 和 seal 三类 Activity。
- 工具执行前写入 dispatch claim。重试发现 claim 但没有结果时返回 `unknown`，不会猜测后再次执行。
- seal 负责把已完成工具结果写回 transcript，失败重试不会重复写入。
- fence token 保护 session 文件，旧 Worker 的迟到写入会被拒绝。
- host queue 把需要本地 workspace 的工具送回持有该 workspace 的 Worker。
- tree shipping 在不同 Worker 之间移动项目文件，并为未提交变更保留 salvage。
- heartbeat、schedule-to-start、schedule-to-close、graceful shutdown 和 Worker Versioning 都是恢复契约的一部分。
- continue-as-new 只在安全边界发生，并携带 session、预算、工具配置和未完成状态。
- `watch` 通过 session file 和 Update 续读，远端客户端可以在不同机器上跟踪同一个 session。

对 Pero 的直接启发是，Coding Workflow 必须把以下三个状态分开。

1. Tool 或 Agent 请求是否已经被执行。
2. 执行结果是否已经写入 Harness 或 ACP session。
3. 控制面是否已经收到并确认 Run completion。

### Durable Research Fleet

参考 checkout 是 `durable-research-fleet@53609c431`。

它展示了 Worker 可按任务弹性出现、完成后归零，而 Workflow 在没有 Worker 时继续存活。

- 一个规划调用产生多个独立子问题，Workflow 并行 fan-out。
- 子任务使用 `return_exceptions=True` 聚合部分失败。一个子问题失败不会抹掉已完成的兄弟结果。
- 结果写入 Workflow state，报告生成只使用已经完成的 findings。
- review gate 通过 durable timer 和 signal 实现，Worker 归零后仍可被 Signal 唤醒。
- Cloud Run 和 AgentCore 的 Worker 生命周期不同，但 Workflow 与 Activity 契约保持一致。
- Worker startup、idle debounce、drain、build id 和 secrets 都有明确的部署边界。
- chaos panel 通过故障注入验证 Activity retry 和恢复，而不是只验证正常路径。

对 Pero 的启发是，Coding 任务可以先采用有限 fan-out，例如 DSH 分析、仓库取向和测试规划并行，然后把实现和验证串成阶段。每个分支必须保留独立结果和失败原因。

### Pydantic AI Harness 与 Temporal durability

参考 checkout 是 `pydantic-ai@0fb8436a0`。

Pydantic AI 将 Agent 能力拆成 typed capability，并把持久化执行作为一个可替换的 capability。

- `TemporalDurability` 将 model、toolset、MCP get-tools、MCP instructions 和 call-tool 操作映射到 Activity。
- Agent、toolset、run context、model registry 和 activity config 都有稳定标识，便于 Worker 注册和 replay。
- activity config 可以按 model、toolset 和具体 tool 覆盖 timeout、retry、cancellation。
- 非可重试错误会被统一加入 retry policy，避免用户覆盖策略后无限重试序列化或参数错误。
- workspace、MCP、dynamic toolset 和 child workflow 都有明确的执行边界。
- StepPersistence 提供不依赖执行引擎的 settled-step snapshot，可用于保存和 fork。
- 流式事件在 Activity 中产生，再通过 workflow stream 传给客户端。
- continue-as-new 时携带 agent state 和有限的历史输入。

对 Pero 的启发是，不能把所有 ACP 操作都当成一个大 Activity。需要明确哪些操作是 deterministic domain transition，哪些操作必须在 Worker Activity 或 Host 中执行。

### OpenAI Agents SDK 与 Temporal integration

参考 checkout 是 `openai-agents-python@6afdd47b4` 与 `temporal-ai-integrations@165fe93`。

这组项目把真实 Agent loop 与 Temporal 的 durable execution 连接起来。

- Workflow 负责 Agent orchestration，model request 和 I/O tool 作为 Activity。
- 纯计算、可 replay 的 tool 可以直接在 Workflow 中执行。
- `activity_as_tool` 让已有 Temporal Activity 以 Agent tool 的形式出现，同时保留 timeout、retry、heartbeat、cancellation、task queue 和 versioning。
- tool approval 返回可序列化的 `RunState`，审批后可以恢复原 run，跨 continue-as-new 也能继续。
- MCP 的 tool list、instructions、call 和 approval 必须区分 workflow-side deterministic policy 与 worker-side I/O。
- Stream 使用 WorkflowStream，客户端保存 run id 和 offset 后可以从断点续读。
- sandbox secret 使用 worker-side environment reference，Workflow history 中只保存稳定引用。
- Stateful MCP session 在 Worker 丢失后不能随意重建。必须把 dedicated worker failure 和普通 activity retry 区分开。
- Workflow Versioning 和 patch marker 是长期运行 Agent 的升级前提。

对 Pero 的启发是，Coding Worker 需要一个 ACP adapter contract，而不是把 DSH 或 Codex 的私有 session 对象写进 Workflow history。History 只保留稳定的 Agent、Session、Thread、workspace、Run 和 checkpoint reference。

### Agent SDK for Go

参考 checkout 是 `agent-sdk-go@8dbb97f53`。

它覆盖了产品层最容易遗漏的运行管理能力。

- `AgentRun` 提供稳定 run id、status、cancel、get 和 done。
- client 与 remote Worker 可以拆成两个进程，Worker 只负责 task queue。
- stream 保存 run id 和 offset，重启后 `GetAgentStream` 可以从 offset 继续。
- tool、MCP、sub-agent delegation 都可以走 approval。
- token、cost、wall-clock budget 可累计到 run，并跨 continue-as-new。
- fallback model、circuit breaker 和 one-extra-iteration grant 处理模型与工具失败。
- action policy 对每个 tool call 做 allow、deny、modify、step-up、defer，并保存签名 audit receipt。
- Temporal runtime 要求 client 与 Worker 使用相同 agent fingerprint，防止配置不一致导致错误执行。
- tool side effect 使用稳定的 `RunID:Iteration:ToolCallID` idempotency key。
- 子 Agent 使用 child workflow，事件流回收到 root workflow。

对 Pero 的启发是，#277 的面向用户 API 至少需要稳定的 Coding Run handle、status、cancel、events、approval 和 reconnect，而不仅是一个启动接口。

### Temporal Python SDK

参考 checkout 是 `temporal-python-sdk@ce8cd4814`。

它提供的是底层运行约束，不是业务功能。

- Worker 可以同时承载 Workflow、async activity、thread activity 和 process activity。
- Activity heartbeat 是检测 Worker 丢失和传递 cancellation 的主要机制。
- Workflow sandbox、replay、determinism、signals、updates、timers、child workflows 和 continue-as-new 都是第一等能力。
- graceful shutdown、poller concurrency、task queue、worker build id 和 versioning 影响真实恢复行为。
- replay test history 是升级长期 Workflow 的最低验证。

Pero 应沿用同样的验证思想，但继续使用 Go Temporal runtime，不把 Python SDK 引入控制面。

## Durable Coding Worker 功能清单

下面的清单按“必须先有的恢复语义”排序，而不是按 UI 或 SDK 目录排序。

### P0 复用已有契约

以下能力沿用现有 Campaign、Task/Run、generation、lease、reconciliation、
Worker journal、approval receipt 和 Temporal replay。PR #265 和 #276 合入后，
这些项目转为回归门禁，不再作为 #277 的新建任务。

### P0 #277 增量

在共享 Project 右侧面板打开「代码交付」，可关联三个阶段的精确 Run。选择器展示节点和代次。交付详情保留 Git 基线及原 Run 的关联，点击短 ID 可复制完整值。已关联且通过 digest 校验的导出产物可直接预览。

隔离的 macOS Native 验收使用真实 Go 控制面和 PostgreSQL。通过 Project 的窄侧栏保存并重开一条交付，三段 Run、机器和代次与服务端一致。HTTP 回归另覆盖跨项目拒绝、创建幂等、追加阶段、冻结基线及已提交产物的内容校验。现有双机 runner 仍把方案、候选补丁、人工决定和验证报告保存在验收目录，需要接入 Project 产物发布后再做统一验收。

- [ ] 在共享 Project 中创建一个 Delivery 入口，关联已有 Campaign 或精确 Run。
- [ ] 将 DSH 分析、Codex 候选、人工决定、验证报告和最终结果绑定到同一个 Delivery。
- [ ] 将 PR #276 的双机 runner 与 PR #265 的 review/replay 检查提升为 #277 的必过验收。
- [ ] 为客户端提供一个 Delivery 视图，展示阶段、当前 Run、generation、候选摘要、审批回执和验证证据。
- [ ] 处理 Delivery 级重复启动和重复审批，复用已有 operation receipt，不新增一套副作用协议。

### P1 Workflow 编排

- [ ] 将分析、实现、验证、审查和发布建成有限状态机。
- [ ] 为并行分析和独立 review 使用 child workflow 或受控 fan-out，并保留部分失败。
- [ ] 为每个 gate 提供 durable timer、Signal 或 Update，处理重复、过期、错误 gate 和未授权决定。
- [ ] 支持在 review 等待期间没有 Worker 的 Workflow，Signal 到达后可以唤醒。
- [ ] 在 history 接近上限时用 continue-as-new，携带 bounded state、未结清 Run 和 pending approval。
- [ ] 按阶段设置 Activity retry、heartbeat、schedule-to-start、start-to-close 和 cancellation policy。
- [ ] 加入 Worker Versioning、replay fixture 和升级期间的 build retention。

### P1 Harness 与 workspace

- [ ] 将 Harness Session checkpoint 接入 Coding Workflow 的 `SessionRef` 和 `CheckpointRef`。
- [ ] 定义 workspace ownership、write fence、workspace revision 和跨设备转移协议。
- [ ] 在设备切换前保存 workspace snapshot 或 git bundle，并验证 baseline、当前 revision 和未提交变更。
- [ ] 对旧 Worker 的迟到写入使用 fence token 或 revision compare-and-set。
- [ ] 为工具输出、补丁、测试报告和截图保存有界摘要及可重取 artifact reference。
- [ ] 为 session file、journal、workspace lock 和 retained evidence 定义保留和清理规则。

### P1 用户可观察性

- [ ] 提供 Coding Run 的 status、phase、current Run、generation、worker、session/thread、pending gate 和 attention reason。
- [ ] 提供按 cursor 续读的事件流，事件包含阶段、工具、审批、重试、未知结果和 reconciliation。
- [ ] 客户端保存 run id 和 event offset，重启后从断点继续。
- [ ] 把 Project 授权、设备授权、Agent 授权和每次 action decision 显示在同一条证据链上。
- [ ] 失败通知只携带稳定的 workflow、run、phase 和 cause category，详细 payload 通过受权读取。

### P2 运行能力

- [ ] 支持 PR、CI、schedule 和需求变更作为经过鉴权与去重的外部触发。
- [ ] 支持按 OS、Agent、workspace、网络、模型和资源约束选择 Worker。
- [ ] 支持独立 reviewer、consensus review 和可配置的重规划次数。
- [ ] 支持 token、cost、wall-clock、tool call 和 child workflow budget。
- [ ] 支持 model fallback、tool circuit breaker、action policy 和签名 audit receipt。
- [ ] 支持 Worker scale-to-zero、serverless Worker 或受控弹性池，前提是先有稳定的 Activity 和 session contract。
- [ ] 支持候选补丁、独立验证、人工批准和发布结果在 Temporal history 关闭后仍可从 Pero 读取。

## 建议的落地顺序

### 第一阶段，接入已有真机链路

范围固定为一个共享 Project、一个 Coding request、一个已有 Campaign 或
精确 Run、一个候选补丁和一个 approval gate。PR #265 与 #276 提供执行和
恢复证据。

交付顺序如下。

1. 合并并稳定 PR #265 的共享 Project review 和 replay 门禁。
2. 合并并稳定 PR #276 的双机 recovery 与 coding handoff runner。
3. 在现有 Campaign、Task/Run 和 receipt 之上增加 Delivery 关联与查询。
4. 将 DSH 分析、Codex 候选、审批和 verifier 结果接入同一条证据链。
5. 增加一个客户端 Delivery 视图和重复启动、重复审批的回归测试。

第一阶段不引入新的 Coding state machine、通用动态 workflow editor 或
新的 Agent runtime 插件平台。

### 第二阶段，恢复与并行

- 将分析和 reviewer 变成 child workflow。
- 增加 workspace shipping、session resume boundary 和跨设备接管。
- 增加事件 cursor、审批恢复、失败通知和 continue-as-new。
- 用真实故障注入覆盖 Worker 崩溃、控制面重启、Temporal Worker 替换、网络断开和迟到回执。

### 第三阶段，产品化编排

- 加入 PR、CI、schedule 和外部事件。
- 加入多设备选择、弹性 Worker、build retention 和版本迁移。
- 加入 consensus review、预算、策略审计和发布结果。
- 评估是否需要把部分固定 Coding phase 提升为可配置 workflow definition。

## 需要保持的架构方向

- Temporal 只拥有 Workflow phase、等待、重试、timer 和 child workflow 的控制状态。
- Go 控制面拥有 Project 授权、stable operation receipt、Task/Run、lease、reconciliation、artifact reference 和最终可读结果。
- Rust Worker、Host 和 ACP provider 拥有本机进程、workspace、session/thread、工具回执和停止证据。
- Harness 拥有 Agent session 事件、checkpoint、context compaction 和恢复材料。
- Workflow history 只保存有界摘要、稳定身份和 digest。完整对话、工具输出、补丁和日志留在各自 owner。
- 所有副作用都要先确定 effect owner，再决定 retry、reconcile 或人工介入。
- 参考项目只作为设计证据，不作为 Pero 的运行时依赖。

## 下一步建议

先把 PR #265 和 #276 的真实验收合入并设为回归门禁，再实现一个薄的
Delivery 关联和查询切片。它只覆盖一个固定 task path。

```text
admit project request
  -> freeze plan and baseline
  -> DSH read-only analysis
  -> Codex implementation in isolated workspace
  -> independent verification
  -> human approval for exact candidate
  -> publish or close with retained evidence
```

验收必须同时记录以下身份。

- `workflow_id` 与 Temporal first execution run id
- Project、Task、Run、generation 和 operation id
- Worker、device、workspace revision
- DSH session 或 thread reference
- Codex session 或 thread reference
- checkpoint、patch、test report 和 verification digest
- approval request、reviewer 和 decision receipt

完成这条最小路径后，再决定哪些阶段值得抽象成通用 durable worker 能力。
