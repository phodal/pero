# Jupyter AI 与 Pero 的竞品研究

[返回总索引](../README.md)

核验日期：2026-11-07。当前官方稳定文档为 v3.2.0；本次未安装运行或进行模型质量评测。

**结论：** Jupyter AI 已是 Notebook 原生 Agent 入口，而非早期仅生成文本的 magic 插件。它开源、贴近已有计算工作流，是 Pero 在计算科研团队中的直接替代组合之一。

## 1 定位与目标用户

Jupyter AI 把 Agent 和模型交互放入 JupyterLab，主要面向已经依靠 notebook、代码、终端和文件开展研究的计算科学家、分析师及研发团队。用户不必先把现有分析迁移到新科研平台。

**官方架构：** Jupyter AI 是聊天宿主；persona 是模型或 Agent 的接入点；ACP 用于连接外部 Agent；Jupyter MCP server 提供 notebook 和工作空间操作。聊天面板本身不是模型，也不是所有动作的执行器。[用户指南](https://jupyter-ai.readthedocs.io/en/stable/users/)

这一区分决定竞品比较单位：应评估“Jupyter AI + 指定 Agent + 指定模型 + 环境”，不能拿空插件和已配齐模型的 Pero 比效果。

## 2 功能与实际工作流

按官方文档还原的流程如下，**非本次实测**：

1. 在科研 Python/Jupyter 环境安装 Jupyter AI。当前入门文档明确默认不附带任何 Agent，需要另行安装所选 Agent，有些还需 ACP adapter。
2. 在 JupyterLab 创建命名聊天，选择 persona 或 Agent，将 notebook 单元格和相关文件作为上下文。
3. 让 Agent 检查数据处理代码、创建或修改 notebook、运行 kernel 单元格并解释错误；对需要的操作处理权限请求。
4. 研究者在同一界面检查输出、修改代码、重新运行，避免只接受对话中的成功陈述。
5. 如需要外部文献或专业工具，可配置自定义 MCP server；生产使用前检查其权限、数据出站和失败行为。
6. 固化环境与输入，导出 notebook、代码和结果，交由第二人从干净 kernel 重跑。[安装与 Agent 配置](https://jupyter-ai.readthedocs.io/en/stable/getting-started.html)、[工具与权限流程](https://jupyter-ai.readthedocs.io/en/stable/users/)

**当前版本的具体变化：** v3.2.0 于 2026-09-03 发布，将实时协作 RTC 改为可选依赖；没有 RTC 时 persona 仍能编辑、运行和调试 notebook。官方同时说明，磁盘上 notebook 文件变化尚不由新的 live-content 机制可靠实时刷新，普通文本文件刷新也有滚动位置限制。[v3.2.0 发布说明](https://jupyter-ai.readthedocs.io/en/stable/releases/v3.2.0.html)

## 3 优势

- **迁移成本低。** 科研团队已经拥有的 `.ipynb`、Python 包和计算环境可继续使用，Agent 嵌入原工作场景。
- **计算状态与交互更接近。** 用户可以直接检查单元格、输出和文件，不必把所有执行结果抽象成聊天中的概述。
- **模型和工具可替换。** 多 Agent 接入与 MCP 使底层能力可随团队需求组合，降低单一模型绑定。[官方仓库](https://github.com/jupyterlab/jupyter-ai)
- **开源适合定制。** 仓库采用 BSD-3-Clause，适合研究机构审查和扩展自身工作流；但外部 Agent、模型和服务各有独立许可。

上述优势不等于默认安装就具备可靠实验管理，仍需团队配置和维护。

## 4 限制与风险

**集成复杂度转移给团队。** 插件、JupyterLab、Agent、adapter、模型账户和 MCP 服务都可能有版本或权限问题。应记录完整组件清单，而不是只固定 `jupyter-ai` 版本。

**Notebook 隐藏状态仍然存在。** 乱序运行单元格、残留变量、未保存输出和外部文件变化可能使“当前能跑”无法在干净环境复现。这是 notebook 工作流的一般风险，本次未量化 Jupyter AI 的表现。

**Agent 权限不等于科学审核。** 授权执行一段代码仅说明允许操作，并不说明模型选对统计方法、避免数据泄漏或解释正确。

**本地部署不等于数据完全本地。** 如果选用远程模型或托管 MCP，提示、文件片段和结果仍可能出站；应按每个组件核对数据处理条款。

**实时协作需要区分实现。** v3.2 可选 RTC；已有磁盘刷新限制不等于所有 Agent notebook 编辑都失效，但意味着多人、外部写入与界面同步必须专门测试。[版本边界](https://jupyter-ai.readthedocs.io/en/stable/releases/v3.2.0.html)

## 5 部署、定价与许可

- **许可：** Jupyter AI 官方仓库标为 BSD-3-Clause。不能把这一许可自动套到所有 Agent、模型权重、专业工具或文献数据上。[仓库与许可](https://github.com/jupyterlab/jupyter-ai)
- **部署：** 可安装到用户管理的 Jupyter 环境；官方提供 PyPI、Conda Forge 等安装路径。是否能用于现有共享服务器，应结合管理员权限和依赖兼容测试。[安装文档](https://jupyter-ai.readthedocs.io/en/stable/getting-started.html)
- **成本：** 本体没有商业 SaaS 订阅价格；算力、存储、外部 Agent/模型和运维分别计费。免费开源不等于每次分析零成本。
- **团队配置：** Agent 的执行权限、模型凭据、MCP 出站策略和共享目录需要统一治理。本次没有安装软件、创建凭据或改变环境权限。

## 6 与 Pero 的比较

Pero 以 master `371ea089` 为本次比较基线，涵盖 Paper、Data、Control Lab、Virtual Cell 和 Host 等研究工作空间能力。可确认事实和未验证范围统一见 [Pero 比较基线](../README.md#pero-比较基线)；本篇没有独立重验 Pero 代码或科学性能。

| 层面 | Jupyter AI 组合的强项 | Pero 需要证明的增量 |
| --- | --- | --- |
| 开源与环境 | 现有 Jupyter 环境可用，组件可定制 | 不能把“开源、有 Agent、能跑代码”作为独有能力 |
| 计算研究 | notebook 原生读写运行与调试 | 跨任务依赖、数据版本和环境重建减少多少人工 |
| 文献证据 | 可通过工具扩展，但非核心科研对象 | Paper 到实验的证据绑定是否默认可靠 |
| 领域能力 | 依靠外部工具或项目代码 | Control Lab/Virtual Cell 有无经验证的专用能力 |
| 研究协作 | 可选 RTC 和已有生态 | 审阅、变更影响和长期任务的质量是否更好 |

**优先建议：** 将 Jupyter AI 纳入第一批头对头测试。如果 Pero 主要只是把常用工具放进同一个外壳，却不能减少环境重建和证据搬运，现成插件组合可能更经济。

## 7 建议实测与待验证问题

给定公开数据、锁定的分析规格和相同模型预算，比较两个完整配置，而不是两个产品名称。

1. 从全新环境开始能否安装依赖、正确加载数据并完成分析？
2. Agent 是否读取了真实 notebook 状态，能否处理 kernel 重启和乱序单元格？
3. 人和 Agent 同时编辑时是否丢改动，外部文件更新何时进入界面？
4. 操作权限是否明确，拒绝后能否继续不受影响的工作？
5. 数据、代码、环境和种子是否被一起保存，第二人复算是否一致？
6. MCP 引入的文献证据是否能追到最终图表和解释？
7. 任务成功、科学指标合格和结果可复算是否分别记录？

建议记录人工修复次数、环境建立时间、模型与算力成本、独立重跑成功率、统计方法错误及结果偏差。

## 8 证据说明与来源

本次完成官方文档与仓库核验，未安装、运行或审计完整源码。主要来源：[用户指南](https://jupyter-ai.readthedocs.io/en/stable/users/)、[入门配置](https://jupyter-ai.readthedocs.io/en/stable/getting-started.html)、[v3.2.0](https://jupyter-ai.readthedocs.io/en/stable/releases/v3.2.0.html)、[官方仓库](https://github.com/jupyterlab/jupyter-ai)。
