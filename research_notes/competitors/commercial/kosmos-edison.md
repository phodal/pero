# Kosmos 与 Edison Scientific 竞品详解

核验日期：2026-11-07。对象：Edison Scientific 的当前企业 Kosmos，以及旧 Playground 的历史关系。方法：官网、发布说明与最新客户案例核验；未申请访问、上传数据、执行 run 或验证客户结果。

## 核心判断

Kosmos 的竞争重点已从一次长时间自主分析，转向与企业科学家持续协作、接入组织历史并交付具体研发流程。它与 Pero Research 的长任务直接竞争，与 Data、Host 和企业研究状态管理邻接。对 Pero 的启发不是追逐“几小时等于几个月”的营销数字，而是明确研究状态、证据包、反馈、预算和终止规则。

## 公司与产品关系

- **FutureHouse** 是研究组织；**Edison Scientific** 是商业 spinout；**Kosmos** 是 Edison 的科学代理产品。2025-11-05 公告宣布 FutureHouse 平台运营转移给 Edison，三者不能作为三家互不相关商业竞品重复计数。
- **2025 年 Kosmos** 以一次自主研究 run 为主要体验，结合文献分析、代码分析和结构化 world model。
- **2026 年 Kosmos** 重新设计为企业持续协作者，并保留异步任务底层。新产品申请/销售交付与旧 Playground 并存，旧接口可用性不能证明新版自助商用已普遍开放。[初始公告](https://edisonscientific.com/news/announcing-kosmos)、[2026-05 产品调整](https://edisonscientific.com/news/building-ai-native-biopharma-announcing-our-partnership-with-incyte-corporation-and-kosmos-for-r-d-teams)

## 目标客户与购买动因

重点客户为 biopharma 的发现、转化、临床和研发决策团队，购买对象不仅是软件席位，也包括私有数据接入、工作流适配、科学方法和服务支持。研究员需要拓展证据覆盖，负责人需要标准化的靶点评估和研发决策依据。

已公开的具体关系包括：

- **Incyte：** 2026-05 公告的初始部署聚焦靶点发现、验证及转化生物学，后续扩展属于发展方向。
- **Pfizer：** 2026-10-29 宣布将 Edison 平台/Kosmos 部署到研发工作的协议，并由驻场科学家和工程师协作落地。协议公告不等于全研发组织已完成实施，更不等于已改善临床成功率。[Pfizer 官方合作说明](https://edisonscientific.com/news/edison-scientific-announces-agreement-with-pfizer-to-accelerate-research-and-development)

## 功能与运行流程

### 公开能力

当前官网描述文献阅读、数据分析、假说生成、分支探索、运行中转向，以及 Slack/Teams/email 协作。组织 world model 结合历史实验、数据和决策；官网明确以模型无关和企业环境部署为卖点，并提供驻场科学家。[当前官网](https://edisonscientific.com/)

2026-05 说明进一步列出：持续同步交互、异步调查、GPU 计算供应、科学图表理解与 PDF 产出；可接本地数据、云存储、数据仓库、ELN、assay、biomarker 和非结构化科学笔记。客户数据可用于约定的模型训练/适配，不能推定所有数据默认不训练，也不能把“持续学习”一概解释成每次操作都修改模型权重。[产品调整说明](https://edisonscientific.com/news/building-ai-native-biopharma-announcing-our-partnership-with-incyte-corporation-and-kosmos-for-r-d-teams)

### 典型端到端流程

以下是公开功能的组织方式，不是试用记录：

1. 明确有价值的研究目标、数据范围与决策问题。
2. 检索文献并分析实验/组织数据，形成多个调查分支。
3. 将阶段发现组织进持续研究状态，选择下一步分析。
4. 科学家在任务进行中补充信息、纠正方向或收窄问题。
5. 调用计算工具并生成图、表与证据报告。
6. 将结论连回文献段落或代码，供专家质疑、修订和决定后续实验。
7. 企业项目可将新资料纳入持续证据包，而不是仅保留单次问答。

World model 是其公开架构概念。内部表示、矛盾消解策略、删除传播、权重更新规则及导出规范未在本次核验中完整披露，不能据此认定其为已验证的领域因果模型。

## 最新案例与证据强度

2026-11-04 的 **Kosmos Target Assessment（Kosmos TA）** 案例描述与 Incyte 共建靶点评估代理。评价框架来自历史审查会议，强调安全、可成药性、竞争格局和项目组合等信息，而非只复述生物机制。

厂商报告：通常一个工作日内形成评估；对 6 个有委员会历史决定的靶点，后续去风险实验建议中 83% 与委员会请求完全或概念匹配，16% 部分匹配，1% 未匹配。[Incyte 案例](https://edisonscientific.com/news/bringing-broader-evidence-and-expert-judgment-into-target-assessment-earlier)

**解读限制：** 这是合作方回顾性案例，不是前瞻性随机试验。匹配专家请求不等于实验执行成功或药物研发成功；少量目标和内部 rubric 的成绩不能外推成全部科研正确率。对于 Pero，值得借鉴的是“任务专用的评审标准”和“证据更新包”，而不是直接比较一个百分比。

## 部署与可用性

| 项目 | 当前公开状态 | 采购应确认 |
|---|---|---|
| 新 Kosmos | 申请访问、预约 demo、企业合作 | 排队时间、SKU、实际交付能力 |
| 企业部署 | 官网标 on-prem、客户环境、SOC 2 Type II | 是否全链路在本地，底层模型数据流与例外 |
| 服务方式 | 驻场科学家/工程师参与 | 服务范围、交付周期、持续支持费用 |
| Playground | 2026-05 公告仍有核心研究代理 | 现行额度、历史数据保留及旧 Kosmos 停止日期 |
| 模型策略 | 官网宣称 model agnostic | 客户能否自选、能否迁移、历史结果可否重跑 |

“可在客户环境部署”不等于拿到源代码、自行维护或完全离线，也不等于全部方案都包括相同条件。

## 商业模式与价格

**新版 Kosmos 当前没有本次可核实的统一公开总价，需申请/销售报价。** 不应将 2025 年的 US$200/run 和 US$1/credit 当作现价。

2026-05 公告明确 Founding subscriptions 不再开放购买；当时 Playground 的 Literature、Analysis、Precedent agents 保持每月 10 个免费 credits，原学术月度额度转为一次性 grant，并计划调整。上述是带日期的公告，不是本次登录验证后的实时权益。[历史定价及限制](https://edisonscientific.com/news/announcing-kosmos)、[方案变化](https://edisonscientific.com/news/building-ai-native-biopharma-announcing-our-partnership-with-incyte-corporation-and-kosmos-for-r-d-teams)

询价应拆出：平台、席位/用量、模型、GPU、数据许可、实施、模型定制、驻场服务与运维。若与 Pero 比较，要同时计算开源方案的工程与科学审阅成本。

## 优势与局限

**优势判断：**

- 长任务并行探索与持续上下文比“输出一个综述”更贴近研究项目。
- 企业数据及历史决策的适配，可形成通用基础模型之外的组织价值。
- 明确的客户协同案例，比只展示产品视频更接近实际采购和交付。

**局限与风险：**

- 厂商在 2025 年公告中明确承认系统会追逐统计显著但科学价值不足的结果，长运行不保证价值随时长增长。
- “约六个月人类工作”来自 7 位 beta 科学家对 20-step run 的估计，不能当客观普适加速比；79.4% 也不是任何场景的结论正确率。[原始 caveats](https://edisonscientific.com/news/announcing-kosmos)
- 企业定制和服务是能力来源，也是实施成本及迁移成本来源。
- 公共证据无法完整回答负结果保留、删除数据对知识状态的影响、世界模型版本和跨供应商移交。

## 与 Pero 的对照

Pero 采用 master 371ea089 的 [统一比较基线](../README.md#pero-比较基线)：Control Lab 是控制器/ngspice 等受控仿真，Lab 为 PyLabRobot 软件仿真。以下为研究方向对照，不代表 Pero 已实现企业级知识治理或物理实验闭环。

| Pero 方向 | Kosmos 带来的压力 | 具体建议 |
|---|---|---|
| Research | 长时间、多分支、可干预研究 | 将目标、假说、任务、证据、失败、审阅建成对象 |
| Paper | 文献与计算证据合并 | 保存原文定位、支持条件与反证，而不只存参考文献 |
| Data | 组织数据和持续世界模型 | 先做好版本与来源，避免把聊天记忆冒充知识治理 |
| Host | 计算供应与工具执行 | 暴露实际预算、资源账单、任务可恢复状态 |
| Virtual Cell | 多组学/模型分析邻接 | 用明确模型验收，不能以代理推理代替生物预测验证 |
| Control Lab | 研究规划邻接，未确认等价受控仿真功能 | 区分建议、批准、仿真执行、指标检查；真实实验另设验收 |

开源和模型中立仍可能有价值，但 Kosmos 也已公开宣称 model agnostic。Pero 必须用实际可替换接口、项目导出和重新运行证明，而非只靠定位措辞。

## 优先实测清单

1. **研究价值而非报告长度：** 固定一个公开数据目标，预先确定有意义的假说和负对照；盲评每条新结论的证据及增量价值。
2. **多重检验：** 比较是否记录探索了多少假说、是否做合适校正、是否保留失败/不显著结果。
3. **可干预性：** 中途更改约束或发现标签错误，检查后续计划和已有结论是否一致更新。
4. **长任务恢复：** 断开会话/工具、替换数据快照，检查重复任务、遗漏和成本边界。
5. **证据审计与移交：** 随机抽取结论，另一名研究者能否定位代码、样本和原始段落；停用服务后还剩什么。
6. **企业专用验收：** 模拟部门权限冲突、撤回资料、旧决策纠正，观察是否泄漏或引用已失效上下文。

## 官方来源与用途

- [Edison 当前官网](https://edisonscientific.com/)：产品形态、部署和服务模式。
- [2025-11-05 Kosmos 发布](https://edisonscientific.com/news/announcing-kosmos)：架构、历史价格、FutureHouse 迁移及已披露限制。
- [2026-05-19 Incyte 与新 Kosmos](https://edisonscientific.com/news/building-ai-native-biopharma-announcing-our-partnership-with-incyte-corporation-and-kosmos-for-r-d-teams)：新交互、企业接入、订阅变化。
- [2026-10-29 Pfizer 协议](https://edisonscientific.com/news/edison-scientific-announces-agreement-with-pfizer-to-accelerate-research-and-development)：新增合作及实施方式。
- [2026-11-04 Incyte Kosmos TA 案例](https://edisonscientific.com/news/bringing-broader-evidence-and-expert-judgment-into-target-assessment-earlier)：专门工作流及回顾性评估边界。

[返回竞品索引](../README.md)
