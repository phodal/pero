---
kind: analysis
date: 2026-11-06
github_issue: 143
github_url: https://github.com/phodal/pero/issues/143
source_revision: 6bdb05ed02d30f187e406ee6bb9930cf7a4860cb
---

# Paper 自主研究与产物交付：#143 实施设计

本文保留 #143 的实施设计，并在末尾记录实际落地情况；验收结论以 [验证报告](../fitness/paper-autonomous-research.md) 为准。方案复用现有 Paper、Host、Harness 和会话产物区，实验执行与科学结论验收仍有独立边界。

**结论：基础动作和结果展示已经具备，适合以一个串行研究模式接通。** 增量集中在研究协议、候选与跨轮证据、可信启动与累计预算、结束反馈、App 报告到会话产物的交付。首版完成“读论文 → 找新论文 → 围绕缺口继续读 → 保存知识 → 更新产物 → 自动进入下一轮”，实验执行在单独授权后接入。

**2026-11-06 实现状态**

用户批准后，代码在 `codex/paper-autonomous-research` 基于 `185673fc8f6e6dc533f11cc9484149a2b6d6b948` 实现。当前包含 Program/候选/轮次领域类型、有限检索与获取任务、Host 可信会话绑定、Harness 同 Turn 续研与持久预算、直接产物交付和 Paper 工作台入口。真实 Python + Host + Harness 的三轮集成已通过；完整验证范围、命令、基线失败和截图见 [验证记录](../fitness/paper-autonomous-research.md)。下文保留方案论证，以下是实际接口上的明确取舍：

- 保存计划后通过明确的“启动研究”按钮调用现有 `agent.start`，随后打开共享 Chat；不把保存、预览或普通问答当作启动。运行仍由原来的 Pero Session 拥有。
- 来源策略细分为 `saved_only`、`public_pdf`、`public_fulltext`；后者允许固定版本官方 HTML。HTML 复用原有 SourceObservation/SourceEvidenceReport，只把实际已读 prose window 作为跨轮文字引用；图表、数学结构和原始标记保持待复核，不伪造 PDF passage。
- 四个声明工具为 `research-program/search/acquire/deliver`；Study 与科学文档操作封装在 program 命令内。当前模式通过已冻结协议和声明 schema 指导行为，不新增会自动演化的 Skill。
- Host catalog 中的 Research provenance 是唯一持久交付回执，不在 Paper 再维护一份容易漂移的产物索引。重复同一 checkpoint/slot/digest 不增版；新 checkpoint 保留新来源版本，即使某个 slot 内容相同。UI 打开原会话的现有产物区。
- 终态投影由 Host 原有 owner tick 处理，不依赖页面 status 轮询。导出是终态收尾，不会重新发起模型请求。交付失败保留已经成功的 slot，并可经 status/deliver 重试。
- 真实模型与外网论文的科研质量验收尚未执行；本地集成使用明确标注的合成论文和脚本模型，结果始终 needs_review。实验、长期追踪和模型权重学习仍在本方案的后续阶段。

**核查基线与证据**

- 2026-11-06 查询并获取上游 master，固定到 `6bdb05ed02d30f187e406ee6bb9930cf7a4860cb`。没有切换或覆盖当前工作目录。
- #143 仍开放，作者 sxyseo，本次读取时无评论。之前的提案基线为 `01ec7f0d7edcbded4a214b91b56d99cd93c261e0`。
- 产物机制在之前基线中已经存在；本次新增认识是将其正式纳入研究闭环。两次基线之间主要为 #139 的阅读、共享 Chat 和会话 UI 修正。
- 已阅读架构、ADR 0027/0028、fitness 索引、Paper 研究设计，以及产物、发现、研究记录、App 工具装配、预算和 Harness 结束扩展点的实现。
- 本机验证：`artifact-delivery.test.ts` 与 `app-agent-plugin.test.ts` 共 6 项通过；`test_research_records.py` 5 项通过。相关受测后端/传输文件在两次基线间没有变化。这仅验证已有局部能力，本次没有实现或运行自主研究，也没有真实模型、GUI 或科学质量验收。

**1. 用户最终看到什么**

在 Reader 或研究记录中选择“持续研究”，填写问题、范围和预算；共享 Chat 显示已冻结计划。用户发送启动后，在允许范围内自动推进。保存计划、打开历史或预览产物不会启动模型。

例如：“从这篇 MPC 论文出发，研究方法在模型失配和约束变化下是否仍成立；优先找原始实验和反证。”启动页只展示必要选择：研究问题、种子、来源范围、是否获取公开全文、轮数/时间/请求上限、停止条件。正文会发送给哪个模型应当明确。

运行时共享 Chat 展示当前动作，Paper 展示候选与证据，产物区持续更新四个逻辑文档：

| 逻辑文档 | 内容 | 更新时机 |
| --- | --- | --- |
| 研究报告（Markdown） | 当前回答、适用条件、支持/反证、未解决问题、下一步、停止原因 | 每个已提交轮次和最终收尾 |
| 证据矩阵（JSON） | 陈述、立场、来源版本、Study/Report/Observation 引用、待复核状态 | 证据或解释发生变化 |
| 文献清单（Markdown） | 发现路径、纳排理由、阅读范围、全文可用性、待处理项 | 候选筛选完成后 |
| 研究日志（JSONL） | 每轮问题、工具回执引用、预算消耗、结果与失败 | 轮次提交或中断检查点 |

