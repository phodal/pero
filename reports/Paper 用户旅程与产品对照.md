# 把论文发现 接到素材收集 与引用写作

研究日期：2026-10-29。

**有直接先例，而且可以组合成清楚的 Pero 用户旅程：ResearchRabbit/Litmaps 负责从一篇继续发现，Zotero 负责把图文变成可追溯素材，ScholarQA/Elicit 负责证据比较与报告，OpenScholar/Overleaf 提供修订与引用写作的参考。
**这些产品覆盖的环节不同，不能据此声称某一个已实现整条研究链。
Pero 已有关键词搜索、冻结原文、科学内容渲染、只读证据矩阵、精确引用侧栏和报告导出。
下一步应连接阅读之后的动作，优先完成相关论文、素材收集、可编辑 Related Work 三个小流程。
下表区分静态源码与官方文档；本轮没有登录或运行这些产品，也没有修改 Pero 产品代码。

## 现有项目已覆盖阅读后的具体动作

| 用户想完成什么 | 项目与证据类型 | 已确认的具体能力 | Pero 可以借鉴的动作 |
| --- | --- | --- | --- |
| 从当前论文继续找 | ResearchRabbit · 官方文档 | 单篇论文提供 Similar / References / Cited By，支持 Notes、Save to collection，并保留探索 tab。[指南](https://www.researchrabbit.ai/articles/guide-to-using-researchrabbit) | Reader 直接进入相关研究、参考文献、后续引用，保留来路 |
| 用几篇论文逐步缩小范围 | Litmaps · 官方文档 | starting articles → Explore Related Articles；More Like This 保存候选，并加入下一轮推荐输入。[搜索流程](https://docs.litmaps.com/en/articles/9092911-search-for-articles-with-litmaps) | 收藏与推荐种子分开，由用户明确选择下一轮输入 |
| 保存图文并继续写笔记 | Zotero · 源码与官方文档 | 图片批注菜单有 Copy Image、Save Image As、Add to Note；笔记默认保留引用及返回原页入口。[菜单源码](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/common/context-menu.js#L350-L368)、[笔记流程](https://www.zotero.org/support/pdf_reader#adding_annotations_to_notes) | 保存摘录/图片素材，添加评论，再加入带来源的笔记 |
| 对眼前不懂的内容继续操作 | SciSpace · 官方产品描述 | 解释高亮文本、公式/图表，按高亮文本找相关论文并记笔记。[Chat PDF](https://scispace.com/chat-pdf) | 选段菜单提供解释、找相关研究、保存素材，携带当前来源 |
| 比较论文中的不同字段 | ScholarQA · 静态源码 | 结构化矩阵格通过 evidenceId 按需打开支持片段；所查视图不证明已有单元格编辑。[组件](https://github.com/allenai/ai2-scholarqa-lib/blob/19e6827ba9e7fe05068624d0851f38cd74ff5efc/ui/src/components/report/LitTable/CellWithEvidence.tsx#L18-L53) | 延续现有矩阵与证据侧栏，连接新收藏的论文和摘录 |
| 把研究产物带出去使用 | Elicit · 官方文档 | 报告导出 PDF/Word，表格导出 CSV/Excel，参考文献导出 BIB/RIS；部分导出有套餐限制。[导出说明](https://support.elicit.com/en/articles/14758189-export-your-data-from-elicit) | 正文、表格、素材和文献表分别导出，保留互相引用 |
| 看清再次生成改了什么 | OpenScholar demo · 静态源码 | Report 读取 previousSection，提供 Compare with draft 和结构化引文；不据此推断有完整编辑器。[Report.tsx](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/report/Report.tsx#L17-L158) | Agent 给候选修改，用户比较后采纳，保留人工正文 |
| 在自己的论文中管理引用 | Overleaf + Zotero · 官方文档 | 导入文献库或逐篇引入来源，以 citeKey 连接正文和 .bib；也支持导出 .bib 后上传。[Zotero 集成](https://docs.overleaf.com/integrations-and-add-ons/reference-manager-integrations/zotero)、[参考文献](https://docs.overleaf.com/citing-and-references/creating-a-bibliography) | 草稿保存稳定来源引用，导出正文与文献表后可继续编辑 |

这些文档证明产品宣称的流程，未验证当前账户、套餐或真实交互。
源码行证明具体菜单、数据和组件存在，未验证整个平台运行。

## 相关论文要让用户知道从哪里找到它

ResearchRabbit 的三个入口最适合直接进入 Pero Reader。
Litmaps 的补充价值是显式迭代：收藏候选后，用户再决定是否用它改变下一轮推荐。
保存论文不应悄悄改变研究范围。
([ResearchRabbit](https://www.researchrabbit.ai/articles/guide-to-using-researchrabbit)、[Litmaps 迭代](https://docs.litmaps.com/en/articles/9082008-do-a-literature-review-with-litmaps))

**相关、直接引用和共被引应分别表达。
**Connected Papers 官方 About 将相似图建立在共被引/共享参考文献等关系上，两篇靠近的论文未必直接互引。
本轮只取得该页的官方搜索索引文本，未运行交互图；公开 Python 仓库也只是 API 客户端。
([About](https://www.connectedpapers.com/about)、[官方客户端](https://github.com/ConnectedPapers/connectedpapers-py/blob/master/README.md))

【Pero 建议】先提供带关系来源的列表：当前论文 → 选择相关/参考/被引 → 查看候选 → 保存到阅读集合 → 加入现有比较任务。
保留种子、入口和返回位置；图谱可以在已有关系数据上增加，不影响首个流程交付。

## 图片应能进入笔记并回到原文

Zotero 的 PDF image annotation 保存 pageIndex 和矩形区域，再将页面区域渲染为 PNG。
它是可追溯区域截图，不能称为原始嵌入图片的无损提取；图号和图注的自动识别也未由这些代码证明。
([区域记录](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/pdf/pdf-view.js#L3783-L3801)、[PNG 渲染](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/pdf/pdf-renderer.js#L181-L224))

**复制图片与加入带引用的笔记是不同动作。
**Copy Image 回调只传图片；Add to Note 的笔记流程默认附引用，并能 Show on Page 返回原页。
不能宣称位图剪贴板自动包含出处。
([复制回调](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/common/context-menu.js#L350-L368)、[返回上下文](https://www.zotero.org/support/pdf_reader#viewing_an_annotation_in_context))

【Pero 建议】明确提供“复制图片”“复制图注/来源”“保存素材”“加入笔记”。
素材保留论文版本、位置、图片或原文、用户评论，再被矩阵和草稿引用。
文本摘录和已有图片可先接入；PDF 圈选需要页内阅读及可靠区域定位，不能从现有 Markdown 偏移编造坐标。

## 生成报告与生成论文分别连接不同输入

Elicit 的提示指南建议先澄清问题、范围和提取列，再由用户启动具体工作流；Research Agent 不能代替用户启动 Research Report。
这说明生成应有明确输入与动作，不能把继续聊天泛化成所有研究流程自动发生。
([官方提示指南](https://support.elicit.com/en/articles/17718409-writing-effective-prompts-in-elicit))

AI Scientist-v2 已有实验摘要、绘图和引用进入 LaTeX 写作、编译检查与修订的模块。
但固定提交中 normal launcher 传入 citations_text，而对应函数签名未接收该参数；本轮只做静态对照，未运行并复现异常，也未验证整套生成。
因此可参考“实验产物进入论文草稿”的数据路径，不能称这份 checkout 已通过端到端生成验收。
([launcher](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/launch_scientist_bfts.py#L271-L295)、[写作模块及参数](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/perform_writeup.py#L455-L755))

【Pero 建议】先交付用户可编辑的 Related Work 草稿：从选定证据和素材生成大纲，再逐节起草、比较和采纳。
它与不可变研究报告分别保存，人工修改可保留；完整原创论文后续再接用户的方法、实际实验与生成图。
排版编译、原文匹配和模型自评都不直接代表科学结论成立。

## 下一轮先让三条短旅程连起来

| 顺序 | 建议的完整操作路径 | 可单独验收的结果 |
| --- | --- | --- |
| 先做 | 打开论文 → 相关/参考/被引 → 保存候选 → 阅读 → 加入矩阵 | 能解释关系来源、返回原阅读位置，收藏不自动改变推荐种子 |
| 随后 | 选文字或图片 → 保存素材 → 加评论 → 加入笔记 → 回到原文 | 原材料、用户评论与来源分别保留，复制与保存有明确反馈 |
| 再接 | 选择证据/素材 → 大纲 → Related Work 逐节草稿 → 比较/采纳 → 导出 | 每节引用可追溯，人工版本不被自动覆盖，正文和文献表可继续使用 |

以上是建议，尚未在本轮实现。
现有 Host 继续负责 Agent、取消和授权；Python 保存领域材料与文稿，当前 renderer、矩阵和证据侧栏继续复用，无需为这三条路径新增通用调度器。

新增官方源码 checkout：`/Users/phodal/test/paper-agent-research/zotero-reader`，origin `https://github.com/zotero/reader.git`，SHA `678994c4928ea5d2e9384137683c27c333d980b8`，许可 AGPL-3.0。只读研究，未复制进 Pero；原 12 仓 manifest 保持上一轮快照。([固定提交](https://github.com/zotero/reader/commit/678994c4928ea5d2e9384137683c27c333d980b8)、[许可](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/COPYING#L1-L6))

调研笔记：[继续发现](</Users/phodal/workspaces/pero/research_notes/Paper 用户旅程与产品对照/related-discovery.md>)、[图文与笔记](</Users/phodal/workspaces/pero/research_notes/Paper 用户旅程与产品对照/figures-notes.md>)、[写作产物](</Users/phodal/workspaces/pero/research_notes/Paper 用户旅程与产品对照/writing-outputs.md>)。
