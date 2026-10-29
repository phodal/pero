# 从论文阅读到图文素材与写作

## Zotero 有没有“复制图片并继续写作”的直接先例？

### Takeaway
有。Zotero 将阅读中的选文/区域保存为批注，再把批注送入笔记并保留引用和返回原页的入口。对 Pero 最值得借鉴的是“材料保留来源，再进入笔记”，以及将复制图片、保存图片、加入笔记作为不同操作。

### Cited Findings
- 【官方文档】阅读器可打开 Notes pane，拖入单个批注或右键 Add to Note；还可把多篇论文的批注合并到一份笔记。加入笔记的批注默认附带 PDF 页链接和文献引用，之后可交给文字处理器插件使用。[Zotero PDF Reader：Adding Annotations to Notes](https://www.zotero.org/support/pdf_reader#adding_annotations_to_notes)
- 【官方文档】笔记里的批注有 Show on Page，引用有 Show Item，可返回原 PDF 页或文献条目。这是“阅读→收集→组织→追溯”的完整交互约定。[Zotero PDF Reader：Viewing an Annotation in Context](https://www.zotero.org/support/pdf_reader#viewing_an_annotation_in_context)
- 【静态源码】PDF 的 image action 根据鼠标起止点生成 `type:image`、`pageLabel`、`position.pageIndex` 和 `position.rects`，区域被约束在页面范围内。[pdf-view.js 3783–3801](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/pdf/pdf-view.js#L3783-L3801)
- 【静态源码】image annotation 的预览用 pageIndex 取页，选第一个矩形，将页面区域渲染到 Canvas，再输出 PNG。这是区域图像，不是根据图号自动抽取论文原始图片文件。[pdf-renderer.js 181–224](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/pdf/pdf-renderer.js#L181-L224)
- 【静态源码】图片批注菜单分别暴露 Add to Note、Copy Image、Save Image As。Add to Note 把 annotations 交给外壳；Copy Image 只把 annotation.image 交给回调，不应声称“复制位图自动把引用写进剪贴板”。[context-menu.js 283–289](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/common/context-menu.js#L283-L289)、[图片操作 350–368](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/common/context-menu.js#L350-L368)
- 【静态源码】另有 image overlay 的直接复制路径，将传入图片转 PNG 后交给 `navigator.clipboard.write`；Save Image As 也转 PNG。该通用路径不证明每个 PDF 的嵌入图对象可无损导出，也不应与 PDF 区域批注混称。[context-menu.js 158–194](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/common/context-menu.js#L158-L194)
- 【静态源码】Reader 构造入口注入 onSaveAnnotations、onAddToNote、onCopyImage 和 onSaveImageAs 等回调；阅读交互与宿主的存储/剪贴板操作有实际接缝。[reader.js 100–112](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/src/common/reader.js#L100-L112)
- 【官方文档】Zotero 自建批注保存在数据库，不直接写回 PDF；导出 PDF 时可嵌入批注。可以借鉴批注独立保存，不必为 Pero 照搬数据库或同步系统。[Annotations in Database](https://www.zotero.org/support/kb/annotations_in_database)
- 【实际克隆】新增官方 `https://github.com/zotero/reader.git`，本机 `/Users/phodal/test/paper-agent-research/zotero-reader`；浅克隆 HEAD `678994c4928ea5d2e9384137683c27c333d980b8`，committer 时间 `2026-10-28T13:02:10-04:00`。[固定提交](https://github.com/zotero/reader/commit/678994c4928ea5d2e9384137683c27c333d980b8)
- 【许可观察】package.json 标 AGPL-3.0；COPYING 明确 GNU Affero GPL v3。本轮只研究，没有复制代码进 Pero，也没有修改上一轮 12 仓快照 manifest。[package.json](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/package.json#L15)、[COPYING](https://github.com/zotero/reader/blob/678994c4928ea5d2e9384137683c27c333d980b8/COPYING#L1-L6)

### Inferences
- 【Pero 建议】具体流程 A：在 Reader 圈出图/表区域 → 保存图片素材（保留源论文版本、页、区域）→ 添加自己的解释/图注 → 加入研究笔记 → 在笔记中点击回原页。先支持可见区域截取即可，但名称应明确为“区域截图”。
- 【Pero 建议】具体流程 B：选中文本 → 保存摘录 → 加入同一研究笔记 → 按主题组织几篇论文的摘录 → 发送指定材料给已有 Host Chat 起草一段相关工作。人工批注与原文引句分开，不把评论当成原文。
- 【Pero 建议】三个不同动作：复制图片（位图）；复制来源/图注（文本）；加入笔记/草稿（保留结构化来源）。合在一个模糊“复制”按钮中会让用户不知道保留了什么。
- 【Pero 建议】最小概念是一个带来源的 Annotation/Material：论文快照引用、类型（text/area-image）、原文位置（文本范围或页+矩形）、原始内容/图片摘要、用户评论。caption 和 figure number 由用户确认；后续真正抽到原始嵌入图片时，再标注不同 extraction kind，避免把裁剪叫原图。
- 【Pero 建议】在矩阵、笔记和草稿共用已有来源侧栏。保存材料是领域操作，真实系统剪贴板/文件选择继续通过现有宿主能力接入；无需因此另建科研执行器。

### Gaps
- 本轮没有安装 Zotero 依赖、初始化子模块、运行 reader 或验证真实 OS 剪贴板；已确认的是菜单、数据和回调实现，不是当前平台端到端验收。
- 所查区域批注代码不能证明自动识别 Fig. 1、自动提取图注、原始矢量图/嵌入图无损导出，或结构化识别表格单元格。
- 来源定位和引用保留不证明科学结论正确。研究材料、原文图、截图和执行生成图应分别保留身份。

## SciSpace 有没有“读着读着就继续检索、理解图表”的先例？

### Takeaway
有官方产品文档描述：选中文本解释、基于选段推荐相关论文、做笔记，以及解释数学/表格/图。它适合借鉴上下文动作，证据强度是公开产品描述，未取得相应平台源码或登录实测。

### Cited Findings
- 【官方产品文档】Chat PDF 页列出按具体章节提供引用、分节摘要、解释高亮文本、按高亮文本推荐相关论文、记笔记，以及数学/公式/表格/图的解释能力。[SciSpace Chat PDF](https://scispace.com/chat-pdf)

### Inferences
- 【Pero 建议】阅读中的上下文菜单可提供“解释选段”“找相关论文”“保存摘录”“加入问题/草稿”，每个动作都携带当前 source anchor。由用户选段触发的检索比把整篇标题塞入通用搜索框更贴合具体疑问。
- 【Pero 建议】点击图表的“解释”时，同时送图、图注与附近正文及源引用；把 Agent 的解释保存在评论中，不覆盖原文。图像说明可以关联到素材，再被比较表或写作流程引用。
- 【Pero 建议】第一轮组合 Zotero 的可追溯材料与笔记、SciSpace 的阅读上下文动作；无需先建设一个全功能论文编辑器。

### Gaps
- SciSpace 本页没有证明图像复制、原始图提取、图注匹配算法或对应开放源码；不能从“解释图表”推断已实现上述能力。
- 本轮未登录产品，没有测试功能限制、准确率、费用或实时 UI。未采用该页的商业比较、隐私和免费额度宣传作为验收依据。
