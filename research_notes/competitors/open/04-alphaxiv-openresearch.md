# alphaXiv OpenResearch 竞品研究

核查日期：2026-11-07。研究对象是 alphaXiv/OpenResearch，不是其他同名 OpenResearch 项目。依据官方当前 main README、Cargo 清单和 GitHub Releases；未安装、未跑同题实验、未审计全部代码。下文“支持”指官方公开描述，不等于独立验收。main 功能与发行包不必完全同步。

## 结论

OpenResearch 是 Pero 在“既有 coding agent + 本地科研工作区 + 远端算力”上的直接竞品。最值得参考的是对现有 agent 账户和操作习惯的承接、实验历史的结构化记录，以及桌面里切换机器和 agent 的连续体验。其竞争力不能概括成“科研聊天加 memory”，也不能仅凭计算后端数量推断长任务可靠性。对 Pero 的真正压力是：通用执行接入已很丰富，领域 App 必须证明能减少研究者在输入、方法、证据与验收之间的手工衔接。

## 产品定位和目标用户

官方称其为 local-first research-agent harness 与 workspace，既支持研究副驾驶，也面向 autoresearch。它优先服务已经使用 Claude Code、Codex、OpenCode、Cursor 或 Google Antigravity，并需要文献检索、代码实验和 GPU/集群资源的研究者。机器学习研究与计算科研尤其贴合这种工作方式。[1]

产品并不要求用户首先迁移到一个全新的模型账户体系。官方列出原生 coding-agent 接入；本地模型则通过 OpenCode 与 LM Studio、oMLX、Ollama 或自定义 endpoint 连接。应把“兼容 agent”与“任何 agent 的行为、权限和质量完全一致”分开看。研究执行仍受到具体 agent、模型、环境和用户授权的约束。[1]

## 核心功能和具体工作流

一个适合验证的流程是“复现训练论文中的一项消融结果”：

1. 在桌面工作区连接已有项目与 coding agent，说明论文、基线、预算和成功标准。
2. 通过 alphaXiv、bioRxiv 或 PubMed 找到相关研究，抽取假设和实验依据。官方确认文献入口；精确引文对齐、PDF 原文锚点与完整文献库管理需另测，不能从检索能力直接推定。
3. 让 agent 修改实验代码，选择本机、SSH 或集群执行。README 同时列出 Slurm、Kubernetes、Modal、Tinker、Ray、Hugging Face Jobs 与 managed OpenResearch compute。
4. 在本地 SQL 实验记录中回看日志、代码和产物，比较结果，再决定下一轮实验。此处是围绕实验的持续上下文，不只是对话摘要。[1]
5. 整理可交付工作。v0.2.25 的 `arc/storage.md` 写明：分享只在本机写出 `.orx`，内容包括基线与实验分支的 Git bundle、实验树、不含 descriptor 的已完成 run，以及用户勾选的日志、产物和聊天。聊天、日志或产物看起来像凭据时拒绝分享，代码不扫描。导入后的 run 后端种类为 `imported`，不会被启动、监视或清理。发布到 openresearch.sh 被写成上传同一份文件，持有链接的人可以获取，直到发布者删除。同一 tag 的 `src/local/share.rs` 开头写明这是一个 zip，清单文件是 `project.json`，`FORMAT` 为 1，解压上限是 16 GiB。本次读了 storage 的分享段和该文件开头的格式常量，没有打开真实 `.orx`，没有在第二台机器导入，也没有实测凭据拒绝或链接撤销。[3][5]

发布说明还列出对话中切换 harness、工作区聊天历史搜索、桌面远端机器切换、新实验引擎、租用机器由 orx-host 管理等变化。这些是重要的产品连续性信号；不能据此宣称跨机器迁移任意运行中进程、崩溃后 exactly-once 执行或实验可复现。[3]

## 架构和部署

