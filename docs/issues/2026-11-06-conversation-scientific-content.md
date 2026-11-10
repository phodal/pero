---
kind: issue
status: open
date: 2026-11-06
github_issue: 145
github_state: OPEN
github_url: https://github.com/phodal/pero/issues/145
---

# 会话流中的科学内容展示与计算证据

## 目标与用户预期

研究者与 Pero 对话时，AI4S 科学内容直接在共享会话流中展示，并能继续讨论、修改和查看依据。入口是现有 harness + ChatPanel；无需先进入 Paper 编辑器或打开其他 App 才能看见主要结果。

Scientific Authoring + Computational Verification 是整体方向，但展示、计算与验证是不同能力：普通公式或用户提供的数据可以先展示，未检查内容如实标识；只有真实工具回执才能支持相应验证结论。

## 为什么需要

普通 Markdown 回复不能完整承载多行公式、化学结构、科学图表、实验表格及其来源。已有会话图表、产物和领域计算能力尚未组成一致的会话体验。仅新增写作 Skill、生成 LaTeX 源码或把文件放入产物侧栏，不能满足“直接在消息流中展示”的要求。

本 issue 专门跟踪科学内容的会话呈现与工具回执接线。#79 继续拥有研究生命周期总纲，#77 继续拥有选中论文结果后的复现流程。

## 内容范围

| 类型 | 会话内期望 | 优先级 |
| --- | --- | --- |
| 数学公式 | 行内/块级 LaTeX、多行对齐、矩阵、微分方程；可复制源码，支持稳定编号与引用 | P0 |
| 科学图表 | 数据驱动曲线、误差线、热图等；轴、单位、图例和实际值清楚；来源可查 | P0 |
| 实验结果 | 指标、样本数、统计方法、置信区间和误差定义；区分报告值与计算值 | P0 |
| 物理单位 | 科学记号、SI 单位、有效数字；具备工具时展示单位换算/量纲检查结果 | P0 |
| 科学表格 | 参数、消融、多维比较；多级表头、单位、统计标记；可绑定结果版本 | P0 |
| 文献与交叉引用 | DOI/BibTeX 文献入口，公式/图/表/代码输出的稳定引用和定位返回 | P0 |
| 科学数据说明 | 数据、代码、方法、环境与执行版本；可展开查看复现依据与未知项 | P0 |
| 数学推导 | 分步推导、定理/证明、假设与边界条件；展示有范围的检查结果 | P1 |
| 化学表达 | 分子式、反应式、二维分子结构、电荷和立体信息；复用真实结构工具 | P1 |
| 算法描述 | 伪代码、复杂度和流程图；可关联具体实现与验证证据 | P1 |

三维结构、相图等复杂交互视图纳入扩展范围，分增量声明支持情况；先在会话内提供可读预览，深入操作可打开已有 Viewer。不得以所有类型都输出一张无来源图片作为完成标准。

## 已有底座与缺口（2026-11-06 源码核查）

- `harness/go/charts/tool.go`：`chart_render` 已通过共享 Python 数据核心产生 `pero.chart.v1` 回执，在 ChatPanel 内联呈现并随历史回放；支持七种图表，尚非完整科学绘图能力。数据标签/哈希不证明输入来自真实实验。
- `crates/pero-chat-ui/src/chart_view.rs`：共享会话图表展示可作为纵向接线参考，复用现有 ACP 工具结果流。
- Host `deliver_artifact` 与 `SessionArtifact` 已保存文件快照和版本；产物保存本身不等于内联展示、计算血缘或科学验证。
- Paper 已有 KaTeX/MathML 阅读展示、来源证据与数值参考；不能据此认定共享 GPUI Chat 已拥有同等公式能力。
- Scientific Viewer 已有真实 RDKit 分子解析/二维渲染；Control Lab 已有特定方法的真实求解和检查；Environment 已有本地准备与 App 绑定。需逐项接入，不重新实现领域规则。
- 作者稿件领域、通用符号/量纲验证、结果驱动表格与跨内容更新仍需实现。SymPy 出现在依赖中不代表验证能力已接通。

参考：`docs/adr/0023-conversation-charts.md`、`docs/fitness/session-artifacts.md`、`docs/design-docs/paper-manuscript-authoring.md`。

