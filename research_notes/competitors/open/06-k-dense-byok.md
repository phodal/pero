# K-Dense BYOK 竞品研究

核查日期：2026-11-07。对象为 K-Dense-AI/k-dense-byok 开源应用，助手名 Kady；不把 K-Dense Web 商业托管平台或独立 scientific-agent-skills 库的全部能力合并进来。依据官方当前 main README、安全、provenance、evidence package 文档和发行 API；未安装、未做同题实验，官方功能声明不等于独立质量验证。

## 结论

K-Dense BYOK 是面向科学家的完整本地分析工作台，而不是一个免费聊天入口。其突出价值是把自然语言任务、workflow 模板、科学文件预览、预算控制、研究记录与证据包做成同一操作体验。当前 main 在分析计划冻结、执行证据与可审阅导出方面已经非常具体，不能沿用旧摘要只将它归为“skills + notebook”。

Pero 可以借鉴其任务起点和交付方式，但必须以自身已有的 Paper、Data、Host 与固定方法验收为基础做公平比较。两者都有证据方向，真正需测的是记录覆盖、恢复行为、用户复核成本和科学结论错误率，而不是谁声称拥有“可信科研”。

## 定位和目标用户

官方面向不要求编程经验的各领域科学家：用户描述分析数据、检查稿件、搜文献、制作图表等任务，Kady 写代码、运行并保留产物。项目、会话、notebook 和结果保存在本地普通目录；使用托管模型时，相应任务内容仍发送给选择的供应商。应用免费，模型与算力成本归用户。[1]

这使其特别适合想从一份数据和一个具体问题出发，而非先搭建 agent 系统的研究者。现有 AI 订阅、直接 provider key、OpenRouter 和本地 Ollama/兼容 endpoint 都是可选模型来源，但订阅登录不代表无限使用或无额外计量费用。[1]

## 核心能力和具体工作流

一个可用于对照测试的任务是“处理 treated/control 表达矩阵并形成可审稿分析包”：

1. 创建独立 project，把原始上传保存在默认受保护的 `user_data/`。从 guided workflow 或 `/qc` 开始，补充研究设计、样本分组、排除规则和目标输出。当前 README 列 326 模板、22 学科；这些是任务启动说明，不是 326 条经过独立验收的方法。[1]
2. 写入假设和 analysis plan，确定结局、纳入标准、统计模型、质量检查、停止规则和数据集，人工审查后冻结。后续修订/偏离保留原因，并以 digest 链接前后版本。官方明确这是本地记录，不是外部正式预注册。[1]
3. Kady 编写和运行分析，必要时派给统计审阅、引用检查、数据分析等 specialist；当前 README 列 23 类。可在专门 transcript 中观察和干预。可选 watchdog 默认关闭、额外耗费模型费用，其未报警不能证明分析无误。[1]
4. 对照两种记录：Living Lab Notebook 保存假设、理由、观察、置信和修正；独立 provenance 由实际工具活动派生，agent 没有专门直接写 provenance 的工具。观察可标支持、反对或不确定，结果可区分 signal、null、inconclusive、technical failure。[1][3]
5. 需要稳健性检查时，可对冻结计划开展 2–16 个已审阅 Python 变体，并在 Modal 运行，先批准脚本与估计成本。该路径不能推广成任意分析均能自动得到统计有效性保证。[1]
6. 在图表、表格和科学文件预览中人工检查，然后导出选定记录与匹配版本文件的 evidence package，包含 Methods scaffold、manifest、checksums、缺失信息和 RO-Crate metadata。准备包本身不运行分析，也不自动发布。[4]

其他体验包括多项目、每项目最多十个并行 chat tabs、Word/Excel/PPT 编辑、LaTeX source/PDF、科学结构与图像预览、MCP、项目内记忆和周期任务。普通定时任务需要应用保持运行；不能把它与独立云端 scheduler 混为一谈。Modal 长任务则由另一套持久任务机制管理，官方称可跨 chat turn 和应用重启继续跟踪。[1]

## 架构 部署和预算

交付形态是本地 Node 后端与浏览器 UI，不应称为已经核验的原生三平台安装器。README 提供 macOS/Linux 启动脚本及 Windows `start.cmd`，Windows 要 Node.js 22+ 与 Git for Windows。首次启动安装依赖，浏览器打开 localhost:3000。安全文档指出标准 launcher 以 Next.js development mode 启动前端。[1][2]

项目保存独立文件、会话、模型设置、notebook 与费用政策，各 chat 共享项目文件，因此并行工作仍需关注文件冲突。provenance steps 用 append-only JSONL，环境快照用内容寻址文件；这提供了可读的证据基础，但不是数据库/OS 层防篡改隔离。[3]

