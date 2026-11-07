# EvoScientist：持续自主研究与多角色协作

核查日期：2026-11-07。本次直接读取官方 main README 和 rubric 指南，未安装、未运行真实科研任务。本文把官方功能说明、产品判断与待实测问题分开；榜单、演示和论文获奖不作为通用科学质量保证。

## 1. 定位、目标用户与竞争关系

EvoScientist 希望成为持续陪伴研究者的自主科研伙伴，强调 human-on-the-loop：人规定方向、监督关键结果，agent 自己计划、搜索、写代码、调试、分析和写作。它面向愿意使用 CLI 或 WebUI、希望降低研究过程切换成本的研究者。与 Pero 的重叠主要在自主研究、多 agent、持续任务与结果检查；其主叙事不是科学文件浏览器或领域 App 桌面，而是有记忆、技能和执行能力的研究系统。[S1]

“self-evolving”在产品中有具体实现线索：每轮提炼观察、跨会话连接知识、从重复模式提议新技能。但是知识条目累积和技能生成不等于能力单调提高；错误经验也可能进入后续决策，必须看来源、修订和负面迁移控制。

项目身份以官方 `EvoScientist/EvoScientist` 仓库为准。README 的论文引文将 arXiv:2603.08127 标为《EvoScientist: Towards Multi-Agent Evolving AI Scientists for End-to-End Scientific Discovery》，作者包括 Yougang Lyu、Xi Zhang 等；README 也注明 Xiaoyi DeepResearch 团队及开源社区参与贡献。贡献关系不等于项目由单一企业拥有，也不能将企业其他产品能力计入本项目。该报告关联由官方仓库自身提供，本次不推断额外机构所有权。[S1]

## 2. 核心功能与具体工作流

官方列出 plan、research、code、debug、analyze、write 六类 subagent；科研流程为 intake → plan → execute → evaluate → write → verify。多模型、MCP 和技能作为扩展层，可按任务选择工具、调整上下文，并通过 More Effort 迭代代码。EvoSkills 是可移植技能库，不宜把其全部能力当作 EvoScientist 独有壁垒。[S1]

一个具体起点是“复现某论文表 2 并给出消融图”：用户指定输入和 workspace；规划角色分解需求，研究角色寻找依据，代码和调试角色执行，分析角色检查指标，写作角色组织结果。用户可加 `--rubric @criteria.md`，要求每个 baseline 有对应结果行、图存在、结论说明局限。若 agent 停止后验收不满足，可收到反馈继续做。这比仅要求最终写一份漂亮报告更可操作，但若 rubric 只检查文件存在，也可能得到形式合格、科学错误的结果。

CLI 单次 rubric 的具体边界很重要：每次 run 最多 3 轮评分；grader 使用辅助模型，否则主模型，能读取会话和 workspace 文件，**不能执行命令**。所以“测试通过”依据已有运行记录判断，并不是 grader 自己复跑测试。退出码 0 表示最终评分 satisfied，3 表示未取得满意判定，1 表示 run 本身失败。[S2]

交互式 `/rubric set` 或 `/rubric next` 可对线程后续任务或下一次任务生效；`/goal` 可帮助草拟标准。后台任务有延迟评分规则，但不同入口并非同等覆盖：指南明确普通 WebUI、EvoSci serve、未标记 run 或部分 gateway 路径不进行同一 rubric 评分。在某客户端审批暂停、换客户端继续时，也可能绕开原评分收尾。因此不能笼统写成“所有渠道自动验收”。定时任务的可选 checklist 有另外的 reviewer 与重跑描述，不能混同 CLI 三轮逻辑。[S1][S2]

持续运行方面，它支持 cron 式排程、跨会话记忆和消息渠道。AutoSkills 从观察聚类提议可复用方法，提交用户审查；这为研究方法积累提供入口，但仍要确认提议是否经过真实任务回归测试、是否保留原数据条件。

## 3. 架构、部署和交付形态

