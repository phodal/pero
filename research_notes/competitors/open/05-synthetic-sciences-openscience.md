# Synthetic Sciences OpenScience 竞品研究

核查日期：2026-11-07。对象为 synthetic-sciences/openscience，区别于 AIPOCH Open-Science 和 ai4s-research Open Science Desktop。依据当前 main 官方 README、ARCHITECTURE、SECURITY、隐私文档源文件及发行 API；未安装或做科学任务实测。主线描述可能领先于已发布版本。

## 结论

OpenScience 已是较完整的“科研 agent + 工作台 + 本地 runtime + 远端计算”直接竞品。它的参考价值不仅是数百 skills，还包括请求去重、权限续接、可恢复产物交付、费用证据和失败状态的明确语义。对 Pero 而言，科研 App 的差异需要落在具体方法与跨 App 验收，而不能只说有代码执行、研究记录或分布式任务。

本次最重要的补充是隐私边界：**当前官方文档明确，登录后的安装默认分享 session traces，涵盖使用自有 API key（BYOK）、订阅登录乃至本地模型产生的会话，受账户与设备 opt-out 约束。** 这里描述会话内容的上传范围，并非声称 API key 本身会被上传；SECURITY 与隐私文档直接写明默认分享行为，同时说明已知凭据会脱敏。 本地项目存储和 BYOK 不等于研究内容只在本机。[2][3][4]

## 定位和用户

官方将其定位为围绕 research agent 的工作台，处理清理数据、复现结论、参数扫描、方法写作与引用检查等具体研究劳动；研究想法和判断仍归用户。目标用户包括计算科学家、生信分析者、ML 研究者和希望把重复科研程序交给 agent 的实验室人员。[1]

桌面、浏览器工作区和终端都访问用户机器上的项目文件。模型可使用直接 API key、支持的账户登录、本地 endpoint 或 Ace 按量服务。它并非只向写代码专家提供一个 CLI，也没有因为提供 Ace 就自动成为具有隔离租户与团队治理的托管研究平台。

## 核心能力和工作流

以“检查样本数据并复现一项统计结果”为例：

1. 打开项目目录，指定原始输入、分析目标和输出目录。需要先审方法时使用 `/plan`，再执行代码，避免让数据清理规则在看到结果后无记录地改变。
2. Agent 搜索文献或数据库、写 Python/R、运行 kernel 或 shell，并以可见 trace 展示读取、搜索、运行和文件输出。可派发边界明确的并行 worker，主 agent 负责汇总。[1]
3. 数据量或 GPU 需求超过本机时，使用 Modal、SSH、Slurm/PBS。README 说远端任务获批后运行；具体权限策略取决于设置，不应笼统保证每个无风险动作都需人工审批。
4. 检查结果、代码和文件，而不是只接受自然语言结论；脚本自动化可通过 `openscience run`、续接、SDK 或公开 runtime 协议接入。[1][2]
5. 以 artifact version 或 session 做只读 review、检查输出交付与成本状态。架构文档描述这些机制，但本次没有验证所有 UI 路径及发行包是否全部包含。[2]

科学能力覆盖数据库和程序型技能。README 特别说明 skill 是过程说明，不代表它引用的软件或服务已经安装。十个 BioNeMo NIM BYOK adapter 包含 Boltz-2、DiffDock、Evo 2 等，具严格请求 schema、每次 dispatch 审批、带 hash 的会话产物，且明确 experimental 和 NVIDIA 服务条款依赖。[1] 架构另列 54 项科学能力清单、五项带完整生命周期的实验性 Python capability，并说明两项 blocked、没有相应 release evidence 的能力不称 verified。数字是文档快照，不能代替逐项可运行性测试。[2]

## 架构 部署和执行语义

后台是 Bun/TypeScript，编译为平台原生 CLI binary；Hono 本地服务提供 HTTP/SSE，SolidJS 工作区嵌入 CLI，Electron 桌面壳启动随机 loopback 端口。TypeScript SDK 来自 OpenAPI，另有 Python HTTP/SSE client，支持无工作台的 `serve` 路径。[2]