官方推荐桌面版，支持 macOS 11+、Windows beta 与 Linux；Windows 需要 Git for Windows，Linux 桌面要求 glibc 2.35+。macOS/Linux 可独立安装 `orx`，`orx up` 打开 `127.0.0.1:4791` 本地 dashboard。README 特别提醒独立脚本安装的 CLI 尚未签名，受管理 Mac 可能阻止运行，建议使用已签名、公证的桌面应用。[1]

Cargo 清单表明核心 CLI 使用 Rust，包含 Tokio、Axum、嵌入式前端、rusqlite 和 agent-client-protocol；macOS/Windows 桌面使用 tao/wry 系统 WebView，Linux 的 WebKitGTK 桌面功能独立启用。仓库含 orx-host 与 orx-host-proto 工作区成员。[2] 这些证据支持“本地控制台与 Host 组件并存”的架构判断，但仅凭依赖清单不能断言每项协议在所有后端都具有相同保证。

用户自己的算力与托管算力是两类路径。创建 openresearch.sh 账户可使用 managed compute；是否必须在特定首次启动路径登录、不同资源的收费和地域、排队策略、数据驻留要求，本次未核实，不把托管服务承诺算成开源本地版本的固有能力。[1]

## 安全和数据边界

README 宣称项目、会话、实验、日志和产物由用户本地持有，不采集代码或完整 agent traces；但同一文档明确官方发行构建默认开启可退出的粗粒度产品 analytics，以及详细 agent feedback，关联随机安装 ID。匿名 token/message counts 用于模型使用统计；agent 可发送 bug、功能请求和使用挫折反馈，并被要求清理敏感信息。[1]

因此应写“本地优先、可关闭遥测”，不能写“零遥测”或“所有数据天然不出机”。官方声称 analytics 不采集提示词、文件内容/路径、仓库名、token、邮箱或项目/实验标识，但 agent 自行净化反馈仍需检验，不能当作形式化隐私保证。可在 Settings 或 `orx telemetry off` 关闭 analytics 和反馈。[1]

此外，调用云模型、文献接口、远端计算与主动发布项目都会形成不同的数据传输边界。需要分别检查凭据保存、上传目录范围、产物回收、Host 身份校验与公共链接撤销。本次没有获得足够安全文档证据确认本地执行是 OS sandbox，也没有把“本地文件归用户”视作能抵御恶意代码或论文提示注入的保证。

## 成熟度 许可和商业边界

GitHub 最新发行接口核实 v0.2.25 发布于 2026-11-07 01:29 UTC，具备桌面安装包和远端 CLI 安装路径；发布说明称桌面默认自动更新。版本号小不意味着只有演示，但 Windows 仍明确 beta，且此次变更包含实验引擎和 subagent 大幅重做，生产使用需对核心路径做回归。[3]

