# Research Agent 源码研究与 Pero 接入建议

研究日期：2026-10-30。实施前的 Pero 对照提交为 `1350cf7f4f5e3a96643649ae3a2fa32e4b1bb945`，工作区有其他任务的并行修改。前五节保留当时的源码对照、诊断与方案，未运行上游系统或作九个项目的统一任务集横向评测。随后用户授权的本地实现见第六节，以及 [设计与范围](../docs/design-docs/paper-research-agent.md) 和 [验收记录](../docs/fitness/paper-research-agent.md)。

九个参考项目已实际克隆到 `/private/tmp/pero-research-sources-20261030` 并固定下表提交；完整 origin、克隆时间和许可观察保存在 [来源清单](../research_notes/Research%20Agent%20源码研究/manifest.json)。未将上游运行时或源码复制进 Pero 产品。

**建议先把现有 ACP Agent 接成持续研究模式：一个研究会话、可按需回读的原文工具、持久化的论断与证据缺口。**优先借鉴 Feynman 的任务契约、PaperQA 的工具循环、NVIDIA 的结构化研究交付物和 FS-Researcher 的原文工作区。DeerFlow 与 Deep Agents 的运行机制适合作为对照，当前无需替换 Pero 的 Host 或增加第二套调度器。

## 一 研究对象与固定版本

源码链接固定到实际读取的提交；提交日期、发行日期和论文发表日期分别处理。DeerFlow 本轮选定 v2.1.0，其余记录当前读取的分支快照。许可为对应仓库主许可证观察，不自动覆盖所有依赖和数据。