值得关注的工程语义包括：执行前持久化请求 receipt；相同 request ID 返回同一 run，内容变化则冲突；owner 进程丢失时把未完成工作中断，而非盲目重放外部副作用。审批/提问的响应会记录，但服务器崩溃后不会凭记录重建活的 approval continuation，模糊情况明确报告 indeterminate。SSE 恢复遇到事件缺口要取 snapshot，而不是再提交一次 prompt。[2]

Modal 任务绑定审批 digest、显式文件/秘密、持久 owner 与可恢复结果交付。并发配置是 admission limit，超额启动会明显失败，不是后台无限自动排队。插件在受信任的 host process 中运行，MCP 则是分离进程的工具协议；project-scoped client 不等价于 OS 隔离。[2]

## 安全和数据边界

官方安全文档说明，新本地安装默认 Approve for me，在支持平台启用执行 sandbox：macOS Seatbelt 或 Linux bubblewrap 包裹 shell、Python/R kernel 与 local compute，限制到工作区和明确授权路径，并拒绝网络出口。必须以 `openscience sandbox test` 的 Containment verified 结果确认，不能只看设置。Windows 暂无该 sandbox backend；Full access 关闭 containment，恶意代码仍建议容器或 VM。[3]

服务默认 `127.0.0.1` 并验证 Host/Origin，可加 deployment bearer token；project selector 不构成租户隔离，远程服务需单独认证网关和执行边界。本次未做穿透测试，不给出安全认证结论。[2][3]

数据出口必须分开看：模型推理、科学数据库/MCP、远端计算、session trace sharing、更新检查。登录后默认分享的 traces 可包括 prompts、模型响应及可见 reasoning、工具输入输出和 usage。已知凭据会被 redaction，但不能去掉所有敏感研究内容。本地模型只移除远端推理调用，不会自动关掉联网工具和 trace 上传。设备关闭 trace sharing 会停止上传并清除待上传记录；账户 opt-out 继续有效，关闭未来上传不等于删除服务端既有数据。[3][4]

文档对于设置导航存在差异：SECURITY 写 Customize → General，而隐私文档写 Customize → Permissions，下均指 Data & privacy → Share session traces；部署前应按实际版本确认，不能仅凭菜单名推定状态。

## 成熟度 许可和商业边界

最新 GitHub release 为 v2.0.153，2026-10-30 08:53 UTC。说明包含 session/Task replay SQLite 存储、费用与日志健康检查、凭据刷新及 Windows 可靠性修复。发行流程声称同 commit 做打包 e2e、各平台 smoke 和科学 capability canaries。macOS 稳定发行要求签名公证；Windows 签名仍可选，未签名安装包应在 release notes 披露。不能把“有跨平台发布验证”简写成“所有平台都已签名安全”。[1][2][5]

