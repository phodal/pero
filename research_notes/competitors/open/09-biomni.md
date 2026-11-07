# Biomni OSS：生物医学 agent、领域环境与工具资产

核查日期：2026-11-07。范围为 snap-stanford/Biomni 开源仓库的 A1 agent 和相关环境，不把当前 hosted Web 平台或 Biomni Lab 的体验算成 OSS 能力。本次读取官方 README、配置及环境指南；未安装环境、未运行生物学实验、未重跑 benchmark。

## 1. 定位、用户与竞争关系

Biomni 定位为通用生物医学研究 agent，结合 LLM 推理、检索增强规划与代码执行，帮助研究者执行跨生物医学子领域任务、提出可检验假设。目标用户是需要多类生信工具、数据库和实验知识的生命科学研究者，而不是仅需要通用代码补全的人。[S1]

与 Pero 的关系是相邻竞品兼集成候选：它对 Virtual Cell 等生命科学方向构成直接任务层竞争，但并非以跨学科科研 App 和分布式 Host 产品框架作为主卖点。研究其价值应看具体生物任务和工具生态，不能只比较聊天界面。若 Pero 借用 Biomni 工具，还必须补齐环境隔离、输入版本、任务验收和组件许可管理。

## 2. 核心功能与具体工作流

典型入口是创建 A1 对象并用自然语言发起任务。官方示例包括单细胞 RNA-seq 注释并提出假设、规划寻找 T 细胞耗竭调节基因的 CRISPR screen，以及预测化合物 ADMET 性质。这些是任务入口与示范，不代表每次都会选对分析方法、得到可靠生物学结论，更不是临床诊断或真实湿实验结果。[S1]

例如单细胞工作流可理解为：研究者提供数据路径和问题；agent 检索相关工具及 know-how，生成代码调用安装好的分析库；输出注释、图表与解释；研究者检查质控、标记基因、批次效应和结论依据。具体算法及顺序仍须在一次真实执行轨迹中核实，不能从“有 scRNA 示例”推断平台强制执行全部最佳实践。

Know-How Library 包含分析最佳实践、实验 protocol、故障排查和设计知识，按相关性检索给 agent 使用，元数据包括作者、所属机构、许可和商业使用标记。官方称 commercial mode 会过滤非商业内容；这比没有许可标签好，但只是内容治理机制，不是覆盖所有工具和数据的法律担保。

MCP 支持接入外部工具，也有将 Biomni 暴露为服务的示例；Gradio 可提供本地交互 UI；会话执行记录可导出 PDF。PDF 是阅读与交接材料，不自动封装全部依赖、输入数据、随机种子和可重跑环境，不能把“有执行记录 PDF”写成完整复现包。

Biomni-Eval1 官方描述 433 个实例、10 类生物推理任务，涉及 GWAS 因果基因、实验问答、筛选基因、稀有病等。它为领域评测提供比通用聊天更具体的起点，但任务覆盖和标注标准不等于所有生物任务准确，也不证明临床可用。Biomni-R0 是另一个模型资产：基于 Qwen-32B、以 agent 交互数据强化学习的生物推理模型，不应把模型权重能力和 OSS harness 能力混为一项。[S1]

## 3. 架构与部署成本

Biomni 是 Python agent 加科学软件环境，而不是无需配置的完整桌面发行版。主要流程先建立 Conda 环境，再安装 pip 包或源码；首次默认下载约 11GB 数据湖，可通过空的 expected_data_lake_files 跳过，代价是依赖这些数据的任务不能凭空可用。跳过数据湖适合轻量开发，不是完整功能免费缩小版。[S1]

环境指南直接说明完整 E1 安装脚本可能需要 **超过 10 小时和至少 30GB 磁盘配额**，官方只注明在 Ubuntu 22.04 64 位测试过该脚本。精简环境不含 R/CLI 工具，也仍需约 13GB。另有特定拷贝数分析的 Python 3.10 环境。这意味着“pip install biomni”不等于所有科学工具安装完成；计算镜像、依赖冲突和缓存策略是实际采用成本。[S3]

