# Open Science Desktop 竞品研究

核查日期：2026-11-07。研究对象为 [ai4s-research/open-science](https://github.com/ai4s-research/open-science)，原名 Open Science，下文简称 OSD。它与 AIPOCH Open-Science、Synthetic Sciences OpenScience 是三个独立项目。本次依据官方 README、发行说明和产品文档进行只读研究，未安装或运行模型、HPC、浏览器控制与复现测试。

## 结论

OSD 是 Pero 的一级直接竞品，竞争重点是**科研者每天使用的执行工作台**：模型、终端、Notebook、文件、远端服务器和产物记录在同一界面中持续工作。其双向 ACP、远程入口和持久终端降低采用现有 coding agent 的迁移成本。

但不能把“同一 runtime / 同一 Web UI”理解为所有部署具有相同证据链。官方 README 明示：**headless server 不追加 provenance.jsonl 或 run index，这些由桌面客户端写入**。这是与 Pero 比较无人值守执行和交付完整性时的重要边界。[README](https://github.com/ai4s-research/open-science/blob/master/README.md)

## 产品定位与目标用户

OSD 自称面向 macOS、Windows 和 Linux 的本地优先、模型中立科研工作台，也明确将 Claude Science 作为同类参照。主要适合拥有项目文件、科学软件、Notebook 或实验室服务器，希望把多个工具放到一个连续工作空间里的计算研究者。

它不是纯论文搜索，也不是只有一个自治 Agent 的命令行项目。项目、分屏、多个模型会话、恢复后的历史、远端任务和丰富文件预览都是核心产品对象。对 ML、生信、材料、物理以及跨学科计算工作有覆盖意图；具体领域质量仍取决于工具、技能、环境和模型。[README](https://github.com/ai4s-research/open-science/blob/master/README.md)、[同名项目辨析](https://github.com/ai4s-research/open-science/blob/master/docs/open-science-desktop-vs-openscience.md)

## 核心功能与工作流

### 研究链条以 skills 组织

官方将探索、文献调研、实验设计与代码、论文写作串成 ai4s-agent 工作流，并为不同阶段设定可检查的文件产物。还有文献完整性、统计、领域检查、图表、远端计算等 review skills。

这些设计的价值在于阶段成果落在真实项目文件，而不是仅保留聊天总结。但官方对论文页数、引用数量、图表数量的要求是技能目标，不是系统在任意任务上可保证兑现的交付标准；“publication-grade”也不是独立同行评审结论。[README 技能与能力](https://github.com/ai4s-research/open-science/blob/master/README.md)

### 项目和多会话研究

用户可创建项目，或直接采用已有目录而不复制文件；在多个 pane 和 Screen 中并行会话，选择各自模型与推理配置。全局与项目记忆、可搜索历史、归档恢复和上下文压缩服务于长周期研究。`/plan` 用于先规划，`/goal` 固定目标、约束与接受条件。

v0.7.1 的重点是将终端生命周期移到应用之外，使其在更新、重开和崩溃后保持；Claude Code、Codex、pi 等可与 OpenCode 并排使用，并在终端和会话之间切换。这为已有工作习惯的研究者提供渐进采用路径，不必一次替换所有工具。[v0.7.1](https://github.com/ai4s-research/open-science/releases/tag/v0.7.1)

### 计算与记录

OSD 提供真实 `.ipynb`、Python/R 本地 kernel 和受管理 Jupyter 环境。远端主机可从 SSH 配置登记与探测，支持本地、SSH/Slurm、Modal 和 notebook-batch 等运行；界面可提交、跟踪和取消任务。桌面 run logs 为 append-only，SQLite 索引便于搜索和过滤；provenance 文件记录文件版本及其对应运行或修改。

典型链条是：确定问题 → 搜集来源 → 建立实验代码 → 在指定机器执行 → 保存日志与文件 → 查看产物的输入/代码/环境关系 → 使用 review skills 核查 → 输出报告。输出链接、复现提示和环境记录有助于重跑，但并不自动证明完整依赖已捕获，或研究结论成立。[README](https://github.com/ai4s-research/open-science/blob/master/README.md)

### 既有工具与远端访问

双向 ACP 既允许在 OSD 中使用其他 ACP Agent，也允许外部编辑器驱动 OSD。MCP 提供文献和科学数据库接入。浏览器控制可使用用户现有 Chrome 身份或隔离浏览器；computer use 经平台 accessibility API 操作原生研究软件，并区分操作是否得到验证。这样能覆盖尚无 API 的科学应用，但本次没有验证具体软件兼容性。

token 验证的 gateway 默认 loopback，LAN 需启用，提供只读与完整访问模式。浏览器、手机或 CLI 可访问实际工作台；这是控制已有计算机，不是将执行迁移到手机。[README](https://github.com/ai4s-research/open-science/blob/master/README.md)

## 架构与部署

桌面为 Tauri 2 + React/TypeScript/Vite，UI 通过 SDK 接固定版本 OpenCode sidecar，后者与用户原有 OpenCode 配置隔离。Rust 的 osd-core 不依赖 Tauri，提供工作区、sidecar 和 gateway；osd-cli 支持无界面服务、项目/会话操作、JSON 输出和等待任务。

安装覆盖 macOS Intel/Apple Silicon、Windows x64、Linux x86_64/ARM64；可在无 root 环境安装。headless 自包含包适合服务器，但与桌面有以下重要差异：

- 无本地 Jupyter kernel、原生文件对话框和系统文件管理器入口。
- 会保存 workspace 的 git snapshots，但不追加桌面专属 provenance 与 run index。
- 不同 state-dir 用于独立实例状态，不是提高并发的必要方法；单 server 本身可运行多个会话。
- 每项目 runtime 配置在会话创建时即读取/缓存，后续修改通常需要重启，不能假定首次 turn 前才生效。

这些都是官方文档限制，不是本次实测结果。[README Headless 与架构](https://github.com/ai4s-research/open-science/blob/master/README.md)

## 数据安全与权限

文件、会话与证据默认本地存储；凭据保存在应用私有 runtime 配置，不写入 workspace、git 或导出。这里“隔离配置”不等于强操作系统沙盒，模型请求仍会向所选服务发送上下文，MCP、浏览器和远端机器也有各自数据流。

默认桌面流程会请求执行、删除、装依赖和远端连接的许可；无人值守可显式启用 full approval。gateway 链接包含访问 token，必须作为控制凭证保护。能读取当前 Chrome 登录状态的功能增加可用性，也扩大了受信任执行范围，需按真实任务测试权限和提示注入边界。[README 安全与 headless 审批](https://github.com/ai4s-research/open-science/blob/master/README.md)

## 成熟度 许可与商业边界

- 核查 latest release 为 **v0.7.1，2026-10-29**；官方仍称 working desktop MVP 与 beta research tooling。GitHub 的非 prerelease 标记不推翻该产品成熟度声明。
- macOS 有签名、公证；README 将 Windows 签名、Windows/Linux 更广验证与自动更新列为仍需加强的事项。v0.7.1 明确**没有应用内自动更新**。[发行说明](https://github.com/ai4s-research/open-science/releases/tag/v0.7.1)
- 主项目 **MIT**，第三方技能、连接器保留自身许可证；不能把主仓库许可覆盖到所有扩展。[LICENSE](https://github.com/ai4s-research/open-science/blob/master/LICENSE)
- 本次未核实商业收费、托管服务、客户量或收入，不据此作商业成熟判断。模型、Modal 和实验室基础设施成本需单独计入。

## 优势与限制

**优势**：与现有 Agent/编辑器和目录互操作强；持久终端、多窗口工作空间适合日用；Notebook 与原生科学文件预览覆盖广；远程访问和 headless 降低跨设备操控门槛。对科研人员而言，切换工具的摩擦可能比模型能力差异更重要，这是产品推断，需访谈和时间测量验证。

**限制**：能力表存在部署边界；不同 runtime、模型、skills 和 connector 增加组合验证成本；多领域宣传没有统一科学质量证明。远程提交、日志和复现提示不等于跨机完整重建。文档也提醒 PRD/技术设计包含目标与历史状态，应优先核对具体实现记录，不能把全部设计视为已交付。[README Status](https://github.com/ai4s-research/open-science/blob/master/README.md)

## 与 Pero 比较和可借鉴之处

Pero 比较固定于提交 `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b`。其 Paper、Data 与固定领域方法已有实际实现和验收，不能写成只有空壳；Compute App 目前仍仅连接草稿，底层本地/Docker/单节点 Slurm 适配则已有单独验证，二者须分开。[Compute README](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/compute/README.md)、[环境验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/ai4s-environments.md)

1. **先补连续使用体验**：持久终端、现有目录和已有 Agent 会话可能比新 App 数量更影响留存。Pero 应用同一实际科研任务测从阅读到计算的上下文搬运次数。
2. **证据记录不依赖某个 UI 存活**：OSD headless 边界提示 Pero 应让执行 owner 记录不可变事件、输入输出和检查，桌面仅展示。此为架构建议，不能当成 Pero 已有全路径优势。
3. **远端计算展示真实完成状态**：提交、排队、执行、产物回收、检查、人类接受分别表达，避免任务进程退出就自动标成研究完成。
4. **用固定科学方法检验跨 App 合同**：Pero 的 Fisher/HPC/Control Lab 可形成比通用 skill 更明确的验收，但必须连接到普通用户界面、持久化和独立交接，不能只展示 CLI 或受控样例。[Fisher](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md)

## 待验证问题与建议测试

- 同一任务分别在 Desktop、远程 Web 与纯 headless 执行，逐项对照 run、输入、代码和产物证据是否齐全。
- 关闭 UI、杀进程、断 SSH、重启服务器，检查是否恢复正确 run，是否重复提交，是否遗失审批。
- 多会话共用项目时，文件变化、kernel 状态和 Agent 工具能否避免串扰？相同项目与不同项目分别测。
- 换模型或 ACP runtime 后，审批、review、产物关联和费用可见性是否保持一致？
- 对一个真实论文结论，比较 OSD、Pero 和普通 Notebook + coding agent 的人工核查时间、错误完成率、复跑成功率与总费用。

以上是验证计划，**本报告未执行**。

## 官方来源

- [项目 README](https://github.com/ai4s-research/open-science/blob/master/README.md)
- [v0.7.1 发行记录](https://github.com/ai4s-research/open-science/releases/tag/v0.7.1)
- [Open Science Desktop 与 OpenScience 区别](https://github.com/ai4s-research/open-science/blob/master/docs/open-science-desktop-vs-openscience.md)
- [MIT 许可](https://github.com/ai4s-research/open-science/blob/master/LICENSE)

[返回竞品索引](../README.md)
