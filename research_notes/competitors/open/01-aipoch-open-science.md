# AIPOCH Open Science 竞品研究

核查日期：2026-11-07。对象为 [aipoch/open-science](https://github.com/aipoch/open-science)，不是 ai4s-research 的 Open Science Desktop，也不是 Synthetic Sciences OpenScience。本报告用于 Pero 产品决策；依据官方 README、能力边界、安全文档及发行记录，未安装、未运行同题测试。下文“支持”表示官方公开说明，不能理解为独立验收通过。

## 结论

AIPOCH 是 Pero 的一级直接竞品：它已把文献库、科研执行、产物版本、独立上下文审阅和研究记录交换放在同一产品。最值得研究的不是 skills 数量，而是**从研究过程挑选证据、冻结版本、交给另一位研究者继续核查**的完整交付体验。Pero 不能只靠“本地优先、模型中立、可追溯”构成差异；应比较同一研究结果的准备、审查、重跑及交接成本。

同时，`.science` 不是任意科研过程的一键复现保证。官方明确区分查看记录、可写分叉、单产物重跑和科学有效性，且不提供确定性的全会话重演。[能力地图](https://github.com/aipoch/open-science/blob/main/docs/ROADMAP.md)

## 产品定位与目标用户

- **主要对象**：从问题、论文或数据出发，进行 Python/R 分析、生成图表并需要向合作者解释结果来源的科学家。
- **主要任务**：整理文献和附件，开展 AI 辅助探索，执行本地或实验室计算，检查结果，交换完整程度可见的研究记录。
- **采用方式**：个人桌面应用为主，同一后端可用于本地 Web、CLI 和 SDK。不是默认提供团队实时编辑或多租户 SaaS 的科研协作平台。
- **竞争关系**：与 Pero 的 Paper、Data、Host、研究证据交付直接重叠。它的主产品是通用研究工作台，而非某一固定科学方法的专业 App。[README](https://github.com/aipoch/open-science/blob/main/README.md)、[使用范围](https://github.com/aipoch/open-science/blob/main/docs/usage-scope.md)

## 核心功能与典型工作流

### 文献进入项目

Literature Library 支持 DOI、arXiv、PMID、PMCID 或文章链接录入，批量导入、集合、标签、项目关联、去重、笔记、全文和补充材料。PDF 标注绑定具体文件版本，支持扫描件 OCR、图表提取及文献概览。Zotero 10+ 是同机单向导入，不是双向同步。智能筛选保留 AI 与人工决定，筛选结果可以导出，但官方不把它等同于完整系统综述协议。

产品细节体现其目标不是一次聊天：批量概览会保留已完成结果，失败后可以继续；概览标出依据全文还是摘要；撤稿/勘误检查需要手动查询 Crossref，而且“未找到通知”不等于论文没有问题。[README 文献能力](https://github.com/aipoch/open-science/blob/main/README.md)

### 从会话到真实执行

用户在项目中指定问题、输入和预期输出，选择模型与审批模式，引用文件或技能。五类 Agent 后端包括 Claude Code、OpenCode、Codex、CodeBuddy 和 Pi；模型兼容性取决于所选后端及接口协议，不是所有模型在所有后端上等价可用。Python/R、Notebook 和 Shell 可使用受管理环境或用户解释器，支持后台任务、SSH 和 Slurm。远端主机的软件、目录权限、资源与作业权限仍由用户准备。

可选 Reviewer 在独立上下文检查当前回合的回答、日志和文件证据，并触发有次数限制的修正。它能增加核查机会，但审阅范围受当次可用记录约束，不等于独立科学专家审稿。[README](https://github.com/aipoch/open-science/blob/main/README.md)、[能力地图](https://github.com/aipoch/open-science/blob/main/docs/ROADMAP.md)

### 从结果到交接

1. 产物进入不可变版本记录，用户查看生成代码、输入、运行、环境与审阅证据。
2. 对资料齐全、运行环境可用的版本执行 artifact replay，并比较输出；缺失信息显示为缺失，不自动补造。
3. 导出 `.science` 时明确选择分支、文件版本、Notebook 记录和验证材料。
4. 接收者导入后先只读查看记录。导入不运行代码、不调用模型、不恢复凭据。
5. 进一步提问生成关联讨论；需要继续研究时建立可写 fork。真正重跑仍需要完整 recipe、输入与 runtime。

Side Chat、私有阅读书签和凭据不进入研究包；其他敏感内容仍可能存在于选中的代码、日志和文件中。桌面端另支持 RO-Crate 1.1 导出及有条件的环境 bundle 恢复。新发布的 narrated research film 是过程展示，也不应被当作执行验证。[研究包说明](https://aipoch.com/docs/guides/research-packages/)、[v1.1.0](https://github.com/aipoch/open-science/releases/tag/v1.1.0)

## 架构与部署

官方架构为 Electron + React/TypeScript 客户端、普通 Node 后端、Prisma/SQLite 数据层和 ACP 运行时。Desktop、localhost Web、CLI/SDK 共用服务与数据目录；每个数据目录由一个 runtime 管理。安装包覆盖 macOS Intel/Apple Silicon、Windows x64、Linux x64/ARM64；独立 CLI 压缩包携带 Node，npm 安装则要求相应 Node 版本。

此结构有利于界面和自动化复用研究状态，但官方明确 **Web/CLI 不代表桌面全部能力等价**。移动设备通过局域网或 Pinggy 隧道控制主机工作区，选择互联网隧道时流量经过 Pinggy。MCP 适配器可以让外部客户端修改记录并产生模型费用，并非另一个只读沙盒。[README 架构和访问方式](https://github.com/aipoch/open-science/blob/main/README.md)

## 数据与安全边界

项目、版本和日志默认本地保存；可用时使用操作系统安全凭据存储。模型、连接器、更新、市场、下载与远端计算仍可能对外通信。官方“日志不自动上传”不能外推为所有第三方 Agent runtime 都无 telemetry。

需要尤其注意：Notebook 文件夹限制不覆盖所有 Agent 原生工具或远端进程；Windows 标准模式与 protected mode 不同；公开 HTTPS 读取通道也不是严格的目的地址白名单。Linux headless 的显式文件凭据模式使用可逆 base64，不能称为加密。审批表示允许执行，不是强制系统隔离。[已知限制](https://github.com/aipoch/open-science/blob/main/docs/known-limitations.md)、[安全使用说明](https://github.com/aipoch/open-science/blob/main/docs/usage-scope.md)

## 成熟度 许可与商业边界

- GitHub latest release 核查为 **v1.1.0，2026-11-06**，有三平台与独立 CLI 发行资产。版本号不是可靠性证书，主线文档还可能包含晚于发行包的变化。
- 主项目采用 **Apache-2.0**；模型服务、连接器和第三方软件分别适用自身条款。[LICENSE](https://github.com/aipoch/open-science/blob/main/LICENSE)
- 有安装、更新、故障诊断、兼容与安全边界文档，说明产品化投入已超出原型演示。但不据此推断企业 SLA、活跃用户、收入或付费客户。
- 当前材料不能确认统一商业收费方案；开源许可不意味着模型和计算免费。
- 官方报告多个文献/科研 benchmark，但存在不同 split、历史对照、模型和 judge 条件；部分数字来自本地内部运行，未为当前 release 重跑。不能据图表称“全面领先”或替代同预算实测。[README 评测说明](https://github.com/aipoch/open-science/blob/main/README.md)

## 优势与限制

**已公开的产品优势**：文献管理入口完整；原文、批注、执行、版本和交接串联较具体；多种客户端共享状态；将证据缺失和重跑条件写成显式边界，便于形成可信交付体验。

**限制**：缺少完整环境时不能重跑；全会话确定性复现未提供；无实时多人会话编辑；没有托管云 GPU；技能/专家的用户可见版本固定仍在路线图；跨执行路径安全策略并不一致。大型文件可上传不代表全文可解析或能全部进入模型上下文。上述多数是官方已承认边界，不是本次发现的运行故障。[能力地图](https://github.com/aipoch/open-science/blob/main/docs/ROADMAP.md)

## 与 Pero 比较和可借鉴之处

比较基线采用 Pero 固定提交 `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b`，不能沿用旧 README 把 Data、版本和研究恢复一概写成未实现。Pero 已有 Paper 原文锚点与持续研究、Data 不可变版本与检查、Host 执行和若干固定方法的独立 checker；仍为 development preview，通用跨 App 闭环与真实模型科学质量尚待证明。[Paper](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/paper-agent/README.md)、[Data 验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/data-workspace.md)

1. **优先借鉴交接对象**：研究包应冻结证据选择，明确漏掉哪些输入，而不只是压缩整个目录。
2. **将验证落到某个版本**：显示检查运行、比较器、环境和失败原因，不把聊天里“看起来正确”变成 PASS。
3. **将文献判断与计算结果相接**：Pero 已有精确原文定位，可把论文中的一个数值接到固定方法重分析，再回写检查状态。Fisher 案例已有方法验证，但通用 Desktop 路由尚未闭环，不能宣传为现成优势。[Fisher 验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md)
4. **避免先比目录规模**：525 个 marketplace skills 或几十个连接器有发现价值，但不能证明部署成功率和科研产出质量。Pero 更适合先证明一条领域 App 路径少花多少人工核查时间。

## 待验证问题与建议测试

- 相同原文和数据，在相同模型预算下，跨机导入后能否找回每个关键结论的精确依据？记录人工分钟数、缺失依赖和错误关联。
- Python/R 及 SSH/Slurm 的取消、断连、重启恢复能否防止重复执行与遗漏产物？分别测，不混为“支持远程”。
- 改动输入、删除中间文件或改变环境后，哪些结果会被降级，哪些会错误地继续显示已验证？
- Reviewer 能否检出单位、过滤、统计检验和图文不一致？与独立人工标注比误报和漏报。
- `.science` 含敏感路径、日志或患者标识时，导出审阅的实际粒度是否足够？不以“排除凭据”替代内容审查。

以上为下一轮实测方案，**本报告未执行**。

## 官方来源

- [项目 README](https://github.com/aipoch/open-science/blob/main/README.md)
- [v1.1.0 发行记录](https://github.com/aipoch/open-science/releases/tag/v1.1.0)
- [能力地图与路线图](https://github.com/aipoch/open-science/blob/main/docs/ROADMAP.md)
- [研究包指南](https://aipoch.com/docs/guides/research-packages/)
- [已知限制](https://github.com/aipoch/open-science/blob/main/docs/known-limitations.md)
- [安全使用范围](https://github.com/aipoch/open-science/blob/main/docs/usage-scope.md)
- [Apache-2.0 许可](https://github.com/aipoch/open-science/blob/main/LICENSE)

[返回竞品索引](../README.md)
