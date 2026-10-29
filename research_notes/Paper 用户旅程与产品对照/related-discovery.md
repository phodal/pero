# 从一篇论文扩展到阅读集合

研究日期：2026-10-29。范围：ResearchRabbit、Litmaps、Connected Papers 的官方指南/公开接口说明；未登录产品、未实际操作 UI、未调用推荐 API。本组没有修改 Pero 或克隆新仓库。

## 哪些产品已经把单篇论文变成继续发现的入口

### Takeaway
ResearchRabbit 直接提供当前论文的 Similar / References / Cited By；Litmaps 把种子论文、推荐候选、保存和再检索串成一个循环。这两者最贴近 Pero 下一轮的阅读后动作。

### Cited Findings
- 【官方产品文档】ResearchRabbit 打开一篇论文后可在 Notes 记笔记，点 Save to… 选已有 collection 或新建 collection；同一论文底部有 Similar、References、Cited By，分别进入相关主题、该论文参考文献、后续引用三个探索方向。指南还说明搜索/地图以 tabs 保留，便于返回此前探索。[ResearchRabbit 官方分步指南](https://www.researchrabbit.ai/articles/guide-to-using-researchrabbit)
- 【官方产品文档】Litmaps 的明确步骤是搜索主题/已知论文 → 选 starting articles → Explore Related Articles → 地图和侧栏查看推荐。输入论文和候选论文用不同显示区分；对候选点 More Like This 会保存到 Litmap，并将其加入下次推荐的输入。[Litmaps 搜索操作](https://docs.litmaps.com/en/articles/9092911-search-for-articles-with-litmaps)
- 【官方产品文档】Litmaps 文献综述指南进一步给出：保存相关论文、反复 More like this 后 Refresh，再评价来源和组织文献。Tagging 保存与加入搜索输入是应向用户说明的动作；该指南的“Write the literature review”章节是写作流程建议，不能据章节标题就声称它有论文全文生成器。[Litmaps 文献综述流程](https://docs.litmaps.com/en/articles/9082008-do-a-literature-review-with-litmaps)

### Inferences
- 【Pero 建议】阅读页给三个稳定动作：找相关研究、查看参考文献、查看后续引用。搜索结果保留“从哪篇论文、哪种关系进入”，可以返回原阅读位置。
- 【Pero 建议】明确区分“保存到阅读集合”与“用作下一轮推荐种子”，避免收藏一个论文就悄悄改变检索范围。ResearchRabbit/Litmaps 是已存在的交互先例，具体排序与来源适配仍由 Pero 自己实现。

### Gaps
- 以上为当前官方文档描述，不是本轮真实产品 UI 验收；不能证明特定账户/套餐/领域中的推荐覆盖率，也不能推断它们内部算法或源码公开程度。
- 没有验证 ResearchRabbit 的 Similar 排序或推荐解释接口；不能把 Similar 一概描述为模型语义向量相似。

## 图谱中的相似关系与引用关系是否相同

### Takeaway
这些项目已经证明可视探索有产品价值，但图中的边必须有类型。Connected Papers 的相似图尤其不能作为“这篇论文直接引用了那篇”的证据。

### Cited Findings
- 【官方公开说明】Connected Papers About 描述：从 origin paper 分析候选并选择强关联论文，按 co-citation / bibliographic coupling 相似度布局；即使两篇论文不直接互引，也可能很接近。因此官方明确区分这种相似图与 citation tree。本次 open 页面受 JS 限制，只能读取搜索索引缓存中的官方 About 正文；未实际打开交互图。[Connected Papers About](https://www.connectedpapers.com/about)
- 【官方产品说明】Connected Papers 起点允许 paper title、DOI 或论文 URL；网站将 Prior Works 定位为领域先行工作，Derivative Works 定位为后续研究与综述。这是围绕种子的探索用途描述，不能等同于穷尽的引用追踪结果。本次同样只取得官方页面的索引文本。[Connected Papers 官方主页](https://www.connectedpapers.com/)
- 【公开接口 README】ConnectedPapers/connectedpapers-py 提供官方 Python API 客户端例子：取 graph、读取 paper 信息，以及 graph.common_references / common_citations。仓库是 API 客户端而非推荐后端或产品 UI；README 所列 token/early-access 要求也不意味着 Pero 已获得调用权限。[官方 Python 客户端 README](https://github.com/ConnectedPapers/connectedpapers-py/blob/master/README.md)
- 【官方产品文档】Litmaps 区分 citation map、Semantic map（标题/摘要相近）、Co-citation network（共被引或共享参考文献）、Co-author network，并允许保留 timeline。布局可按日期、引用数等安排；只能移动已保存输入的自定义位置，推荐候选不等同于已保存论文。[Litmaps 地图与关系说明](https://docs.litmaps.com/en/articles/9181490-use-and-edit-litmaps-visualization)

### Inferences
- 【Pero 建议】先把相关研究/参考文献/后续引用做成可筛选列表，并保存关系来源；如果加图，再明确区分“直接引用”“共被引/共享参考文献”“内容相似”。不能用一条无类型的线包办所有关系。
- 【Pero 建议】推荐理由可来自可核实关系，例如“引用当前论文”“共享 N 篇参考文献”。没有公开依据的算法分数只标为来源推荐，不生成似乎已经读过全文的理由。

### Gaps
- 未取得这些完整平台的推荐引擎源码；客户端公开不意味着服务端可复用。
- 未测图谱在中文、冷门主题、少引用新论文上的表现；不引用营销文案作为准确率或完备率结论。

## Pero 可以借鉴哪两条具体旅程

### Takeaway
优先完成“当前论文 → 候选 → 保存 → 比较”和“集合 → 增补种子 → 新一轮发现”。保留每轮种子与用户选择，比先画大图更直接地支持当前阅读任务。

### Cited Findings
- 【可复述的官方操作路径 A】ResearchRabbit：打开论文 → Similar / References / Cited By → 打开新地图和候选 → Save to… 保存到命名集合 → 回到已保留的 tab。结果对象是持续增长的 collection 与可返回的探索上下文。[官方指南](https://www.researchrabbit.ai/articles/guide-to-using-researchrabbit)
- 【可复述的官方操作路径 B】Litmaps：选一至多篇起始论文 → Explore Related Articles → 从地图/侧栏查看候选 → More Like This 保存并纳入下一轮输入 → 再运行/Refresh。结果对象是保存的 Litmap、输入论文集及一轮新的推荐候选。[搜索指南](https://docs.litmaps.com/en/articles/9092911-search-for-articles-with-litmaps)、[综述中的迭代](https://docs.litmaps.com/en/articles/9082008-do-a-literature-review-with-litmaps)

### Inferences
- 【复用模式 1：以当前论文为种子】Reader 中三种入口复用现有检索/论文卡，并携带 seedPaperId、relationKind 与数据来源；这里是建议的领域输入，不是已新增 API。
- 【复用模式 2：收藏与推荐输入分开】保存候选到阅读集合，再显式选择哪些作为下一轮种子；保留检索历史，避免用户失去来路。
- 【复用模式 3：阅读集合连接证据比较】将已读且有足够来源的论文加入同一比较任务，进入现有 EvidenceMatrix。推荐候选和阅读收藏保持未核验，只有具体摘录才能成为报告的证据引用。

### Gaps
- 本组只研究发现/收藏旅程，不声称这些产品提供 PDF 图片复制、实验执行或完整论文生成；这些由相邻调研分别核实。
- 本轮仅产生对照建议，没有实现上述入口；没有复制平台 UI/算法，也没有把推荐关系升级成科学支持或反驳关系。
