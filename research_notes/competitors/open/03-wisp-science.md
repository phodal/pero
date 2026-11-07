# Wisp Science 竞品研究

核查日期：2026-11-07。对象为 [xuzhougeng/wisp-science](https://github.com/xuzhougeng/wisp-science)，WISP 全称 Workspace for Intelligent Scientific Practice。本报告依据官方 README、Publication Evidence、开发与发行文档；未安装、未执行复验或科学任务。功能描述为官方公开能力，未独立验证性能、可靠性或科学质量。

## 结论

Wisp 是 Pero 的一级直接竞品，尤其值得对标**把论文中的 Claim、Figure、Methods 绑定到精确证据版本**的产品设计。它不仅保存聊天或工作区，还将论文修订、来源选择、冻结、导出和复验建模为用户可操作的对象。

因此，Pero 不应把 provenance、独立检查或“可复现”当成独有标签。应在一个真实科学结果上证明证据完整度、错误 PASS 控制、异机重验和人工交接成本。Wisp 自己也明确：本地 clean verification 不是强系统沙盒，输出被复现不代表结论科学有效。[Publication Evidence](https://github.com/xuzhougeng/wisp-science/blob/main/docs/publication-evidence.md)

## 定位与用户

Wisp 面向以 Python/R、文献和科学数据库开展研究的科学家，强调把数据、图、运行、决定与草稿保留在同一项目。生命科学是明显的展示与连接器重点：PubMed、GEO、RNA-seq demo 等都出现在默认入口中，但其工具形态并不限于生物医学。

适合已有本地或实验室 SSH 算力、希望保留数据控制权并带入自己的模型的研究者。与 Pero 的 Paper、Data、Host 和生命科学 App 有直接重叠，但并非只围绕 Virtual Cell 的特定科学模型。[README](https://github.com/xuzhougeng/wisp-science/blob/main/README.md)

## 核心功能与研究工作流

### 从检索到计算

官方支持 OpenAI-compatible、Anthropic 模型和 ACP 驱动的 Codex/Claude Code；Agent 可读写项目文件、执行 shell，并按需加载 skills。科学 MCP 提供约 80 个数据库入口。用户可登记本地、WSL、SSH 主机，探测硬件并运行带实时日志的长任务；Python/R 持久 kernel 维持执行状态。

README 宣称每个会话有独立 kernel，但开发文档还使用 project/context/language 级进程描述。因此，本报告不进一步推断所有并发路径都已证明无状态共享，实际隔离粒度应列为实测项。文件预览、会话恢复、撤销某回合修改、引用文件/会话以及独立 exploration 分支，降低试错对主线研究的干扰。[README](https://github.com/xuzhougeng/wisp-science/blob/main/README.md)、[开发文档](https://github.com/xuzhougeng/wisp-science/blob/main/docs/development.md)

### 从项目记录到论文证据

Publication Workspace 与项目备份、Session 导出分离。论文包含 Section、Claim、Figure、Table、Methods、Supplement 等有序条目和多个 revision。用户为条目选择项目 Artifact、持久化 Run 或研究会话片段，记录用途、支持的 Claim、候选/采用/拒绝以及公开/受限/私密状态。

绑定会保存精确 ArtifactVersion，而不会之后自动跟随 latest；消息片段和工具证据也有精确 ID、位置及内容快照。这对科研交付很重要：一张图后来重生成，不应悄悄改变旧稿件所引用的依据。[Publication Evidence](https://github.com/xuzhougeng/wisp-science/blob/main/docs/publication-evidence.md)

### 冻结与导出

1. Draft 阶段编辑正文条目和证据，运行 Finalization check 检查依赖、缺失和共享风险。
2. 检查通过并不会自动冻结；用户另行确认，系统再次检查后锁定。
3. Frozen/Published revision 只读，继续修改需 clone revision。
4. Build Capsule 只使用已冻结 manifest 和内容寻址快照，不回退读取当前工作区文件。
5. 包含校验、复验说明、引用信息、选定 evidence 与 code/input/output/environment lineage；公开包排除受限和私密依赖字节，保留引用及获取说明。

官方说明生成 ZIP 时规范化条目与时间等元数据，并对 blob 做 SHA-256 校验。同一冻结版本与相同 blob 可得到相同 archive bytes。这证明交换对象的一致性，不证明原始数据或科研方法正确。历史文件若缺创建时校验会标为 late_capture，不能伪装成原始 Run 输出。[Publication Evidence](https://github.com/xuzhougeng/wisp-science/blob/main/docs/publication-evidence.md)

### 复验分级

Wisp 明确区分 archived、traceable、re_executable、reproduced。对有生产 Run 的冻结证据，clean-workspace 验证会新建临时目录，仅放入允许的精确输入与代码，清理继承环境，执行并对每个声明输出比较。比较器包括字节哈希、规范化文本、语义 JSON 和数值绝对/相对容差，UI 默认 SHA-256。

只有 manifest 指定的每个 Run 都满足已捕获环境字段一致、退出码为零和所有必需输出比较通过时，才显示 reproduced；失败或环境不匹配保持 re_executable。复验记录追加保存，不篡改原冻结 manifest。这种“失败不抹掉历史”比在聊天中输出一个笼统完成标志更适合审计。[Publication Evidence](https://github.com/xuzhougeng/wisp-science/blob/main/docs/publication-evidence.md)

## 架构与部署

主桌面栈包含 Rust workspace、Tauri v2 和 Leptos/WebView 前端，职责分为 Agent、模型、工具、runtime、MCP、运行控制、应用查询和存储等模块。另有 headless CLI、SwiftUI macOS 客户端、WinUI 3 preview 和 iOS/Android 客户端；不应假定所有原生界面与主桌面功能完全一致。移动客户端控制桌面服务，不在手机上运行科学 Agent。[开发文档](https://github.com/xuzhougeng/wisp-science/blob/main/docs/development.md)

发行覆盖签名的 Windows MSI/NSIS、签名公证 macOS Intel/Apple Silicon DMG 和 Linux x86_64/ARM64。v1.24.0 增加对缺失 uv/Python/R/Node 的受控安装、全局配置、工作流进度和 Cloudflare Workers remote-access relay；该 Workers 版本只覆盖远端访问，项目同步仍有另一 relay 需求。安装环境是显式行为，不能把“可自动安装”写成首次打开已具备所有科学依赖。[v1.24.0](https://github.com/xuzhougeng/wisp-science/releases/tag/v1.24.0)

## 安全 数据与复验边界

普通模型、连接器和 SSH 使用仍可能发送数据。README 的本地存储表述不能等同于完全离线；手动加密同步也不等于所有工作区字节默认加密。API key 使用系统 keyring，审批默认开启，Full Permission 会改变运行权限体验。

**clean verification 的强度必须准确描述**：当前仅支持 local Runs。临时目录、路径校验和环境清理是进程级防误用机制，不是 hardened OS/container network sandbox；经解释器或子进程间接联网不在其当前威胁模型内，不应执行不可信代码。

结构化文本/JSON/数值比较限制为 16 MiB；流式 SHA-256 可处理更大支持文件。Python 包、CUDA、driver 等仅在 Execution Context 实际捕获时参与环境一致性。因此 reproduced 只表示在已记录指纹下声明输出重现，并不保证未捕获依赖相同。[Publication Evidence 限制](https://github.com/xuzhougeng/wisp-science/blob/main/docs/publication-evidence.md)

## 成熟度 许可与商业边界

- 核查 latest release 为 **v1.24.0，2026-11-03**，多平台发行、更新、环境配置及故障修复较活跃。
- **当前主线为 AGPL-3.0-only**，目录有另行声明时按其声明；旧发行版保留当时许可，不能继续将当前项目统一标为 MIT。[README 许可声明](https://github.com/xuzhougeng/wisp-science/blob/main/README.md)、[LICENSE](https://github.com/xuzhougeng/wisp-science/blob/main/LICENSE)
- 将源码或服务集成到 Pero 前需具体评估 AGPL、第三方技能和组件义务；“参考交互设计”与“复制实现”是不同决策。本报告不是法律意见。
- 本次未核实收入、客户、统一收费或团队托管方案，不能从版本频率和安装包推断企业稳定性。
- 官方教程截图/部分 UI 测试使用 mock，bundled demo 不需要 API key。能观看完整轨迹不能证明当前模型现场重跑也会成功。[开发文档](https://github.com/xuzhougeng/wisp-science/blob/main/docs/development.md)

## 优势与限制

**优势**：证据对象、稿件修订、来源版本和复验状态清楚；不隐去不完整环境和历史捕获缺口；主线探索与独立分支分开；日常研究工具、远端运行和安装体验较完整。这些是公开产品机制的强项，并非同题性能排名。

**限制**：跨平台/远端 clean verification 未得到同等支持；可复现性仍依赖捕获质量与比较合同；文献检索、实验设计及稿件判断仍受模型影响。多客户端、多个 runtime 和丰富插件提高组合测试成本；论文证据包不能替代领域审稿或统计有效性判断。

## 与 Pero 比较和可借鉴之处

Pero 基线为提交 `371ea0895f8dbd12d7fcc97e320f3a9499b3e94b`。它已具备 Paper 原文/版本锚点、Data 不可变版本、Host 运行与 Fisher/HPC/Control 等固定方法检查；不能将“有版本和验证”写成 Wisp 独有。但 Pero 的通用“论文结论 → 数据 → 执行 → 独立检查 → 原文结果状态”产品闭环仍待完成。[Paper](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/apps/paper-agent/README.md)、[Fisher 验收](https://github.com/phodal/pero/blob/371ea0895f8dbd12d7fcc97e320f3a9499b3e94b/docs/fitness/paper-fisher-reproduction.md)

1. **固定证据版本，不跟随最新文件**：一个 Claim 应指向当时采用的图、数值、代码和输入，研究继续后旧结论仍可解释。
2. **把接受状态拆开**：执行结束、产物存在、证据齐全、比较通过、人类接受、科学判断不能合成一个“成功”。
3. **优先暴露失败和豁免**：缺失依赖、环境差异和人工 waiver 应在 UI 可见，不能藏在长日志里。
4. **借鉴分级，不照搬宽泛承诺**：Pero 可为固定领域方法设计更有意义的数值/物理/统计检查，但需证明真实模型、真实执行和普通用户 UI 全部接通。
5. **将已有离线 checker 产品化**：对照 Wisp Capsule，验证 Pero 交出的结果能否由第三人在没有原应用、原会话和原模型的条件下核查。

## 待验证问题与建议测试

- 先冻结 Figure/Claim，再改变对应文件和运行，旧版本是否完全不受影响？重复导出是否得到相同包？
- 故意丢失输入、修改环境、改变数值容差，是否正确降级，是否存在错误 reproduced？
- 进程失败、部分产物和多 Run 依赖下，是否所有必需结果都被检查，而非只看最后一个 exit code？
- 使用另一个操作系统和 SSH 任务能否完成同等交接？无法复验时是否准确解释范围？
- 并发 kernel 隔离在不同会话、同项目及不同 context 下实际如何表现？先核清 README 与开发文档粒度差异。
- 同一公开生物数据任务，与 Pero/Notebook + coding agent 比较领域正确性、人工检查分钟数、总成本和重跑成功率。

以上为下一轮测试方案，**本报告未执行**。

## 官方来源

- [项目 README](https://github.com/xuzhougeng/wisp-science/blob/main/README.md)
- [Publication Evidence Workspace](https://github.com/xuzhougeng/wisp-science/blob/main/docs/publication-evidence.md)
- [开发 架构与测试边界](https://github.com/xuzhougeng/wisp-science/blob/main/docs/development.md)
- [v1.24.0 发行记录](https://github.com/xuzhougeng/wisp-science/releases/tag/v1.24.0)
- [当前主线许可证](https://github.com/xuzhougeng/wisp-science/blob/main/LICENSE)

[返回竞品索引](../README.md)