本次已直接读取 [LICENSE 原文](https://github.com/alphaXiv/OpenResearch/blob/main/LICENSE)，确认为 MIT，版权标识为 2026 alphaXiv，要求保留版权与许可通知；适合研究集成和二次开发评估。外部模型、计算服务、依赖及品牌仍遵守各自条款。alphaXiv 维护与 managed compute 是明确的组织/服务线索，但价格、活跃用户、营收、付费客户和企业 SLA 未核实，不能据此推断商业成功。[1][2]

## 优势和限制

**优势：** 接住既有 coding-agent 生态，迁移门槛较低；文献入口与实验记录靠近执行；本地、实验室服务器和云端资源可在同一产品讨论；新版本对机器、harness、项目分享的处理体现出研究工作区的产品投入。

**限制：** 后端兼容列表不等于统一取消、恢复与结果验证；本地 SQL 记录不自动等于不可变证据链；项目归档不自动意味着依赖齐全、重新执行成功；README 中未见足够证据证明与 Pero 领域 App 对等的固定方法验收。以上均是本次证据不足的边界，不是判定功能不存在。

## 与 Pero 的比较和可借鉴方向

Pero 比较基线固定为 master `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b`：Paper 已有原文、锚点和连续研究，Data 已有不可变数据版本与检查，分布式 Host 和固定方法验收已存在；仍为 development preview，跨 App 完整闭环与真实模型科学质量未证明。Compute App 只有连接草稿，但底层单节点 Slurm owner 已单独验收。不能用旧 README 的 planned 标签抹去这些实现。

上述 Pero 判断对应同一固定 commit 的直接证据：[README 的 development preview 与 Tasks/Workers 状态](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/README.md)、[Paper 原文及证据锚点](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/paper-agent/README.md)、[连续研究及真实模型验收缺口](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-autonomous-research.md)、[Data 不可变版本与已执行检查](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/data-workspace.md)、[Fisher 固定方法复现记录](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md)、[环境 owner 的 local/Docker/Compose/单节点 Slurm 最新验收记录](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/ai4s-environments.md)、[Compute App 仅连接草稿的边界](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/compute/README.md)。这些记录同时保留早期缺口与后续结果，应阅读最新补充；底层 adapter 验收不等于完整 App、正式发行或通用科学质量验收。


- **已有重叠：** 两者都有 agent/远端执行与研究记录方向，Pero 不宜把“有 Host”当独占优势。OpenResearch 的后端广度可作为接入体验标杆，不应直接压过 Pero 已验收的单节点路径。
- **值得借鉴：** 在用户已有 coding agent 上补科学工作区，比重造全部 agent 栈更容易形成有效起点；机器切换、会话连续性、实验历史入口值得纳入 Pero 日用体验验收。
- **Pero 应证明的差异：** 从 Paper 锚点产生明确方法任务，绑定 Data 版本，交给指定 Host，按固定验收规则返回检查结果，再由人接受。把每一步的证据关联起来，比单纯增加算力后端更有说服力。
- **建议对测：** 同一论文和训练小任务、同模型同预算，记录首次可用耗时、远端取消/断线恢复、错误完成率、回传产物完整度、原文证据可达性和人工修补分钟数。

## 待验证问题

1. 所列后端在失败、重复派发、取消和日志回收上的语义是否一致？
2. 实验 SQL 是否记录精确输入版本、环境、代码状态和随机种子，何者仅引用当前文件？
3. 包内对象、凭据扫描范围和解压上限已经写在 v0.2.25 的 storage 文档和分享源码开头。逐项预览、第二台机器导入、凭据拒绝和链接撤销仍未实测。
4. 切换 agent/机器后历史工具调用、权限和产物身份是否完整保持？
5. 关闭遥测后的网络行为、反馈净化与 managed compute 数据保留是否符合实验室要求？

## 官方来源

[1] [当前 README](https://github.com/alphaXiv/OpenResearch/blob/main/README.md)，本次读取原始文件全文，定位、流程、安装、analytics。

[2] [Cargo.toml](https://github.com/alphaXiv/OpenResearch/blob/main/Cargo.toml)，本次读取，Rust/WebView/SQLite/ACP 与 Host 结构。

[3] [v0.2.25 发布说明](https://github.com/alphaXiv/OpenResearch/releases/tag/v0.2.25)，通过 GitHub 官方 latest release API 刷新日期与变更。

[4] [官方文档入口](https://openresearch.sh/docs)，本次直接访问返回 403，未作为已读详细机制的证据；以官方仓库文档和发布说明替代，不绕过限制。

[5] [v0.2.25 `arc/storage.md`](https://github.com/alphaXiv/OpenResearch/blob/v0.2.25/arc/storage.md) blob `657c32c09e4456dcd9a1a68abd10d01a769de00d`，读取了 Sharing 与 Published projects；[同 tag `src/local/share.rs`](https://github.com/alphaXiv/OpenResearch/blob/v0.2.25/src/local/share.rs) blob `b1d6261128871b280633ca49904644628e026ea9`，只读了文件开头的格式说明和常量，没有审计整个模块。

[返回竞品索引](../README.md)