README 承认一些包因冲突未默认安装，可能需要额外安装或修改启用相关代码。Gradio 当前要求 5.x，6.x API 变化可能不兼容。部署规划应固定 agent、环境、科学库和数据湖版本，而不是把主线升级视为无风险操作。

## 4. 安全、模型路由与数据边界

最重要的官方警告是：Biomni 当前以完整系统权限执行 LLM 生成代码，可访问文件、网络和系统命令；生产使用需要自行隔离/沙箱。没有证据表明 A1 默认提供强多租户隔离。处理未公开组学数据、受试者信息或机构凭据前，应独立审查数据授权、模型路由、网络出口与执行环境。[S1]

Gradio 配置也有容易忽略的边界：README 给出的 server_name 默认是 0.0.0.0，可改成 127.0.0.1；share=True 会产生公开分享链接；示例访问码不能视为适合生产的认证。不能因为页面地址写 localhost 就推断只在 loopback 监听。

**本地模型不自动等于全链路本地。** 配置指南明确：传给 A1 的 llm 参数只影响该 agent 推理，数据库查询仍使用 default_config。官方 R0 示例甚至有意让本地模型做推理、另一个外部提供商处理数据库查询。需要统一数据边界时，应核对全局配置、具体工具和 MCP，而不仅检查主模型名字。[S2]

会话 PDF、日志、数据湖和结果文件也可能含研究材料；没有依据可以声称自动脱敏或满足医疗合规。本次不对数据保留、审计认证、零遥测或企业权限作无证据保证。

## 5. 成熟度、许可与商业边界

