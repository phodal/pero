# 科研 Agent 的可视化、交互与渲染源码对比

## 哪些项目确实有可研究的界面源码？

### Takeaway

本轮最值得 Pero 优先读的交互实现，是 Ai2 ScholarQA 的证据矩阵和引文组件、OpenScholar demo 的修订比较，以及 PDF.js 的可选中文本层。AutoResearchClaw 与 Agent Laboratory 的现有仓库不能直接视作完整科研工作台：前者的遗留前端存在静态挂载路径不匹配和功能占位，后者主要通过终端收集反馈。

### Cited Findings

本次为只读源码研究：2026-10-29 执行 `git clone --depth 1`，未安装上游依赖、未执行上游脚本、未运行研究 Agent，也未完成这些系统的浏览器交互验收。下列 5 个仓库由本研究者成功克隆，另 2 个由同组研究者成功克隆后共用读取；源码全部留在 `/Users/phodal/test/paper-agent-research/`，未复制进 Pero 应用。版本日期为 Git commit 的 committer 日期，不代表产品发布时间。

| 本地目录 | official origin / 固定 SHA | commit 日期 | License / 性质 |
| --- | --- | --- | --- |
| `AgentLaboratory` | [SamuelSchmidgall/AgentLaboratory@d9017d90e329112d2a80b7712f37ee9094d2cd27](https://github.com/SamuelSchmidgall/AgentLaboratory/tree/d9017d90e329112d2a80b7712f37ee9094d2cd27) | 2025-08-20 | [MIT](https://github.com/SamuelSchmidgall/AgentLaboratory/blob/d9017d90e329112d2a80b7712f37ee9094d2cd27/LICENSE)，含 AgentRxiv 服务 |
| `AutoResearchClaw` | [aiming-lab/AutoResearchClaw@be4ba4755bf1b52220f25e13b2293b5956590070](https://github.com/aiming-lab/AutoResearchClaw/tree/be4ba4755bf1b52220f25e13b2293b5956590070) | 2026-08-19 | [MIT](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/LICENSE)；官方论文明确指向该仓库 [arXiv](https://arxiv.org/abs/2605.20025) |
| `pdf.js` | [mozilla/pdf.js@87b369cd9d4cfe415b587b26a8d81f486db02874](https://github.com/mozilla/pdf.js/tree/87b369cd9d4cfe415b587b26a8d81f486db02874) | 2026-10-28 | [Apache-2.0](https://github.com/mozilla/pdf.js/blob/87b369cd9d4cfe415b587b26a8d81f486db02874/LICENSE)；额外加入的渲染基础组件 |
| `elicit-api-examples` | [elicit/api-examples@89e24c1b28510079aad24fcd73f8052858cc7257](https://github.com/elicit/api-examples/tree/89e24c1b28510079aad24fcd73f8052858cc7257) | 2026-07-16 | [MIT](https://github.com/elicit/api-examples/blob/89e24c1b28510079aad24fcd73f8052858cc7257/LICENSE)；API 调用与集成示例 |
| `scite-extension` | [scitedotai/scite-extension@b676165d2d40154a23534807f7739121d03feae3](https://github.com/scitedotai/scite-extension/tree/b676165d2d40154a23534807f7739121d03feae3) | 2026-10-07 | [MIT](https://github.com/scitedotai/scite-extension/blob/b676165d2d40154a23534807f7739121d03feae3/LICENSE)；浏览器扩展与 citation badge |
| `ai2-scholarqa-lib` | [allenai/ai2-scholarqa-lib@19e6827ba9e7fe05068624d0851f38cd74ff5efc](https://github.com/allenai/ai2-scholarqa-lib/tree/19e6827ba9e7fe05068624d0851f38cd74ff5efc) | 2026-10-26 | [根目录 Apache-2.0](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/LICENSE)，但 [ui/package.json:5](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/package.json#L5) 标为 `UNLICENSED`；直接复制 UI 代码前需澄清范围 |
| `open-scholar-demo` | [allenai/open-scholar-demo@565cfbb4e77fa520196631cc710147de2b9a4ca1](https://github.com/allenai/open-scholar-demo/tree/565cfbb4e77fa520196631cc710147de2b9a4ca1) | 2026-04-06 | [根目录 LICENSE](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/LICENSE)；由同组克隆，本文只检查 report UI |

- **Agent Laboratory / AgentRxiv：**人工反馈是在 `human_in_loop()` 中 `print()` 产物，再 `input()` 收 Y/N 和修改建议；拒绝后将建议加入 notes 并重跑，阶段保存是 `pickle.dump(self, ...)`。可研究反馈位置与再迭代语义，不能据此声称已有浏览器共编工作台。[human_in_loop:547-574](https://github.com/SamuelSchmidgall/AgentLaboratory/blob/d9017d90e329112d2a80b7712f37ee9094d2cd27/ai_lab_repo.py#L547-L574)、[save_state:106-113](https://github.com/SamuelSchmidgall/AgentLaboratory/blob/d9017d90e329112d2a80b7712f37ee9094d2cd27/ai_lab_repo.py#L106-L113)
- **AgentRxiv 是累计报告检索服务，而非证明结论正确的共享知识库。**服务将上传 PDF 的页文本拼接，向量相似度排序返回 PDF URL，Agent 再取 PDF 生成摘要。`app.py` 引用了 index/upload/search/view 模板，本次 `git ls-files` 未找到模板目录或 HTML 文件，因此不能把这个快照称为可直接启动的完整网页产品。[app.py:20-53](https://github.com/SamuelSchmidgall/AgentLaboratory/blob/d9017d90e329112d2a80b7712f37ee9094d2cd27/app.py#L20-L53)、[app.py:121-156](https://github.com/SamuelSchmidgall/AgentLaboratory/blob/d9017d90e329112d2a80b7712f37ee9094d2cd27/app.py#L121-L156)、[search_agentrxiv:613-643](https://github.com/SamuelSchmidgall/AgentLaboratory/blob/d9017d90e329112d2a80b7712f37ee9094d2cd27/ai_lab_repo.py#L613-L643)
- **AutoResearchClaw 主仓库具有 FastAPI API、WebSocket 和遗留界面文件，但集成不完整。**当前 server 静态挂载只在 `frontend/` 存在时启用；检出树提供的是 `frontend-legacy/`。其 package 声明是 vanilla JS/no build step，不能把目录存在等同于当前 CLI 已交付可用 dashboard。[server/app.py:104-130](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/researchclaw/server/app.py#L104-L130)、[frontend-legacy/package.json](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/frontend-legacy/package.json)、[仓库目录](https://github.com/aiming-lab/AutoResearchClaw/tree/be4ba4755bf1b52220f25e13b2293b5956590070)
- **占位与已实现必须分开：**`PaperPreview` 注释称 render markdown/PDF，实际只显示 has_md/has_tex/has_pdf 对应的“available”；`ExperimentMonitor` 建了 canvas，但 `_renderMetrics()` 只生成数值卡，未看到曲线构建；语音按钮只切图标，注释写“production use MediaRecorder”。因此它适合看页面分工和事件名称，不适合作为成熟 PDF/图表/语音实现样板。[PaperPreview:17-31](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/frontend-legacy/src/components/PaperPreview.js#L17-L31)、[ExperimentMonitor:7-58](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/frontend-legacy/src/components/ExperimentMonitor.js#L7-L58)、[ChatPanel:88-97](https://github.com/aiming-lab/AutoResearchClaw/blob/be4ba4755bf1b52220f25e13b2293b5956590070/frontend-legacy/src/components/ChatPanel.js#L88-L97)
- **四个商业产品只比较可见公开边界：**Elicit 官方公开 org 有 API examples/eval 等，但本轮未定位到完整 Research Agent 产品前后端；克隆到的是示例而非产品。Scite 有确实可克隆的 badge/extension，不等于 Scite Assistant 平台代码。Consensus、SciSpace 在本轮限定检索未定位到可归属官方的完整产品仓库，以下仅引用官方文档，不能断言它们绝无公开代码。[Elicit org](https://github.com/elicit)、[Elicit examples README](https://github.com/elicit/api-examples/blob/89e24c1b28510079aad24fcd73f8052858cc7257/README.md#L13-L34)、[Scite org](https://github.com/scitedotai)、[Scite API](https://scite.ai/api)、[Consensus Help](https://help.consensus.app/en/articles/9922726-why-do-people-choose-consensus)、[SciSpace Chat PDF](https://scispace.com/chat-pdf)

### Inferences

- 项目列表需要加 `algorithm / usable UI source / legacy or partial UI / docs only / integration examples` 维度；同名系统论文演示、marketing 图和实际默认启动的界面应分别标注。
- AgentRxiv 的共享报告是新的输入来源，不能自动获得 Pero 的人工采纳或科学验证状态。复用其“跨次研究可检索产物”思想时，应保留来源和接受状态。

### Gaps

- 未登录四个商业产品、未消耗 API 配额、未执行源项目模型流程；商业交互只是官方文档描述，开源项目只是静态代码观察。
- 原文 `Paper_Agent_Research_and_Pero_Architecture_2026-10-29.md` 在 Downloads、workspaces、当天 visualizations 的精确文件名检索无结果，本次未核对其 42 个原始链接；不能宣称完整覆盖其 13 组及全部 URL。

## 哪些交互与渲染实现值得 Pero 阅读？

### Takeaway

优先学习“内容结构和证据关联”，再选 renderer。矩阵单元格、正文引文、修订差异、PDF 页面文本是不同的领域对象；把这些都当作一段 Markdown 会丢掉核验入口。

### Cited Findings

1. **ScholarQA：单元格关联证据。**`TableWidget` 明确 rows/columns/cells，cell 有原值、展示值、loading/error、metadata、edited_value/edited_by_uuid。`CellWithEvidence` 从 metadata.evidenceId 取引用，用户打开弹层才 `getEvidence()`，显示 supports 和 corpusId。现有渲染组件使用 `display_value`，未在所查视图看到编辑交互；类型里有 edited 字段不等于当前 UI 支持编辑。[TableWidget:91-128](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/src/@types/TableWidget.d.ts#L91-L128)、[CellWithEvidence:18-53](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/src/components/report/LitTable/CellWithEvidence.tsx#L18-L53)
2. **ScholarQA：矩阵窄屏按列分页。**`LitTable` 根据 <900/<1100 窗宽展示 1/2/3 比较列，左边保留论文列，再逐个 cell 交给证据组件。优点是论文和列名称始终在视野内，代价是跨多列比较需要切换；Pero 可对照桌面横向滚动+固定论文列决定采用方式，不应照抄断点。[LitTable:20-64](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/src/components/report/LitTable.tsx#L20-L64)、[LitTable:87-129](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/src/components/report/LitTable.tsx#L87-L129)
3. **ScholarQA：正文引用映射到证据组件，并区分模型记忆。**Markdown 的 `Paper` override 通过 corpusId 找结构化 citation，把片段传给引文 chip；`Model` override 明示内容来自模型记忆且未找到相关来源证据。Popover 展示论文元数据和原文 snippets，标题链接到 Semantic Scholar，并非内嵌 PDF 原位置定位。[Section:21-77](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/src/components/report/Section.tsx#L21-L77)、[EvidenceCard:53-101](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/src/components/widgets/EvidenceCard.tsx#L53-L101)
4. **ScholarQA：长任务显示用户理解的阶段。**`StepProgress` 分开初始化、历史步骤、当前步骤、预计时间与错误。它依赖 `TaskStep[]`，不是从聊天词汇猜阶段；这适合 Pero 在 Host 执行记录之上提供领域投影。[StepProgress:11-58](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/src/components/StepProgress.tsx#L11-L58)
5. **OpenScholar demo：回答修订可比较。**`Report` 在存在 previousSection 时提供 Compare with draft，使用 react-diff-viewer；比较前按句拆行，并弱化年份和引用编号差异，正常视图仍通过 Markdown 的 Paper override 接引文卡。它是答案前后差异，不是源文件/实验结果等价证明。[Report:17-42](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/report/Report.tsx#L17-L42)、[Report:88-132](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/report/Report.tsx#L88-L132)、[Report:144-158](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/report/Report.tsx#L144-L158)
6. **PDF.js：图片页、文本层、文本高亮是分开的机制。**`TextLayerBuilder` 从 `pdfPage.streamTextContent()` 渲染文字，将 textDivs/textContentItemsStr 映射交给 highlighter 和 accessibilityManager；匹配位置由高亮器转为 divIdx/offset，find controller 按 pageIndex/matchIndex 滚到对应文本。PDF.js 是渲染与选择的基础，不能单独把另一套 OCR/Markdown 的字节偏移转为可靠 PDF 坐标。[text_layer_builder:94-132](https://github.com/mozilla/pdf.js/blob/87b369cd9d4cfe415b587b26a8d81f486db02874/web/text_layer_builder.js#L94-L132)、[text_highlighter:103-142](https://github.com/mozilla/pdf.js/blob/87b369cd9d4cfe415b587b26a8d81f486db02874/web/text_highlighter.js#L103-L142)、[pdf_find_controller:566-579](https://github.com/mozilla/pdf.js/blob/87b369cd9d4cfe415b587b26a8d81f486db02874/web/pdf_find_controller.js#L566-L579)
7. **Scite extension：分类和提醒直接在阅读上下文可见。**`Tally` 分开 supporting/contradicting/mentioning 数量及 retraction/editorial notices，点击跳到 DOI 对应 report。UI 来自 API tallies，不是在浏览器现场证明研究真假；数量不能变成 Pero 的科学结论通过/失败。[Tally:84-116](https://github.com/scitedotai/scite-extension/blob/b676165d2d40154a23534807f7739121d03feae3/src/components/Tally.js#L84-L116)、[badge/scite:5-22](https://github.com/scitedotai/scite-extension/blob/b676165d2d40154a23534807f7739121d03feae3/src/badge/scite.js#L5-L22)
8. **Elicit 文档：事件、产物和来源分别可取。**公开 v2 API 把 Agent session 的 completed 解释为 idle/可继续对话；事件用 cursor/eventId 增量读取；产物按 table/prose/presentation/figure 区分，来源用 sourceRef 关联。本文借鉴的是公开协议形状，未检查其平台内部实现。[Elicit API](https://docs.elicit.com/)
9. **商业产品文档：**Consensus 的 Study Snapshot 在论文旁暴露方法和 outcome measures；SciSpace 描述选中文本解释、相关论文、记笔记及来自 PDF 指定 section 的答案。它们支持“选中内容→带来源操作”的任务设计，但本轮没有源码证据说明其底层定位算法。[Consensus Help](https://help.consensus.app/en/articles/9922726-why-do-people-choose-consensus)、[SciSpace Chat PDF](https://scispace.com/chat-pdf)

### Inferences

- **建议交互结构：**保留 Pero 共享 Chat；领域主面板承担 Reader / Evidence matrix / Report / Experiments。引文点击打开固定侧栏，持续对照原文；矩阵单元格打开同一个证据侧栏，不再另建全局聊天系统。
- **建议先定义格式，再换渲染库：**正文以允许的 Markdown block + citation references 为契约；公式用专门 math block；图/表使用 Artifact 引用与 caption；数值矩阵用结构化 cells；不要要求 UI 从自由文本里猜 DOI、数字、文件路径、实验状态。
- **PDF 的务实第一步：**先有不可变原文件+页面号+原始选文/定位来源，再逐步补页内高亮。对没有页坐标的 Markdown/纯文本证据保持文本上下文定位，不编造 PDF 精确位置。
- **Agent 进度：**展示真实已发出的检索/读取/提取/写作事件和可取消状态；当前工具调用归 Host，领域名称是投影。没有可测总量时不产生虚构百分比。
- **修订接受：**候选 report 版本与当前已采纳版本并列 diff；即使文本差异小，也保留 citations/source/content digest 和 evidence 状态变化。OpenScholar demo 的“清理引用编号后比较”可提升阅读，但不能作为研究证据版本比较的全部依据。

### Gaps

- 所查 ScholarQA UI 使用 markdown-to-jsx 和自定义引用组件，依赖中未看到 KaTeX/MathJax/PDF reader；没有足够证据把它描述为完整的公式、图表和 PDF 工作台。[ui/package.json:16-45](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/package.json#L16-L45)
- 本文没有测量这些 renderer 的性能、辅助技术表现、公式覆盖率或 PDF 提取质量；源码存在不等于在 Pero iframe/主题/窄屏中通过验收。

## Pero 应该补什么，哪些现有边界应保留？

### Takeaway

Pero 当前已经有冻结原文、精确引文检查、Reader/Report/EvidencePanel 和共享 Host Agent 通道；主要缺的是丰富内容渲染、单元格级证据矩阵、可恢复的执行/产物关联与修订比较。无需因本轮比较另加一套通用调度或聊天后端。

### Cited Findings

- 对照工作区 2026-10-29，协调者记录 HEAD `393bea7972bc765d2f831636bb460320378fac80`，其他线程有并行未提交改动。本研究只读，没有修改产品。`Reader` 目前按空行拆段、正则识别标题，原 PDF 走外链；`ReportView` 的正文是 React `<p>` 字符串，实验代码是 `<pre><code>`。这是安全简单的文本显示，但不是 Markdown tables/math/figure/PDF 渲染器。[Pero documents.tsx:6-29](/Users/phodal/workspaces/pero/apps/paper-agent/ui-src/documents.tsx:6)、[ReportView:46-64](/Users/phodal/workspaces/pero/apps/paper-agent/ui-src/documents.tsx:46)、[Experiments:67-75](/Users/phodal/workspaces/pero/apps/paper-agent/ui-src/documents.tsx:67)
- `EvidenceReference.locate()` 对冻结 paper.content 做精确连续引文查找，再给 start/end/heading 和前后 500 字符；当前定位不是 PDF 页/坐标。UI 把上下文和 quote 用 `<mark>` 显示，已有良好的“报告→原文”入口，应升级同一证据对象而非丢掉重做。[reports.py:10-41](/Users/phodal/workspaces/pero/apps/paper-agent/backend/paper_agent/reports.py:10)、[EvidencePanel:78-84](/Users/phodal/workspaces/pero/apps/paper-agent/ui-src/documents.tsx:78)
- 当前架构说明明确 App 拥有领域界面/数据，Host 拥有会话、审批和进程；共享 Chat 通过 SDK 展开/填草稿，App 不另建消息、模型或审批实现。该文件有其他线程并行变更，以上是工作区当前观测，不是本轮新交付。[ARCHITECTURE.md](/Users/phodal/workspaces/pero/docs/ARCHITECTURE.md:1)、[ADR 0007](/Users/phodal/workspaces/pero/docs/adr/0007-local-app-platform.md:1)、[ADR 0012](/Users/phodal/workspaces/pero/docs/adr/0012-shared-gpui-app-chat.md:1)
- Pero UI 约定保留黑白灰主层级、任务优先、明确加载/空/错误/运行/完成状态、键盘焦点和真实浏览器验证；科学图表使用 DESIGN.md 的主题与分类色，避免拿上游截图配色当产品标准。[AGENTS.md](/Users/phodal/workspaces/pero/AGENTS.md:1)、[DESIGN.md](/Users/phodal/workspaces/pero/DESIGN.md:1)
- **Pero 已有聊天 Markdown 能力应先盘点复用。**共享 GPUI Chat 使用 retained `TextViewState::markdown()`，流式追加与选择由 `stream.rs` 管理。它是 Rust/GPUI 组件，不能直接当 React iframe 组件导入；本轮对 App SDK / Paper App 的局部依赖检索未看到已有 React Markdown、KaTeX 或 MathJax renderer。后续应在 App SDK 规划可复用的 Web 内容呈现/引用契约，保留共享 Chat 现有渲染；先验证最小 PDF 嵌入能力，不把 PDF.js 整个 viewer 或另一套聊天渲染搬进 Paper App。[stream.rs:112-122](/Users/phodal/workspaces/pero/crates/pero-chat-ui/src/stream.rs:112)、[stream.rs:195-214](/Users/phodal/workspaces/pero/crates/pero-chat-ui/src/stream.rs:195)、[App SDK 源码](/Users/phodal/workspaces/pero/packages/app-sdk/src/index.tsx:1)

### Inferences

建议后续实现切成四个可单独验收的目标，以下均为建议而非已交付：

1. **Reader 和 Report 共用科学内容 renderer。**先盘点并保留现有 GPUI Markdown，在 App SDK 的 Web 边界补齐真实复用的内容组件与引用契约，避免每个 App 自选整套聊天渲染。先覆盖 headings/list/table/code/math/image caption；引文仍是类型化 reference 的组件；只允许既定内容和来源，不直接采纳 AutoResearchClaw 遗留 ChatPanel 的正则替换后 `innerHTML`。对应用户价值是论文结构和公式可读，验收包含选文仍能绑定冻结来源、引文/代码/公式/表格导出、深浅主题与窄窗。
2. **Evidence matrix。**Python frozen dataclass 定义 Matrix/Column/Cell/EvidenceReference，单元格表达原值、规范值、单位、缺失或冲突和来源；React 使用表格与已有证据侧栏；编辑产生人工修订版本。验收一格一证据、无来源和相互冲突可见、列多/内容长/键盘可用。
3. **Research activity + Artifact 对照。**复用 Host session/turn 和现有执行权威，持久记录提交与产物引用；显示真实阶段和可取消操作；表/文/图/代码作为不同 artifact 预览。验收隐藏/重开面板后仍能关联结果，不靠聊天文字推断实验已执行。
4. **PDF 与修订版本。**已有 PDF 文件在受管 App 内用 PDF.js 页面渲染和文本层；有来源定位信息才高亮页内区域。报告候选版本与已采纳版本做正文和来源变化比较；采纳是明确用户动作。验收源文件 hash、页号、原文选区、版本与导出产物一一对应。

### Gaps

- 本轮仅建立源码对照，不新增 UI、不写兼容层、不为上述建议提前抽象统一 renderer 接口，也不添加数据库/工作流引擎。
- 下一轮应先用一份含双栏、公式、表格、图片和重复引文的真实论文，验证选择定位和导出，再决定 PDF extraction 或 OCR 的额外依赖；不能以任一开源项目的自动 paper generation 声明代替科学验收。