官方以 DeepAgents 为底层 harness，存在 LangGraph 服务与 WebUI。CLI/TUI、浏览器和消息渠道共享研究能力；近期交付 Windows 桌面应用。Python 安装要求 3.11 至低于 3.14；一键安装器使用隔离的工具目录和 uv 管理 Python，按需准备 Node、WebUI 及 Windows Git Bash，不是直接替换系统 Python。当前 macOS 一键分发注明 Apple Silicon。[S1]

可使用 Docker，但研究用 Python 环境不完全内置在镜像中，需要 setup；挂载卷同时决定持久化与访问边界。当前多个项目共用一个后台服务，这改善启动和持续任务体验，也引入明确环境语义：服务保留启动它的 shell 环境，后续项目的变量不会自动更新进去。README 特别提醒，一个项目启动时带的 conda、direnv 或 AWS_PROFILE 可影响其他项目的 shell 与 MCP 变量。项目级记忆/会话隔离不等于 OS 进程环境完全隔离。

最新 README 记录 v0.4.2（2026-11-06），强调丢失跟踪的后台进程会报告、移除项目会停止服务端工作、失败命令正确显示失败。此类修复说明工程团队正在处理日用可靠性；不能反过来宣称所有恢复、取消和跨客户端边界都已验证。

## 4. 安全和数据边界

默认 shell execute 需要人工批准，主 agent 与同步/异步子 agent 共享审批策略；也有 allowlist、自动批准与危险模式。危险模式解除 workspace 文件边界并隐含无提示自动批准，虽然保留部分高危命令阻断，但不能据此认为它适合不受信任材料。科研文档、外部网页、技能和 MCP 均可能影响 agent 的执行计划，应分别控制信任。[S1]

本地部署意味着可以控制文件和进程，不代表模型输入不离开本机。启用外部模型、搜索、MCP、消息渠道时，问题、文件片段、工具结果可能进入对应提供商；本次未得到统一的全链路保留政策或零遥测保证。消息渠道把研究任务扩展到手机和团队沟通，也扩大授权与误触发面。Docker 可约束 shell 到挂载卷，但挂载真实 home、凭据目录或过宽数据卷会扩大实际风险。

记忆与技能演化应设置独立检查：陈旧结果如何被 supersede，模型产生的推断是否标成观察事实，自动技能是否把某个任务的错误概括扩散到别的任务。官方描述知识图谱的 complements/contradicts/supersedes 关系，是可研究机制，而不是错误不会传播的证明。

## 5. 成熟度、许可与商业边界

本次直接读取 LICENSE 全文，确认为 Apache-2.0，版权声明为 Copyright 2026 EvoScientist（blob SHA `626d2955c7242e9ed293e7d839d93d45471ef9be`）。分发须遵守许可副本、修改标记、归属及适用 NOTICE 条件；专利授权有诉讼终止条款，不授予商标权。主项目配有技术报告、版本更新、安装器和多端交付，显示出超越一次性论文 demo 的工程投入。仍需分别评估 Python 主程序、独立 WebUI/桌面、技能与第三方服务版本，不能把最新 main 一概当成已安装发行版。

官方列出的 DeepResearch、AstaBench 等第一名带有 at submission time；不能写成核查当天榜首。2025 年论文接受/获奖和具体榜单成绩证明特定实验或评审情境下有成果，不保证另一研究领域、另一模型或预算得到相同结论。未核实商业订阅、企业 SLA、营收与客户；开源许可也不免除模型和计算费用。[S1]

## 6. 优势、限制与对 Pero 的启发

优势在于把研究角色、持续服务、跨会话经验、渠道和可选结果评分连接起来，研究者能够从目标而不是工具列表开始。限制是能力依赖模型、上下文和工具环境；更多角色可能增加成本、相互重复和错误放大。其 grader 读现有材料而不复跑，适合作为交付检查，不足以独立证明复现成功。

Pero 以 master `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b` 为基线：Paper 原文/锚点/连续研究、Data 不可变数据版本与检查、分布式 Host、固定方法验收已存在。仍为 development preview，跨 App 完整闭环与真实模型科学质量未证明；Compute App 只是连接草稿，但底层单节点 Slurm owner 已单独验收。不能把旧 planned 当当前缺失。