默认选中研究报告。论文原件继续留在 Paper；产物区交付研究结果与索引。CSV、图表、Notebook 可作为后续衍生产物，不是完成首版的前置条件。

“暂停”停止后续派发并取消当前 owner 的活动请求；“结束研究”保留已有结果；“继续”读取同一研究和剩余额度。暂停请求、已确认停止和结果未知分别呈现。

**2. 现有能力、真实缺口和复用位置**

| 能力 | 已核实实现 | 本次增量 |
| --- | --- | --- |
| 主题搜索、关系探索 | `literature.py`、`discovery.py`；related/references/citing；HTTP `/api/search`、`/api/discover` | 声明 Agent 工具、保存主题搜索批次，关联 Program 和累计额度 |
| 原文与引用 | `studies.py`、`paper_documents.py`、`source_reading.py`；固定版本、真实观察、原文定位 | 子研究与 Program 关联；明确 PDF/HTML/TeX/摘要观察差别 |
| 阅读报告和纳排 | `reports.py`、`research_records.py`、`research_record_commands.py` | 跨 Study 的综合引用；自动创建内容固定为待复核 |
| 同一会话持续调用 | Rust Host/ACP、Go Harness，已有 `TurnStopping` / `Agent.Inject` | 为自主研究绑定协议和结束检查，不新建 Agent 调度器 |
| App 插件与 Skill 装配 | `apps/agent_plugin.rs`、`apps/session_plugins.rs`、共享 `AppAgentPluginBinding` | Paper 当前没有 `contributes.agentPlugin`；补仅作用于自主启动的限缩装配和实际 Skill 加载 |
| 持久产物与版本 | `SessionArtifact`、`SessionArtifacts`、Host `artifacts` | 从 Paper 的已提交研究修订导出，并保存可信产物关联 |
| 产物阅读与上下文 | Scientific Viewer、共享 Chat；exact version、digest、历史快照 | 研究页面导航到指定版本；历史恢复不自动读全文或发模型请求 |
| 来源更新与监测 | `research_watch` 和现有 Automation | 后续按获准协议触发增量研究；首版无需定时器 |

必须处理的已有约束：

- `ResearchStudy` 为冻结的 1–5 篇、24 步；新发现建立新 Study。不能在旧 Study 中不断追加论文。
- `ResearchRecord` 最多 32 篇、64 条 evidence link。父 Program 引用多个有界记录，综合时保留各自来源身份。
- `ResearchStore._list/_write` 每个种类限 200 条。新 Program 的候选、轮次、查询须按 Program 分区并分页，不能全部塞进现有全局目录。原有 paper/pdf/report 容量检查仍保留；启动和每次落库前检查余量，到限则交付 `storage_capacity`，不自动删除旧证据。全库分页迁移可后续独立实施。
- App 插件 `maxCalls` 为 1–100、只覆盖一次 ACP connection；连接重建会重新装配。Program 总额度必须另行持久化，且一个批次须容纳在现有连接预算内。
- App Write 适配目前有 15 秒等待、通常 1 MiB 响应限制。检索不能假设多个 provider/分页一定在一次调用内返回；结果必须分页，较慢请求返回 operation ID 后查询状态。
- 普通 `prepare-research(fullText=true)` 会调用 `LibraryFiles.reading_pdf`，可能获取缺失 PDF。自主模式必须走已获准获取，再以已保存 document ID 创建 Study，不能从旧入口绕过研究预算。
- 既有工具描述包含“仅用户明确要求续研”“逐文件确认”“保存后结束回合”。自主模式要用真实 Program 授权和模式化返回契约替代这些单次问答语义；普通问答行为保留。
- 当前 `deliver_artifact` 只接收工作区内路径；Paper 的数据根目录不等于会话工作区。报告 HTTP 导出目前返回内容，不会自动进入产物区。
- 产物 ID 归属于 thread。新会话不能直接给旧会话产物追加版本；`request_id` 目前只做回执关联，不能视作交付幂等键。

**3. 路线选择**

| 路线 | 适用性与代价 | 决定 |
| --- | --- | --- |
| Skill 驱动现有工具，Agent 写工作区文件后 `deliver_artifact` | 可快速演示；论文搜索仍需工具接线，工作区写权限和跨重启预算/引用一致性需要另补 | 可做局部技术试验，不作为 #143 完成标准 |
| Paper 保存研究状态，现有 Harness 循环执行，Host 交付 App 导出 | 与现有 owner 一致，既有产物与阅读能力可以复用；要实现本文的明确接线 | 推荐首版 |
| Paper 自建后台队列/多 Agent/知识图数据库 | 引入第二个执行所有者，首个用户旅程不需要这些条件 | 本版不采用；只有实际吞吐/远程运行需求成立后重新评估 |

首版自动模式仅对经过验收的内置 Pero Agent 开放。其他 ACP Agent 继续使用普通 Paper 问答；只有通过相同的工具范围、预算、取消和结束反馈契约验收后再启用自动模式。不能承诺任意外部 Agent 都能被相同方式控制。

