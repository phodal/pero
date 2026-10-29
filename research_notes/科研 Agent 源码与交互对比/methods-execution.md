# 科研方法复用 实验与持久执行

调研日期：2026-10-29。本笔记基于实际浅克隆文件及官方材料；没有安装依赖、执行上游脚本、调用模型、运行实验或验证上游 UI。Pero 对照基线 HEAD `393bea7972bc765d2f831636bb460320378fac80`，同时读取了有并行改动的实际文件；App Use 的并行改动不是本轮交付。

## 哪些实现已经克隆 源码究竟覆盖什么

### Takeaway

Paper2Agent 是技能与验证脚本，AI Scientist-v2 是实验执行系统并包含 HTML 实验树；Kosmos 官方公开的克隆对象是实验图表与分析产物，而不是其持久 Agent 平台源码。

### Cited Findings

| 项目 | 本机目录 | origin | 完整 SHA 与提交时间 | 实际 LICENSE |
| --- | --- | --- | --- | --- |
| Paper2Agent | `/Users/phodal/test/paper-agent-research/Paper2Agent` | `https://github.com/jmiao24/Paper2Agent.git` | `8c2d059165ef8cdcb70dbea76655b9c2b55b38e6` · 2026-09-17T09:56:07-07:00 | MIT，Copyright 2025 Jiacheng Miao |
| AI Scientist-v2 | `/Users/phodal/test/paper-agent-research/AI-Scientist-v2` | `https://github.com/SakanaAI/AI-Scientist-v2.git` | `96bd51617cfdbb494a9fc283af00fe090edfae48` · 2025-12-19T08:46:31+01:00 | The AI Scientist Source Code License v1.0，December 2025；基于 Responsible AI Source Code License v1.1，不应写成 MIT |
| Kosmos 官方分析产物 | `/Users/phodal/test/paper-agent-research/kosmos-figures` | `https://github.com/EdisonScientific/kosmos-figures.git` | `819447258cb53782fb3b7ddd63be8d65acf8f078` · 2025-11-03T15:32:34Z | 在本次克隆树未找到 LICENSE/license 文件，复用许可未确认 |

