# 从证据比较走向写作与论文草稿

调研日期：2026-10-29。沿用既有 clones，不安装或执行第三方系统、模型、LaTeX 或实验。下文区分【源码观察】【官方文档】和【Pero 建议】。当前 Pero 已有科学内容渲染、证据矩阵与引用侧栏；先前报告里的“缺 renderer”不再适用。

## 哪些项目把检索和比较接成带引用的研究报告

### Takeaway
Elicit 给出了明确的“问题→搜索/筛选/提取→报告/表格/参考文献导出”产品路径；OpenScholar demo 提供逐节引用和前稿比较的公开 UI 源码。两者适合支持 Pero 的综述与 Related Work，不能直接等同于原创实验论文已生成或科学验收完成。

### Cited Findings
- 【官方文档】Elicit 的报告 API 接收研究问题，异步执行搜索、筛选和结构化提取并生成研究报告；另有交互式 Research Agent，支持后续消息和产物。这里证据是公开 API 契约，不是平台源码或本轮实际调用。[Elicit 官方 API：Reports 与 Research Agent](https://docs.elicit.com/)
- 【官方文档】Elicit 明确建议先与 Research Agent 澄清问题、范围、筛选标准和提取列，再由用户进入具体工作流；Research Report 需用户自行启动，Agent 不能代为启动。因而不能把“同一聊天继续问”描述为自动触发所有研究产品。[Writing effective prompts，尤其第 1 节](https://support.elicit.com/en/articles/17718409-writing-effective-prompts-in-elicit)
- 【官方文档】产物按用途分别导出：报告 PDF/Word，表格 CSV/Excel，参考文献 BIB/RIS。表格导出存在套餐限制。具体交互是报告右栏 Save PDF 的下拉选择格式，表格顶部 Export，其他产物各自 Download。[Export your data from Elicit](https://support.elicit.com/en/articles/14758189-export-your-data-from-elicit)
- 【源码观察】OpenScholar demo `Report` 接受当前 section 与可选 previousSection；正文 Paper 标记映射结构化 citation/snippets，底部列参考文献；有前稿时提供 Compare with draft。diff 会按句拆行并清理部分年份/引用编号，属于阅读辅助。本组件未提供通用文稿编辑器，不能从 diff 推断编辑/采纳/版本持久化全链路。[Report.tsx 固定源码](https://github.com/allenai/open-scholar-demo/blob/565cfbb4e77fa520196631cc710147de2b9a4ca1/ui/src/components/report/Report.tsx#L17-L158)

### Inferences
- 【Pero 建议】保留已经实现的矩阵和来源侧栏，新增“用所选证据写 Related Work”动作：用户选择已收藏材料→补充输出目的/结构→生成候选大纲→逐节生成带引用文本→核对和修订→导出正文、图和参考文献。
- 【Pero 建议】“添加比较列”“缩小范围”“补充某类论文”适合在同一次研究中继续；“生成文稿”应形成独立的草稿对象和明确用户动作，不把新的 Agent 消息自动覆盖已采纳正文。
- 【Pero 建议】图表、文稿与文献清单分别提供导出；当前 Markdown/JSON 报告导出可作为起点，再补 BIB/RIS 的互操作能力。

### Gaps
- 没有登录 Elicit、实际创建报告或测其引用准确率；不将官方功能说明写成实际操作验收。报告导出为 Word 也不证明在线已有逐段富文本编辑。
- 没有验证 OpenScholar demo 当前依赖下的实时 UI、文稿版本保存或编辑 API；本次只确认上述具体 React 组件。

## 如何把收藏的论文接入用户自己编辑的论文

### Takeaway
Overleaf 与 Zotero 的组合展示了另一个成熟边界：文献库负责来源元数据，文稿编辑器负责正文，引用键将两者接起来。对 Pero，“生成 Paper”可以先交付可编辑、有稳定引用的 Related Work 草稿，而非一次输出整篇不可控文本。

### Cited Findings
- 【官方文档】Overleaf 可从 Zotero 整库/Group Library 导入只读、可刷新的 `.bib`；也可通过 Advanced Reference Search 按篇查找并引用，条目进入项目的可编辑 `.bib`。直接集成是 Premium 功能；文档同时给出从 Zotero 导出 `.bib` 后上传的路径。整库导入是扁平列表，不保留文件夹选择语义。[Overleaf Zotero integration](https://docs.overleaf.com/integrations-and-add-ons/reference-manager-integrations/zotero)
- 【官方文档】写作中用唯一 citeKey 引用 `.bib` 中的来源，编译时排定引文和参考文献。`.bib` 既可上传/创建，也可来自参考管理器集成。这是排版与引用管理能力，不证明所引文献支持论断。[Overleaf Creating a bibliography](https://docs.overleaf.com/citing-and-references/creating-a-bibliography)

### Inferences
- 【Pero 建议】最小 `ManuscriptDraft` 可由章节、用户编辑内容和来源引用构成，逐节接受 Agent 候选修改；正文可以重新生成某节，已编辑版本保留。首版支持“阅读笔记 / Related Work / 小型综述”三类目标即可，结果仍调用现有 Host 执行链。
- 【Pero 建议】从证据格、选段或 Figure 加入写作时保留内部来源身份；导出时统一生成引用键和文献表，不要求用户从自由文本手工重建引用。后续可导出 Markdown/LaTeX 加 `.bib`，让用户进入既有写作工具继续。
- 【Pero 建议】素材、证据报告与可编辑文稿使用不同对象和状态。草稿编辑不改变冻结论文或已保存证据，文稿生成也不自动代表实验已运行。

### Gaps
- 本次未运行 Overleaf 服务或编辑器，也未做 Zotero 同步。这里只用官方文档证明用户流程及文件互操作边界，不建议立即重做完整 Overleaf。

## 哪些开源系统已经实现从实验到完整论文的模块

### Takeaway
AI Scientist-v2 确有把实验摘要、生成图、参考文献组合成 LaTeX，再编译、检查与模型修订的源码。它代表“实验结果→论文草稿”的路径；固定 checkout 有一处 normal 分支装配不匹配，不能称为本轮已验证可以直接跑通的整套产品。

### Cited Findings
- 【源码观察】launcher 按顺序执行实验、聚合绘图、收集引用、选择 8 页 normal / 4 页 ICBINB 写作，再在存在 PDF 时调用论文及图片/图注/引用 review。该文件证明流程接线的意图，本轮没有实际执行。[launch_scientist_bfts.py 256–318](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/launch_scientist_bfts.py#L256-L318)
- 【源码观察】写作模块输入包括 idea、baseline/research/ablation JSON 摘要、绘图脚本、可用图片文件名、模型图像描述和当前 LaTeX；随后写回生成稿，并反复编译、检查图引用、运行 chktex，再让模型修订。它是生成文件与检查脚本，不是面向用户的共编文稿界面。[perform_writeup.py 410–755](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/perform_writeup.py#L410-L755)
- 【源码观察：范围限制】同一固定 SHA 中，launcher normal 分支传 `citations_text=`（上面的 281–287 行），但被导入的 `perform_writeup` 参数表没有该参数（上面的 455–463 行）；ICBINB 另有接收该参数的实现。这是静态签名对照，未执行并复现异常；因此不能把 normal 默认路径描述为已经跑通。[launcher 同上](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/launch_scientist_bfts.py#L271-L295)、[被调用参数表同上](https://github.com/SakanaAI/AI-Scientist-v2/blob/96bd51617cfdbb494a9fc283af00fe090edfae48/ai_scientist/perform_writeup.py#L455-L463)

### Inferences
- 【Pero 建议】写作输入应能选择已存在的实验记录/图/表并关联生成版本，区分原论文图、用户截取素材和自己实验产生的图。论文草稿中的实验结果从这些产物取得；缺失实验保留缺口。
- 【Pero 建议】近期纵向切片：现有论文集合和证据矩阵→选中若干证据与图片素材→候选大纲→带引用的 Related Work 草稿→逐节修订/采纳→正文+素材+参考文献导出。完整原创论文、自动实验、复杂 LaTeX 排版属于后续切片。
- 【Pero 建议】复用现有 Host 的执行、取消与授权，Python 保存领域文稿/素材/引用；不因研究 AI Scientist 而另建调度器。

### Gaps
- 没有安装、运行实验、调用模型或编译生成稿；未验证 ICBINB 全流程。编译通过、图文件存在和模型自评都不足以证明实验、引用或科学结论正确。
- 本次未审查自动写作最终质量，不推断它可以替代人工研究与论文核对。