## 实现边界

- harness 负责工具发现、调用和依据回执推进任务；科学规则由具名领域类型和纯函数拥有。
- Shared Chat UI 负责科学内容的内联呈现；Host/ACP 继续拥有授权、会话、取消和历史；现有领域 App 保留实验和证据所有权。
- Scientific Blocks 作为内容概念，按真实需要定义公式、图、表等具名值及其版本/来源引用；不要先建立通用注册中心或第二套执行状态机。
- 区分展示内容、计算产物与检查回执。检查记录指明所查对象版本、方法、假设、结果和限制；不采用无法解释范围的统一“Python verified”标签。
- 复用 `chart_render`、现有 artifact 版本及 App 工具边界。内置 Go harness 与外部 ACP Agent 的工具可用性分别记录，不假设外部 Agent 自动获得新工具。
- KaTeX/MathML、mhchem/RDKit、SymPy/单位工具等作为按需候选；Quarto/Pandoc/TeX 用于后续文档构建评估，不作为会话展示的前置条件。
- Paper 稿件保存和 PDF/HTML 导出可消费已确认内容；完整论文编辑器及通用定理证明器不属于本 issue 的首期交付。

## 实施顺序与验收

### 第一增量：公式、数据驱动图表、可追溯实验表格

- [x] 在同一真实共享会话中展示多行公式/矩阵、一张真实数据图和一张实验结果表；用户无需切 App 查看主要内容。
- [x] 公式可读并可复制源码；错误输入保留原文并显示局部错误，不能破坏整条回复。
- [x] 图表/表格可查看准确输入或结果引用、单位和计算方法；缺失值不补零，来源不明不能显示为实验已验证。引用是 `chart:` / `table:` 加回执内容哈希。方法与 reported/calculated/unspecified 都是声明，界面仍写明不是实验验证。缺失和 null 不补零。
- [x] 至少一个 Control Lab 已支持方法跑通：会话提出获准参数变更 → 实际求解 → 领域检查 → 新图/表及对应解释；新结果与旧版本可区分，旧检查不能自动继承到新输入。范围是 robust-pid 的搜索场景，见 2026-11-10 记录。Workbench 视觉尚未复验。
- [x] 工具不可用、计算失败、检查不通过和尚未检查分别呈现；已有成功内容保留可读。回执与解析测试覆盖这些状态；界面截图尚未复验。
- [x] 实际检查范围清楚，例如语法、符号计算、量纲或数值抽样；无工具/无证据时保持未检查，不由模型文字声明通过。本增量的范围是 Control Lab 既有 Hurwitz 与有限窗口检查，不是通用量纲或符号验证。

### 后续增量：完整科学表达与引用

- [x] 补齐上表各类型，逐项记录支持范围及未支持项；化学至少覆盖反应式和真实 RDKit 二维结构。支持范围见文末记录。反应式是 LaTeX，不是反应机理。二维结构是 Scientific Viewer 的 RDKit 回执。
- [x] 文献、公式、图、表的引用可稳定定位；修订和重新编号不把历史引用静默指向另一内容。身份分别是 DOI、BibTeX 原文哈希、公式源码哈希、图/表回执哈希。显示顺序不参与身份。Paper 位置沿用现有 `pero-app-location`。
- [x] 已展示内容能继续作为明确版本的后续对话上下文；可交付或关联 Paper 稿件，来源关系不丢失。回执和引用留在会话工具结果里。关联使用原 Paper 位置，不另建稿件编辑器。

### 共同验收

- [x] 历史恢复/重启后可重现已保存的内容；回放不重新计算或调用模型。既有图表/表格已在此前的 Workbench 重启中验证。本次 Control Lab 回执验证了存储重放不再求解；没有再跑桌面重启。
- [x] 内容主要在会话流可见，来源/长表/深入交互按需展开；不能只交付侧栏文件、源码或截图。
- [ ] 实际检查明暗主题、窄窗、长公式/宽表、键盘与复制；Web/Wasm 和 Native 分别记录观察与截图，构建成功不代替界面验收。
- [x] 用 PDE、控制优化、负二项分布和化学反应等材料检验表达能力；展示这些表达式不等于已经支持对应 CFD、MPC 或单细胞计算。
- [x] fixture 接线、真实工具、真实模型和科学接受分别记录；首例真实计算使用既有受支持方法，不要求泛化到所有学科。

