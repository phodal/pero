# CoCalc 与 Pero 的竞品研究

[返回总索引](../README.md)

核验日期：2026-11-07。依据当前 CoCalc.ai 官网、CoCalc 手册和 OnPrem 文档；未登录实测或安装部署。

**结论：** CoCalc 已不能只归类为“带 AI 补全的协同 Notebook”。当前产品把 Codex/Claude Code 与持续存在的项目文件、notebook、终端和协作者放在一起，并新增免费自运营 Star 及本地 Plus 路径。它对 Pero Host/Data 和整体计算研究空间形成较直接压力。

## 1 定位及与旧资料的差异

CoCalc 长期服务数学、科学计算、研究、教学和多人协作。工作单位是项目，项目内包含代码、文档、计算资源及历史。当前 CoCalc.ai 官网进一步强调由 Agent 建立或修改应用、报告和图表，研究者在同一项目中查看并接管结果。[平台手册](https://doc.cocalc.com/)、[当前官网](https://cocalc.ai/)

**重要纠正：** 旧手册称 CoCalc 非完全开源，自运行需要许可；2026-11-07 当前产品页明确提供免费的 CoCalc Star，由用户自行运营。应区分产品版本和发行路径，不能再笼统声称“CoCalc 不能免费自托管”。免费可部署也不自动等于采用 OSI 开源许可。[旧许可说明](https://doc.cocalc.com/alternativeto/jupyterhub.html)、[当前部署产品](https://cocalc.ai/products)

## 2 功能与可操作工作流

以下依据官方文档还原，**本次没有实际启动项目或 Agent**。

1. 按团队治理需求选择 CoCalc.ai 托管、单用户本地 Plus、共享单机 Star，或另行洽谈较大私有部署。
2. 把公开数据、notebook、脚本和说明放入同一项目，选择运行环境和必要计算资源。
3. 在项目聊天中让集成 Codex 或站点启用的 Claude Code 使用文件、命令和 notebook 状态；其他命令行 Agent 可在终端使用。
4. 人类与 Agent 在同一批文件上工作，打开实际生成的报告、图表和应用，确认文件确实存在且内容正确。
5. 使用历史与恢复机制检查修改，保留必要输出；多人协作时明确谁在运行、谁在审阅。
6. 导出 `.ipynb`、代码和数据，在独立环境验证能否重跑。[Agent 工作流](https://cocalc.ai/features/ai)、[Notebook 格式与协作](https://doc.cocalc.com/jupyter.html)

**通用能力：** 官方手册列出 Jupyter、LaTeX、多语言、协同 Linux 终端、TimeTravel、计算服务器和教学工具。其优势在于把计算和协作当成核心工作，不只是一次对话的临时附件。[CoCalc 手册](https://doc.cocalc.com/)

## 3 部署路径的具体区别

| 路径 | 官方说明 | 需要特别核查 |
| --- | --- | --- |
| CoCalc.ai | 厂商运营的托管项目和会员方案 | AI 权益、项目资源、备份及额外算力费用 |
| CoCalc Plus | Linux 或 Apple silicon Mac 上的单用户本地运行时 | 本地文件权限、远程模型出站、更新机制 |
| CoCalc Star | 免费的单 Docker 共享站点，由用户运营 | 备份、升级、主机权限、隔离和单机可用性 |
| OnPrem | 单独的企业部署文档和支持路径 | 合同、当前发行件、规模化及许可边界 |

来源：[产品总览](https://cocalc.ai/products)、[Plus](https://cocalc.ai/products/cocalc-plus)、[Star](https://cocalc.ai/products/cocalc-star)、[OnPrem 4.3](https://onprem.cocalc.com/index.html)。

**Star 边界：** 官方说明是单机而非高可用或横向扩展方案；运营者负责 Docker volume 备份，升级会停止运行项目。其安装示例涉及 privileged 容器，评估时应专门审查主机安全，不能把“每项目容器”直接等同于已通过安全审计。[Star 部署细节](https://cocalc.ai/products/cocalc-star)

**Plus 边界：** 当前页面面向个人本地工作，部分命名 Agent、共享、快照和备份等能力属于托管路径。远程 Agent 请求仍会离开本机，因此“在自己电脑运行”不等于数据不出站。[Plus 能力与限制](https://cocalc.ai/products/cocalc-plus)

## 4 优势及对 Pero 的压力

- **持续项目比短时沙箱更贴近真实研究。** 文件、服务、交互计算和协作者可以围绕同一任务长期积累。
- **人可以直接接管 Agent 的产物。** 用户看到的是可编辑 notebook、代码或文档，而不是只能继续聊天的黑箱结果。
- **有成熟协同计算基础。** Jupyter 标准格式、多人编辑和历史能力为团队使用提供现实基准。[Notebook 说明](https://doc.cocalc.com/jupyter.html)
- **部署选择扩展。** Star 和 Plus 降低“必须迁入厂商托管平台”的门槛，使 Pero 不能只靠本地或自托管标签建立区别。

以上是公开产品能力分析，不表示本次验证过稳定性、隔离强度或长期任务可靠性。

## 5 局限、许可与总成本

**科学语义仍不是核心。** 本次未确认其原生将论文主张、实验假设、数据版本、偏倚判断和复核签署组织为统一科研对象。可以在项目里搭建这些流程，不等于产品已经提供并验证。

**历史不等于复现。** TimeTravel 或快照能找回文件，不自动保存外部数据下载、系统库、GPU 驱动、随机性和运行时隐藏状态。标准 `.ipynb` 可导出只证明文件可迁移，不证明环境可重建。

**许可须按发行件核查。** 旧官方比较文档使用 Microsoft Reference Source License 的说明；OnPrem 4.3 文档称其代码与配置为专有。新 Star 免费可部署，当前公开产品页不足以证明全部源码具有同一开放许可。本篇不将 CoCalc 写成完全开源，也不否认官方明示的免费部署权利。[许可说明](https://doc.cocalc.com/alternativeto/jupyterhub.html)、[OnPrem](https://onprem.cocalc.com/index.html)

当前 CoCalc.ai 价格页展示如下会员价格，保留官网 `$` 符号；币种、地区适用性与税费待具体账户结账确认：[当前价格](https://cocalc.ai/pricing)

| 方案 | 月付 | 年付月均 |
| --- | --- | --- |
| Free | 免费入口 | 不适用 |
| Basic | $8 | $6 |
| Standard | $24 | $18 |
| Pro | $200 | $150 |

专用 VM、资源规模、模型调用和组织支持可能增加成本。不同部署路径的 AI 权益不同；不能直接把旧 AI Assistant 的按调用收费规则套到新官网所有会员和 Agent 上。[现行会员说明](https://cocalc.ai/pricing)

## 6 与 Pero 的比较

Pero 以 master `371ea089` 为本次比较基线，涵盖 Paper、Data、Control Lab、Virtual Cell 和 Host 等研究工作空间能力。可确认事实和未验证范围统一见 [Pero 比较基线](../README.md#pero-比较基线)；本篇没有独立重验 Pero 代码或科学性能。同日较晚的主干已经有本地 Python notebook 内核和交付证据链接，范围见 [基线之后的同日主干](../README.md#基线之后的同日主干)。那次增补不是持续存在的协同项目，也不替代本篇未做的同题实测。

| 层面 | CoCalc 的公开能力 | Pero 应证明的价值 |
| --- | --- | --- |
| 计算与 Agent | 项目、notebook、终端、集成 Agent | 跨科研阶段的默认流程，而非再加一个聊天面板 |
| 部署 | 托管、单用户本地、免费单机共享及企业路径 | 开放许可、可控运行和运维成本的具体区别 |
| 数据与历史 | 文件、编辑历史、恢复机制 | 数据/实验/结论依赖及失效传播 |
| 团队研究 | 实时协作与标准计算格式 | 专门证据审核和实验责任链 |
| 科学质量 | 本篇未验证科学推断准确性 | 实验结果独立重算与领域指标验收 |

**建议：** 把 CoCalc 放入 Pero 的第一批复现任务和协作可靠性对照，而不是只列为远端参考。对于已经在 Jupyter 和终端里工作的团队，它可能是更接近的替代方案。

## 7 建议实测与待验证问题

同公开数据、同分析规格和相近资源预算，分别测试托管与适合团队的自运营路径，不能跨版本混用结果。

1. 长任务在浏览器断开、kernel 重启和主机升级时如何恢复？
2. 多人和 Agent 同改一个 notebook 时是否有覆盖、状态错乱或误执行？
3. 导出的项目能否在第二台机器复算，缺少哪些环境描述？
4. 快照恢复是否覆盖数据、代码和输出，还是只有部分文件？
5. Star 的主机权限、租户隔离、备份恢复及升级停机是否满足实验室要求？
6. 模型数据出站和共享密钥是否受站点级治理？
7. API/CLI 自动化是否保留完整日志与费用，并能接入 Pero 的证据对象？

指标包括独立重算成功率、恢复耗时、编辑冲突、人工干预次数、资源和模型总费用。产品声明的“持续项目”不能直接折算为这些指标已达标。

## 8 证据说明与来源

本次重新核验发现官网与旧资料存在产品演进，已在文中保留时间和发行路径差异。没有安装 Star/Plus、测试收费、审计源码或验证私有部署。

主要来源：[官网](https://cocalc.ai/)、[产品路径](https://cocalc.ai/products)、[Agent](https://cocalc.ai/features/ai)、[价格](https://cocalc.ai/pricing)、[Star](https://cocalc.ai/products/cocalc-star)、[Plus](https://cocalc.ai/products/cocalc-plus)、[Notebook](https://doc.cocalc.com/jupyter.html)、[许可背景](https://doc.cocalc.com/alternativeto/jupyterhub.html)、[OnPrem](https://onprem.cocalc.com/index.html)。