**4. 状态归属与数据模型**

```text
Reader / 研究记录 ──冻结计划并发送──> 共享 Chat / Host
                                      │ 实际会话、授权、取消
                                      ▼
                              现有 Go Harness 循环
                                      │ 已声明 App 工具
                 ┌────────────────────┴──────────────────┐
                 ▼                                       ▼
       Paper Program / 候选 / 轮次              既有发现、获取、Study、Report
                 │                                       │
                 └────────────已验证引用的综合────────────┘
                                      │ 固定修订导出
                                      ▼
                              Host SessionArtifacts
                                      │ 原有目录与版本快照
                                      ▼
                           产物区 / Scientific Viewer
```

新增概念放在 Paper 领域内，以 frozen dataclass 表达；这里列的是字段和不变量，不预设新的数据库或接口层：

| 概念 | 关键字段/规则 |
| --- | --- |
| `ResearchProgram` | 稳定 id、协议 revision、question/scope、seed refs、acquisition policy、研究额度、停止规则、已提交 round refs、checkpoint。协议不可被 Agent 放宽 |
| `ResearchCandidate` | Program 内 key、经过核实的 DOI/arXiv/OpenAlex aliases、发现 batch/query/parent refs、纳排决定及理由、阅读来源版本和状态。身份与获取位置分开 |
| `ResearchRound` | round number、parent checkpoint、subquestion、action/receipt refs、Study/Report refs、证据增量、下一步及停止依据。不是 ACP Run 状态 |
| `ResearchSynthesis` | 属于一轮的不可变综合：claims、conditions、support/counterevidence/gaps、原报告及精确 observation 引用。只组织已有证据，不复制来源仓库 |
| `ResearchDeliveryRef` | Program/checkpoint、文档 slot、thread/artifact/version/digest、导出内容 digest。Host 确认交付后记录，不允许模型自报成功 |

`ResearchRecord` 仍拥有批次内的纳排和研究矩阵；Program 关联这些记录。`ResearchProject` 只增加 `research-program` 资源引用和导航，不接管内容/运行状态。对于 Agent 创建的记录，服务端固定 `needs_review`，不能调用旧 `review=accepted` 字段冒充人的接受决定。

纯领域入口的形状为：

```text
apply(program_state, typed_command, observed_facts, now)
  -> next_state + effects | domain_error
```

时间、查询结果、已保存报告和 Host 回执由外层提供。纯核心决定候选、下一步准入、额度结算、证据引用和停止原因。Python shell 调用现有网络/Store；Rust Host 拥有真实启动和执行授权；Harness 拥有模型请求；没有新建一个 `running/failed/retrying Run` 的副本。

持久化建议：`research-v1/programs/<programId>/protocols/`、`queries/`、`candidates/`、`rounds/`、`checkpoints/`。目录分区的写入仍复用原子文件写方式，单 Program 用现有串行锁提交；先写不可变子记录，最后原子发布 checkpoint，读者只从已发布 checkpoint 导航。不引入消息队列或通用 event-sourcing 框架。

每条命令携带 `operationId` 和 `expectedCheckpoint`；已提交操作返回原回执，旧 checkpoint 提交报冲突并返回当前引用。操作 receipt 不等于内容 digest：即使两次查询文本相同，也要区分显式 refresh 与同次请求重传。

**5. 实际研究循环**

1. **恢复上下文。** 读取协议、当前 checkpoint、剩余额度、未完成 operation、候选和 gaps。旧总结只用于导航；恢复真实陈述必须取回其 observation/原报告。
2. **选择子问题。** 优先补一个明确缺口：种子中的关键原始工作、适用条件、实验设置或反证。Agent 提交结构化 action proposal，包含所针对 gap 和理由。
3. **发现。** 首轮可选 references/related，后续选择 citing 或主题搜索。查询和分页结果持久化；相同工作不同 URL 合并身份，但不同版本保留。标题匹配多解保留待核对，不自动选第一条。
4. **筛选。** 判定 include/exclude/pending 并给理由。优先相关且可消除当前不确定性的原始研究。引用量和相似度仅用于排序，不直接作为科学质量分数。
5. **获取与阅读。** 已保存原文直接固定版本；缺失原文按初始策略获取。当前候选不可获取时保存 blocker，可继续其他候选。单 Study 最多 5 篇，读取/search/recall/note 复用原能力。
6. **批次报告。** finalize 只结束该子 Study。自主上下文返回“提交本轮/选择下一步”，普通问答仍按原指引给最终回答。不要复用含“禁止外部来源”的单 Study 指引去控制整个 Program：该约束只作用于当前冻结阅读批次。
7. **综合。** 提交本轮 claims、反证、条件和 gaps。服务端验证引用确实来自关联 Study/来源观察；跨 Study 不强行塞进旧 `ResearchReport.parse` 的单 input 范围。
8. **评价进展。** 计算新来源版本、新观察、新纳排，以及有证据支持的解释修订。重复摘要、换网址和重复 observation 不算新增证据；基于旧证据纠正解释单独记 `interpretation_revised`，不能标为新观察。
9. **交付。** 发布 checkpoint，确定性导出，并给既有产物追加版本。产物失败不回滚已保存证据；显示“研究已保存，产物交付待重试”。
10. **继续或停止。** 核心返回可继续、需输入、研究停止及具体原因。允许时 Agent 在同一回合继续；停止时保留未解决问题，不宣称“已经搜遍所有论文”。