## 关联

- #79：研究生命周期总纲。
- #77：原论文结果的复现与标注回写。
- 本地 canonical tracker：`docs/issues/2026-11-06-conversation-scientific-content.md`。

## 2026-11-06 实现进度与库选型

本次交付是会话呈现基础，issue 保持 OPEN；未完成全部科学创作/验证能力。

| 建议组件 | 本次决策 |
| --- | --- |
| KaTeX / MathML | Paper 阅读已有实现。共享 GPUI 会话采用 `latex-rust = 3.0.1`，同一 Rust 实现在 Native/Wasm 生成自包含 SVG；保留 LaTeX，随包提供字体/代码许可声明。不是完整 TeX 或 mhchem。 |
| MathLive / Tiptap | 属于可视化输入与稿件编辑，留给 Paper 编辑器；本次提供块级公式源码复制。 |
| MyST / Quarto / Typst | 出版、编号与交叉引用候选，暂不引入会话执行依赖。 |
| Plotly / Vega-Lite / Matplotlib | 本次复用已有 `chart_render` 与 GPUI 图表；修正小数数轴标签舍入为 0.0 的问题。误差线、热图、3D 等尚未新增。 |
| TanStack Table | 会话复用 GPUI Markdown 表格和已有 ContentReader；新增 `table_render`，无第二套 Web 表格运行时。 |
| SymPy / Pint / Statsmodels | 后续提供有对象版本与范围的检查回执；本次没有通用符号、量纲或统计验证。 |
| RDKit / Ketcher / NGL | 后续复用领域 App；当前支持普通数学语法写出的简单反应式，没有新增二维分子/立体结构内联块。 |
| Citation.js / Docling / GROBID | 属于引用与导入链路；本次未改动。 |

已实现：`$...$` 行内与独立 `$$` 块级公式、多行对齐、矩阵、PDE、源码复制及局部错误回退；精确数字、单位声明、缺失/null 区分、来源哈希与选择记录的实验表格；工具回执正常持久化和历史恢复。暂不支持 `\(...\)`/`\[...\]` 分隔符、公式编号/交叉引用、多级表头或自动依赖更新。

`table_render` 对 supplied dataset 保留来源，不证明它来自真实实验；表格中的 PASS/FAIL 列也只是记录字段。UI 明确说明科学结论未核验。独立验证不由模型输出的标签推断。

验收发现并修复两个问题：多个工具复用 mount ID 会使 harness 启动失败，改为按工具名称注册；原有单系列曲线将 0.001–0.008 的轴刻度显示为 0.0，数值轴统一使用小值科学记数法。没有引入新的执行状态机。

真实 Control Lab `python-control` 对 kp=1 和 kp=2 的 nominal 场景完成计算与原有 checker；最终采样误差为 0.008012362983683907 和 0.0017626982052595386，两者报告均为 FAIL。求解过程保留数值 RuntimeWarning。这里只运行引擎/checker 并把输出交给真实 harness 展示，不代表已完成 Agent→授权→Store→改参重算的闭环。

行为/视觉、命令、截图与尚未验证范围见 [科学会话验收](../fitness/scientific-conversation.md)。

实现提交（分支 `codex/scientific-chat-145`，已推送）：

- `a4f970c2` — 共享会话公式渲染与许可。
- `6e01d808` — harness 实验表格领域与工具。
- `4931551d` — 内联实验表格与来源阅读。
- `1118d6af` — 科学数值轴刻度修正。

## 真实 GPT / ACP 与分子 skill 验证

用户要求补充真实 GPT 理解/生成验收，并设计 RDKit 输入/输出 skill。本轮沿用
现有 Go harness、ACP、Host 和 GPUI，使用用户已配置的 GPT API；默认测试仍不联网。

已观察到：配置的 `gpt-6.1-sol` 经 Responses 完成两轮自然语言任务，主动选择
`table_render`/`chart_render`，保留原始误差和来源 run，生成公式、变量定义、单位矩阵；
追问中保留旧表并产生新哈希，零值与新 run 正确，未声称运行或验证实验。
Chat Completions 入口首次返回 HTTP 503；Responses 的第三轮首次遇到 HTTP 429。
这些是实际失败记录，不计为模型通过。当前 Responses adapter 非 token streaming，
ACP 仍有真实工具/消息更新；尚不声称 GPT token 流验收。

