# Rosalind Workbench 竞品详解

核验日期：2026-11-07。对象：OpenAI Rosalind Workbench、GPT-Rosalind 模型准入与学术计划，三者分别说明。依据官方发布、帮助文档、API 价格；未获得受控模型准入、未执行科研任务或验证数据分析质量。

## 核心判断

Rosalind Workbench 将生命科学任务入口、专业工具、模型、分析计划和科学查看器组合为工作区，是 Pero 的整体对标，特别涉及 Research、Paper 和 Virtual Cell 周边工作。其强项是领域模型与工具体验共同演进；Pero 更现实的差异化在开放项目状态、跨模型/环境迁移及透明验证，而不是未经测试地声称底层生物推理能力更强。

## 产品边界与目标客户

需要区分三个对象：

1. **Workbench：** ChatGPT 应用中的研究工作台，当前发布口径为 research preview；提供引导任务和科学工具。
2. **GPT-Rosalind：** 生命科学模型家族，包含不同准入等级和模型版本，不是所有 Workbench 使用者自动获得的一个公共模型。
3. **Life Sciences Research plugin / Codex 工作流：** 在获批工作区连接科学数据库、工具和数据，安装插件本身不授予模型访问权。[Workbench 公告](https://developers.openai.com/blog/rosalind-workbench)、[准入帮助](https://help.openai.com/en/articles/20001193-gpt-rosalind-for-life-sciences-research)

目标为生命科学研究者、计算生物学家、药物发现/转化团队、大学实验室，以及需要受治理访问的机构。采购方通常还包括 PI、机构管理员、安全及合规人员。它不是供个人直接作临床诊断或治疗决定的已验证医疗器械。

## 功能与完整流程

### 工作台界面

公开示例以蛋白/小分子、结构与序列、组学、病理和实验验证任务作为入口。分子结构、序列比对和切片查看器，使图像/结构与对话中的解释保持关联；NGS 工作台连接 FASTQ、质控、bulk RNA-seq 和单细胞分析，先提出供研究者批准的计划，再协调工具并返回可检查结果。[Workbench 功能与示例](https://developers.openai.com/blog/rosalind-workbench)

这一设计的竞争价值是减少“把问题重新解释给下一个工具”的摩擦，而非用一个更长的聊天窗口代替科学流程。展示某个结构或切片，不能推断其结构解释或病理判断已达到临床验证水平。

### 模型与工具层

官方列出的研究范围包含证据综合、靶点研究、基因组/序列、蛋白分析、药物化学、湿实验排障和实验规划。大数据可以保留在获准的文件/存储系统，由工具按任务读取和分析，不要求全部塞入模型上下文。内部知识接入仍可能需要定制 skills 或 automation，不能描述为全部企业知识自动开箱接入。[GPT-Rosalind 帮助文档](https://help.openai.com/en/articles/20001193-gpt-rosalind-for-life-sciences-research)

### 典型端到端路径

以下是功能合成的流程说明，不是本次运行记录：

科学问题 → 选择示例/任务并指定数据 → 建立方法和分析计划 → 研究者检查样本、参数与设计 → 调用专业模型或科学工具 → 查看结构、序列、图表及中间结果 → 整合文献与分析证据 → 解释局限并规划验证 → 留存可审查产物与后续问题。

对 Pero 来说，这条链要求一等公民对象不仅有聊天和文件，还要有“研究问题、数据版本、计划批准、工具运行、具体证据、审阅意见”。

## 可用性与部署

| 层次 | 截至核验日的官方状态 | 不应混淆 |
|---|---|---|
| Rosalind Workbench | Research preview | 不是所有科学功能均 GA |
| Explore | 可用 ChatGPT 模型探索任务 | 不等于获准使用高级 Rosalind |
| Rosalind Discovery | 日常科学工作准入等级，约束较严格 | 不授予 Research 模型权限 |
| Rosalind Research | 更高级研究，额外审核和指定模型权限 | 不等于同机构所有用户自动可用 |
| API | 单独审批，限获批内部研究用途 | 不能默认用于对外商业产品 |

[Workbench 模式说明](https://developers.openai.com/blog/rosalind-workbench)、[最新访问政策](https://help.openai.com/en/articles/20001193-gpt-rosalind-for-life-sciences-research)

当前帮助页说明 GPT-6 Rosalind Research 面向有限获批 Research 组织，在 Work/Codex 及单独批准的 API 使用，不在 Chat tab；企业启用还可能受 Admin Preview 和权限控制影响。购买 Business/Enterprise、加入组织或装插件都不是充分条件。

**部署判断：** Workbench 是 OpenAI 产品生态中的工作区，可结合 Codex 的数据与执行环境；本次没有完整平台可自托管、任意离线运行或用户自选替代模型而保留全部 Rosalind 能力的证据。不能从“可读本地文件”推导“数据绝不离开本地”。

## 商业模式与价格

### API 单独计价

截至核验日官方页面的每百万 token 标准价格如下，单位 USD：

| API 模型 ID | 输入 | 输出 |
|---|---:|---:|
| gpt-6-rosalind | 15 | 75 |
| gpt-rosalind-research | 5 | 25 |
| gpt-rosalind-discovery | 5 | 25 |

缓存、数据区域和其他条件可能有不同价格。以上不是 Workbench 全包价，也不自动包含计算、外部工具、数据授权或组织工作区费用。[API 价格](https://developers.openai.com/api/docs/pricing)

### 学术与机构

2026-10-15 发布的 Rosalind Academic Plan 对合资格美国大学实验室提供最多 30 个 Business Standard 席位、最多 12 个月的赞助访问，仍须 trusted-access 审核。它不是 ChatGPT Edu 的自动权益，也不含 API 访问/credits。非美国学术组和产业团队不能直接套用这项优惠。[学术计划](https://openai.com/index/introducing-the-rosalind-academic-plan/)、[准入政策](https://help.openai.com/en/articles/20001193-gpt-rosalind-for-life-sciences-research)

机构应确认工作区/席位、任务用量、API 和工具运行账单分别由谁承担。对外集成进 Pero 产品的授权也应单独确认；当前内部研究 API 授权不等于允许对外转售。

## 优势与局限

**优势判断：**

- 专业模型与任务入口、科学查看器共同设计，能直接竞争科研使用体验。
- 工作流中的计划和中间证据减少纯黑箱报告的问题。
- 引导任务有利于非专业计算研究者起步，同时可延伸到脚本/工具。
- 学术计划降低符合资格实验室的采用门槛。

**局限与需查证事项：**

- 准入、版本、工作区及产品通道复杂，研究者获得界面不等于获得目标能力。
- Research preview 和产品演示并不能证明外部数据集上的稳定科学质量。
- 能规划实验/报价不等于已执行实验，更不等于自动接受所有实验或采购承诺。
- 数据连接器和自定义流程需要配置；客户特定环境仍可能有工程负担。
- 分析计划可审阅不等于完整的运行可复现，需检查环境锁定、数据 hash、随机种子和外部依赖版本。

## 与 Pero 的对照

Pero 采用 master 371ea089 的 [统一比较基线](../README.md#pero-比较基线)：Control Lab 是控制器/ngspice 等受控仿真，Lab 为 PyLabRobot 软件仿真。以下为研究方向对照，不能据此认定任何模块已通过生产级科学验证。

| Pero 方向 | 当前竞争含义 | 建议的验收重点 |
|---|---|---|
| Paper | 文献与科学问题结合 | 引用是否支持论点，是否保存证据条件 |
| Research | 专业任务、工具和计算编排 | 方法选择、执行失败恢复、人工批准记录 |
| Data | 文件、元数据和分析相连 | 样本身份、不可变版本、数据权限 |
| Virtual Cell | 与组学/专业生物模型邻接 | 模型训练域、外推、扰动预测的独立验证 |
| Host | Codex 环境和工具执行有重合 | 用户控制、跨平台、环境导出与重跑 |
| Control Lab | 研究规划邻接，非当前同级物理实验能力比较 | 将规划、约束、仿真执行、独立指标检查分开记录 |

Pero 的模块基线不是已验证优势。尤其不能用一个单细胞可视化界面与完整 Virtual Cell 科学能力画等号；双方都应采用相同检验口径。

## 建议实测清单

1. **数据与样本完整性：** 用公开 RNA-seq/单细胞数据，设置错配的样本元数据、批次效应和伪重复，检测系统是否主动质疑。
2. **批准后是否守约：** 固定分析计划后更改输入，检查是否重新请求审查，而不是继续产生表面一致结果。
3. **科学查看器正确性：** 核对结构编号、残基、序列比对和模型解释是否与真实文件一致。
4. **方法质量：** 按已知标准结果/保留集检验统计设计、差异分析和不确定性；以领域专家盲评，不能以代码可运行评分替代。
5. **溯源移交：** 新研究者在没有原聊天背景时，能否解释参数、输入、工具选择及结论边界。
6. **准入与成本：** 记录从申请到成功运行的等待、配置工时、模型/工具费用和人工审核时间。

**产品建议：** 选择一个具体科研流程形成开放、完整可重跑交付，不试图以统一界面覆盖的模块数量对抗其专业模型。对无法替代的模型能力，可以评估合规接入，但不得假定当前 API 条款允许对外产品化。

## 官方来源与用途

- [Rosalind Workbench 发布与示例](https://developers.openai.com/blog/rosalind-workbench)：工作台、research preview、查看器和工作流。
- [GPT-Rosalind 帮助中心](https://help.openai.com/en/articles/20001193-gpt-rosalind-for-life-sciences-research)：模型准入、权限、内部研究 API、数据与工具边界。
- [API 价格](https://developers.openai.com/api/docs/pricing)：模型 token 费用，不是工作台包价。
- [2026-10-15 学术计划](https://openai.com/index/introducing-the-rosalind-academic-plan/)：资格、席位与时间范围。

所有效果判断仍需实际试用；未将官方演示或模型定位当作独立科学验收。

[返回竞品索引](../README.md)