本次已直接读取 [LICENSE 全文](https://github.com/snap-stanford/Biomni/blob/main/LICENSE)，确认为 Apache-2.0（blob SHA `261eeb9e9f8b2b4b0d119366dda99c6fd7d35c64`）。分发应保留许可、归属和适用 NOTICE，修改需标明；许可不授予商标权。Biomni 主代码许可开放，但官方特别提醒集成工具、数据库、软件可能有更严格的商业限制。Know-how 的商业过滤不取代逐组件检查；R0 模型权重及其基础模型也需要单独许可审查。商业集成应列出所调用资产及数据来源，而不是只附主仓库 LICENSE。[S1]

官方当前 README 同时保留“此 release frozen as of April 15 2025，与当前 Web 平台不同”的说明。应把它理解为 OSS 与 hosted 的边界提醒，不应据此断言 main 自该日起完全停更，也不能拿 hosted 的新功能为 OSS 背书。

它已有研究论文、领域数据与工具、教程和可运行接口，适合研究原型和开发者整合；完整部署成本与权限风险仍较高。E2 为下一代环境的建设倡议，不能视为已交付全部能力。本次未核实 hosted 价格、付费账户、客户规模或服务承诺。

## 6. 优势、限制与 Pero 比较

优势是领域工具、数据与实验知识结合较深：用户能提出明确生物问题，评测也有相应任务资产。限制不是“缺少更多 agent”，而是环境巨大、部分依赖有冲突、执行权限过宽、模型配置容易出现分层外发，以及工具输出到可靠科学结论之间仍有距离。

Pero 对比以 master `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b` 为准：Paper 已有原文/锚点/连续研究，Data 已有不可变版本与检查，分布式 Host 与固定方法验收已存在；仍为 development preview，跨 App 全闭环和真实模型科学质量未证明。Compute App 只有连接草稿，但底层单节点 Slurm owner 已单独验收，不可笼统说没有算力能力。

Pero 可借鉴 Biomni 的任务定义、know-how 来源与许可标签、领域评测样本，而不是只复制自然语言入口。Virtual Cell 应选一条明确任务，如固定数据上的注释结果与可检验假设，比较实际产物和错误模式。Pero 已有数据版本和 Host 契约可用于约束 Biomni 式工具，但这种集成是否可靠仍需实测，不能直接当成现成优势。

## 7. 待验证问题和建议试验

1. 固定公开 scRNA 数据、预处理方法、预算和模型，对照人工参考及另一工具链，测注释准确率与批次效应处理。
2. 对 CRISPR 候选基因要求每条有来源、证据层级和实验条件，检查模型是否把推测包装成已知事实。
3. 从空环境安装至首次成功，记录时间、磁盘、依赖失败和手工修补；分别评估 E1 与精简环境。
4. 通过网络记录验证 A1、本地 R0、数据库查询和 MCP 的实际外发，检查是否符合预期数据边界。
5. 将同任务封装进 Pero 的固定输入版本、指定 Host 和验收方法，测试结果可移交性，而不仅比较响应文字。
6. 商用前逐项复核数据湖、tool、know-how 和模型许可；PDF 导出能否让第三方重跑也要独立检查。

## 8. 官方来源与证据限制

- [S1 README：任务、数据湖、Gradio、Eval1、R0、安全及 OSS 边界](https://github.com/snap-stanford/Biomni/blob/main/README.md)，本次读取，blob SHA `1968f2196d59f63a3b7110c554bd1626c10e123e`，不是仓库 commit。
- [S2 Configuration：A1 与数据库查询路由](https://github.com/snap-stanford/Biomni/blob/main/docs/configuration.md)，本次读取，blob SHA `c14e87c6ae04c8918e951bf29e32ae258a410133`。
- [S3 Environment Setup：安装时间、磁盘与测试平台](https://github.com/snap-stanford/Biomni/blob/main/biomni_env/README.md)，本次读取，blob SHA `a561401c99fc0aca1df7d924e58c49ddcd73f396`。
- [论文](https://www.biorxiv.org/content/10.1101/2025.05.30.656746v1)、[Eval1 数据集](https://huggingface.co/datasets/biomni/Eval1)，作为后续核查入口；本次未重跑论文。


### Pero 固定版本证据（补充核查）

以下链接均固定到比较基线 commit，而非移动的 master；本次读取的是仓库内记录，没有重跑这些验收：

- [Paper 实现与边界](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/paper-agent/README.md)：原文/PDF 版本、精确片段与页面锚点、冻结输入、连续追问均有具体说明；既有回答仅作意图上下文，不能转成支持证据。
- [Data Workspace fitness](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/data-workspace.md)：不可变输入版本、SHA-256、saved view 与完整输入检查，以及 2026-11-05 macOS Electron 的 v1/v2 历史、原始字节和重启记录；数值解释、错误定位亦有后续验收。其导入/检查有 10MiB 边界，不能延伸为大型数据流处理或科学结论验收。
- [Host 与 preview 状态](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/README.md)：任务派发、租约、取消和恢复已有实现；真实 Linux provider 验收与稳定发行仍有明确限制。不能用这份摘要中其他 planned 标签覆盖后续具体 fitness 证据。
- [固定 Fisher 方法验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md)：绑定真实 PDF、人工复核的 100 个观测、冻结容差与独立 Fraction checker，记录精确结果 19.1434 cm² 和 REPRODUCED；这是一条固定数值复算，不是自动理解全文、真实模型科研或完整跨 App 闭环证明。
- [环境与 Slurm owner fitness](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/ai4s-environments.md)：须阅读后半部“2026-11-06: live local, Docker, Compose and Slurm owner evidence”。Slurm 23.11.4 单节点 fixture 分别记录真实提交、allocation 侧 payload 哈希、输出/终态和运行中取消，属于这些 adapter 的 L2，而非生产调度器、accounting fallback、全部 App/Native/release 验收。该文件也明确记录历史检查的版本和后续未重跑部分。
- [Compute App README](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/compute/README.md)：App 仅保存连接草稿，不发 SSH 请求，jobs 为 null；不能把上项底层 owner 验收算成此 UI 已连接 Slurm。

[返回竞品索引](../README.md)