新增 App 所有的 `molecular-report` skill，复用现有 Scientific Viewer worker，
规定原始分子文本、JSON 请求、逐条错误、实际描述符、SVG 与科学结论的边界。
通过 `--skills-root` 广告/摘要加载，且加入 Pero 的 skill 上下文入口和 App 打包清单。
不新增 RDKit 计算实现或凭空定义会话内分子回执。

首次独立分子测试发现测试驱动把 `--approval never` 当成“无提示执行”，实际含义是
拒绝需批准的写文件/命令。因此 GPT 正确发现和读取 skill，但 worker 未执行；它
如实报告未计算，没有编造数值。后续测试改为现有 `ask` + ACP 默认 Auto-review，
使用用户授权的临时工作区执行。生产权限规则不修改。


分子正向验收已完成：11 次真实 GPT 请求，经 skill 发现/读取、ACP Auto-review、
现有 Scientific Viewer worker 和 `table_render`，用 RDKit 2026.09.1 处理
`CCO`、`C[C@H](O)C(=O)O`、`invalid@@`。前两条产生真实描述符与 SVG；
第三条保留 `Invalid molecule`，没有补造数值或图。MolWt 为 46.069 / 90.07799999999999，
TPSA 为 20.23 / 57.53 Å²。模型调用实际 `deliver_artifact` 交付结果 JSON，并明确
SVG 保存在文件内、尚未内联显示；没有把解析成功表述为实验/生物活性验证。
完整记录在 `test-results/scientific-molecules-real-approved/`，随后用同一历史离线回放检查 UI。

## 会话科学内容的视觉迁移

按用户要求，由两个 subagent 制作公式、控制实验、分子部分失败三类明暗/窄宽原型，
再落实到共享 GPUI，原型在 `test-results/scientific-design/`；它们不作为产品验收替代品。

- 旧公式下方的 `LaTeX` 文本按钮 → `pero_theme::ghost_icon_button`，保留动作名称、提示和原始源码复制。
- 旧图表/表格上方工具名称 → 内容标题优先，成功结果下方显示可展开的执行详情。运行、失败和审批仍由原会话状态决定。
- 旧结果的零散标题/页脚 → `research_result` / `research_note`；来源和未核验说明保持可见。
- 旧表格样式 → `research_table_style`，轻染表头、适当行距和按 CellKind 右对齐的数字列。
  不舍入原始数字；只有实际出现 null/缺失时才显示对应图例，不凭 PASS/FAIL 字符串生成验证徽章。
- 修复 JSON Lines 来源身份前缀；共享 `ScientificSource` 以 json/jsonl + 原始字节绑定来源。
- 补充科学单位字体子集，防止 `Å²` 等在 Wasm 显示缺字；生成字体不提交 Git。

实际 Native 窗口已检查浅/深色公式、控制表格、局部公式失败、源码复制、原始记录打开、
执行详情展开，以及键盘调整为较窄会话分栏；证据在 `test-results/scientific-chat/native-*.png`。
Electron GPUI/Wasm 的两主题、较窄窗口、原始 JSON 精确复制和完整重启回放自动回归通过。
分子表格另已验证窄窗横向滚到最后一列，科学单元格保持单行以避免拆断小数和 SMILES。
这些不代表超宽公式滚动、完整键盘/屏幕阅读器、签名安装包或所有科学领域均已验收。


补充本地提交：`1720a622`（来源绑定）、`4b3ad893`（分子 skill）、
`f88d015f`（科学单位字体）、`0cfeaf11`（共享结果呈现）及 `0d2aa4cd`（会话 UI）。
均关联 #145，已推送。完整范围仍未完成，GitHub issue 保持 OPEN。

2026-11-06：按用户要求推送至 `origin/codex/scientific-chat-145`，科学会话实现截至 `00c4c78d`。
后续文件浏览调研见 [会话工作区文件树](../design-docs/conversation-workspace-file-tree.md)：
核查实际 request/result JSON，并对照本机 Qwen、deepseek-harness、Zed、Pi 和 Codex 源码。
建议复用右侧面板、Host 文件读取和 ContentReader；本轮仅记录方案，尚未实现文件树。