以上 SHA、时间、origin 从每个本机 clone 的 `git log -1`、`git remote get-url origin` 读取。许可原文与仓库身份依据：[Paper2Agent LICENSE](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/LICENSE#L1-L21)、[AI Scientist LICENSE](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/LICENSE#L1-L53)、[Kosmos artifacts README](https://github.com/EdisonScientific/kosmos-figures/blob/819447258cb53782fb3b7ddd63be8d65acf8f078/README.md)。Paper2Agent 官方论文直接指向 jmiao24 仓库：[Nature Code availability](https://doi.org/10.1038/s41586-026-11044-y)；AI Scientist 作者论文直接指向 SakanaAI 仓库：[论文](https://arxiv.org/abs/2504.08066)；Edison 官方账号将 kosmos-figures 描述为技术报告图表、验证与可复现分析：[官方 GitHub](https://github.com/EdisonScientific)。

- 【源码观察】Paper2Agent 当前主干是 `skills/paper2agent/` 下协调技能、路由、任务说明和 Python 校验/Notebook 产物脚本，并非一个完整 Web 工作台或自带聊天前端。科学计算要求绑定已有代码，不以生成算法填补上游缺口。[技能工作流与边界](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/SKILL.md#L17-L47)
- 【源码观察】AI Scientist-v2 的当前许可证有使用限制及 AI 论文披露条款；本轮只读取源码，未引入 Pero。这里只报告 LICENSE 内容，不作许可兼容性法律判断。[LICENSE 21–42](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/LICENSE#L21-L42)
- 【源码观察】kosmos-figures 顶层为 Figure 2–8 分组，其中有 `.ipynb`、Python 绘图分析与结果记录；README 明确范围为报告图表和人工验证分析。[README](https://github.com/EdisonScientific/kosmos-figures/blob/819447258cb53782fb3b7ddd63be8d65acf8f078/README.md)

### Inferences

- 可借鉴设计与源文件结构，不应把三个项目当成同类的可嵌入 Agent UI 库。AI Scientist-v2 的许可证尤其需要在真正复制代码前另行评估；本轮建议以独立实现模式为主。
- 未找到 Kosmos 官方平台代码，不代表不存在私有实现；不能拿社区同名 Kosmos 仓库替代官方证据。

### Gaps

- 未运行克隆对象；没有速度、成本、正确率、故障恢复或真实交互可用性的实测。
- Kosmos 的平台前端、调度器及沙箱平台源码本轮未找到官方公开地址；kosmos-figures 未确认复用许可。

## 方法如何从论文代码变成可验证的工具与可视化产物

### Takeaway

Paper2Agent 最值得借鉴的是“先直接运行上游得到参考结果，再做最小包装，最后对最终交付物独立验证”。它同时给出将 Notebook 图片追溯到 cell、output 和文件摘要的实际脚本。

### Cited Findings

- 【源码中的流程契约】六阶段明确为环境与工具选择、直接源码参考运行、包装实现及独立验证、MCP 集成、运行时验证、ZIP 交付。要求新 verifier 与所有 implementer 分开，不能把工具发现成功视为科学结果正确。[Paper2MCP 17–47](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/SKILL.md#L17-L47)
- 【实际脚本】`verify_mcp_server.py` 用 FastMCP Client 启动本地 stdio server，读取工具清单与 schema，按预先保存 cases 调用；检查成功/预期错误、输出子集和 artifact 路径。启动、列举和调用有各自 timeout，输出 report 明确区分 `calls` / `inventory-only`。[实现 102–150](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/scripts/verify_mcp_server.py#L102-L150)、[参数与报告 164–185](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/scripts/verify_mcp_server.py#L164-L185)
- 【明确的验证限制】artifact 存在、JSON 输出匹配不等于矩阵数值、浮点容差或图内容正确；科学比较由独立 tests 承担。缺 GPU/数据/凭据不能因为工具列举成功就标为已验证。[runtime contract 28–50](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/references/runtime-verification.md#L28-L50)
- 【实际图片产物】`extract_notebook_images.py` 从执行 Notebook 的 code cell outputs 中选 PNG/JPEG/SVG，写图片及 `image-manifest.json`。每图保存 `cell_index`、`cell_id`、`output_index`、MIME、SHA-256，manifest 另有原 Notebook SHA-256；不声称覆盖另行保存的绘图文件。[实现 82–134](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/scripts/extract_notebook_images.py#L82-L134)、[范围说明 1–10](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/scripts/extract_notebook_images.py#L1-L10)
- 【记录验证与真实性分开】工作流 JSON 有真实 host agent ID、attempt、角色、独占文件、报告摘要及 tested-files 哈希；校验器只检查记录与文件一致，明示不能认证 Host 身份或外部执行时间，也不能证明科学正确。[state contract 3–34](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/references/workflow-state.md#L3-L34)、[attempts 38–99](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/references/workflow-state.md#L38-L99)
- 【交付契约】验证最终 ZIP 的哈希、异目录解包、干净环境安装、真正工具调用及科学结果；生产文件再变更会使原交付验证失效。这是文档定义的流程，不是本轮完成了某个方法转换。[output delivery 19–35](https://github.com/jmiao24/Paper2Agent/blob/8c2d059165ef8cdcb70dbea76655b9c2b55b38e6/skills/paper2agent/paper2mcp/references/output-delivery.md#L19-L35)

### Inferences

- 【Pero 建议】先命名 `MethodRevision` 与 `ReferenceCheck`：前者固定上游 commit、入口、环境引用、参数与输出契约；后者固定参考数据、预期、容差与真实观察。MCP 适配可以删除，科研方法与验证记录仍保留；不要让 transport 成为科学身份。
- 【Pero 建议】UI 将参考运行、包装运行、新数据运行并列，展示“待执行/执行完成/参考一致/独立验证通过”及其范围。当前只靠 `passed` 文本过于粗；不能把 Agent 的陈述升级为信任结果。
- 【Pero 建议】增加 `ArtifactReference` 值类型，至少关联 Host session/turn 或协调 Run、相对位置、媒体类型、摘要、产生代码/输入版本；Notebook 图可增加 cell/output 定位。证据抽屉同时打开原图、生成代码、数据引用与验证记录。Python 负责解析产物，Host 继续拥有启动、取消和权限。

### Gaps

- Paper2Agent 的流程有很多严格契约，但本轮只查源代码，不证明所有第三方转换都遵循它们。
- 尚未选择实际科研方法、数据或数值 oracle，不能给 Pero 宣称方法复现已通过。

## 实验树 渲染与持久协作能给 Pero 哪些具体启发

### Takeaway

AI Scientist-v2 已有“树节点 → 代码、指标、错误、图、模型反馈”的真实 HTML 交互源码，适合借鉴信息结构。Kosmos 的新版交互是持久协作 Agent 加按需生成进度网站，但这里的证据是官方工程文章，不能等同于公开 UI/平台实现。

### Cited Findings

- 【实际领域数据】AI Scientist `Node` 保存 parent/children、代码/计划、执行异常与时间、metric、图路径、绘图代码/分析、VLM feedback、seed、ablation、hyperparameter 名。`stage_name` 由 parent 与 buggy 状态导出 draft/debug/improve。[journal.py 43–118](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/journal.py#L43-L118)、[158–168](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/journal.py#L158-L168)
- 【实际界面】p5.js 实验树可点节点，右侧更新代码、计划、metric、异常、图、VLM 分析、数据集与用时。metric 用数据集表，图为关联路径的 `<img>`，代码由 highlight.js 渲染。[点击及数据传递 313–345](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/utils/viz_templates/template.js#L313-L345)、[细节与图 477–565](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/utils/viz_templates/template.js#L477-L565)
- 【实际渲染路径】Python 从 journal 边生成 igraph layout，输出树结构；`save_run` 写 journal.json、config.yaml、tree_plot.html。模板加载 CDN p5.js/highlight.js；localhost 下每秒 HEAD 检查文件更新时间并刷新。属于生成的文件报告视图，不能据此称为有带持久会话/权限的完整科研 Web App。[layout](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/utils/tree_export.py#L14-L40)、[save_run 219–245](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/utils/config.py#L219-L245)、[HTML 1–42](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/utils/viz_templates/template.html#L1-L42)
- 【实际边界】stage 迭代数、workers、debug depth、执行 timeout 都有配置；manager 保存 pickle checkpoint（journals、阶段历史、任务、配置与工作目录）。在本次 treesearch 源码搜索未发现配套 checkpoint 加载/恢复入口，因此仅确认“有保存”，不确认进程故障后可续跑。[配置](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/bfts_config.yaml#L17-L76)、[checkpoint 249–272](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/treesearch/agent_manager.py#L249-L272)
- 【实际绘图流程】从实验摘要生成 `auto_plot_aggregator.py`，执行后最多 n_reflections 次按输出反馈修订；最终 figures 是执行产生文件，并非 UI 从回答文字随意猜数绘图。该逻辑会清理原 figures 目录，应借鉴产物关联而非照搬覆盖方式。[perform_plotting 136–249](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/perform_plotting.py#L136-L249)
- 【官方工程描述，非平台源码】2026-05-18 Kosmos 文章说明：现为持久代码 Agent，可对话接收反馈并生成进度网站；执行使用 Kubernetes 容器/VM 沙箱，子 Agent 各有沙箱并共享文件系统，GPU 服务按需使用。没有给出可据此克隆的完整平台实现。本轮只保留这些与交互/执行归属直接相关的陈述。[How We Built Kosmos](https://advances.edisonscientific.com/research/how-we-built-kosmos/)
- 【Pero 当前源码】`ResearchInput` 固定论文、问题、验证计划，但 `.prompt()` 每次生成最终指令；报告 `Experiment` 只有 Agent 报告的文件、commands、expected/observed/status，provenance 明确 `agent-reported`。[model.py](/Users/phodal/workspaces/pero/apps/paper-agent/backend/paper_agent/model.py:148)、[reports.py](/Users/phodal/workspaces/pero/apps/paper-agent/backend/paper_agent/reports.py:83)
- 【Pero 当前源码】React hook 保管 sessionId/status/raw 与轮询结果、终态保存；`openIntent` 清空 sessionId。实验视图展示预期/观察/限制及折叠的命令/代码，没有结构化图、表格数据或实验分支模型。[use-research.ts](/Users/phodal/workspaces/pero/apps/paper-agent/ui-src/use-research.ts:6)、[documents.tsx](/Users/phodal/workspaces/pero/apps/paper-agent/ui-src/documents.tsx:67)
- 【Pero 当前边界】App Python 环境按 per-App override→共享 default 选择；Host 的 App start 创建/复用绑定的 ACP session。ADR 明确当前环境机制不 sandbox Python 文件/网络访问。[python.rs](/Users/phodal/workspaces/pero/crates/pero-runtime/src/apps/python.rs:9)、[app_agent.rs](/Users/phodal/workspaces/pero/crates/pero-host/src/app_agent.rs:65)、[ADR 0007](/Users/phodal/workspaces/pero/docs/adr/0007-local-app-platform.md:62)

### Inferences

- 【P0 建议】先补冻结方法版本/指令和持久 `ResearchSubmission`（intent→session/turn→result 引用）。“恢复查看”从已存记录和 Host 对账，UI 轮询仅订阅；Python 不另起调度器，前端不成为执行权威。这能让进度视图、图表和日志有稳定身份。
- 【P1 建议】产物渲染优先以表格/图片/代码/Notebook 摘要为模块，源数据与生成代码一起可达。报告富文本渲染与执行产物预览分开，图有明确来源、状态和生成版本；不能通过好看的图隐藏尚未验证的数字。
- 【P1 建议】先做平面实验对照表：名称、父实验、配置差异、数据集、metric/单位/方向、耗时、执行状态、验证范围、图表。选中行联动详情。只有已经真实产生分支比较需求时再加树布局；避免为树而造并行执行框架。
- 【P2 建议】借鉴 Kosmos 的持久反馈与按需进度视图：用户反馈成为下一次输入修订，不覆盖已完成产物；进度网站是可查看的候选 artifact。真正生成/打开 HTML 时复用 Pero 现有 App/产物边界，不给任意 HTML 获得 Host bridge。
- 【环境建议】继续使用默认共享 env，特定方法需要版本冲突时声明专用环境。GPU/容器/文件与网络隔离是未来 Host Provider 的具体能力，不能把 venv 写成沙箱，也不应因阅读 Kosmos 大规模设计就立即引入 warm pool、Kubernetes 或分布式文件系统。

### Gaps

- 尚无真实浏览器/桌面运行证据证明 AI Scientist 的生成报告在当前依赖下可正常打开，也未测键盘、暗色、窄屏和错误状态。
- 本轮没有验证 AI Scientist checkpoint 恢复，没有测它对调用预算或取消的完整产品语义。只确认源码可见的迭代/调试/timeout 上界。
- Pero 尚无本轮的真实方法执行和可信 artifact 回执；上述模型/UI 优先级为建议，不是已实现功能。