PDF 走 `ResearchStudy`；官方 HTML 走 `scientific-document` 的固定 document/observation，再关联 source report。综合引用使用区分这两类来源的类型，不能把 HTML block ID 填进 PDF passage ID。原 TeX 读取只在既有单独获取授权生效时使用，不是首版自动下载范围。纯图像 PDF 标为不可文本阅读；当前阅读链未验证视觉读取时保留缺口。

不需要一个无法验证的“科研价值分数”。停止条件建议为：用户停止、截止时间/动作额度到达、既定范围内候选耗尽、连续 N 个完成轮次没有事实或解释变化、全部关键下一步被外部条件阻塞，或当前问题已形成待复核结论。最后一种是 Agent 提议的充分性判断，不能标为科学证明。

查询失败、429、文件不可读与“查询完成但无新证据”分开统计。遇到相同参数错误最多在核对具体字段后修正；重试预算计入总额，不能用无限纠错拖住研究。

**6. 工具与模式契约**

新工具沿现有 `contributes.writes → app_describe/app_write` 接入。工具集合按领域职责分成四个入口，operation 用判别 schema 表达，避免一个接受任意 JSON 的总控工具：

| 拟议工具 | operation 与必需语义 |
| --- | --- |
| `research-program` | `read` 读取 checkpoint；`propose` 提下一动作；`commit-round` 关联真实回执/Study/综合；`finish` 提议停止。不能批准自己、提高预算或启动 Agent |
| `literature-search` | `search`、`discover`、`status`、`read-page`；输入 Program/action 引用、query 或 seed/relation。返回已保存批次、provider 错误和 next cursor |
| `research-candidate` | `screen`、`acquire`、`readiness`、`prepare-study`；必须引用已发现候选，prepare 只接已保存来源版本。实际获取复用 PDF/HTML owner |
| `research-delivery` | 对固定 checkpoint 执行 `publish` 或 `status`，Host 生成/确认产物引用。模型不能提交正文路径、thread 或可信交付回执 |

示意一次调用（值为示例，正式 ID 按现有约束生成）：

```json
{
  "app": "paper-agent",
  "tool": "literature-search",
  "document": {
    "operation": "discover",
    "programId": "<saved-program-id>",
    "protocolRevision": 1,
    "expectedCheckpoint": "<saved-checkpoint-id>",
    "operationId": "<stable-operation-id>",
    "seedCandidateId": "<saved-candidate-id>",
    "relation": "citing"
  }
}
```

以上 JSON 是设计示意，不能直接调用当前版本。身份、授权、实际会话和执行状态由 Host 关联，Agent 参数只是引用。外部 JSON 在入口转为领域类型，内部不继续传自由字典。

现有 `research-step`、`read-context`、`scientific-document`、`research-source-read` 继续使用；对 Program 子 Study，按服务端保存的关联自动结算总额度，不能仅依赖模型每次传 `programId`。自主会话的路由范围须拒绝未绑定 Study/旧获取入口，避免创建新 Study 重置额度。

主题检索需增加持久 query result，与现有关系 DiscoveryBatch 共用候选身份。对大结果使用既有 content reference / bounded read，而不是将完整论文或全部候选一次塞回模型。

检索若需要超过工具等待时间，使用领域内的单个在途 lookup operation：start 先落库，再启动有限时长的网络工作；status/cancel 通过同 ID 查询。复用已有获取进程的生命周期做法，不把多个 HTTP 请求包装为新 Agent 调度平台。

**7. 自动推进如何保证**

正常推进依靠现有 Harness 的模型—工具循环；Skill 给方法，Program 工具返回明确的下一步与余额。只写“请继续研究直到完成”仍会在模型提前给最终回答时停止，因此需接入已有 `TurnStopping` 信号。

建议新增一个只在获准 Paper 自主会话挂载的 Go 反馈处理函数，挂在 CLI/ACP 的研究模式组合处，不让通用 Harness 导入 Paper 类型。处理函数通过已有 MCP 客户端查询 Program 的结束决定，读取类型化结果后决定是否 `Agent.Inject` 一条系统反馈。

```text
On TurnStopping:
  若取消、Finish 不允许继续、CanContinue=false：不注入
  获取最近已提交 checkpoint 的 next/stop 决定
  若需要输入、已停止、预算到达或当前结果未知：不注入
  若存在未完成且获准动作，并且还剩反馈/模型/工具预算：
      注入“从 checkpoint X 执行动作 Y”的内部反馈
  否则记录 runtime_incomplete，交付现有事实后结束
```

这复用 `harness/go/harness/agent.go` 的 `TurnStoppingInput.CanContinue` 和 `loop.go` 的注入机制。已有 Claude Stop hook 也展示了有界续跑，但命令 hook 带平台限制，故首版选择 Go 挂载函数，不依赖 `/bin/sh`。它只消费 Paper 的决定，不在 Go 再实现候选/研究完成规则。