由此，Pero 不应宣传“只有我们做验收”或“对方只有自主聊天”。更有区分力的比较是：EvoScientist 的语言 checklist 与 reviewer 判定，和 Pero 固定方法、输入版本及 Host 执行契约分别能阻止哪些错误？可借鉴 `/goal` 对目标的具体化、退出码区分和未跟踪进程的诚实报告；Pero 应将已有确定性方法检查与开放式解释审阅分层，而不是用单个模型判定替代可复算指标。

## 7. 待验证问题和同题测试

1. 同一任务分别由 CLI、WebUI、定时运行发起，评分和审批是否一致，哪些入口会跳过？
2. 注入“文件存在但数据错误”的结果，grader 能否识别，是否检查统计定义和来源？
3. 两个项目配置不同环境、凭据和 MCP 时，服务共享是否导致意外数据或身份混用？
4. 取消、重启和丢失进程跟踪后，是否重复运行或产生重复费用？
5. 对同一真实领域任务连续迭代，记忆/AutoSkills 相对无记忆基线是否提高正确率，还是只提高表面完成率？

建议与 Pero 在同模型、预算、原始输入下比较可用结果率、人工纠错分钟数、总费用、错误完成率，不把 agent 数量当优势分数。

## 8. 官方来源

- [S1 README：功能、安装、审批、排程与版本记录](https://github.com/EvoScientist/EvoScientist/blob/main/README.md)，本次直接读取，blob SHA `5af864ef833da775b065914c381c9130a1b23da1`（文件标识，不是仓库 commit）。
- [S2 rubric 指南：评分、退出码和渠道边界](https://github.com/EvoScientist/EvoScientist/blob/main/docs/guides/rubric.md)，本次直接读取，blob SHA `2e809c80aacc0e88354ce04116d88527bf0956f4`。
- [v0.4.2 发布](https://github.com/EvoScientist/EvoScientist/releases/tag/v0.4.2)，日期和变更依据官方 README，未逐项验证安装包。
- [技术报告](https://arxiv.org/abs/2603.08127)、[EvoSkills](https://github.com/EvoScientist/EvoSkills)、[LICENSE](https://github.com/EvoScientist/EvoScientist/blob/main/LICENSE)，均为官方 README 链接；本次未重跑论文评测、未审计技能全集。


### Pero 固定版本证据（补充核查）

以下链接均固定到比较基线 commit，而非移动的 master；本次读取的是仓库内记录，没有重跑这些验收：

- [Paper 实现与边界](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/paper-agent/README.md)：原文/PDF 版本、精确片段与页面锚点、冻结输入、连续追问均有具体说明；既有回答仅作意图上下文，不能转成支持证据。
- [Data Workspace fitness](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/data-workspace.md)：不可变输入版本、SHA-256、saved view 与完整输入检查，以及 2026-11-05 macOS Electron 的 v1/v2 历史、原始字节和重启记录；数值解释、错误定位亦有后续验收。其导入/检查有 10MiB 边界，不能延伸为大型数据流处理或科学结论验收。
- [Host 与 preview 状态](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/README.md)：任务派发、租约、取消和恢复已有实现；真实 Linux provider 验收与稳定发行仍有明确限制。不能用这份摘要中其他 planned 标签覆盖后续具体 fitness 证据。
- [固定 Fisher 方法验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md)：绑定真实 PDF、人工复核的 100 个观测、冻结容差与独立 Fraction checker，记录精确结果 19.1434 cm² 和 REPRODUCED；这是一条固定数值复算，不是自动理解全文、真实模型科研或完整跨 App 闭环证明。
- [环境与 Slurm owner fitness](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/ai4s-environments.md)：须阅读后半部“2026-11-06: live local, Docker, Compose and Slurm owner evidence”。Slurm 23.11.4 单节点 fixture 分别记录真实提交、allocation 侧 payload 哈希、输出/终态和运行中取消，属于这些 adapter 的 L2，而非生产调度器、accounting fallback、全部 App/Native/release 验收。该文件也明确记录历史检查的版本和后续未重跑部分。
- [Compute App README](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/compute/README.md)：App 仅保存连接草稿，不发 SSH 请求，jobs 为 null；不能把上项底层 owner 验收算成此 UI 已连接 Slurm。

[返回竞品索引](../README.md)