## 2026-11-07 文件树与合并收尾

科学会话 PR #150 已合并到 master（`cd873027`）。当前增量新增会话工作区
Files/Artifacts 切换，关联 #145；没有关闭仍有未完成科研能力的总 issue。

- 单层惰性目录读取、虚拟列表、键盘导航与复用 ContentReader，Host 根据原会话解析目录。
- Files 是实时工作区；Artifacts 是历史交付快照。浏览不调用 Agent，不写对话历史。
- 用户指出两层 Files 标题重复，已合并为上方单行切换和操作栏；选中态明确，预览保留。
- 修复 #150 审查发现的较大科学回执被默认 50,000-byte spill 截断后无法展示：
  完整回执保存在 `ToolPresentation` 元数据，ACP 实时/回放统一投影，模型侧继续使用有界文本。
  两个真实 mounted 科学工具、实际 spill 及 ACP 两种投影路径已有回归。
- 已同步主干 GPUI Kit 0.9.0 并重新构建/验收。用户明确要求不提交二进制截图，
  PR 链接 [本地验收记录](../fitness/workspace-files.md)，记录 ignored 截图位置与观察范围。


PR #155 收尾审查：Markdown 文件预览使用 workspace Reader 后捕获链接，却未订阅
`ReaderAction::Link`，导致点击无效果。已接回既有 ContentLink 分类和会话文件读取；
外部 URL 交给现有 opener，工作区外目标显示局部错误。补充纯路径解析与真实 Markdown 点击回归。

CI run `42248809414` 的 engineeringprofile fixture 在清理时把
`ErrHarnessDisposalInProgress` 当作失败；Harness 合约明确 Dispose 可以返回 pending，
Drain 才是最终关闭回执。30 次本地重复未复现调度时序，但 fixture 的断言与合约不符；
仅修正清理接受该 pending 值，仍检查 Drain 的最终错误，不改变运行时行为。

同一次 CI 的 Host settings 合约期望值尚未包含新增 `resource_tab`，导致旧配置恢复/
保存/重启的整对象比较失败。已补齐默认 Artifacts、保存 Files 与非法 tab 拒绝的合约案例。


最终审查补齐 workspace_files 事件的 thread_id 合约、断开后的请求释放与重试、
工作区不可用时保留列表、tab 偏好回显顺序、打开产物后的偏好保存，以及 Markdown
重载时保留滚动位置。真实滚动回归同时修复了 Reader 的滚动容器约束。
完整科学回执现在保留同时返回的图片，实时与回放测试通过。
线程池限流和抗并发路径替换的描述符式文件隔离未纳入本增量；具体边界见验收记录。

## 2026-11-10 Control Lab 会话闭环

对照最新 `master`（`ce9e2a3a`，已含 Notebook #181）和 issue 全文。#145 无 assignee、无开放 PR。`codex/scientific-chat-145` 已随 #150 / #155 合并，没有第二份进行中的实现。本增量不改侧栏，不重做 Notebook 的领域快照，也不进入 #79 / #77。

Control Lab 继续拥有求解和检查。新增只读 `project-result`（agent-step `project`）：在既有 Host goal 注入 `specHash` 之后，把一个已保存候选投影成 `pero.control-conversation.v1`。它不启动求解、不锁定、不继承另一组参数的报告。获准改参仍走既有 `propose-candidate`；求解仍由 `ExperimentStore` 和真实引擎完成。共享 Chat 只解析这份回执，复用现有曲线绘制和科学表格样式。

真实 `python-control` 0.10.2，robust-pid，horizon 2 s、201 个样本：kp=1 与 kp=3 都是 `check_failed`，版本 `83d66c7a789b` 与 `c633259368c9` 不同，报告 id 不相交。名义场景最终窗口误差为 0.2594973325520875 与 0.012463386149768274，限制 0.01。沉降时间在 kp=1 为 `INCONCLUSIVE` 且 actual 为 null；增益裕度可以是无交越的 PASS，actual 仍为 null，不写成 0。内联曲线是该观测的 16/201 个已保存 reference 样本，不是新的求解。同一回执再投影不会增加 trial。把候选参数改掉而不重算时，状态变为 `unchecked`，曲线为空，旧 report id 进入 `notApplicable`。