反馈不是伪造新用户消息，不自动创建另一个 ACP session，也不在 Paper UI 做定时发送。“反馈次数”和累计模型预算均有限；同一 checkpoint 无进展不能反复获得新的续跑额度。Provider 错误与请求耗尽不能借 StopFailure 再启动模型。

自主模式的最小工具集由真实会话上的研究绑定约束。具体接线是在 Host 研究启动分支，从已安装 `contributes.writes` 和实际授权派生一份限缩的 `AppPluginAssembly`，再交给现有共享 binding 执行。需要补充这个“仅当前获准模式的 assembly”入口；它不能引入未声明工具或扩大 App 授权。不要简单给所有 Paper 对话加全局 `agentPlugin` 和 100-call 限制，否则会改变普通问答行为。

Skill 可用已有 `requiresAgentPlugins` 随 App 包装并冻结加载；其指引只有识别到真实自主上下文时才采用研究循环。普通问答不被自动循环接管。验证须检查 Skill 实际到达模型，而不只检查仓库存在 SKILL.md。

内置 Agent 的自主配置仅装配本轮需要的 App、content read、技能读取和结束反馈能力。通用 shell、clone、实验执行、其他 MCP 写入不因“自主研究”被启用。这是阅读模式的动作范围，不声称提供操作系统级沙箱。若必须执行代码，建立单独获准实验，而不是给阅读模式增加任意执行权限。

**8. 初始授权、获取与累计预算**

UI 保存 Draft Program 不产生执行权。真实用户发送冻结计划时，Host 保存研究绑定：Program ID、协议摘要、允许动作、执行后端和截止条件。调用链用实际 MCP caller 关联绑定，不接受模型提供 thread ID 或 `approved=true`。

复用现有 App 请求准入，增加 Paper 研究绑定；参考 `ControlLabGoals` 的“真实发送冻结对象后生效”，但不能直接复用其内存 Map 作为跨重启权威。新绑定持久化在 Host，恢复只重新展示；用户明确继续后检查原执行已停止并重新激活。

获取策略第一版支持三种：已保存原文 + 公共元数据；公开 PDF；公开 PDF + 官方固定版本 HTML。TeX 源码获取、图像模型输入、仓库 clone、模型/数据大文件、安装、实验和外部发布保留现有单独路径。

`acquire` 不伪造旧 `confirmedDownloads=true`。Host 读取已保存 candidate/resource 和研究授权，产生绑定 Program/action/source/version/类型/额度的内部准入，原 Paper 下载 owner 执行。重定向仍遵循原下载规则。未知大小用单文件和累计流式字节上限控制；超限保留失败回执，不发布半文件。

| 额度 | 唯一所有者 | 执行点 |
| --- | --- | --- |
| 查询页、候选、子研究、读操作、完成轮次 | Paper Program | 动作准入时预留；真实回执结算；失败派发也留记录 |
| 下载数量、实际接收字节 | 原获取 owner，结算给 Program | 流读取前受剩余上限约束；实际接收/丢弃字节都可审计 |
| 模型 HTTP attempts、每请求输出上限 | 内置 Harness/provider | 每次真实请求前持久记录，包含重试和压缩请求 |
| 绝对截止时间、取消、活动执行身份 | Host | 到期停止派发并取消；首次协议写明暂停不延长截止时间 |
| App connection maxCalls | 现有 App plugin binding | 保留现有 1–100 限制；不能通过重连清空 Program 总量 |

目前 `--max-requests` 和 `httpAttemptAudit` 已有请求拦截/持久审计，但计数器是进程内的，不能直接宣称跨重启预算已完成。研究模式需绑定专属审计记录：启动时加载已用次数，每次请求前持久化预留；确认旧进程停止后才能恢复。仍由 Harness 写这一份模型计数，Paper 仅显示投影，不另建扣费权威。额度未知时不按零处理。

使用现有单执行 owner 即可，不引入多机租约。模型重试、压缩和可选标题请求共享同一配额。金额为实际用量或标明估算；首版硬约束选择可执行的请求次数与单请求输出上限，不承诺精确美元或总 token 消费上限。

可用于 fixture/试跑的配置示例：最多 3 个完成轮次、8 次检索页请求、24 个候选、6 篇新全文、60 次研究 App 写入、40 次 provider HTTP attempts、30 分钟绝对期限。它们是测试输入，不是测得的合理生产默认值。真实试跑记录消耗后再定 UI 默认值。

正常路径提前留出最后一次 Study finalize、round commit 和 delivery 的额度。硬预算触顶、用户停止或模型失败时，Host 仍可用已保存 checkpoint 生成确定性“中断阶段清单”，不追加模型请求、不伪造完成的 Study 报告。

**9. 产物区接线：本次补充的核心**

已有 `deliver_artifact` 对 Agent 编写的工作区文件很合适；正式研究结果应直接由 Paper 既有记录导出，避免让模型再次抄写报告而引入引用漂移。

推荐增加 `research-delivery` 这个有限 Host handoff，沿 `research-assets` 已有的固定 App→Host 路由模式接入，保持一个产物 Store：

