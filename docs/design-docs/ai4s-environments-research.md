---
kind: analysis
date: 2026-11-02
---

# AI4S 环境抽象：科研、开源平台与商业产品研究

本报告比较科学方法、软件环境、执行资源、数据来源和实验记录的边界，为 Pero 的 ADR 与分期计划提供依据。它是设计研究，不是实现或产品验收记录。

## 结论

**Environment 应表达科学方法所需运行条件的准备、实际绑定、观察和使用；完整实验由方法、输入、执行、环境快照与验证共同描述。** 不宜把研究项目、工作流、软件安装目录或整份实验都命名为环境。

研究得到三个主要修正：软件定义与实际安装/加载身份分开；可复用的准备结果与每次执行的资源分配分开；领域观测与 Agent 的提案、解释和排序分开。以下事实由一手资料支持，Pero 的选择属于推论。

## 阅读范围与证据等级

- 2026-11-02 访问下列官方文档与作者论文，阅读涉及概念、接口、版本和恢复语义的段落；没有安装、购买、调用账号或实测这些平台。
- 商业产品的接口/文档是其公开合同证据，不证明服务实际部署、性能、科学正确性或全部现有能力。
- Google co-scientist 阅读摘要、系统概述与实验验证范围；不将论文的特定领域结果外推为任意研究任务的能力。
- 对 Pero/Point 的判断来自当前仓库源码与文档；本次研究不复跑历史验证、不改变其验收等级。

## 一手来源与可迁移边界