求解器不可用、计算失败和尚未检查在回执里分开。解释写明方法是 `control-lab-verifier-v1` 的 Hurwitz 与冻结有限窗口，不是设备验收，也不适用于其他参数。引用形如 `control-lab:{experimentId}@{version}`，版本由规范哈希、当前参数和各搜索场景的观测/报告身份决定。

当时尚未完成：通用图表/表格的计算方法、文献和图/表编号、Paper 稿件关联、ngspice 主动滤波器这条会话闭环，以及本回执在 Workbench 明暗主题、窄窗、键盘和复制上的界面验收。Native 库测试已运行；Wasm 与完整 Workbench 没有运行。没有新的真实模型请求。分子回执见下一节。详情见 [科学会话验收](../fitness/scientific-conversation.md)。

## 2026-11-10 分子结构与公式引用

化学结构继续由 Scientific Viewer 的 `preview` 拥有。`conversation.py` 只把这次预览投影成 `pero.molecule-conversation.v1`。内置 harness 的 `molecule_render` 调用它；模型看到的是不含 SVG 的摘要，会话界面看到完整回执。无效记录没有图，也没有被补成 0 的描述符。真实 RDKit 2026.09.1 对 `CCO`、`C[C@H](O)C(=O)O` 和 `invalid@@` 的结果与既有分子测试一致：乙醇 MolWt 约 46.069，无效输入保留 `Invalid molecule`。同一输入再次投影得到同一版本。

公式的稳定引用是源码的 SHA-256，形如 `formula:{hash}`。它不使用公式在消息里的位置，因此前面的文字改动或重新编号不会把旧引用指到另一条公式。复制源码的原按钮保留。

反应式仍只是 LaTeX，不是反应机理或 RDKit 反应绘图。文献编号、图/表编号、Paper 稿件关联、ngspice 会话闭环，以及分子图在 Workbench 里的明暗、窄窗和键盘验收都还没有做。Wasm 没有运行。

## 2026-11-10 引用身份与支持范围

图和表的稳定引用是回执内容哈希：`chart:{artifactId}`、`table:{artifactId}`。表格可以声明 `method` 和 `valueOrigin`（`reported`、`calculated` 或 `unspecified`）。未说明来源时界面写明不是实验验证。缺失单元格仍是 missing，null 仍是 null。图表方法写在 `source.method`，缺省时界面写明未说明计算方法。这些都是声明，不产生检查结论。

公式引用是 `formula:{sha256(source)}`。DOI 引用是规范化后的 `doi:10…`。BibTeX 引用是条目原文的 `bibtex:{sha256}`。Paper 关联只接受现有 `pero-app-location://paper-agent/main/report/{64}/citation|passage/…`，版本留在该地址里。重新排序不会把旧 token 解析到另一条已保存内容。

| 类型 | 本 issue 支持 | 明确不做 |
| --- | --- | --- |
| 数学公式 | 行内/块级、对齐、矩阵、复制源码、源码哈希引用 | 通用定理证明；显示序号不是身份 |
| 科学图表 | 既有七种图、来源、单位轴、方法声明、内容哈希 | 误差线、热图、三维、相图 |
| 实验结果 | 精确数字、样本字段、方法声明、报告值/计算值/未说明 | 不把声明当成独立统计检验 |
| 物理单位 | 列单位、科学记数轴 | 没有接入通用量纲换算工具，所以不显示换算结论 |
| 科学表格 | 单位、缺失/null、结果版本哈希 | 多级表头 |
| 文献与交叉引用 | DOI、BibTeX 原文哈希、图/表/公式/Paper 位置 | GROBID/Docling 导入 |
| 科学数据说明 | 回执中的方法、引擎版本、范围和未知项 | 不把文件侧栏当作正文 |
| 数学推导 | 可展示步骤；无工具时保持未检查 | 通用证明器 |
| 化学表达 | LaTeX 反应式；RDKit 二维结构、电荷和立体 SMILES、逐条错误 | 反应机理、三维结构、生物活性 |
| 算法描述 | 普通 Markdown 伪代码 | 不把流程图当成验证 |

ngspice 主动滤波器没有走会话改参闭环。完整论文编辑器不属于本 issue。