1. Agent 调用 `publish(programId, checkpointId)`；或者停止/故障后的 Host 清理路径调用同一交付函数。手动交付历史修订属于明确 UI 操作，不假装成仍在运行的 Agent 请求。
2. 共享适配器提供真实调用会话。当前 `AppWriteRoutes.apply` 需要补传由 MCP caller 产生的类型化研究 scope；不能从 document 取 thread。Host 校验研究绑定和目标会话确实存在，向固定 Paper 内部导出端点取该 checkpoint 的四份只读文档。Agent 不传 URL、路径或正文。
3. Paper 从固定的 Program、ResearchRecord 修订、Study/Report 和来源引用确定性导出。现有 `store.export` 会叠加当前 matrix edits，因此需显式冻结所选 matrix revision 集合，不能以后重导出同 checkpoint 却使用最新编辑。
4. Host 复用 `SessionArtifacts.register` 保存 Markdown/JSON/JSONL 文本快照；媒体类型走已有 `ContentFormat`。每份文本保持在现有 2 MiB 限额内；超过则按固定页/分片交付并在主报告列索引，不截断证据。
5. 产物使用固定逻辑 slot。第一次产生 ID，之后追加该 ID 的版本。Host 保存 `(program, checkpoint, slot, thread) → (artifact, version, digest)`，再记录交付回执。同一 checkpoint/slot/digest 重复交付复用原版本；新 checkpoint 保留独立来源版本，普通 poll 不产生新版本。
6. 共享 Chat 消费现有 `artifact_registered` / catalog 事件，产物区自动更新；复用现有 Viewer，不增加第二个报告编辑器。

内部导出按文档/分片读取，每个 JSON 回执最多 512 KiB，低于现有通常 1 MiB 的传输上限；主报告与每个实际产物仍保留对应导出摘要。Host 取得完整文档后才发布版本。使用已验证的会话身份直接调用现有文本注册分支，不把 Paper 数据目录伪装成会话工作区，也不放宽 `register_file` 的路径规则。

为处理“已保存快照但回执丢失”，现有 catalog 每个 version 增加可选的受信 App 导出来源键，包含 app/program/checkpoint/slot/exportDigest。该字段由 Host handoff 写入，与快照版本同次 catalog 提交；普通 Agent 文件工具不能填写。旧产物缺此字段仍可读取。

`status` 先从 Host catalog 按来源键核对；已存在则返回原版本，不重新 register。若 Paper 的交付引用尚未保存，由 Host 重传同一回执补齐。研究阶段默认串行、每次有限文档集合即可，不需要跨 Store 分布式事务或通用发布队列。部分成功逐项可见，最后一项失败不能把四项都显示为成功。

`ResearchDeliveryRef` 通过 Host 专用内部接口写回 Paper，不能使用可由 Agent 任意提交的“产物保存成功”JSON。SHA-256 只证明版本内容一致，引用位置匹配也不证明语义正确；产物持续显示 `needs_review`。

同一 thread 续跑：复用该 thread 的 slot ID。新的 thread 续跑：在新会话创建产物，保存对旧 `(thread, artifact, version)` 的来源引用；继续同一 Program 累计预算。不会绕过 `SessionArtifact.thread_id` 约束。

首版核心四种交付均为文本，不需要向 App 暴露 Host 私有快照路径或扩大现有文件路径准入。以后交付 CSV/PDF/图片可复用文件交付，另行补固定 App 文件导出绑定；这不阻塞阅读闭环。

**10. 恢复和错误的具体行为**

| 情况 | 恢复动作 |
| --- | --- |
| 子 Study 报告已保存，round 未提交 | 从原报告 ID 补齐 round，不重新读全文或另造报告 |
| checkpoint 已提交，产物未完成 | 读取固定导出、查询原交付键，只补未交付 slot |
| Host 已交付但 Agent 没收到回执 | 查询 catalog 原版本，回填引用；不盲目追加版本 |
| 原文获取请求超时 | 按既有 resource/operation ID 查询原 owner；未知时保留 reservation 和 blocker |
| 网络/provider 暂时失败 | 保留失败和真实消耗，按协议的有限重试策略处理；不计作研究无进展 |
| 暂停/取消 | 先禁止新派发，再请求原 owner 取消；收齐回执或显示未确认，生成已保存事实清单 |
| 重启 | 加载 protocol/checkpoint/预算，核对原执行；用户继续后重新挂载剩余额度与准确来源 |
| 换 Agent 或新会话 | 先校验能力和原执行停止；引用同一 Program，预算不清零，产物按新 thread 建立关联 |
| 来源被删除/损坏 | 旧结论保留为历史，依赖项标 missing/stale，不能当成仍可核验的证据 |
| 上游版本变化 | 新版本进入新候选/轮次；旧 Study、旧产物不改写 |
| 存储或权限失败 | 不返回“已提交”；保留可恢复状态与已完成 owner 回执，给明确重试/调整入口 |

打开历史零网络/模型请求。将产物“加入上下文”保留 exact version，但 PDF/大文本仍可能只进入引用；模型真正读取时必须走当前被允许的读取路径。不能把看见附件标题计为读完论文。

**11. 文件级改动与可审阅实施顺序**

下表的新文件按概念拆分，已有文件只接线。每个提交保持一个 concern，并遵守仓库文件行数和 co-author 规则。不是要求一次提交全部文件。