本次直接读取 [LICENSE 原文](https://github.com/synthetic-sciences/openscience/blob/main/LICENSE)，确认为 Apache License 2.0，版权标识为 2026 InkVell Inc.（Synthetic Sciences）；再分发需遵循许可、修改标识及适用 NOTICE 等义务，不授予商标权。第三方 skills/文档资源各有许可与归属。官方列明大量技能源自 K-Dense、Orchestra Research、Hugging Face、Anthropic 和 NVIDIA 等；这说明 skill 丰富度存在共享底座，不应当作独有知识产权或质量壁垒。[1]

Ace 无订阅、按 Wallet 所示模型价收费；direct provider route 不加费，经 OpenRouter 的路由包含其 funding fee，README 标为默认 5.5%，卡处理费结账显示。BYOK/本地模型不扣 Ace Wallet，但用户仍承担自身供应商或硬件成本。首次图形设置要求 OpenScience 账户，headless `run` 不要求。未核实付费用户规模、收入和企业合同。[1]

## 优势 限制和评测解读

**优势：** 从计划、执行、并行分工到文件结果的链路完整；分发渠道丰富；对重复提交、失联 owner、交付失败和费用未知状态有具体协议；科学 capability 区分实验性、阻塞和验证状态，比工具数量宣传更有用。

**限制：** 本地部署仍有默认 trace 分享需要主动理解；跨平台隔离不对等；远端和供应商条件造成运行差异；会话可审计不等于每个科学步骤正确；当前 main 的实验能力不能自动计入 v2.0.153 的实测能力。

README 列出 Terminal-Bench Science 53/70、BiomniBench-DA public 50 得分 82.2、Terminal-Bench 4.0 science subset 10/14，并指向官方 traces。这些是特定模型、环境、任务和判分器下的官方报告，本文没有重算、复跑或核查独立性；不能把不同分母的成绩拼成通用科研质量排名。[1]

## 与 Pero 的比较和借鉴

Pero 固定基线为 master `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b`：Paper 原文/锚点/连续研究、Data 不可变版本与检查、分布式 Host 和固定方法验收已经存在；development preview、跨 App 完整闭环及真实模型科学质量仍未证明。Compute App 是连接草稿，底层单节点 Slurm owner 已独立验收。

上述 Pero 判断对应同一固定 commit 的直接证据：[README 的 development preview 与 Tasks/Workers 状态](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/README.md)、[Paper 原文及证据锚点](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/paper-agent/README.md)、[连续研究及真实模型验收缺口](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-autonomous-research.md)、[Data 不可变版本与已执行检查](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/data-workspace.md)、[Fisher 固定方法复现记录](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md)、[环境 owner 的 local/Docker/Compose/单节点 Slurm 最新验收记录](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/ai4s-environments.md)、[Compute App 仅连接草稿的边界](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/compute/README.md)。这些记录同时保留早期缺口与后续结果，应阅读最新补充；底层 adapter 验收不等于完整 App、正式发行或通用科学质量验收。


OpenScience 的当前 runtime 与 scientific capability lifecycle 说明，“可验证任务”也不是 Pero 可独占的口号。Pero 可以进一步聚焦领域 App 的输入 schema、版本约束、固定方法、独立检查和用户接受之间的可解释映射。差异要通过用户任务证明，不能用另一方缺少 Pero 风格导航作为没有领域能力的证据。

建议直接借鉴三点：第一，把请求 receipt、未知结果和重试权限设计进 Host 对外协议；第二，让能力状态同时显示依赖、实验性、验证证据和失败原因；第三，清楚分开本地存储、模型数据出口、诊断上传与发布，给予用户可见的逐项控制。对测应包含进程中断、重复派发、数据版本变化、远端结果回收和计划偏离检查，而不仅测一轮“能生成图”。

## 待验证问题

- 当前 main 的 runtime/隔离/版本 review 到哪一发行包可以复现？
- 各平台 sandbox 验证、进程子树、授权路径和联网例外是否符合实验室威胁模型？
- 账户与设备 trace opt-out 在离线队列、退出登录和切换账户后是否一致生效？
- 相同模型预算下，capability 验证能否发现数值正确但统计方法错误的结果？
- SSH/Slurm/PBS 与 Modal 是否提供同等级 owner、取消、费用和产物完整性保证？

## 官方来源

[1] [README](https://github.com/synthetic-sciences/openscience/blob/main/README.md)，定位、使用、能力、benchmark、Ace、许可归属。

[2] [ARCHITECTURE.md](https://github.com/synthetic-sciences/openscience/blob/main/ARCHITECTURE.md)，runtime、request receipt、SDK、能力生命周期、trace sharing、发行结构。

[3] [SECURITY.md](https://github.com/synthetic-sciences/openscience/blob/main/SECURITY.md)，sandbox、平台差异、服务器与默认数据分享。

[4] [Privacy and data 源文件](https://github.com/synthetic-sciences/openscience/blob/main/frontend/docs/src/content/openscience/privacy.mdx)，本地模型与 trace 分享、opt-out、费用未知状态。上述四份均本次读取原始全文。

[5] [v2.0.153](https://github.com/synthetic-sciences/openscience/releases/tag/v2.0.153)，本次通过官方 release API 核验时间及说明。

[返回竞品索引](../README.md)
