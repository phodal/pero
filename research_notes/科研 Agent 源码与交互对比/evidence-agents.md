# 证据检索与 Agent 交互源码对比

## 克隆了哪些实现，能证明什么

### Takeaway
本组已实际 shallow clone 四个官方公开仓库。PaperQA2 与 OpenScholar 核心更适合研究算法；ScholarQA 和 OpenScholar 的单独 demo 才提供可直接查阅的报告交互源码。下述判断来自固定提交的源码阅读，没有安装上游依赖、调用模型或启动这些 UI。

### Cited Findings

| 仓库 | 本地目录（根目录 `/Users/phodal/test/paper-agent-research/`） | 固定提交及提交时间 | 许可与来源 |
| --- | --- | --- | --- |
| Future-House/paper-qa | `paper-qa` | `c692d0dfeac4a0296599f7fe21a253a58b7ac12a`，2026-10-25T18:56:13-07:00 | [官方源码](https://github.com/Future-House/paper-qa/tree/c692d0dfeac4a0296599f7fe21a253a58b7ac12a)，[Apache-2.0](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/LICENSE) |
| AkariAsai/OpenScholar | `OpenScholar` | `0e9b8fb912273d3dae39e593da86e4f6d3bf8de1`，2025-08-12T21:16:46-07:00 | [官方源码](https://github.com/AkariAsai/OpenScholar/tree/0e9b8fb912273d3dae39e593da86e4f6d3bf8de1)，[Apache-2.0](https://github.com/AkariAsai/OpenScholar/blob/0e9b8fb912273d3dae39e593da86e4f6d3bf8de1/LICENSE) |
| allenai/ai2-scholarqa-lib | `ai2-scholarqa-lib` | `19e6827ba9e7fe05068624d0851f38cd74ff5efc`，2026-10-26T16:26:45-07:00 | [官方源码](https://github.com/allenai/ai2-scholarqa-lib/tree/19e6827ba9e7fe05068624d0851f38cd74ff5efc)，[Apache-2.0](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/LICENSE)；[Ai2 官方发布页直接链接此库](https://allenai.org/blog/ai2-scholarqa) |
| allenai/open-scholar-demo | `open-scholar-demo` | `565cfbb4e77fa520196631cc710147de2b9a4ca1`，2026-04-06T16:03:30-07:00 | [源码](https://github.com/allenai/open-scholar-demo/tree/565cfbb4e77fa520196631cc710147de2b9a4ca1)，[Apache-2.0](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/LICENSE)；[OpenScholar 官方 README 的 Public demo code 链接](https://github.com/AkariAsai/OpenScholar/blob/0e9b8fb912273d3dae39e593da86e4f6d3bf8de1/README.md#L6) |

- 克隆记录来自各目录的 `git remote get-url origin` 和 `git log -1 --format=%H %cI %s`。表中时间是提交时间，研究日期为 2026-10-29；不把旧提交日期写成当前产品的发布日期。上述固定提交链接可以复核本次观察对象。[PaperQA2 commit](https://github.com/Future-House/paper-qa/commit/c692d0dfeac4a0296599f7fe21a253a58b7ac12a)、[OpenScholar commit](https://github.com/AkariAsai/OpenScholar/commit/0e9b8fb912273d3dae39e593da86e4f6d3bf8de1)、[ScholarQA commit](https://github.com/allenai/ai2-scholarqa-lib/commit/19e6827ba9e7fe05068624d0851f38cd74ff5efc)、[demo commit](https://github.com/allenai/open-scholar-demo/commit/565cfbb4e77fa520196631cc710147de2b9a4ca1)。
- ScholarQA 官方文章描述表格、可展开分节、引文摘录，但这篇 2025 年介绍不能证明目前 Asta 的全部产品能力；本次主要用上述公开库查实现。[Ai2 官方介绍](https://allenai.org/blog/ai2-scholarqa)。

### Inferences
- 研究这些项目时应该同时固定“算法仓库”和“演示前端仓库”，否则容易把论文流程图误当成可以复用的工作台实现。
- Apache-2.0 不是直接复制整个产品的工程理由；本次只克隆研究，不把代码、依赖、数据写入 Pero App。

### Gaps
- 未做这些上游系统的运行验收、视觉可用性评测、外部模型成本测试，也没有证明其 SaaS 与此固定公开提交相同。
- 本组没有研究 Asta 全部生态仓库；这里只明确覆盖 ScholarQA 开放实现，不把它当作整个 Asta 的源码。

## Agent 如何在证据、检索与修订之间协作

### Takeaway
最有价值的共性是把“搜索、证据、回答、修订”作为显式操作，而不是让用户只能观察一段聊天文本。三个项目的运行策略不同，不能统一描述成持久自治科研 Agent。

### Cited Findings

**PaperQA2：工具循环、证据状态、失败与不确定分离。**

- `EnvironmentState` 明确包含 `Docs`、`PQASession` 与工具历史；`GatherEvidence` 用具体子问题收集相关上下文，按 relevance score 取前 N 条反馈给 Agent；`GenerateAnswer` 根据当前证据形成回答并返回状态。存在 initialized/completed callbacks，可作为语义进度接点，而不是解析模型自然语言猜阶段。[状态与历史](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/tools.py#L47-L92)、[证据工具](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/tools.py#L217-L311)、[回答工具](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/tools.py#L314-L372)。
- `Doc.content_hash`、`Text.doc`、`Context.text/question/score` 把文档、片段、面向问题的摘要分开；相关性分值属于检索排序，不能理解成科学结论置信概率。[Doc](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/types.py#L75-L86)、[Text](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/types.py#L155-L174)、[Context](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/types.py#L238-L277)。
- 预算边界要准确表述：`timeout` 默认 500 秒，`max_timesteps` 默认 `None`，调用方可设置步数；aviary runner 在循环顶部检查步数。更重要的是，超时或截断后 `_run_with_timeout_failure` 还会调用一次 `gen_answer`，该调用位于 `asyncio.timeout` 的外面。因此这不是“包含所有检索和最终生成的严格总时间/总费用上限”。所查 runner/settings 也只看到成本记账，没有可直接等同于强制美元预算的字段。[默认值](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/settings.py#L651-L672)、[步数循环](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/main.py#L278-L327)、[超时后生成](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/main.py#L155-L183)、[费用显示](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/env.py#L149-L157)。
- `AgentStatus` 区分 fail、success、truncated、unsure；success 是回答已生成，unsure 表示答案存在但生成器未成功确认。它不宣称论文复现或科学验收完成。[状态定义](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/models.py#L30-L39)。
- 本次克隆的该仓以 Python 库、CLI 和 notebook/docs 为主要入口，没有发现独立应用前端 package.json；适合学习证据与工具循环，不把它列成现成的可视化工作台。这个“未发现”是本次文件树检索范围内的结论，不是对所有外部集成的断言。[固定仓库树](https://github.com/Future-House/paper-qa/tree/c692d0dfeac4a0296599f7fe21a253a58b7ac12a)。

**OpenScholar：有界批处理式自反馈与补检索。**

- `run()` 先可选 rerank、生成 initial_result，启用 `use_feedback` 后最多遍历前三条反馈；无新问题时直接编辑，带问题且 `ss_retriever=True` 时生成关键词并搜 Semantic Scholar，去重、重排新增论文，再修订输出，并保存 `edited_answer_N`。[主流程](https://github.com/AkariAsai/OpenScholar/blob/0e9b8fb912273d3dae39e593da86e4f6d3bf8de1/src/open_scholar.py#L606-L700)。
- 新稿被接纳的一项启发式是字数比例大于原答案的 0.9；这只能防止答案异常缩短，不是结论正确性或证据支持的验证规则。源码中还保留一处与实际 retrieval 分支不完全一致的旧注释，因此以分支代码为准。[编辑与采纳分支](https://github.com/AkariAsai/OpenScholar/blob/0e9b8fb912273d3dae39e593da86e4f6d3bf8de1/src/open_scholar.py#L644-L700)。
- 主算法仓主要是 Python 推理/训练/检索代码；界面另在官方链接的 `allenai/open-scholar-demo`，不能只看主仓 README 就评价交互实现。[官方 README](https://github.com/AkariAsai/OpenScholar/blob/0e9b8fb912273d3dae39e593da86e4f6d3bf8de1/README.md#L6)、[主仓树](https://github.com/AkariAsai/OpenScholar/tree/0e9b8fb912273d3dae39e593da86e4f6d3bf8de1)。

**ScholarQA：阶段明确的检索与报告管线。**

- `run_qa_pipeline()` 的实际编排是问题拆解 → snippet+keyword 检索 → cross encoder 重排与聚合 → generate_report。后者再做逐论文 quotes → outline/cluster → 引文映射 → 按节生成 → 比较表；每节会写回当前部分结果。[入口](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/scholar_qa.py#L638-L726)、[报告生成](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/scholar_qa.py#L541-L625)。
- `CitationSrc` 带 paper、snippets、snippet_metadata；`GeneratedSection` 有 title、tldr、text、citations、table。`TableCell` 有原值/显示值、loading、error、metadata、用户覆盖值和编辑者，说明比较表的交互状态是显式对象，不只是 Markdown 文本。[报告类型](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/models.py#L56-L105)、[表格类型](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/table_generation/table_model.py#L5-L75)。
- `passage_to_quotes_metadata()` 先做大小写忽略的 substring 匹配，然后只有字母的规范化匹配，再尝试 0.75 word overlap；会写 section_title、pdf_hash、start/end、sentence_offsets/ref_mentions。这是“尽力找回位置”的处理，不应把 approximate match 直接展示成经过逐字验证的精确引文；代码也可能留空 pdf_hash。[引文定位](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/scholar_qa.py#L230-L341)。
- `EventTrace` 保存 decomposition、retrieved/candidates、quotes、cluster plan、summary、模型/费用/token，再写本地或 GCS。这是执行过程的结构化记录；所查 `persist_trace()` 不构成调度恢复协议。[事件记录](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/trace/event_traces.py#L10-L120)。
- edit 子系统已定义 `KEEP/REWRITE/DELETE/NEW` 和 edit-aware cluster plan，`EditPipelineRunner` 可取原报告、分析编辑意图并条件检索；但默认 `create_app()` 只暴露 `query_corpusqa`，默认装配类是 ScholarQA。本次没有验证 edit 入口完整运行，不把这些类直接写成“当前 demo 已端到端支持自然语言编辑”。[动作类型](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/rag/edit_pipeline.py#L42-L65)、[edit runner](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/edit_pipeline_runner.py#L25-L65)、[默认应用装配](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/app.py#L50-L65)、[默认路由](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/app.py#L114-L151)。

### Inferences
- Pero 的证据问答可以先用固定阶段，不必一开始做任意工具 DAG：明确 search/evidence/outline/section 的数据产物，再在其中一个步骤引入有界自主补检索。
- 自反馈应产生“问题缺口 + 新检索请求 + 候选修订 + 改动原因”，不是仅把思考文本放进聊天栏。OpenScholar 的 edited_answer_N 与 demo 的前后稿比较可以启发候选版本 UI；不应照搬字数比作为验收。
- 相关性分数、引文匹配、方法运行成功、论文指标复现、科学结论采纳是五件事，界面要分别表达。

### Gaps
- 没有跨模型、跨语种引文定位准确率数据；尤其 ScholarQA 的 alphabet-only fallback 不应推断适合中文原文。
- 没有证明逐字匹配等于原论断成立，也没有验证 OpenScholar 自反馈对当前问题的实际收益。

## Pero 应借鉴什么，执行与恢复边界留在哪里

### Takeaway
先扩展领域结果和语义进度，保留 Host 的执行权威。最值得落地的是证据定位、分节/矩阵结果、候选修订与稳定研究提交绑定，而不是把上游 Python 后台进程及状态管理器复制进 Pero。

### Cited Findings

**公开实现的恢复范围。**

- ScholarQA 的 `POST /query_corpusqa` 首次返回 task_id；再次带 task_id 时检查现有状态并返回部分结果/最终结果。启动时用 multiprocessing fork 创建进程，状态交给本地目录中的 StateManager；`update_task_state()` 把当前章节和步骤写回。该设计让前端刷新后有查询标识，但不能仅据这些代码宣称服务重启后会从未完成步骤自动续跑。[API](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/app.py#L125-L193)、[状态查询](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/app.py#L198-L270)、[本地存储及部分结果](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/state_mgmt/local_state_mgr.py#L23-L57)。
- `TIMEOUT=240` 在 task check-in 发现超时后标记失败；所查超时分支没有持有/终止后台子进程的 handle。因此 UI 状态变成 failed 与实际计算停止不能直接画等号。[TIMEOUT 与 fork](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/app.py#L34-L36)、[进程启动](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/app.py#L171-L193)、[超时状态处理](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/api/scholarqa/app.py#L262-L270)。

**本次检查的 Pero 状态。**

- Pero 当前职责是 Python 保存论文快照/校验报告，Host 管理 ACP、凭据、授权与取消，SDK 接窄 Host Agent 端口。产品文档明确不在领域 App 自建通用执行环。[App README](/Users/phodal/workspaces/pero/apps/paper-agent/README.md:30)、[ADR0007](/Users/phodal/workspaces/pero/docs/adr/0007-local-app-platform.md:84)。
- `EvidenceReference.locate()` 对冻结文本做严格 contiguous 查找，返回 start/end、前后文、heading；`ResearchReport` 保存章节和实验，acceptance 固定 unverified。应保留这个强于模糊匹配的契约，再补 PDF 页/区域锚点时另行区分定位来源。[精确引文](/Users/phodal/workspaces/pero/apps/paper-agent/backend/paper_agent/reports.py:9)、[报告](/Users/phodal/workspaces/pero/apps/paper-agent/backend/paper_agent/reports.py:119)。
- 当前 `useResearch` 用 React state 保存 sessionId/intent/status，运行时每秒轮询，完成后由 UI 触发 reports 保存；打开既有 intent 会清空 sessionId。冻结输入已持久化，但执行提交关联/未保存结果的重启恢复还未由这个 UI 实现。[UI 控制逻辑](/Users/phodal/workspaces/pero/apps/paper-agent/ui-src/use-research.ts:6)。
- `ResearchInput` 固定论文和问题，最终 prompt 仍按当前函数生成；`AppSessionBinding` 绑定 app/request/agent/prompt，没有 workspace 字段。要做可靠候选修订或结果对比前，应先冻结方法版本/实际指令和执行目标，并通过既有 Host 身份关联研究提交。[ResearchInput](/Users/phodal/workspaces/pero/apps/paper-agent/backend/paper_agent/model.py:149)、[Host binding](/Users/phodal/workspaces/pero/crates/pero-runtime/src/apps/agent.rs:28)。
- App 事件当前是 running/text/needs_input/completed/cancelled/failed，没有 search/evidence/outline/section 这样的领域进度；现有 ReportView/Reader 把正文作为 p 文本渲染，点击来源能打开证据侧栏，这不是 Markdown/公式/矩阵渲染器。[事件](/Users/phodal/workspaces/pero/crates/pero-runtime/src/apps/agent.rs:77)、[领域界面](/Users/phodal/workspaces/pero/apps/paper-agent/ui-src/documents.tsx:6)。

**可直接交给报告作者的 UI 源码证据（视觉代理也已接到位置）。**

- OpenScholar demo 的报告用 markdown-to-jsx，并把 Paper 标记 override 为有证据的 inline paper chip；每个引文从显式 citations 数据映射 snippets，不靠从最终文字重新猜来源。[报告渲染](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/report/Report.tsx#L39-L132)。
- demo 有 previousSection + react-diff-viewer，用户可打开 Compare with draft；比较前会去掉部分引用编号和按句拆分，所以它是阅读辅助而非可校验的原始产物 diff。[比较实现](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/report/Report.tsx#L17-L35)、[比较按钮](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/report/Report.tsx#L144-L157)。
- 引文点击弹出 EvidenceCard Popover，包含论文元数据、证据摘录和 Semantic Scholar 外链；所读该组件本身不是 PDF 页内定位器。[EvidenceCard](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/widgets/EvidenceCard.tsx#L28-L94)、[摘录内容](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/widgets/EvidenceCardContent.tsx#L28-L36)。

### Inferences

建议按以下顺序交付，每项先命名领域概念，再在已有壳中接线；这些是本次建议，不是现有 Pero 功能。

1. **ResearchSubmission（研究提交）**：持久保存 frozen input → Host session/turn → 执行目标/方法快照 → 结果引用。Host 继续拥有执行状态，Python 只保存领域关联和不可变产物；重启后能查询既有执行并归档结果。避免 UI 成为唯一提交所有者。
2. **EvidenceAnchor（证据锚点）**：保留精确引文+内容摘要+文本位置；后续可选 PDF 页/bounding boxes，但显示 anchor_kind/match_kind。模糊匹配只能“待核对”，不能悄悄升格为精确引文。来源原始文件哈希与解析文本哈希分开。
3. **ResearchProgress（研究进度观察）**：只记录真实已发生的 search/evidence/outline/section 等领域事件以及计数/产物引用；运行/取消/审批仍投影 Host 状态，不再定义一套领域执行状态机。没有真实工具/Worker回调时，不从模型文字伪造阶段。
4. **EvidenceMatrix + ReportRevision（证据矩阵与报告修订）**：矩阵按 paper×field 展示，每格有 source anchors、missing/conflict、原生成值/用户覆盖值。候选修订显示 base revision、增加证据、修改段落及原因，采纳后产生新版本，保留人工修改。先做一个明确比较任务，不建设通用 BI 系统。
5. **有界补检索**：复用 Host 现有工具/执行路径；领域步骤声明查询次数/证据数量/上下文限制，取消和执行授权仍由 Host 管。要承诺强制总时间/费用预算，必须覆盖最终生成和外部并发调用；PaperQA2 的 fallback 行为不能直接充当这个保证。

不要现在照搬：ScholarQA 的 fork+本地状态管理器、PaperQA2 的整套 Agent harness、上游向量数据库/全量文献索引，也不要为了这些对比在 Python App 内重建 Task/Run/Step/Attempt 调度框架。是否上持久工作流由现有控制面/Host 的实际接线需求决定。

### Gaps
- 本次是源码评审，不是实现；没有修复上述 Pero 关联/冻结/渲染缺口。
- Pero 的 App Use 和共享 Chat 有并行变更；本组只把稳定的 Paper App/Host 源文件作为观察点。2026-10-29 读取时 repo HEAD 为 `393bea7972bc765d2f831636bb460320378fac80`，所引用 `apps/paper-agent` 与 `crates/pero-runtime/src/apps/agent.rs` 没有未提交修改；其他工作区改动未动。
