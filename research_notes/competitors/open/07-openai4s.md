# OpenAI4S：执行账本与持久科学计算运行时

核查日期：2026-11-07。研究对象为 PKU-YuanGroup/OpenAI4S，不是 OpenAI 官方产品。本文刷新了官方 main README、安全及计算文档；未安装、未调用真实模型、未进行任务对照。下文“支持”指官方公开实现描述，不代表本次独立验收。主线与已发布 v0.3.1 必须分开理解。

## 1. 定位、用户与竞争关系

OpenAI4S 由北京大学—元空 AI 联合实验室推出，定位为混合式科学研究 agent：JSON 工具负责编排与权限，Python/R 持久内核负责计算。它面向需要检查计算过程、保留分析状态、恢复研究会话、使用自己的模型和算力的科研人员及研发团队。与 Pero 的竞争不仅是聊天入口，而是工作台、科学执行运行时、研究产物与任务完成判定；其领域工具也可能成为集成参考。

官方以低价模型套餐强调使用成本，但模型套餐不是整套科研任务的总成本；远端 GPU、数据服务、失败重试和人工核查仍需计入。“Claude-Science-class”等营销措辞没有在本次研究中得到同模型、同预算、同任务独立证实。

## 2. 核心功能与具体工作流

其核心是控制面与科学面的分离：原生 JSON Tool 处理有 schema 的动作、审批、服务和元数据；Python/R cell 执行数据清理、分析、模拟和长期计算。大型对象可留在 kernel，避免把整个数据表反复塞进模型上下文。Python 可通过内核中的 host API 同步调用宿主能力；R 是独立持久通道，不能简单假定拥有完全相同的完成信号。[S1]

一个有代表性的工作流是：导入数据或查询 UniProt/PDB 等来源，检查来源和时间；agent 提出分析计划，按权限执行 cell；生成图、表和指标并保存有版本产物；在 notebook 与 Action Timeline 中检查过程；导出 Markdown、ipynb 或可携带会话。Notebook 默认只读，直接输入 Python/R 要显式开发者开关，因此不能等同于任意交互式 notebook IDE。

执行记录不是只存聊天摘要。官方描述 append-only Action Ledger、动作组、尝试、生命周期、用量及终止事实；产物具有版本和 lineage，环境 provenance 绑定实际 kernel generation。科学 cell 用 `host.submit_output(...)` 提交结构化产物和指标；Engine 也有 `finalize_response`，所以“发了一段最终回复”与“科学计算提交有效结果”是不同路径。

恢复功能包含 branch fork/activate/revert、检查点和 Partial/Failed 状态。官方明确不序列化所有任意内存对象，只有安全 recipe 能重建并验证时才算恢复；缺少可信 checkpoint mapping 的旧历史不能假定可 fork。可携带 Session 或只读分享因此不是无条件恢复整个现场。

远端任务采用 stage → run → harvest：SSH 或 BYOC provider 提交，查询结果推动状态和产物回收。**文档明确没有自动后台 poller，没人调用 result 就不会自动 harvest。** 输出声明是契约：即使退出码 0，只要必需输出缺失或不能验证，也不能算成功；清单记录路径、大小和 SHA-256，并将无法确认的结果保留为 unknown，而不是乐观完成。未知状态需要先对账，盲重试可能重复执行。[S3]

同一文件后半补充了持久化和失败语义，仍是文档描述，不是本次运行结果。任务行在提交尝试之前写入 SQLite；重启后可以继续 poll、harvest 和 cancel 仍在进行的任务，但不会自动重交。同一 `idempotency_key` 的第二次提交会被拒绝为 `duplicate_request`，这把钥匙在重启后还在；没有钥匙时，对 `unknown` 盲重试仍可能重复执行。`ssh:*` 的 cancel 先向进程组发信号，再升级到 SIGKILL，并确认进程组已经消失。约 100MB 以上的文件，以及声明远端驻留的输出，留在集群上并记入 `left_on_remote_files`。BYOC 容器寿命和单次 `timeout_seconds` 是两只钟，温容器会继承已经消耗的时间；宿主没有 `timeout` 或 `gtimeout` 时拒绝提交。[S3]