预算会对计价 API、OpenRouter、Anthropic OAuth 的计量额外用量和 Modal 计算做跟踪及上限处理；供应商自行管理的订阅、NVIDIA credits、预付 token plan 等可能只显示 token 和参考价，不消耗同一个美元 cap。必须区分“显示估算”“项目硬上限”“供应商最终账单”，不能承诺配置一个数字即可覆盖所有外部成本。[1]

## 安全和数据边界

官方直接说明：后端能以当前 OS 用户身份执行 shell、读文件和改凭据，project workspace 不是 OS sandbox。raw-data guard 旨在防止误改，不能抵御刻意绕过；对不可信数据或代码应使用独立账户、VM 或容器。hash chain、受保护目录与模型审阅都不改变同用户权限边界。[1][2]

前后端默认 bind loopback，校验 Origin、Host 和 cross-site embed headers，并可用 token auth。共享机器上其他 OS 用户也能访问 loopback，文档要求考虑 `KADY_REQUIRE_AUTH=1`；远程访问优先 SSH tunnel。相同用户的 shell 仍可能读取子进程继承的 token，因此网络身份验证不等于同用户进程隔离。[2]

API key 写入本地 `.env` 并设置 0600；launcher 默认 umask 077 并收紧相关目录权限。预览有 CSP、Markdown 清理和 scriptless/networkless notebook iframe 等保护，但存在具体例外，例如 PDF 为浏览器显示免除 sandbox CSP。设置页的 connector environment values、headers 和 OAuth client secrets 当前不遮罩，需注意屏幕共享。[2]

托管模型、web search、MCP/远端 connector 与 Modal 都会收到它们所需的数据。无 key 搜索使用共享第三方 fallback；选择本地模型并不能禁止其他工具联网。导出时默认排除原始 command arguments，也不会自动清理 notebook prose、脚本或数据中的敏感信息。许可证和数据再分发权限要由用户分别审查。[2][4]

## 证据能力及其明确限制

provenance 最值得借鉴的是区分 observed、inferred 与 declared links。直接文件操作能明确命名输入输出；shell、codemode 和不透明工具依赖 bounded scan，重叠运行可能只能推断。命令行中出现的文件不等于脚本内部全部实际输入，glob、变量和硬编码路径不能完整追踪。[3]

文件状态区分 Current、Stale、Unverified，lineage 能追到消费时使用的版本，但遍历存在 60 节点/12 hops 等限制，单文件 hash 上限 512 MB。specialist 文件在 harvest 时检查，不一定有执行当时的 hash；更深层嵌套 specialist 不在该 harvest 覆盖内。环境快照不完整记录 seeds 和硬件，远端镜像也不枚举全部已装包。可追溯不等于可复现，更不等于科学有效。[3]

evidence package 会优先寻找匹配记录 hash 的字节，但 hash 无法恢复从未保留的旧文件。缺失、未验证当前副本与真正匹配版本分别标记。包有 128 MiB 单 artifact、256 MiB/512 files payload 等限额；`verify.py` 只验证清单、路径和 hash，不执行科学脚本，不构成签名或独立作者认证。RO-Crate 也不承诺 workflow replay。[4]

## 成熟度 许可和商业边界

GitHub latest release API 当前返回 v0.15.0，发布时间 2026-10-01 22:51 UTC；README 明确 beta。本文详细功能主要来自当前 main 文档，不能保证 v0.15.0 包含所有研究记录与 UI 能力，尤其不能用主线功能清单声称已经验收稳定产品。[1][5]