| 切片 | 主要位置 | 可交付结果 |
| --- | --- | --- |
| 1：领域和存储 | 新 `apps/paper-agent/backend/paper_agent/research_program.py`、`research_candidates.py`、`research_rounds.py`；`store.py` 只接分区存储 | protocol/candidate/round/checkpoint、额度与停止纯函数；能保存和恢复固定 fixture |
| 2：工具和来源 | 新 `research_program_commands.py`；现有 `literature.py`、`http.py`、`library_files.py`、`app.json` | 搜索/发现 Agent 入口、候选筛选、获准获取、冻结 Study；旧单次问答回归通过 |
| 3：真实研究启动 | `protocol/` 对应 TypeSpec、`crates/pero-host/src/apps.rs` 组合处及新研究绑定概念；共享 App Use 适配；`apps/session_plugins.rs` 装配 | 用户发送计划后绑定真实会话，累计预算和模式化工具准入，声明 Skill 实际挂载 |
| 4：自动推进 | `harness/go/cmd/pero-agent-acp/` 的研究组合；现有 `harness` 的 TurnStopping 信号；新 `paper-autoresearch` Skill | 同一回合至少三轮，提前结束会得到有界反馈；预算/取消不会被反馈绕过 |
| 5：产物交付 | 新 `research_exports.py`、Host `research_delivery.rs`；现有 `session_artifact.rs`、`session_artifacts.rs`、`artifacts.rs`、共享 `app-write-routes.ts` | 四种文档、稳定 slot/版本、可信来源键、回执丢失对账、恢复/跨会话关联 |
| 6：产品与验收 | `apps/paper-agent/ui-src/` 的计划/进度/候选视图、研究记录与资源 catalog；共享 Chat 只加导航；fitness 文档与真实旅程 | 从 Reader 启动到产物回原文的完整体验；明暗/窄窗/键盘/失败恢复；真实来源+provider 验收 |

切片 2/3 的接口应先一起审阅；实现可以用 feature flag 逐步合并。只有切片 1–6 的组合旅程完成才关闭 #143。不要把“Skill 已存在”“搜索能调用”“产物能预览”分别当作自主研究已交付。

新功能默认关闭直到组合验收完成。启用失败保留用户输入；普通 Paper 问答和手工 Discover 保持可用。升级只添加可选关联与新分区，旧 Study/产物不需要重写；关闭功能保留已生成数据可读。

**12. 验收矩阵**

| 层次 | 测试输入/动作 | 必须观察到的结果 |
| --- | --- | --- |
| 领域 | A→B→C→A、同 DOI 多入口、标题歧义、缺全文、反证 | 去重但保存发现路径；多解不猜；反证改变下一轮实际 query 或阅读目标 |
| 引用 | 跨三个冻结 Study 综合、版本替换、摘要混入、伪造 passage | 综合可追溯；非法引用拒绝；摘要和来源缺失不升级为全文观察 |
| 存储 | 落库失败、201 个候选分页、重复 operation、旧 checkpoint | 不谎报提交、不静默丢数据、不重复动作；候选分页不触发全局 200 条目录限制 |
| 预算 | 旧 prepare 路径、新 Study、新 session、重试、压缩 | 总量不重置，未批准获取被拒绝；所有真实 HTTP attempts 计数 |
| Harness | 模型第一轮后直接回答、重复提前结束、provider 报错 | 在允许条件内继续；反馈有上限；失败/取消/耗尽时不偷偷再发请求 |
| 产物 | 连续三轮、重复 publish、丢回执、部分 slot 失败 | 有对应版本，重复不增版，失败可补齐，旧版本内容完全不变 |
| 恢复 | Study finalize 后/交付后重启，删除工作区原文件 | 可恢复实际 checkpoint；Host 快照仍可读；没有重复下载/模型请求 |
| 集成 | 真实 Host + Harness + Paper + Viewer；loopback provider | 一次用户启动完成至少三轮，工具参数与已保存证据一致 |
| 真实来源 | 固定公开种子，实际 provider，有限预算 | 真正获取并读取新来源；保存查询、原文版本、失败、费用/用量与下一步理由 |
| 产品 | Reader→启动→暂停→恢复→产物→引文 | 真实 Desktop 可完成；完整 Loading/Empty/Running/Paused/Waiting/Error/Stopped 状态 |
| 回归 | 普通问答、显式续研、手动导入、旧历史、普通产物 | 不进入自动模式；权限、引用和原有交互保持正确 |
| 研究质量 | 独立逐条核查 fixture 和真实产物 | fixture 已知陈述全部匹配；真实报告记录复核总数/支持数/不支持数及遗漏反证，发现无支持陈述须修正 |

候选分页测试使用更大的获准测试协议；它不要求把 201 篇原件都下载到仍有 200 条限制的现有论文库。对原库容量另测明确停止和可恢复交付。

优先扩展已有 concept tests、loopback 接线和 `tests/runtime/session-artifacts.mjs`；增加一次贯穿的自主研究旅程。Go/Rust/Python 在各自所属模块运行适用测试，协议生成后跑 `npm run check` 和实际 Host contract。真实 Desktop 必须查看截图和交互，fixture 不能替代真实模型或科研复核。

