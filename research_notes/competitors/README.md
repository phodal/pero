# Pero 竞品研究索引

研究日期：2026-11-07。范围：25 个产品或项目，每个对象一篇独立文档。

本目录用于产品研究、源码阅读和后续实测设计。它不是采购建议、性能榜单或已经完成的产品验收。不同对象覆盖的工作流不同，文献检索、科研 Agent、计算环境、实验数据平台不宜直接排成一个总分。

## 怎么读

1. 先按下表选择与当前问题相近的产品，再读单篇的功能、优势、限制和 Pero 启发。
2. 找可借鉴的实现时，优先读开放代码组；找工作台和机构部署对标时，读商业平台组；研究文献、记录与计算的具体体验时，读相邻产品组。
3. 每篇末尾给出来源与待验证问题。把可复现任务做成同题测试后，才适合判断性能、成本或结果质量。

“优势”指从公开证据推导出的潜在产品优势，不代表本轮已经验证其优于 Pero。单篇中的产品状态、许可、定价和可用区域只对列出的核验日期与材料负责。

## 产品索引

分组用于安排阅读，不是对许可证或商业模式的统一认定；开放代码项目也可能有收费服务，相邻产品也可能直接替代某项研究任务。

### 开放代码与研究平台（9）

| 产品 / 项目 | 研究重点 |
| --- | --- |
| [AIPOCH Open-Science](open/01-aipoch-open-science.md) | 科研桌面、技能与工作流入口 |
| [Open Science Desktop / ai4s-research](open/02-open-science-desktop.md) | 本地科学工作台、工具与模型连接 |
| [Wisp Science](open/03-wisp-science.md) | 科研工作区、数据分析和交互呈现 |
| [alphaXiv OpenResearch](open/04-alphaxiv-openresearch.md) | 既有 coding agent、实验历史与远端算力 |
| [Synthetic Sciences OpenScience](open/05-synthetic-sciences-openscience.md) | 研究运行时、持久交付、科学工具与数据出口 |
| [K-Dense BYOK](open/06-k-dense-byok.md) | 多 agent 科研编排、技能与计算环境 |
| [OpenAI4S / PKU-YuanGroup](open/07-openai4s.md) | 持久科学内核、执行账本和产物契约 |
| [EvoScientist](open/08-evoscientist.md) | 持续自主研究、跨会话经验和 rubric 评分 |
| [Biomni OSS](open/09-biomni.md) | 生物医学工具、数据环境与领域评测 |

### 商业科研平台（8）

| 产品 / 项目 | 研究重点 |
| --- | --- |
| [Claude Science](commercial/claude-science.md) | 通用科研工作台、科学产物与算力 |
| [Kosmos / Edison Scientific](commercial/kosmos-edison.md) | 长周期调查、企业研究状态与科学家协作 |
| [OpenAI Rosalind Workbench](commercial/rosalind-workbench.md) | 生命科学工作流与受控准入 |
| [Microsoft Discovery](commercial/microsoft-discovery.md) | 企业科研平台与本地应用的不同交付范围 |
| [Elicit](commercial/elicit.md) | 文献证据、系统综述与研究 Agent |
| [SciSpace](commercial/scispace.md) | 文献、数据分析、写作与领域 Agent |
| [Benchling AI](commercial/benchling-ai.md) | 实验记录、结构化研发数据与治理 |
| [Causaly](commercial/causaly.md) | 生物医学证据推理和研发决策支持 |

### 相邻研究工具与计算空间（8）

| 产品 / 项目 | 研究重点 |
| --- | --- |
| [Gemini Notebook](adjacent/gemini-notebook.md) | 来源驱动的研究空间、分析与工作流 |
| [Consensus](adjacent/consensus.md) | 文献证据搜索、综合与快速判断 |
| [scite](adjacent/scite.md) | 引文语境、支持/对比证据与引用核查 |
| [ResearchRabbit](adjacent/researchrabbit.md) | 引文图谱、持续发现与论文集合 |
| [Covidence](adjacent/covidence.md) | 系统综述、筛选冲突与可审计流程 |
| [Jupyter AI](adjacent/jupyter-ai.md) | Notebook 内的模型与 Agent 工作方式 |
| [CoCalc](adjacent/cocalc.md) | 协同计算、长期项目与 Agent 执行 |
| [Litmaps](adjacent/litmaps.md) | 文献图谱、增量发现与监测 |


## 统一比较维度