| 对象 | 资料直接支持的事实 | 对 Pero 的推论 |
| --- | --- | --- |
| [Nextflow executor](https://docs.seqera.io/nextflow/executor) | Process 与执行系统通过 executor 分开；每个 task 有目录、输入 staging、脚本、输出与退出记录；一个 pipeline 可混合执行目标。 | 方法、软件条件与执行地点分别绑定；独立工作目录属于实际 task/attempt。 |
| [Nextflow cache/resume](https://docs.seqera.io/nextflow/cache-and-resume) | 缓存键包含输入、脚本、容器/Conda/Spack 等信息；复用还要求工作目录中的输出存在。 | 缓存身份与环境身份不同；复用已有结果不等于重新执行或恢复数值状态。 |
| [AiiDA Process](https://aiida.readthedocs.io/projects/aiida-core/en/stable/topics/processes/concepts.html)、[Code/数据类型](https://aiida.readthedocs.io/projects/aiida-core/en/stable/topics/data_types.html) | Process 描述如何运行，ProcessNode 记录发生了什么；InstalledCode、PortableCode、ContainerizedCode 表达不同程序来源。 | 准备意图、实际执行与来源证据分开；venv 只是软件实现的一种。 |
| [AiiDA provenance](https://aiida.readthedocs.io/projects/aiida-core/en/stable/topics/provenance/concepts.html) | Calculation 创建 Data；Workflow 调用过程并返回数据；输入、创建、返回和调用有不同关系。 | 保留“结果怎样产生”和“为什么运行这一步”两种关系，环境摘要不能代替它们。 |
| [Galaxy dependencies](https://docs.galaxyproject.org/en/release_26.0/admin/dependency_resolvers.html)、[job destinations](https://docs.galaxyproject.org/en/release_26.0/admin/jobs.html) | Tool 的参数/命令映射、依赖解析和任务目的地分别配置；支持版本缺失时的 versionless 解析策略。 | 可借鉴分离接缝；科研精确复现不应隐式采用版本回退策略。 |
| [atomate2](https://materialsproject.github.io/atomate2/user/key_concepts_overview.html) | Maker、InputSet、TaskDocument、Builder 分开；TaskDocument 保存结构、输入、输出、目录和计算软件相关字段。 | 材料/分子/求解器语义留在领域类型，通用环境只关联版本化需求和实际条件。 |
| [Code Ocean](https://docs.codeocean.com/user-guide/v4.1.0/key-concepts) | Capsule 组合代码、数据、环境和结果；Release 是与开发对象分开的 run-only 版本。 | 产品可提供一个可分享的实验入口，内部仍分别持有各对象身份；探索与正式发布分开。 |
| [Domino 6.2 API](https://docs.dominodatalab.com/en/6.2/api_guide/c5ef26/the-python-domino-library/) | job_start 分别接受 commit、environment、hardware tier 和外部卷；省略参数可使用最新提交或项目默认值。 | 便捷默认值在执行准入时必须解析并记录，历史执行不能只保存“默认环境”。 |
| [Terra workspace](https://support.terra.bio/hc/en-us/articles/360046095192-Intro-to-workspaces) | Workspace 组合数据、分析、工作流与历史；表可引用 workspace 外部云数据；交互应用运行于 Cloud Environment VM。 | 项目工作面与计算环境分开；数据引用、位置与访问条件不能被一份 VM 配置替代。 |
| [TetraScience processing](https://developers.tetrascience.com/docs/monitor-pipeline-processing-new) | Retry 与 Reprocess 有不同配置选择；同版本强制覆盖、通配 task-script 版本会改变实际使用的实现；reprocess 使用文件最新版本。 | 名称/版本标签不等于解析后的内容身份；重试与重新分析需要明确不同记录。 |
| [Google AI co-scientist v1](https://arxiv.org/html/2502.18864v1) | 系统生成、反思、排序和演化假设；论文另述计算、专家与湿实验验证，领域和规模有边界。 | Agent 提案、内部排名、实测观测和科学接受是不同证据，分别关联来源。 |
| [Bluesky documents 1.13.1](https://blueskyproject.io/bluesky/v1.13.1/documents.html) | RunEngine 产生带 schema 的文档；Start 保存初始元数据，Event 保存测量及其时间戳；plan 与 run 不要求一一对应。 | 仪器支持需要带时间的观测流；把一个 Run 的启动快照当作全部实验条件会丢失信息。 |
| [ECL Object[Protocol]](https://www.emeraldcloudlab.com/helpfiles/types/object_protocol) | Protocol 关联排队/执行时间、样品与仪器、资源等待、运行中温湿度数据等字段。 | 物理实验资源有消耗和随时间变化的状态，不能用容器/venv 生命周期完整表达。 |

## 有意义的反例

### 版本标签与解析身份

TetraScience 文档明确列出同版本覆盖和通配版本更新的行为；Domino 允许执行使用最新提交和默认配置。它们方便日常操作，但单独记录 `v1`、`latest` 或 `default` 不足以重建一次科学执行。

Pero 应分别记录请求的要求、准入时解析出的固定引用、运行时实际观察。摘要固定某份内容，不自动证明安装完整性、资源授权或科学有效性。仅检查包清单也不能宣称逐文件内容完整性。

### 四种“恢复”

| 动作 | 实际语义 | 应由谁拥有 |
| --- | --- | --- |
| 复用结果 | 根据明确匹配规则使用已经存在的输出；Nextflow resume 包含这种机制。 | 原执行/结果存储拥有者 |
| 恢复编排 | 从持久状态继续工作流控制；AiiDA process checkpoint 属于此类。 | 原工作流执行者 |
| 恢复数值计算 | 从模型、优化器、随机状态、数据游标或求解器 checkpoint 继续。 | 领域计算适配器与原执行者 |
| 重新执行/重新处理 | 新 attempt 使用显式固定的输入与条件，保留对原记录的关联。 | 现有执行权威 |

这些动作不能互相推导。[OpenMM 的 checkpoint 与 State](https://docs.openmm.org/latest/userguide/application/02_running_sims.html#saving-and-loading-simulations) 进一步说明：能加载一般状态不等于恢复全部内部状态，checkpoint 也有软件/平台兼容条件。Environment 只报告恢复条件是否满足，不新增恢复调度器。

### 环境就绪与科学结论

软件能导入、资源可访问、程序退出成功、数值检查通过、科学结论被接受，是不同事实。[PyTorch](https://docs.pytorch.org/docs/stable/notes/randomness.html) 明确指出相同 seed 不保证跨版本/平台及 CPU/GPU 的相同结果；[OpenMM 平台属性](https://docs.openmm.org/latest/userguide/library/04_platform_specifics.html) 还涉及精度、线程与确定性行为。

Pero 的比较要求由预先固定的方法/验证规则拥有。环境报告实际条件和差异，不能因为换平台而自动放宽数值容差，或把原作者未知条件补写成已知。

## 对 Pero 的抽象推导

| 概念 | 唯一拥有的事实 | 明确边界 |
| --- | --- | --- |
| 科学方法/实验方案 | 参数、seed、单位、数据划分规则、初始条件、预算与验证要求 | Gym reward、力场选择和求解器算法不是环境通用状态。 |
| 数据/模型制品 | 内容、来源、版本、变换关系与领域含义 | 环境绑定引用和实际访问方式，不重建数据目录。 |
| 软件环境定义/准备结果 | 解释器、依赖锁、原生程序或镜像的准备输入与实际记录 | 定义摘要、构建结果和加载观察保持区分。 |
| 环境 Instance/Binding/Use | 实际资源身份、观察、消费者使用范围、Owner 授权引用与释放结果 | 不拥有 Run 状态、工作流队列或科学判定。 |
| 执行与观测 | 原始日志、退出结果、checkpoint、时序数据、结构化输出及其输入关联 | 继续由 Host、Worker 或既有计算后端拥有。 |
| 验证与接受 | 固定规则下的检查结果及研究者/Project 的决定 | Agent 自评和环境 Ready 均不代替此对象。 |

软件准备结果可以复用；输入可以只读共享；临时目录、输出和资源使用按具体执行绑定。不能把目录位置当成软件内容身份，也不能把对象引用当成访问授权。

App 自身的运行环境与某篇论文/模型的计算环境需要分别绑定；一个科学方法可能同时使用 Python、原生求解器、GPU 和数据服务。资源组合按真实需求接入，不先定义所有科学领域的通用动态字段。

数据驻留与 bulk data transfer 属于实际存储/执行边界：控制面保留必要引用和清单，不默认搬运全部数据。交互探索的内核状态不能自动成为正式实验的初始条件；冻结后应有明确重跑入口。

## Pero / Point 的已有基础与缺口

- 本地 Point 对照源：`~/ai/point/docs/adr/0143-domain-environment-profiles.md` 与 `~/ai/point/apps/ai4s-lab/backend/environment.py`。其 Python 与原生程序 profile 分开，配方、安装记录和结果回执相关联；本文不把其历史实跑移作 Pero 证据。
- Pero 已有 [App Python 准备](../../crates/pero-runtime/src/apps/preparation.rs)、[远程 RuntimeBinding](../../server/internal/runtimebinding/binding.go) 与 [Kubernetes Owner 来源记录](../../server/internal/environments/SOURCE_REFERENCES.md)。这些接缝应被接入，不再新增执行器或任务状态机。
- [Control Lab](control-lab.md) 已定义 ExperimentSpec、Trial、Observation 与 VerificationReport；[Paper 固定复现](paper-pcgym-reproduction.md) 保留源码、seed 与原始制品缺口；[Lab 对照研究](lab-google-reproduction.md) 明确软件/合成观察和真实仪器验收的差别。
- 缺口是跨这些场景的科学软件准备身份、App 与科学计算环境的独立绑定、每次执行的实际条件关联；详细取舍与阶段验收由对应 ADR/执行计划拥有。

## 不由本研究推出的承诺

上述平台相似之处不证明 Pero 应复制其调度器、图数据库、商业权限模型或全面 DSL。首批接缝需由至少两个真实领域验证再提取共性；外部工作流先按其原执行身份集成。

本报告未建立跨平台数值等价、任意不受信代码隔离、物理仪器控制、商业平台账号接入或生产可复现性；这些能力需要各自实现、验证和明确证据。
