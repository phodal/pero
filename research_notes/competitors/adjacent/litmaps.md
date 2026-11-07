# Litmaps 与 Pero 的竞品研究

[返回总索引](../README.md)

核验日期：2026-11-07。依据官方产品、算法、数据覆盖、Monitor 和定价文档；未登录搜索或实测提醒。

**结论：** Litmaps 把种子文献、可视化探索和持续跟踪组合成轻量研究入口。Pero 可借鉴“已保存的研究范围持续吸收新证据”，但不能把引文图谱或主题空白直接当成科学结论。

## 1 产品定位与用户

Litmaps 面向研究者、学生、导师、实验室和需要长期跟踪文献的专业用户。产品围绕 Litmap，也就是基于一组论文及其关系建立的主题地图，提供发现、可视化、分享和监控。[官方产品](https://www.litmaps.com/)、[功能说明](https://www.litmaps.com/features)

**与 ResearchRabbit 的比较判断：** 二者都包含种子、关系网络和持续发现。Litmaps 的文档尤其明确地把一个已保存地图当作后续 Monitor 搜索的输入，并提供不同推荐算法。不能仅以“一个有图、一个没有图”区分，也不应假定二者召回效果相同。

## 2 核心功能与实际工作流

下面为文档还原的操作路径，**不是本次使用结果**：

1. 从一个或多个已知相关论文开始，建立主题地图。没有可靠种子时，先用学术数据库确定基本范围。
2. 选择推荐算法，审阅候选论文，将真正相关项加入地图。
3. 根据检索目标改变日期、关键词等条件，避免把图上所有邻居都视为应纳入研究。
4. 调整可视化和注释，向导师或同事解释领域结构及当前覆盖范围。
5. 对稳定的主题地图启用 Monitor，按设置检查新增论文，再由研究者判断其是否改变已有结论。
6. 用文献管理工具、导出或 Zotero 联动继续阅读和写作；Pro 功能包含 Zotero 同步，具体同步细节仍需账户测试。[功能页](https://www.litmaps.com/features)、[Monitor 文档](https://docs.litmaps.com/en/articles/9126249-monitor-get-alerts-for-important-research)

### 三类推荐算法

官方算法文档列出：

- **Shared Citations & References：** 依据输入论文的引用与参考文献关系寻找连接紧密的研究。
- **Common Authors：** 根据输入中的作者合作模式发现相关团队的其他研究。
- **Similar Text：** 对题名和摘要作语义分析，不依赖引用关系，可用于探索低引用或网络之外的相似研究。

这三者回答的问题不同，应分别测试；把 Similar Text 写成全文科学内容理解是不准确的。[官方算法说明](https://docs.litmaps.com/en/articles/9029858-search-algorithms-in-litmaps)

## 3 优势与适用场景

- **从少量种子逐步扩展。** 适合已经知道几篇核心论文、但尚不掌握完整领域的研究者。
- **可换推荐路径。** 引文、作者与文本相似提供互补线索，有利于检查初始种子的局限。
- **地图便于讨论研究范围。** 用于团队讨论“目前看到了什么、哪些方向还没覆盖”，比一长串链接更容易形成共同理解。
- **持续监控贴近长期课题。** 文献研究不必在一次搜索后停止。Monitor 基于现有地图重复搜索，免费用户也有基础监控，付费可自定义更多设置。[Monitor](https://docs.litmaps.com/en/articles/9126249-monitor-get-alerts-for-important-research)

以上为产品分析，不是召回、精确率、提醒及时性或用户效率的独立验证。

## 4 数据覆盖和可靠性边界

**元数据不等于全文。** 官方说明从 Crossref、Semantic Scholar、OpenAlex 等开放元数据来源构建索引，开放元数据与开放获取全文是不同概念。检索到论文不意味着产品或用户自动获得全文使用权。[数据库说明](https://docs.litmaps.com/en/articles/7212085-litmaps-database-coverage-open-access-and-article-indexing)

**缺失与版本是现实问题。** 元数据缺失、收录延迟、标识符差异或版本合并可能造成漏文献、缺少引用关系和重复记录。使用者应核对 DOI、预印本与正式出版版本，而不是把图中的单个节点视为完整档案。[覆盖与版本处理](https://docs.litmaps.com/en/articles/7212085-litmaps-database-coverage-open-access-and-article-indexing)

**网络结构存在偏差。** 热门文献、引用操纵和低质量期刊都可能影响推荐。官方亦承认引用网络受到这些因素影响。语义算法可以提供不同路径，但不是自动消除偏差。

**地图空白不等于科研空白。** 某片区域没有节点，可能来自种子、算法或索引边界。要提出“尚无研究”的主张，仍须记录正式数据库检索、同义词与纳入规则。

**提醒不保证即时或完整。** Monitor 按周期运行搜索，收到的是服务发现的新记录；不应把营销中的即时提示理解为所有新论文发布后立即可见。

## 5 部署、价格、许可与页面矛盾

价格说明：下文保留官网的 `$` 标价；币种、地区适用性与税费待具体账户结账确认。

Litmaps 是商业托管服务，提供 Free、Pro、Team 及机构路径。公开元数据来源、可分享地图或可导出文献，不等于完整产品开源或可自部署。[价格](https://www.litmaps.com/pricing)

**可确认的价格信息：** 官方页面显示教育 Pro 为年付 $120、折合 $10/月，并标注学术邮箱条件；商业和团队报价及地区折扣应在具体账户核实。不能把教育价格推广到全部商业使用。

**需要明确保留的不一致：** 同一定价页的不同展示区域分别写免费版 2 张地图和 1 张地图；Pro 提醒分别出现 weekly/configurable 和 daily/configurable。较早 Monitor 帮助文档则列 weekly/monthly。因此，本篇不把免费地图数量和提醒频率写成确定合同权益，建议在账户界面或销售确认后采购。[定价页](https://www.litmaps.com/pricing)、[Monitor 设置](https://docs.litmaps.com/en/articles/9126249-monitor-get-alerts-for-important-research)

**本次未确认：** 可供 Pero 生产调用的公开通用 API、批量导出许可、项目保留和取消订阅后的数据权益。未来集成应先核实授权，而不是用自动化抓取替代缺失接口。

## 6 与 Pero 的比较和建议

Pero 以 master `371ea089` 为本次比较基线，涵盖 Paper、Data、Control Lab、Virtual Cell 和 Host 等研究工作空间能力。可确认事实和未验证范围统一见 [Pero 比较基线](../README.md#pero-比较基线)；本篇没有独立重验 Pero 代码或科学性能。

| 层面 | Litmaps 的公开能力 | Pero 的潜在增量 |
| --- | --- | --- |
| 文献发现 | 种子网络及不同推荐算法 | 统一来源并保存论文进入课题的理由 |
| 持续课题 | 基于地图的 Monitor | 新证据触发哪些假设、实验或结论重审 |
| 展示与交流 | 关系图、注释和分享 | 从图上关系继续追到原文和具体实验 |
| 科学执行 | 不是主要公开产品重心 | 数据、环境、运行与复核形成连续链条 |
| 开放与迁移 | 商业服务、已有文献工具联动 | 不丢文献标识、研究者判断和历史版本 |

**优先建议：** Pero 不必先复刻整套关系图谱。更有区别的工作是把“发现新论文”转化为“原结论是否受影响、哪些实验需要重跑”，并让研究者控制更新，而不是自动覆盖旧结论。

## 7 建议实测与待验证问题

用同一主题、同一批种子测试三种算法，再增加一组最新低引用论文，观察发现范围如何变化。

1. 每种算法新增多少真正相关且原集合没有的论文？
2. 无引用连接但语义相关的论文能否被找到，代价是多少误报？
3. 版本、DOI、预印本和重复文献如何合并与导出？
4. Monitor 的实际执行周期、收录延迟和漏报率是什么？
5. 免费/教育/商业计划当前生效的地图及提醒配额是什么？
6. Zotero 与导出能否保留标签、笔记、版本和发现来源？
7. 新论文进入 Pero 后，能否指出受影响的具体结论而非仅发一条通知？

建议记录新增有效文献、不同领域覆盖、提醒噪声、文献记录一致性和下游复核工作量。图谱节点数不是主要质量指标。

## 8 证据说明与来源

本次只有公开资料核验，没有创建地图、测试 Zotero 或实际接收提醒。主要来源：[官网](https://www.litmaps.com/)、[功能](https://www.litmaps.com/features)、[算法](https://docs.litmaps.com/en/articles/9029858-search-algorithms-in-litmaps)、[数据库](https://docs.litmaps.com/en/articles/7212085-litmaps-database-coverage-open-access-and-article-indexing)、[Monitor](https://docs.litmaps.com/en/articles/9126249-monitor-get-alerts-for-important-research)、[价格](https://www.litmaps.com/pricing)。