计算 helper 的隔离是文件系统边界：替换 `$HOME`，写入限制在 stage 目录，macOS 还拒绝 keychain。`network_isolated` 为 false，网络隔离没有启用。`OPENAI4S_COMPUTE_CONFINEMENT` 的 `auto` 能隔离就隔离并报告降级，`enforce` 在无法建立边界时拒绝，`off` 明确跳过；文档写明 `auto` 不再等同于 `off`。`host.compute` 仍标 Prototype，理由是还没有被点名为生产级的具体云 GPU provider，而不是 helper 的文件边界完全没写。`host.fold` 和 `host.score_mutations` 是另一类经 SSH 的专用服务：没有配置宿主时拒绝并报错，不编造结构或分数；结构检查不证明预测准确，失败也不会自动重跑。`REMOTE_GPU_PROVISIONER` 要先在远端安装并验证，才登记能力。[S3]

## 3. 架构、部署与运维

核心 engine 与 HTTP/WebSocket 服务官方称使用 Python 标准库，科学库是另外的依赖层；“核心零依赖”不等于科学环境零依赖。当前工作台已经使用 Preact/TypeScript，不能机械沿用旧版 framework-free UI 描述。安装路径包括 PyPI、源码、Linux x86_64 包、Windows/WSL2 包和 linux/amd64 容器。v0.3.1 没有正式 macOS DMG，macOS 使用 PyPI/源码；原生 Windows 内核不受支持，不能将 WSL2 支持写成原生支持。[S1]

SSH 与 NVIDIA NIM 是具体的现有远端路径；一般 remote compute 仍标 Prototype，理由见上一节，不表示文件边界不存在，也不表示网络默认隔离。计算文档把 Slurm、Kubernetes、Modal provider 标为未来能力。**支持把服务部署到 Kubernetes，不代表已实现 Kubernetes 任务计算 provider。** 类似地，模型 endpoint registry 存在也不代表 scoped inference kernel 已接通。[S3]

当前 README 的技能数为 612，而 v0.3.1 新闻写 611，npm 0.2.0 写 603；这是不同交付快照，不能混成同一版本能力。技能主要是可迁移的代码 recipe，不等于相关科学软件、权重、GPU 或外部授权已经就绪。

## 4. 安全、数据和信任边界

官方安全文档比普通“本地优先”口号具体：macOS Seatbelt、Linux bubblewrap；默认 auto 自检成功时隔离，失败时可显著提示降级；enforce 才是失败即停止。team-mode local cell 对相关隔离要求更严格。普通内核边界限制文件写入、默认阻止原始网络，宿主 Web/MCP 经审计 RPC 访问；但 local compute/jobs 是另一类特权操作，不能据内核沙箱推断它也安全隔离。[S2]

文档也明确，这不构成恶意同 UID 用户之间完整隔离。需要互不信任多用户时，应使用不同 OS 用户、容器/VM 等资源层边界。容器中的 bubblewrap 可能因 namespace 条件不足而降级，此时实际边界是容器本身。

本地 daemon 即使 loopback 也强制 access token；只读分享经用户自建 relay，发布的是扫描秘密后的快照，不是把执行 API 暴露出去。分享包不含全部记忆、权限和检查点，导入先隔离只读。遥测官方称默认关闭且可撤销；本地运行不意味着模型调用没有数据外发。实验性 TypeSafe 语义判断默认关闭，启用会按能力发送请求、论文片段或数据行等到美国服务，不能与离线模式混淆。[S1][S2]

## 5. 成熟度、许可与商业边界

公开版本为 v0.3.1，新闻日期 2026-10-18；MIT 主代码允许较宽的复用，但依赖、模型与数据许可仍应单独核查。已具备安装渠道、诊断、迁移、发布产物验证与运维文档，可视为有实质工程化投入的早期平台，不能由版本号或 stars 推断生产成熟。

官方主线写有 13 个 workflow/46 个 case 的执行测试；开发测试注明 LLM mocked，公开可比结果仍待发布。因此这些证据有助于判断状态机、失败和 provenance 契约，不证明能自动做对开放式科研。升级涉及数据库 schema，回退不能随意进行，需先备份。未核实企业 SLA、收费、营收或实际付费用户。

## 6. 优势、限制与 Pero 比较

优势是把“执行过”“提交完成”“产物已回收”“环境可识别”拆开建模，并将恢复失败诚实暴露。对于长任务和科研证据，这比单纯加更多工具更有价值。限制是远端 provider 广度仍有限、真实科学有效性未证明、跨平台完整度不一致，且运行时复杂度转化成运维负担。

Pero 比较固定在 master `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b`：Paper 已有原文、锚点与连续研究，Data 已有不可变版本与检查，分布式 Host 与固定方法验收已存在；不能再依据旧 README planned 判成缺失。Pero 仍是 development preview，跨 App 完整闭环与真实模型科学质量未证明；Compute App 是连接草稿，但底层单节点 Slurm owner 已单独验收。

