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
- [ ] 图表/表格可查看准确输入或结果引用、单位和计算方法；缺失值不补零，来源不明不能显示为实验已验证。
- [ ] 至少一个 Control Lab 已支持方法跑通：会话提出获准参数变更 → 实际求解 → 领域检查 → 新图/表及对应解释；新结果与旧版本可区分，旧检查不能自动继承到新输入。
- [ ] 工具不可用、计算失败、检查不通过和尚未检查分别呈现；已有成功内容保留可读。
- [ ] 实际检查范围清楚，例如语法、符号计算、量纲或数值抽样；无工具/无证据时保持未检查，不由模型文字声明通过。

### 后续增量：完整科学表达与引用

- [ ] 补齐上表各类型，逐项记录支持范围及未支持项；化学至少覆盖反应式和真实 RDKit 二维结构。
- [ ] 文献、公式、图、表的引用可稳定定位；修订和重新编号不把历史引用静默指向另一内容。
- [ ] 已展示内容能继续作为明确版本的后续对话上下文；可交付或关联 Paper 稿件，来源关系不丢失。

### 共同验收

- [x] 历史恢复/重启后可重现已保存的内容；回放不重新计算或调用模型。
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

本地实现提交（分支 `codex/scientific-chat-145`，尚未推送）：

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
均关联 #145，尚未推送。完整范围仍未完成，GitHub issue 保持 OPEN。