| 维度 | 具体研究问题 | 可接受的验证证据 |
| --- | --- | --- |
| 定位与目标用户 | 面向个人研究者、实验室、企业研发还是平台开发者？替代哪一步工作？ | 官方产品与工作流说明；实际目标任务 |
| 问题到证据 | 搜索、全文阅读、文献筛选、提取与引用如何衔接？ | 固定问题、来源清单、原文位置、误引与遗漏记录 |
| 分析与执行 | 能否运行代码、Notebook、科学软件或外部计算？谁控制环境和预算？ | 真实输入、执行命令、环境版本、用量及失败回执 |
| 科学验证 | 如何区分生成解释、执行成功与科学结果成立？ | 预先固定的指标/容差、独立检查器、原始结果与失败案例 |
| 项目与长期上下文 | 能否保存研究目标、假设、版本、笔记和跨会话进度？ | 关闭/恢复/续研后的记录一致性与来源关系 |
| 协作与审阅 | 团队如何共享、复核、批准、引用或撤回结果？ | 角色权限、审阅记录、可导出的证据和版本历史 |
| 扩展与组合 | 能否接入工具、模型、MCP、App、数据源或计算集群？ | 官方接口和实际集成路径；接口可用不等于全流程已接通 |
| 部署与数据边界 | SaaS、桌面、本地或私有部署？哪些数据仍离开本机？ | 部署说明、模型/检索服务依赖、账户与数据处理条款 |
| 开放程度与许可 | 哪些部分公开？代码、模型、数据和托管服务是否适用不同条款？ | 固定版本的 LICENSE、模型卡、数据条款和服务合同 |
| 商业与成熟度 | 开放注册、邀请预览、商业可用还是论文原型？如何计费？ | 官方准入/定价页面及日期，不以营销发布替代可用性验证 |

### 建议的同题实测

以下是待开展的实验设计，本轮未执行，也不表示已创建账号或付费。

| 任务 | 固定输入 | 应记录的结果 | 关键失败条件 |
| --- | --- | --- | --- |
| 有证据的文献综述 | 同一研究问题、时间范围、纳排标准和可读原文集合 | 覆盖率、逐条引文支持、原文定位、遗漏与人工纠错时间 | 引用存在但不支持结论；把摘要推断写成全文发现 |
| 论文结果重分析 | 同一原始表格/数据、方法、目标数值和预先冻结的容差 | 数据来源、环境、运行轨迹、数值差异、独立校验和导出重检 | 换数据集、调容差、只验证文件存在、不能离线复核 |
| 多轮研究续接 | 同一项目先完成一轮，再中断、重启和加入反例 | 假设/来源/决策版本、历史保留、错误纠正与额外成本 | 重启后丢证据；新结论覆盖旧记录；重复执行外部动作 |
| 受约束的计算任务 | 相同输入、科学软件、硬件、预算、取消与故障条件 | 执行边界、资源消耗、失败恢复、结果和人工干预 | 不披露云调用；越预算；失败后伪造成功；取消后仍执行 |
| 团队证据审阅 | 一个需两人核对的结论及其文件、版本和来源 | 权限、评论、审批、引用和可移交报告 | 分享超范围数据；审阅者无法复查同一版本 |

比较前应对齐版本、账号层级、数据权限、模型、预算和任务难度；记录不可获得的功能，不能将“未能试用”记成“产品不支持”。自建软件的模型、存储和运维成本也应计入。

## Pero 比较基线