| 对象 | 固定源码 | 许可观察 |
| --- | --- | --- |
| Feynman v0.5.60 | [072ded6](https://github.com/Companion-Inc/feynman/tree/072ded66bbea8cc5ad9cfddd2c2283b670b8094d)，2026-10-29 | MIT |
| PaperQA | [c692d0d](https://github.com/Future-House/paper-qa/tree/c692d0dfeac4a0296599f7fe21a253a58b7ac12a)，2026-10-25 | Apache-2.0 |
| NVIDIA Deep Researcher Agent | [951a1a1](https://github.com/NVIDIA-AI-Blueprints/deep-researcher-agent/tree/951a1a1114e9818073ddbe2a5fdbfa824751f4d3)，develop，2026-10-10 | Apache-2.0 |
| GPT Researcher | [3582a68](https://github.com/assafelovic/gpt-researcher/tree/3582a6841fe7dc801e2a34e34ee408641aea9bce)，2026-10-10 | Apache-2.0 |
| DeerFlow v2.1.0 | [345f08b](https://github.com/bytedance/deer-flow/tree/345f08be00c8a9495079b732a39b46aa9af1584e)，[9 月 24 日发行](https://github.com/bytedance/deer-flow/releases/tag/v2.1.0) | MIT |
| Deep Agents 0.7.32 | [64de801](https://github.com/langchain-ai/deepagents/tree/64de801918612668a591c486c65407baf0f96f02)，2026-10-30 | MIT |
| autoresearch | [228791f](https://github.com/karpathy/autoresearch/tree/228791fb499afffb54b46200aca536f79142f117)，2026-03-26 | MIT |
| EvoScientist | [0e87c5b](https://github.com/EvoScientist/EvoScientist/tree/0e87c5bdffdac1e6ced1e9a0a4fd556b8b2d3299)，2026-10-28 | Apache-2.0 |
| FS-Researcher | [a9f0483](https://github.com/Ignoramus0817/FS-Researcher/tree/a9f04834708d96ff3cec9cbbe076f0c77ce6d11e)，2026-04-21 | 本轮未确认明确许可证 |

覆盖重点是研究循环、来源回读、证据交付与恢复语义。Biomni、Robin、STORM、Tongyi、Agent Laboratory 等不在本轮逐仓源码核查范围，不据此延伸选型排名。

## 二 对照实现中真正值得借鉴的机制

### Feynman 用任务契约组织研究与核查

【源码观察】`prompts/deepresearch.md` 要求保存计划、任务台账、验证日志和决策日志；简单问题直接搜索，宽任务再拆分；研究后经过 verifier、reviewer，再交付报告与 provenance。这是随产品提供的 Markdown 工作契约，执行质量依赖 Agent 和工具，不能把提示词里的要求当作程序已经强制执行的完成门禁。[计划与规模选择](https://github.com/Companion-Inc/feynman/blob/072ded66bbea8cc5ad9cfddd2c2283b670b8094d/prompts/deepresearch.md#L9-L59)、[核查与交付](https://github.com/Companion-Inc/feynman/blob/072ded66bbea8cc5ad9cfddd2c2283b670b8094d/prompts/deepresearch.md#L106-L179)。

【源码观察】verifier 角色要求检查具体数字、引语、结论与论文身份。但 10 月 26 日发布说明所说的 `source_check` 匹配片段来自依赖 `pi-web-access`。固定依赖源码有片段时仍返回 `unclear`，没有片段返回 `missing-evidence`，并不自动判断语义支持。当前 verifier 的显式工具列表也没有 `source_check`，不能推断默认工作流已用它完成核验。[verifier](https://github.com/Companion-Inc/feynman/blob/072ded66bbea8cc5ad9cfddd2c2283b670b8094d/.feynman/agents/verifier.md#L10-L70)、[更新记录](https://github.com/Companion-Inc/feynman/blob/072ded66bbea8cc5ad9cfddd2c2283b670b8094d/RELEASES.md#L29-L39)、[相关片段与 unclear](https://github.com/nicobailon/pi-web-access/blob/4af1a7f7757d450ba0afefe2d98737384dc9a9b4/source-check.ts#L120-L196)。

【Pero 建议】学习研究台账与职责边界；保留“不足以判断”的状态。采用其设计不要求运行 Pi 或复制整个 Feynman。

### PaperQA 把补证据与重新回答放进工具循环

【源码观察】默认工具是 `paper_search`、`gather_evidence`、`gen_answer`、`reset`、`complete`。Agent 可以重复找证据、重生成答案并显式报告不确定，默认超时为 500 秒，截断后会尽力生成答案并保留 `TRUNCATED`。循环存在于代码中，证据充分性仍非确定性保证。[默认工具](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/tools.py#L702-L713)、[Agent 循环](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/main.py#L298-L328)、[截断处理](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/main.py#L156-L183)。

【源码观察】默认 `paper_search` 读取本地目录建立的 Tantivy 索引，不等同于全网论文发现；默认工具没有 PDF 按页或按章节原文读取。证据处理用 embedding/MMR 和针对问题的摘要与重排，`Context` 关联原始 `Text`，避免只留下摘要。[本地索引检索](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/agents/tools.py#L119-L203)、[证据处理](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/docs.py#L454-L585)、[Context 与 Text](https://github.com/Future-House/paper-qa/blob/c692d0dfeac4a0296599f7fe21a253a58b7ac12a/src/paperqa/types.py#L238-L278)。

【Pero 建议】借鉴可继续取证的循环和摘要与原文分离。直接引入 PaperQA 仍需另补原文读取能力，也应避免在现有研究 Agent 下面再嵌套一整套规划循环。

### NVIDIA 的结构化研究交付最接近当前缺口

【源码观察】计划用 `required_components` 表达必须回答的项，查询指明 `target_components`；研究笔记保存 `claim / evidence / source_ids / confidence / caveats`，缺口单独保存描述、影响和建议查询。并行研究结果写入共享工作区再交给 writer。编排仍有规划、研究、写作顺序和预算约束。[研究交付契约](https://github.com/NVIDIA-AI-Blueprints/deep-researcher-agent/blob/951a1a1114e9818073ddbe2a5fdbfa824751f4d3/src/deep_researcher_agent/agents/deep_researcher/models/subagent_contracts.py#L154-L230)、[并行与保存](https://github.com/NVIDIA-AI-Blueprints/deep-researcher-agent/blob/951a1a1114e9818073ddbe2a5fdbfa824751f4d3/src/deep_researcher_agent/agents/deep_researcher/tools/research.py#L214-L329)。

【源码观察】citation verification 检查工具采集的来源 registry 中是否存在对应身份、URL 和引用键；这不证明原文蕴含论断。报告轻改写保留父版本、不重新搜索；增量研究另开子任务补资料。API 有提交、查询、取消、SSE 游标重连和产物读取；客户端重连后台任务不能直接解释为任意 worker 崩溃后的自动续跑。[引用校验范围](https://github.com/NVIDIA-AI-Blueprints/deep-researcher-agent/blob/951a1a1114e9818073ddbe2a5fdbfa824751f4d3/src/deep_researcher_agent/common/citation_verification.py#L16-L34)、[API](https://github.com/NVIDIA-AI-Blueprints/deep-researcher-agent/blob/951a1a1114e9818073ddbe2a5fdbfa824751f4d3/docs/source/integration/rest-api.md#L20-L42)、[轻改写](https://github.com/NVIDIA-AI-Blueprints/deep-researcher-agent/blob/951a1a1114e9818073ddbe2a5fdbfa824751f4d3/src/deep_researcher_agent/agents/report_rewriter/agent.py#L99-L125)。

【官方工程实践】2026-05-20 的文章确实展示主 Harness 通过 Skill 委派专业研究服务。对 Pero，这是后续远程 Worker 的一种接法，不要求首版把整个服务栈引进本机。[官方文章](https://developer.nvidia.com/blog/add-a-specialized-deep-research-skill-to-agent-harnesses/)。

### GPT Researcher 适合作为独立报告服务对照

【源码观察】主研究实现按 depth/breadth 递归拆分、并行研究并收集 learnings、citations 和 follow-up questions。独立的 `deep_agents/` 示例把 GPT Researcher 包装为工具，返回 Markdown 报告和来源列表。把这一报告工具直接嵌进另一个 Research Agent，会增加规划与汇总层次，并不会自然保留逐论断证据结构。[主循环](https://github.com/assafelovic/gpt-researcher/blob/3582a6841fe7dc801e2a34e34ee408641aea9bce/gpt_researcher/skills/deep_research.py#L386-L585)、[报告工具返回值](https://github.com/assafelovic/gpt-researcher/blob/3582a6841fe7dc801e2a34e34ee408641aea9bce/deep_agents/tools.py#L26-L76)。

【Pero 建议】若后续需要快速调用外部报告服务，可按一个专业 Worker 接入；当前先解决本地证据闭环，不把完整研究服务当普通检索工具叠加。

### FS-Researcher 把原文与写作上下文分开

【源码观察】当前推荐入口是 Skill：先归档原始网页与结构化笔记，再逐节写作；笔记、计划和轮次日志都可回读。Python 最小实现也提供分页网页和文件读取，默认归档原文。恢复主要依赖重新检查工作区文件，不等同于保存并恢复任意执行中的工具调用。[工作区与阶段契约](https://github.com/Ignoramus0817/FS-Researcher/blob/a9f04834708d96ff3cec9cbbe076f0c77ce6d11e/skill/SKILL.md)、[分页读取和循环实现](https://github.com/Ignoramus0817/FS-Researcher/blob/a9f04834708d96ff3cec9cbbe076f0c77ce6d11e/agent.py)。

【Pero 建议】采用“先保存原始材料，再登记证据，再写作”的顺序。其典型主题至少 20 个来源等提示词门槛不适合直接用于单篇论文问答；源数量不能替代问题覆盖。

### DeerFlow 与 Deep Agents 的恢复能力需要明确条件

【源码观察】DeerFlow v2.1 的工具回执、父级核查和 SQL 批任务确实存在。receipt verification 是 advisory，不是接受门禁；文件与已记录测试命令可做确定性检查。租约过期后批任务可能重试，执行提示明确要求保持副作用幂等，不能称为从崩溃前工具位置无缝继续。[回执校验边界](https://github.com/bytedance/deer-flow/blob/345f08be00c8a9495079b732a39b46aa9af1584e/backend/packages/harness/deerflow/agents/middlewares/receipt_verification.py#L1-L17)、[接受检查](https://github.com/bytedance/deer-flow/blob/345f08be00c8a9495079b732a39b46aa9af1584e/backend/packages/harness/deerflow/subagents/acceptance_checks.py#L1-L53)、[重试提示](https://github.com/bytedance/deer-flow/blob/345f08be00c8a9495079b732a39b46aa9af1584e/backend/packages/harness/deerflow/subagents/batch_service.py#L226-L247)。

【源码观察】Deep Agents 默认 `StateBackend`，checkpointer 与 store 是可选接入项；跨重启和跨线程持久化要配置。长工具结果与旧消息可落盘供回读，但旧消息 offload 失败仍允许继续摘要，不能直接把这一降级当科研证据的持久化保证。v0.7.0 的 65% 指系统提示和工具描述对应的基础输入 token，不是所有任务总成本。[默认后端与可选持久化](https://github.com/langchain-ai/deepagents/blob/64de801918612668a591c486c65407baf0f96f02/libs/deepagents/deepagents/graph.py#L590-L671)、[offload 失败行为](https://github.com/langchain-ai/deepagents/blob/64de801918612668a591c486c65407baf0f96f02/libs/deepagents/deepagents/middleware/summarization.py#L1330-L1405)、[维护者的 65% 说明](https://github.com/langchain-ai/deepagents/issues/5071)。

【Pero 建议】当前先复用 Host 的执行和历史边界。研究资料保存成功后才登记为可回读来源；执行重试、上下文恢复与研究继续分别表达。

### autoresearch 与 EvoScientist 对应后续实验和经验积累

【源码观察】autoresearch 用 `program.md` 规定只修改 `train.py`、固定准备和评价、每轮训练五分钟，并记录 keep/discard/crash。它复用外部 coding agent，研究循环主要是指令契约；“不修改评价文件”本身不是不可绕过的执行隔离。其默认持续循环直到人工停止，也不适合直接作为 Pero 所有任务的停止策略。[实验指令](https://github.com/karpathy/autoresearch/blob/228791fb499afffb54b46200aca536f79142f117/program.md)。

【论文与源码分别观察】EvoScientist v2 论文确实区分 ideation memory 和 experimentation memory；当前工程代码则用 semantic/procedural/episodic observation、project/global scope，以及 complements/contradicts/supersedes 关系，不能把论文两模块原样描述成当前存储类型。后台记忆 worker 有最多三条 observation 和二十次模型调用的限制。研究子 Agent 自身也有最多五次搜索的约束，并非无限探索。[论文 v2](https://arxiv.org/abs/2603.08127v2)、[当前记忆类型](https://github.com/EvoScientist/EvoScientist/blob/0e87c5bdffdac1e6ced1e9a0a4fd556b8b2d3299/EvoScientist/memory/types.py)、[有界记忆提取](https://github.com/EvoScientist/EvoScientist/blob/0e87c5bdffdac1e6ced1e9a0a4fd556b8b2d3299/EvoScientist/memory/agents/memory_worker.py)、[研究角色](https://github.com/EvoScientist/EvoScientist/blob/0e87c5bdffdac1e6ced1e9a0a4fd556b8b2d3299/EvoScientist/subagents/research.yaml)。

【Pero 建议】先让本项目内的失败方向和有效方法有来源、有条件、可撤销，再考虑跨项目自动沉淀。实验执行成功、指标改善与科学结论成立分别记录。

## 三 Pero 已有基础与真实缺口

实施前的真实 Meta-Harness 测试中，第一题约 177 秒、追问约 193 秒；各经四次串行会话。第一题最终十二段证据遗漏正式方法所在第 4–5 页，却包含多个附录片段。回答正确说明检索不完整，已检查数字和引文匹配，但无法进一步打开缺失章节。当时重启后重新打开面板的测试失败，不能将该次基线记录为整套通过。[原始问题与证据](../docs/issues/2026-10-30-paper-research-evidence-coverage.md)。

现有两轮检索上限并不是错误的概念。其他系统也设搜索次数、深度或总时间上限。真正需要改进的是：预算用于补齐什么、缺口出现后能调用什么工具，以及达到上限时是否准确交付未完成项。让循环更自由也不保证更快，四次调用的实测耗时不能证明新方案一定降低延迟。

| 当前拥有者 | 已有能力 | 需要补齐的研究能力 |
| --- | --- | --- |
| Python Paper 领域 | `PaperSnapshot`、`PdfPassage`、`ResearchInput`、精确引文与报告矩阵 | 持久研究问题、逐项发现与缺口；明确的原文页/节读取契约 |
| Rust Host 与已有 ACP Harness | 会话、授权、取消、历史、工具连接 | 把领域工具绑定到研究会话，继续调用已有循环 |
| Desktop App Use 与 SDK | MCP 接入、来源 App 范围、读 UI 状态与有限操作 | 挂接可稳定读取领域数据的工具，不靠 DOM 操作执行完整研究 |
| Go 控制面与 Worker | 分布式 Task/Run、执行绑定与租约 | 研究确需远程运行时引用现有 Task/Run，不另建研究队列 |

以上拥有者依据 [共享 Chat ADR](../docs/adr/0012-shared-gpui-app-chat.md)、[App Use ADR](../docs/adr/0014-app-use.md) 和当前 [App 会话绑定](../crates/pero-runtime/src/apps/agent.rs)。当前 App Agent API 只有 Start/Events/Cancel，不能只改提示词便声称已经实现同一研究会话内持续取证。

## 四 建议的首版范围

### 一个研究角色与一个领域对象

【方案】新增具名领域概念 `ResearchStudy`：拥有问题范围、必须回答的项、当前 findings/gaps 与报告版本引用。Python 领域用不可变类型和纯函数统一维护它；Host 仍拥有执行状态。研究进行中、等待用户、失败等运行状态引用 Host，不在领域后端再建一份任务执行状态机。

复用 `PaperSnapshot` 和 `PdfPassage` 表达来源，保留 `ResearchInput` 作为每次报告生成的冻结证据输入。逐论断记录引用既有来源与页内位置，不创建另一份 Source/PDF 数据副本。后续实验引用已有 Run 与产物，不把 Agent 自报状态升级为真实执行回执。

### 研究工具先覆盖从缺口回到原文的路径

以下是待实现的能力契约，不是已存在的工具名称，也不预设把所有工具塞进一个接口。

| 能力 | 关键输入与结果 |
| --- | --- |
| 找来源 | 区分本地库与外部发现；返回稳定来源身份和可获取内容的范围 |
| 搜原文 | 返回带 source/page/offset 的命中，保留候选与最终选中记录 |
| 读页或章节 | 明确读取范围与续读位置；不要求再次命中关键词才能读取相邻页 |
| 查看表格或图 | 返回对应原始页面或裁剪与身份；文本提取不清楚时可看原图 |
| 登记发现与缺口 | 论断、条件、支持/反驳片段、未解决项及影响；后端校验真实引用 |
| 提交报告版本 | 固定实际使用的证据；保留父版本与未决问题，返回校验问题供继续修正 |

研究角色在同一绑定会话内选择工具、检查缺口、补读与更新判断。主流程保持一个 Agent；仅当独立研究方向或审阅任务确有收益时再委派。审阅 Agent 的判断带模型来源，不能命名为独立科学验证。

### 分开三种验证

1. 来源与定位：来源身份、文件摘要、页码和逐字引文匹配，由领域代码验证。
2. 论断支持：原文是否支持结论、数字和适用条件，由有记录的审阅给出支持、反驳或证据不足；模型审阅仍可出错。
3. 科学与实验接受：预设对照、数据、指标、容差和必要独立复核，属于相应研究验收。

汇总层需要保持论断与证据的关联。论文对 AI-Q 特定配置观察到 84.7% 的最终报告错误源自协调者；这支持检查汇总过程，不是所有系统的通用错误率。[Who is the Agent to Blame](https://arxiv.org/abs/2608.24306)。报告更新还要比较旧有论断与引用是否被无意删改；Mr Dre 在五种被测系统中观察到 16–27% 的既有内容与引用质量回退，不能推成 Pero 的测量结果。[Mr Dre](https://arxiv.org/abs/2601.13217)。

### 预算与停止依据

时间、工具调用及可用的 token/cost 读数由现有执行路径约束，Agent 可在预算内选择读页、补检索或结束。因预算结束时交付已经完成的项、尚缺的证据与建议下一步，不自动标记研究完成。未报告的成本保持未知。简单问答不强制经过所有研究阶段，也不设与任务无关的来源数量下限。

## 五 下一轮该怎样验证

采用相同来源、模型设置和预算，对照当前流水线与新研究模式；不以换强模型掩盖接线差异，也不预先宣布多 Agent 更好。

| 场景 | 必须检查的行为 |
| --- | --- |
| 核心方法问题 | 能取到正式方法与算法；记录第 4–5 页何时进入候选、被读取并用于回答 |
| 消融与适用条件追问 | 数字对应原表、控制变量和任务边界；只引用真实读过的来源 |
| H100 费用等无依据问题 | 不估算、不把未检索到写成全文没有；明确查证范围 |
| 两篇论文的冲突结论 | 保存各自条件与反证，不在汇总时抹平冲突 |
| 修改既有报告 | 新增证据与受影响论断可追踪，范围外内容和原引用不退步 |
| 中断后继续 | 重新读到已保存的研究对象与原文；区分客户端重连、研究继续和工具重试 |

质量记录至少包括必答项覆盖、错误论断、原文定位、有效反证和报告修改回退；运行记录包括首个有用结果时间、总耗时、模型/工具调用及实际报告的消耗。现有三道问题只是小样本诊断，后续需固定更完整的材料和验收项，才能评价新模式收益。

首个可交付目标是：**对 Meta-Harness 核心方法问题，Agent 能发现缺口、主动读到正式算法、保存论断与原文位置、生成报告，并在后续问题中继续查证。**远程研究服务、自动实验和跨项目记忆可在这个闭环通过后分别扩展。

## 六 本轮已交付的研究闭环

2026-10-30 的后续实现保留现有 Host/ACP，全文问题只启动一个 Host 研究会话，由 Agent 通过既有 MCP `app_describe` / `app_write` 选择 `research-step` 操作。`ResearchStudy` 保存冻结 PDF 身份、实际观察的原文片段、发现、未决缺口与最终报告；没有引入上述参考项目的运行时依赖。领域持久化已提交为 `487a8a08`，App 所属研究会话的 Host 工具接入已提交为 `f451bcd8`。具体契约见 [实现设计](../docs/design-docs/paper-research-agent.md)。

已实现 `read`、`search`、`note`、`finalize`，保留既有逐字引文和报告校验；长页有明确续读位置。新增取证与笔记受 24 步预算约束，末步留给提交。研究停止后，显式继续沿用原 study，并冻结新的 Host 请求；`recall` 回读已经观察的原文，不重放读取、不消耗新取证预算。未决缺口随冻结证据进入报告与导出，精确定位不升级为论断支持或科学接受。

验证分别记录：26 项 Python 测试、7 项 App MCP 测试和真实 Electron 中的 7 组确定性旅程通过；后者包含读到第 4–5 页、引用高亮，以及未完成研究取消后重启、回读证据并继续提交。真实 Codex 的 Terra 三问与重启检查通过后，另行固定 `gpt-6.1-sol[high]` 的同模型实测也通过 6 组检查，包含三问与重启，正式方法第 4–5 页已实际读取并用于引用，未记录渲染错误。三问各启动一次 Host 会话，旧流程每题四次；但前两问耗时分别为 331.644 和 242.580 秒，旧基线约为 177 和 193 秒，本次没有速度改善。新流程读取更多证据、回答也更长，这个小样本只能确认取证与恢复链路，不能据此推断整体质量或成本收益。UI 与验收脚本分别提交为 `f6c2c222`、`11b6d0d0`；模型记录、原始答案和剩余边界统一见 [验收记录](../docs/fitness/paper-research-agent.md)。

当前范围是已保存、已选择的本地 PDF。外部网页与新论文发现、图像页输入、科学实验执行、远程 Research Worker 和跨项目记忆尚未由这个闭环交付；后续应按前文的研究任务与验收项分别扩展。

最终补充的 `e48beff` 修复了取消后异步读页记录把续研按钮推到视口之外的问题；7 组研究旅程要求整个按钮可见，并已通过。原有 Paper App 的 15 组界面回归也在最终构建上通过。
