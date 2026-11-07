# Microsoft Discovery 竞品详解

核验日期：2026-11-07。对象：Azure 上的 Microsoft Discovery 企业平台与 Microsoft Discovery 桌面 app。依据官方技术文档、GA 公告和价格页；未部署 Azure 环境、下载 app、操作实验设备或执行统一基准。

## 核心判断

Microsoft Discovery 是企业科研基础设施和多代理工作流平台，与 Pero 整体定位直接相邻。它已有“本地探索入口加企业治理/算力”的分层策略。Pero 若强调本地或轻量，必须进一步说明实际配置成本、跨供应商迁移和开放研究对象的价值，不能只以“能在电脑上用”区分。

最重要的事实边界是：**企业云平台已 GA，桌面 app 仍为 preview，两者不是同一交付规格。** 价格页标题仍显示 Preview，与产品专门文档和 GA 公告不同步；此处采用后两者判定产品状态。[GA 公告](https://azure.microsoft.com/en-us/blog/announcing-microsoft-discovery-general-availability-and-microsoft-discovery-app-preview/)

## 定位与目标客户

- **学科范围：** 化学、材料、生命科学、物理及工程研发，而非仅论文检索或生物问答。
- **科学用户：** 研究员、实验科学家、计算工程师，重点是连接假说、模拟、数据与实验验证。
- **企业买方：** R&D 平台负责人、IT/Azure 管理员和研发领导者，需身份、权限、网络、审计和成本控制。
- **桌面用户：** 学生、研究者和小规模概念验证团队，先使用核心子集，再决定是否进入企业部署。[官方概述](https://learn.microsoft.com/en-us/azure/microsoft-discovery/overview-what-is-microsoft-discovery)

不应将 Azure 的普通客户、合作伙伴工具列表或演示案例，直接当作 Discovery 全功能生产部署的客户证据。

## 体系结构与功能

### 核心构成

官方把代理编排、图谱知识基础、推理和 HPC 结合：Discovery Engine 组织研究循环，Bookshelf 索引并辅助推理知识，专业 agents 调用模型、模拟/分析工具及计算资源。企业平台可结合私有资料与外部文献，并用长期知识状态保存结果。支持与现有 Microsoft/伙伴系统和开源模型集成。[技术概述](https://learn.microsoft.com/en-us/azure/microsoft-discovery/overview-what-is-microsoft-discovery)

这不意味着所有插件、模型和实验室都默认可用。概述亦描述在人工监督下与机器人、仪器、IoT 的集成；应理解为可扩展集成能力，不能据此宣称对任意实验设备拥有通用即插即用控制。

### 典型端到端工作流

依据官方流程整理，非本次操作记录：

1. 科学家定义问题、评价标准和可用证据。
2. 组织内部资料与文献进入知识索引，限定权限及数据范围。
3. Discovery Engine 规划并分派专业代理，生成和筛选假说。
4. 调用计算、模拟或分析工具，并保留与研究问题的关系。
5. 科学家审阅中间结果，调整假说或提出下一轮实验。
6. 连接实验数据/验证结果，进入下一轮发现循环。
7. 在企业工作区共享项目、代理与数据，保留治理和审核记录。

GA 公告将其定义为现有研发环境中的编排与治理平台，不是替代科学家判断的全自动发现机器。[研发流程与 GA 说明](https://azure.microsoft.com/en-us/blog/announcing-microsoft-discovery-general-availability-and-microsoft-discovery-app-preview/)

## 云平台与桌面 app 必须拆开

| 比较项 | Discovery 企业平台 | Discovery app |
|---|---|---|
| 状态 | GA | Preview |
| 运行形态 | Azure 企业云 | Windows/macOS 本地应用 |
| 建立条件 | Azure 订阅及云资源 | GitHub Copilot 账户 |
| 计算 | Azure CPU/GPU/HPC 等 | 本机资源 |
| 协作 | 多用户工作区 | 单用户、单机登录 |
| 数据 | 企业私有和云数据源 | 本地文件和公共资源，不直接连企业数据或网络盘 |
| 支持 | 企业支持及 SLA | 社区/尽力支持 |
| 费用 | Azure 消耗及服务计费 | 免费下载，消耗 Copilot credits |

[官方产品比较](https://learn.microsoft.com/en-us/azure/microsoft-discovery/concept-discovery-and-discovery-app)

**迁移也要准确表述：** 官方说 agents、prompts 和部分知识内容可复用到 Azure，但目前没有自动迁移工具。不能把“共享 API、可移植定义”写成一键无损迁移，也不能把 app 称为企业版的完整免费替代。

**隐私提醒：** 本地运行与本地推理不同。账户模型调用、外部工具和数据源的具体传输仍须确认；对敏感数据不能只凭应用装在本机就判定安全。

## 商业模式与价格

截至核验日：

- **app：** 免费下载，但 AI 使用消耗 GitHub Copilot credits，本地计算还有硬件和时间成本。
- **企业平台：** 价格页列按用户提交消息计费，底层其他 Microsoft 服务/Azure 资源另计。
- **公开金额：** 本次提取的每消息单价仍为 `$-` 占位，未核实可直接采购的统一价格。应使用指定区域、协议的计算器/销售报价，不能填入猜测值。[价格说明](https://azure.microsoft.com/en-us/pricing/details/microsoft-discovery/)

建议比较成本表包含：Discovery 消息、模型调用、CPU/GPU/HPC、存储与网络、数据许可、平台实施、运行维护与领域审核。不能拿一条消息与 Pero 的一次完整分析作等价单位。

## 优势与局限

### 优势判断

- Azure 的算力、身份、企业数据和治理体系，可以减少大组织自行拼装的工作。
- 从个人试验到团队部署的产品梯度，既服务采用入口也服务企业采购。
- 工作对象包括假说、工具调用和循环验证，不局限于检索报告。
- 公有生态与组织资源结合，适合需要规模化算力和跨部门协作的研发组织。

### 局限与未证实项

- 企业平台需要 Azure 资源和管理能力，其复杂度不能由免费 app 的简单安装体验代表。
- 应用子集不具备完整团队治理/私有数据连接；若科研场景必须具备这些条件，评价应使用企业版本。
- GA 指商业生产支持状态，不保证每次科学结论正确或任意专业工具已得到科学验证。
- “有知识图谱”不等于已解决证据冲突、因果识别、外推或生物预测不确定性。
- 离开 Azure 后可带走哪些代码、知识结构和审阅记录，需用实际导出样本检验。

## 与 Pero 的对照

Pero 采用 master 371ea089 的 [统一比较基线](../README.md#pero-比较基线)。Control Lab 为控制器/ngspice 等受控仿真，Lab 为 PyLabRobot 软件仿真，不是已完成的真实设备闭环；下表比较研究方向，不将厂商集成愿景与 Pero 仿真状态直接计分。

| Pero 方向 | 对应能力/竞争点 | 不应误判 |
|---|---|---|
| Paper | Bookshelf、文献与知识推理 | 索引知识不等于逐句支持检查通过 |
| Research | 多代理、发现循环、工具编排 | 工作流成功不等于假说被科学证实 |
| Data | 企业数据与长期研究状态 | 通用云治理不等于自动具有样本科学语义 |
| Host | Azure HPC 与 app 本地计算 | 不能拿 app 与全部 Pero 部署选项作同规格比较 |
| Control Lab | 仿真/研究验证邻接；Discovery 另有实验室集成方向 | 两者不等价，Pero 应先证明受约束求解与独立指标检查 |
| Virtual Cell | 可接专业模型/模拟 | 不等于自带已验证的通用细胞预测模型 |

Pero 的机会是中立、轻量、可移交的研究工作区；但要证明比整合 Azure 更省事，同时不牺牲审计和安全。若用户本已深度采用 Azure，Discovery 的组织适配优势可能比开源许可更影响选择。

## 待实测与采购验收

1. **分别测试 app 与云：** 相同公开任务记录设置时间、运行限制、输出差异和实际费用，不混合两者成绩。
2. **迁移演练：** 在 app 创建 agents/知识/产物，再搬到企业环境，记录需手工重建的对象及丢失的信息。
3. **算力任务：** 以固定数据和资源预算执行并行计算，测试超时、取消、重试、恢复及闲置资源费用。
4. **权限继承：** 不同团队身份访问同一项目，检查引用原文、生成摘要和派生产物是否越过原始权限。
5. **证据变化：** 源数据更新、论文更正或假说被反证后，历史结论是否能标明失效而非静默覆盖。
6. **科学检查：** 在已知结论和负对照任务中评价分析设计、结果可信度和不确定性，而非只比运行速度。
7. **实验室集成：** 必须拿具体设备、协议和安全条件验收，明确人工批准、急停及异常状态；本报告没有做任何设备操作。

**产品建议：** Pero 应优先实现一次无需重新搭建环境的跨主机移交，并输出可审核的研究包。如果没有此类证据，不宜直接承诺比企业平台更“可复现”或更“安全”。

## 官方来源与用途

- [What is Microsoft Discovery](https://learn.microsoft.com/en-us/azure/microsoft-discovery/overview-what-is-microsoft-discovery)：体系、用户及扩展/实验室集成范围。
- [Discovery 与 app 比较](https://learn.microsoft.com/en-us/azure/microsoft-discovery/concept-discovery-and-discovery-app)：状态、部署、协作、资源和迁移边界。
- [GA 与 app preview 公告](https://azure.microsoft.com/en-us/blog/announcing-microsoft-discovery-general-availability-and-microsoft-discovery-app-preview/)：发布状态与研发循环定位。
- [定价页](https://azure.microsoft.com/en-us/pricing/details/microsoft-discovery/)：消息计费与独立资源收费；标题和状态文档存在更新不同步。

[返回竞品索引](../README.md)