本次已直接读取 [LICENSE 原文](https://github.com/K-Dense-AI/k-dense-byok/blob/main/LICENSE)，确认为 MIT，版权标识为 2026 K-Dense，要求保留版权与许可通知；外部模型、数据库、文档能力与算力仍受各自许可/服务条款约束。开源 BYOK 免费不代表科学研究总成本为零。README 将 managed infrastructure、团队协作、免配置体验引导到商业 K-Dense Web，不能把 Web 的团队功能和实验室服务反算成 OSS 已交付能力。商业收入、用户数、机构部署和价格合同未核实。[1]

README 的 CompBioBench 表明特定日期、100 道 exact-match 生物计算问题、不同模型和 reasoning 下成绩；其中“第二名”明确为 2026-09-11。另一个 20-prompt 平台比较由 K-Dense 内部设计、运行和评估，官方自己限定解释范围。本文不把历史榜单当今日排名，不把内部比较当独立质量保证，也不据此给 Pero 排名。

## 优势和限制

**优势：** 起步任务模板、追问表单、科学预览和文稿工具降低上手负担；预算与并行工作可见；notebook 叙事和实际执行 provenance 分离；证据包、计划偏离和明确缺失状态适合研究交付。

**限制：** 本地同用户权限风险较大；Node/浏览器启动仍有环境维护成本；trace 和版本保留覆盖有限；多个 reviewer 可能共享偏差；不同行为是否受硬预算限制取决于 provider route；Beta 主线功能与稳定发行之间需逐项确认。其文件证据工具不能取代统计审查、数据治理或领域专家。

## 与 Pero 的比较和建议

Pero 对照基线固定为 master `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b`：Paper 已有原文/锚点/连续研究，Data 已有不可变版本与检查，分布式 Host 和固定方法验收已存在。仍为 development preview，跨 App 完整闭环和真实模型科学质量未证明；Compute App 仅连接草稿，底层单节点 Slurm owner 已单独验收。

上述 Pero 判断对应同一固定 commit 的直接证据：[README 的 development preview 与 Tasks/Workers 状态](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/README.md)、[Paper 原文及证据锚点](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/paper-agent/README.md)、[连续研究及真实模型验收缺口](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-autonomous-research.md)、[Data 不可变版本与已执行检查](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/data-workspace.md)、[Fisher 固定方法复现记录](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md)、[环境 owner 的 local/Docker/Compose/单节点 Slurm 最新验收记录](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/ai4s-environments.md)、[Compute App 仅连接草稿的边界](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/compute/README.md)。这些记录同时保留早期缺口与后续结果，应阅读最新补充；底层 adapter 验收不等于完整 App、正式发行或通用科学质量验收。


因此不能写“K-Dense 有 evidence、Pero 没有版本”，也不能因 Pero 有不可变版本就断言其证据闭环胜出。K-Dense 提供的参考是把证据变成日常用户操作：冻结计划、查看文件来源、显示过时字节、导出缺失信息。Pero 的机会是把这些操作绑定到领域 App 的固定输入/方法/验收规则，而不是让 notebook 与 App 任务状态各自孤立。

建议先以一个 Data 分析 App 对测：相同原始数据、同模型和预算，比较原始数据误改率、计划偏离是否被发现、图表到输入版本是否可追、错误完成率、证据包缺失比例和审阅者复核分钟数。再对比由 Paper 原文锚点启动的连续任务与 Host 失败恢复。这样能够分别测“容易开始”“可以追查”“真正通过固定方法检查”，而不是混成一个宣传分数。

## 待验证问题

1. 源码在场已经核对，发行包行为没有复现。tag `v0.15.0`（commit `da32498a186e15c09e865257d8e903dc324e34b7`，发布于 2026-10-01）与 2026-10-16 的 main 上，`docs/evidence-packages.md`、`docs/provenance.md`、`server/src/agent/notebook-plans.ts` 的 blob 相同，分别是 `c89f07fa2e437d4d3a6f9b9bd9ef9bf65af97f63`、`7e9897f9d6fa3f6df2d04f22eb7cd1b176b819e3`、`2608955c749a21e57b95d9ed7a70bebccc5a5cd9`。main 比该 tag 超前 9 个提交，README blob 不同（tag `335390dcba83daae6ad3ed53c0d0ab79195bd5f8`，main `44b23f8f87fe30e70bbe134828e6e6935cd51386`）。未安装该 tag，不能把文件在场写成可完整复现。
2. shell 扫描和 specialist harvest 的未覆盖输入，会如何影响真实数据任务的证据完备度？
3. 预算在并行请求、未知计费、订阅超额和 Modal 回收失败时是否及时阻断？
4. 容器/VM 部署后，文件预览、Modal、浏览器编辑和 native shell 的体验是否仍顺畅？
5. 已导出包在另一台机器上能否在不求助作者的情况下理解、恢复环境并复跑？应分别记录 hash 验证与实际复跑结果。

## 官方来源

[1] [README](https://github.com/K-Dense-AI/k-dense-byok/blob/main/README.md)，本次读取全文，定位、工作流、功能、费用、beta 和商业边界。

[2] [Security](https://github.com/K-Dense-AI/k-dense-byok/blob/main/docs/security.md)，本次读取全文，同用户执行、loopback/auth、credentials 和外部数据流。

[3] [Provenance](https://github.com/K-Dense-AI/k-dense-byok/blob/main/docs/provenance.md)，本次读取全文，证据来源、版本、环境、specialist 与覆盖限制。

[4] [Reviewer evidence packages](https://github.com/K-Dense-AI/k-dense-byok/blob/main/docs/evidence-packages.md)，本次读取全文，版本匹配、RO-Crate、大小限制、校验与不可重执行边界。

[5] [v0.15.0](https://github.com/K-Dense-AI/k-dense-byok/releases/tag/v0.15.0)。发行说明正文仍只有 compare 链接。2026-11-07 用 GitHub tag、contents 和 compare API 核对了待验证问题第 1 条里的三个文件；这不包含安装或运行。

[返回竞品索引](../README.md)