因此，不宜把版本化或验收作为 Pero 的独占卖点。真正可比较的是：同一固定输入经某个科学 App 发到指定 Host 后，是否有可核对的输入、方法、环境、输出和拒绝理由。可借鉴 OpenAI4S 的 unknown 状态、输出哈希契约、恢复 Partial 和 provider 状态分层；Pero 的已验收 Slurm owner 则应与对方实际 SSH/NIM 路径对照，而非拿双方路线图比较。

## 7. 待验证问题与建议实测

1. 文档写明重启不自动重交，相同 idempotency key 的重复提交会被拒绝，unknown 需要先对账。断网、daemon 重启和远端取消后，实现是否遵守这些规则，仍未运行验证。
2. 有状态 Python/R 分析的恢复覆盖哪些对象，如何显示不可恢复部分？
3. 声明输出缺失、部分传输、环境漂移时，能否阻止错误完成？
4. 固定真实模型、同预算对照 Pero 的已验收方法，记录人工修补、结果正确率和总成本。
5. 每个平台实测 sandbox auto 降级与 enforce 拒绝；不能从文档推断所有安装包都达到相同边界。

## 8. 官方来源与证据范围

- [S1 README：定位、功能、版本、分发与路线图](https://github.com/PKU-YuanGroup/OpenAI4S/blob/main/README.md)，本次读取；文件 blob SHA `7947c647bc4e61633bb73c81256440b196e95853`，不是仓库 commit。
- [S2 Security：沙箱、凭据、外发与分享边界](https://github.com/PKU-YuanGroup/OpenAI4S/blob/main/docs/security.md)，本次读取。
- [S3 Remote GPU compute：provider、状态、持久化、隔离与专用折叠/突变服务](https://github.com/PKU-YuanGroup/OpenAI4S/blob/main/docs/compute.md)，2026-11-07 已读全文 184 行。blob SHA `0958a812c8e9e1e140b149c5782148c57d4cbea6`，是检索当时的 main 文件，不是仓库 commit，也不是 v0.3.1 发行包。
- [v0.3.1 发布页](https://github.com/PKU-YuanGroup/OpenAI4S/releases/tag/v0.3.1)，官方 README 指向；版本日期依据 README，不声称本次逐项检查全部 release asset。
- [MIT 许可文件](https://github.com/PKU-YuanGroup/OpenAI4S/blob/main/LICENSE)，本次已读取全文，确认为 MIT，Copyright (c) 2026 openai4s contributors；要求保留版权及许可通知，软件按现状提供。LICENSE blob SHA `5ccbc162b2971bf6f5b857218601da2eaa766fb2`。依赖与数据仍需另核。


### Pero 固定版本证据（补充核查）

以下链接均固定到比较基线 commit，而非移动的 master；本次读取的是仓库内记录，没有重跑这些验收：

- [Paper 实现与边界](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/paper-agent/README.md)：原文/PDF 版本、精确片段与页面锚点、冻结输入、连续追问均有具体说明；既有回答仅作意图上下文，不能转成支持证据。
- [Data Workspace fitness](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/data-workspace.md)：不可变输入版本、SHA-256、saved view 与完整输入检查，以及 2026-11-05 macOS Electron 的 v1/v2 历史、原始字节和重启记录；数值解释、错误定位亦有后续验收。其导入/检查有 10MiB 边界，不能延伸为大型数据流处理或科学结论验收。
- [Host 与 preview 状态](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/README.md)：任务派发、租约、取消和恢复已有实现；真实 Linux provider 验收与稳定发行仍有明确限制。不能用这份摘要中其他 planned 标签覆盖后续具体 fitness 证据。
- [固定 Fisher 方法验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md)：绑定真实 PDF、人工复核的 100 个观测、冻结容差与独立 Fraction checker，记录精确结果 19.1434 cm² 和 REPRODUCED；这是一条固定数值复算，不是自动理解全文、真实模型科研或完整跨 App 闭环证明。
- [环境与 Slurm owner fitness](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/ai4s-environments.md)：须阅读后半部“2026-11-06: live local, Docker, Compose and Slurm owner evidence”。Slurm 23.11.4 单节点 fixture 分别记录真实提交、allocation 侧 payload 哈希、输出/终态和运行中取消，属于这些 adapter 的 L2，而非生产调度器、accounting fallback、全部 App/Native/release 验收。该文件也明确记录历史检查的版本和后续未重跑部分。
- [Compute App README](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/compute/README.md)：App 仅保存连接草稿，不发 SSH 请求，jobs 为 null；不能把上项底层 owner 验收算成此 UI 已连接 Slurm。

[返回竞品索引](../README.md)