本轮读取的基线是 [phodal/pero master 371ea089](https://github.com/phodal/pero/tree/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b)，包含 PR #160。后续主干可能变化，比较应重新对照实现和验收记录。

- [README.zh-CN](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/README.zh-CN.md) 明确为开发预览，已有 macOS arm64 开发版，尚无稳定发布版。
- [架构](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/ARCHITECTURE.md) 描述 App/SDK/Host、ACP 会话、领域工具、研究项目与计算环境的分工。可组合科研应用是定位；完整跨 App 研究闭环不能仅由架构图推定已完成。
- [Paper 研究验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-autonomous-research.md) 与 [研究质量门槛](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-research-quality.md) 记录有界研究、来源证据与复核范围，应逐项阅读其限制。
- [Data 验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/data-workspace.md) 已记录不可变数据版本、精确值检查及实际 Electron/Host 开发验收；记录同时明确 Run/Compute 接线、远程存储与通用科学验证的范围。
- [Compute App](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/compute/README.md) 当前保存连接草稿，不代表已连通集群。[环境验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/ai4s-environments.md) 另有本地/Docker/Compose 和单节点 Slurm fixture adapter 的实际证据；底层路径验收不等于生产调度器、Compute UI 或签名产品验收。
- [Fisher 原始论文结果重分析](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md) 已记录一个真实原始数据的固定数值重分析及独立精确算术校验。这是 CLI 个案，未评估整篇论文，也不是通用科学复现或 Desktop 全链路验收。
- [验收等级](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/README.md#acceptance-levels) 区分编译/契约、开发 Desktop、真实外部服务和签名安装包。竞品的论文、README、演示和正式产品也应保持类似区分。

### 基线之后的同日主干

各篇比较仍然解释 `371ea089`。2026-11-07 16:32 +0800 的 `origin/master` 是 [`92d9eb1f`](https://github.com/phodal/pero/commit/92d9eb1f5634fa63b3df1348752a7ba5cdb5c2a3)，比基线多 29 个提交。本次只重读了和比较直接相关的两处记录；设置、MCP 页面、记忆存储和预览外观没有重新对照 25 篇。

- 会话产物。[`docs/fitness/session-artifacts.md`](https://github.com/phodal/pero/blob/92d9eb1f5634fa63b3df1348752a7ba5cdb5c2a3/docs/fitness/session-artifacts.md) 在同日增补里写明：Scientific Viewer 可以按请求启动本地 Python Jupyter kernel，编辑并运行所选代码单元；工作副本和原始快照分开，其他语言仍是保存预览。一次交付可以挂最多 16 个同会话快照，角色是 input、code、execution log、environment 或 review。外部系统可以用 `<output>.pero-run.json` 附上运行回执。这些是捕获和关联，科学结果仍未验证。Electron 有真实 Host 和本地 kernel 的验收记录；其中一次独立 Native 窗口没有加载 fixture 对话。基线正文里的“Notebook 没有共享 live kernel”已被这段增补替换。
- 本地科学前缀。[`apps/environments/README.md`](https://github.com/phodal/pero/blob/92d9eb1f5634fa63b3df1348752a7ba5cdb5c2a3/apps/environments/README.md) 写明，本地环境用固定的 micromamba 2.5.0-2 创建 conda 前缀；这次试验为 Paper、Control、Circuit 和 LCMS2Yield 安装 conda-forge 的 CPython 3.12。这是 App 运行时绑定，不是逐次独立计算，也不构成科学验收。`git diff 371ea089 92d9eb1f -- apps/compute/README.md docs/fitness/ai4s-environments.md` 没有改动这两个文件，所以 Compute App 仍是连接草稿，单节点 Slurm owner 的验收范围也不变。

因此，用 `371ea089` 描述 11 月 7 日傍晚的主干时，不能再说笔记本只有静态预览，也不能说交付物之间没有证据链接。Jupyter AI、CoCalc 和 Open Science Desktop 的同题实测仍然没有做；新内核不是 JupyterLab 里的 Agent，也没有和这些产品比过同一份分析。

因此，“Pero 可研究的差异点”是产品假设：把问题、证据、受控计算、独立验证和可移交产物连起来。是否具有更好的体验、可靠性或成本，需要同题实测，不能由模块数量得出。

## 来源与核验方法

- 优先使用项目官网、官方文档、作者论文、官方仓库和许可证原文。单篇明确区分可核实功能、官方自述、研究判断与尚待验证事项。
- 公开代码的存在不等于整个商业产品开放，也不自动说明可以商用；“本地部署”不等于模型、搜索和遥测完全离线。
- 动态官网、定价和默认分支会变化。若单篇有 commit permalink，应优先使用；未固定版本的页面只是检索当日的观察。检索失败、访问门槛或材料缺失不证明产品没有某项能力。
- 本轮属于公开材料调研。没有对 25 个对象统一安装、登录付费账户、运行模型、执行科学实验或做全流程 UI 验收。论文/厂商公布的指标保留其来源属性，不作为本轮复现结果。
- 名称相近的产品按运营主体和官方地址区分，尤其是不同 OpenScience/Open-Science 项目。旧称和更名只按单篇所列官方证据处理。
- 只引用理解结论必要的事实和少量术语，不复制上游源码、论文全文、私人材料、模型输出或截图。实际引入代码/数据、采购或共享研究资料前，另行审查许可、合同、数据保留与授权范围。

### 后续更新时

每次更新记录核验日期、产品名称/主体、版本或 commit、准入与价格变化、主要来源和仍未验证的事项。删除或降级已失效结论；不要只把日期改成当天。若补做实测，应将输入、环境、过程、结果和失败证据放在独立记录中，再回链到单篇。

## 与既有研究的关系

本目录补充逐产品的功能与定位研究，不替代较早的源码和交互专题：

- [科研 Agent：证据与研究台账](../%E7%A7%91%E7%A0%94%20Agent%20%E6%BA%90%E7%A0%81%E4%B8%8E%E4%BA%A4%E4%BA%92%E5%AF%B9%E6%AF%94/evidence-agents.md)
- [科研方法、实验与持久执行](../%E7%A7%91%E7%A0%94%20Agent%20%E6%BA%90%E7%A0%81%E4%B8%8E%E4%BA%A4%E4%BA%92%E5%AF%B9%E6%AF%94/methods-execution.md)
- [科研结果的可视化与呈现](../%E7%A7%91%E7%A0%94%20Agent%20%E6%BA%90%E7%A0%81%E4%B8%8E%E4%BA%A4%E4%BA%92%E5%AF%B9%E6%AF%94/visual-rendering.md)
- [此前源码研究快照](../Research%20Agent%20%E6%BA%90%E7%A0%81%E7%A0%94%E7%A9%B6/manifest.json)

这些历史文件有自己的日期与基线。本轮未重跑其安装、源码运行或交互验证；若与最新官方材料冲突，以新证据明确修订，保留版本差异。