验收材料固定源码 revision、平台、模型和设置、公开种子版本、轨迹与成本、产物 ID/版本/digest、停止原因、截图和剩余缺口。测试通过仅说明对应层次；读了多篇论文、产生更多文件和得到模型自评分，都不是科学结论被接受的依据。

**13. 与 AutoResearch、实验和长期学习的衔接**

本阶段的“学习”是更新有来源的理解、反证和下一步，不修改模型权重。下一轮由上一轮证据决定；研究产物是可复查、可继续的结果。Karpathy 风格的借鉴点是固定边界、执行—评价—反馈、保存结果和持续迭代。

自然语言研究没有一个天然等价于实验损失函数的统一分数，因此保留多个可核查的判断：来源是否真实、引文是否支持陈述、条件是否明确、反证是否处理、研究动作是否有依据。

第二阶段发现可检验假设后，生成“实验提案”产物，包含来源、假设、输入、现有方法、环境、指标/checker、预算和未具备条件。用户批准后才交给现有 Control Lab/PC-Gym 等执行 owner；结果与独立检查回执回到 Program，驱动下一轮文献调查。数值一致性仍不等于复现论文结论。

定期追踪由已有 Automation 产生增量触发。系统先检测来源修订并展示差异，在持续有效的授权和新增预算内开展新轮次；过期时请求继续。无需让 Paper 自己常驻轮询。App/Skill 自我演化仍属于 #138，全天候远程运行属于已有执行架构的单独能力建设。

**可核对的上游来源**

- [Issue #143](https://github.com/phodal/pero/issues/143)
- [产物验证与范围](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/docs/fitness/session-artifacts.md)
- [产物领域类型](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/crates/pero-contracts/src/session_artifact.rs)、[产物 Store](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/crates/pero-runtime/src/session_artifacts.rs)、[Agent 交付适配](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/desktop/src/main/artifact-delivery.ts)
- [关系发现](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/apps/paper-agent/backend/paper_agent/discovery.py)、[文献客户端](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/apps/paper-agent/backend/paper_agent/literature.py)、[现有 App 工具](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/apps/paper-agent/app.json)
- [冻结 Study](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/apps/paper-agent/backend/paper_agent/studies.py)、[研究记录](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/apps/paper-agent/backend/paper_agent/research_records.py)、[Paper Store](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/apps/paper-agent/backend/paper_agent/store.py)
- [App 插件 ADR](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/docs/adr/0027-app-agent-plugins.md)、[现有 Host handoff 模式](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/desktop/src/main/app-write-routes.ts)
- [Harness 停止信号](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/harness/go/harness/agent.go)、[循环注入位置](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/harness/go/harness/loop.go)、[请求审计](https://github.com/phodal/pero/blob/6bdb05ed02d30f187e406ee6bb9930cf7a4860cb/harness/go/cmd/pero-agent-acp/attempt_audit.go)


## 缺口修复 — 2026-11-07

- **等待不等于无进展。** Paper 的可信 feedback 返回 pendingJob，Harness 在同一 TurnStopping 内按任务状态有界观察；等待不发送模型请求、不增加续研计数。后台 worker、原始 deadline 与取消信号继续约束等待。任务就绪后仍由原 Agent 选择下一步。
- **共用研究记录。** commit-round 在领域准入后经现有 record_command 创建不可变 ResearchRecord；round/program 保留 researchRecordIds。每个 revision 至多 32 篇论文、64 条证据，分片沿同一 parentId 链保存。后续轮次记录本轮证据，不复制全历史。未发表的提交冻结时间，丢失回包或写入中断后的同操作重试不会增版。
- **来源类型保真。** PDF EvidenceLink 保持旧序列化与 hash；HTML link 显式 sourceKind=html，经 SourceEvidenceReport owner 核对原件与实际 observation，再关联对应 paper。解释保留 needs_review/not_run。
- **真正加载 Skill。** App 随包交付 agent-plugins/paper-autoresearch；Host 的既有依赖装配读取 SKILL.md，并保留插件 revision。专用四工具和冻结计划由 Host 绑定。普通阅读会话不因 Skill 文字获得自主研究授权。
- **拒绝前无记录副作用。** 独立审查复现了“轮数超限仍先写 revision”，现先运行 complete_round，再写记录。测试覆盖额度拒绝、错误来源、操作重放和两处中断恢复。

真实 provider、模型与独立科学质量评测分开报告。用户于 2026-11-07 选择先完成离线及受控端到端验收，真实模型验收继续列为待验证。


Windows 后台论文获取复现了 console Python 子进程未进入执行入口的问题；正式获取边界通过 multiprocessing 公共 spawn API 使用同一环境的 pythonw.exe，保持原 Pipe、有限时长、取消与虚拟环境。受控检索下载—暂停—Host 重启—同 ACP 恢复已通过，无测试进程补丁。

实际 Desktop/Scientific Viewer 验收还补上了研究产物 provenance 的目录准入分支。需同时构建 Host、完整工作台 WASM、Paper 与 Scientific Viewer，避免旧工作台仅识别 text/file 产物。现已通过原会话重开、版本 4→3→2、键盘预览及暗色窄窗口验证。
