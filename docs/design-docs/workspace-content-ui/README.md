---
kind: analysis
status: proposed
date: 2026-11-12
scope: workspace content area only
---

# 主内容区 UI 契约

目标：让 Data、Environments、Compute、Paper、Notebook 的右侧主内容区拥有一致的视觉与交互语法，允许不同研究任务保留不同正文布局。

**这是设计与接口提案，不是已实现功能。** 本目录不参与运行时构建，不向 `@pero/app-sdk/ui` 导出任何新组件。先完成共享组件实现与参考页，再让各模块迁移。不要从本目录导入运行时代码。

配套文件：[组件声明](contract.d.ts)、[迁移与 Agent 任务书](migration.md)。

## 1. 范围与既有事实

只处理全局左侧导航和窗口内容标签以下/以右的工作区域。本文中的 Inspector 指该区域内的对象详情面板，不等于整个右侧工作区。

不改全局 Sidebar、窗口 Tabs、品牌色、路由、业务 API、领域状态机、权限、Host 会话生命周期、Notebook 编辑器内核；不批量增加页面功能。

继续采用现有来源，不新建第二套 UI 包：

| 职责 | 唯一来源 |
| --- | --- |
| 品牌、语义色、状态表达 | `DESIGN.md` |
| 尺寸、间距、字阶、圆角 | `spec/pero-design/design.tsp`，经现有生成器生成 |
| 视觉组合组件 | `packages/pero-design` |
| Web 公共入口与行为控件 | `@pero/app-sdk/ui` |
| Native 对应视觉实现 | `crates/pero-theme` / `pero_theme` |
| 会话与审批 | Host；App 使用既有 `useAppChat` / `AppConversation` |
| 真实页面验收 | `DESIGN-REVIEW.md` |

已存在：AppFrame、AppBar、PageHeader、LibraryHeader、Toolbar、Split/SplitPane、Tabs、ListRow、ReaderFrame、Button、Feedback、EmptyState、LoadingSkeleton 等。本文不再定义一组同义替代品。

现有字阶是 24/18/14/12，阅读宽度是 720，间距是 4/8/12/16/20/24；操作与输入当前最小高度是 24，并随字体增长。此前讨论中的 20px 标题、36px 按钮、900px 阅读宽度不是现有仓库契约，不能各页面分别硬编码。需要调整时统一修改 token 源并审查两端影响。

## 2. 必须遵守的原则

### A. 职责与组合

**W01 — 统一语法，不统一正文。** 所有页面共享框架、控件、层级、反馈和滚动规则。列表、计算表格、PDF、编辑器、科学图形仍使用适合任务的领域布局。

**W02 — 一种责任一个 owner。** AppFrame 是 App 根；Split 拥有分栏、拖动和宽度持久化；ContentPane 拥有面板内的头/工具/反馈/正文/底部布局；领域组件拥有内容与业务状态。禁止新的万能 WorkspaceManager 或第二套分栏引擎。

**W03 — 单一主标题作用域。** Content Tab 标识打开的对象；AppBar 放局部导航和操作。只有当前页面身份确实不同才显示页面标题。对象详情保留完整标题，不因去重丢失论文或 Notebook 名称。不得在 AppFrame 内再套 AppFrame，也不得同时渲染同一作用域的 PageHeader 和 LibraryHeader。

**W04 — 尊重宿主头部。** 现有 `columnHeader` / `useHostColumnHeader` 协议继续决定动作由 Host 还是 App 显示。不要机械加固定 64px 大标题栏，也不能隐藏标题时顺带丢失唯一动作入口。

### B. 几何、表面与密度

**W05 — 对齐由组件负责。** 同一作用域标题、搜索、列表文字、段落共享起始线；图标槽采用一致缩进。Pane 的 horizontal inset 只由一层组件施加，避免父 24 + 子 24 的叠加。

**W06 — 只用语义 token。** 页面不直接写品牌 hex、独立字号、按钮高度、选中颜色。背景区分 workspace、list、reading 等既有角色；白色不是全主题通用值。深色主题同时验收，不把所有区域强制刷白。

**W07 — 平面优先，不禁用有意义的卡片。** 普通分组优先标题、间距和必要分隔线；独立研究结果可保留语义卡片。禁止每个区块一个大圆角卡、卡中再套卡、仅因列位置不同而上色。阴影仅在层级确有需要时使用。

**W08 — 密度按内容类型统一。** 研究资源使用主标题加辅助元信息；任务表格使用紧凑可比较行；文档保持阅读行宽。标题允许必要换行；行高是最低值而不是裁切上限。不能把论文、文件、任务和 Notebook 强制设成相同行高。

**W09 — 长内容有明确规则。** 列表可截断并提供完整名称访问；Inspector 标题可换行；路径、hash、命令使用等宽字并允许换行/复制；复制值必须完整。单位、时区、来源和版本不能为了紧凑被误删。

### C. 操作、导航与 Inspector

**W10 — 一个作用域一个显著主操作。** 页面级导入/创建放当前页面动作区；对象级阅读/分析放对象头；批量操作只在选择后出现。禁止顶部、快捷操作卡和底部三处重复同一主动作。取消、删除与启动不能同等强调。

**W11 — 页内导航、过滤和表示切换分工。** Tabs 切换关联面板；Search/Select 过滤当前集合；ToggleGroup 切换 PDF/正文等同一内容表示；不要互相伪装。按钮/筛选过多时先分组与分层，不直接增加第三排导航。

**W12 — Inspector 是上下文，不是第二个主页。** 固定顺序：对象身份 → 当前重要状态 → 对象操作 → 可选 Tabs → 分组详情。它不复述整个 App 的介绍，不承载市场宣传、全局设置或永久帮助栏。没有选中对象时可关闭 Inspector，或在保留选择布局确有价值时显示紧凑选择提示。

**W13 — 详情结构共享，业务分组不同。** 共享 InspectorHeader、ContentSection、MetadataList；Paper 的摘要、Data 的 schema、Compute 的日志、Environment 的依赖、Notebook 的引用保持领域化。不要强制每个模块都有 Overview/Activity/Related，空 Tab 不显示。

**W14 — 交互状态互不冒充。** Hover、selected、keyboard focus、disabled、busy、domain outcome 分开表达。列表当前对象与多选 checkbox 分开；不从 hover 背景推断选中。显示 status 必须包含文字，不只依赖色彩。

### D. 空态、异步与科研事实

**W15 — 数据、请求和业务结果是三个维度。** UI 组件不发请求，不推断权限，不把请求成功映射为科学通过。已有内容可以刷新中或刷新失败；执行完成与验证通过分别展示。

**W16 — 空态按原因处理。** 首次加载用结构骨架；成功为空用创建/导入入口；筛选无匹配用清除筛选；缺环境/集群用条件说明与配置入口；失败用恢复反馈。未连接调度器不是空作业队列，未安装解析器不是零数据。

**W17 — 状态作用于最小区域。** 列表失败不清空仍可用的文档；详情失败不遮住导航。刷新保留同一对象内容、选择和滚动；切换对象不得把旧详情冒充新对象。权限失效时遵守原业务访问边界。

**W18 — 禁用有原因，恢复有入口。** 禁用原因在非 hover 的可达位置说明；未实现能力不要以一个无解释的灰按钮常驻。修复前置条件通常是可执行动作，而不是继续禁用原动作。技术详情可折叠，关键阻塞不可折叠。

**W19 — 科研事实优先。** Data 的 stored/integrity/indexed 分别表达；Compute 的 submitted/running/completed/validated 分别表达；Notebook 的 unsaved/saving/saved/conflict 分别表达；Paper 的 imported/full-text available/read 分别表达。迁移不改变这些既有领域定义。

### E. 滚动、窄窗与可访问性

**W20 — 一个面板一个主要纵向滚动 owner。** Header/Toolbar/Footer 非滚动；ContentPane 的 body 滚动。Editor、PDF、终端或虚拟表格自带滚动时设置 `scroll="content"`，外层不再 overflow:auto。横向数据表可有局部横向滚动。根与分栏使用 min-width:0/min-height:0，不用视口高度覆盖宿主 iframe 高度。

**W21 — 以可用容器宽度降级。** 使用 Split 已有 ResizeObserver、min、collapseBelow 与 storageKey，不只检查整个窗口。打开 Host Chat 后的剩余宽度也必须正确响应。第一版沿用共享 Split 的窄窗堆叠；需要单页 drill-in 时由领域路由显式实现，不以 CSS 偷偷隐藏唯一入口。

**W22 — 有最小宽度且可恢复。** 正文保留任务所需宽度；Inspector 建议默认约 360、最小约 320，仅作为待共享实现确认的 preset，不能五个 App 分别复制常量。Data 的真正预览区是主工作面，不必压到 360。列表继续评估现有 listColumn=336。宽度 preference 的 storageKey 按 App/布局分开，沿用已有值或显式迁移。

**W23 — 键盘不是补丁。** 复用现有 Tabs、Toolbar、Split 的键盘实现；按钮有可访问名称，输入有 label，焦点与选中分别可见。面板关闭后由 owner 将焦点返回触发器。长标题、中文/英文、大字号、焦点、深浅色同时检查。

### F. Agent 与工程约束

**W24 — Agent 共享会话，不共享一个自造聊天框。** 各 App 的 Ask/Discuss 使用既有 useAppChat/AppConversation 与对象上下文接口；权限、审批、工具准入仍在 Host。Inspector 内可放上下文动作，但不能再实现一套 Composer、消息流或自动执行入口。上下文至少可辨当前对象及实际传入的版本，不假装 Agent 已读取全部数据。

**W25 — 导航和编辑状态不因视觉迁移丢失。** 保留选择、筛选、Tab、滚动、未保存草稿、Notebook history/selection、任务运行。不要为了统一布局更换 editor key 或反复卸载实例；隐藏 Inspector 不是取消任务。

**W26 — 页面只拥有领域 CSS。** 允许 schema table、scientific plot、editor、PDF、log 的专用样式；禁止重新定义通用 button、input、tabs、header、empty-state、selection 外观。共享组件缺能力先回到共享层，不用 !important 穿透控件或复制已有样式。

**W27 — 文案和自动化语义稳定。** 使用既有 i18n；同一动作统一命名，不混用三种 Ask Agent 文案。保留现有 useAppObject / appObjectProps 的对象身份和可操作节点，使用稳定测试定位，不依赖可翻译字符串猜领域状态。

**W28 — 验收有证据。** 类型检查和组件目录只证明部分实现；必须检查真实 App、Host 嵌入、standalone（支持时）、窄窗、长内容、正常/加载/空/失败/刷新/缺条件等状态。Native 与 Web 分别记录，不用 React 截图证明 GPUI 已完成。

## 3. 组件骨架与所有权

```text
Host Sidebar / Content Tabs / Chat          不改，Host owner
└─ AppFrame                                已有，App 根
   ├─ AppBar / PageHeader                   已有，同一作用域仅选其一
   └─ Split                                已有，按任务声明 1–3 个 pane
      ├─ SplitPane                         已有，必须是 Split 的直接子元素
      │  └─ ContentPane                    提案：统一面板内部布局
      │     ├─ header                      LibraryHeader 或 InspectorHeader
      │     ├─ toolbar                     已有 Toolbar/Search/Tabs
      │     ├─ feedback                    已有 Feedback；只在有状态时出现
      │     ├─ body                        唯一主滚动区或交给领域内容
      │     └─ footer                      可选、紧凑、不放营销说明
      └─ SplitPane as="aside"               可选 Inspector
         └─ ContentPane
            ├─ InspectorHeader             提案：完整标题、状态、动作、关闭
            └─ ContentSection              提案：无卡片内容分组
               └─ MetadataList             提案：语义 dl/dt/dd
```

注意当前 Split 仅识别直接的 SplitPane。不要让自定义 Wrapper 返回 SplitPane 再作为 Split 的孩子；需要组合时，Wrapper 包在 SplitPane 里面。

最小增量仅四个视觉组件：ContentPane、InspectorHeader、ContentSection、MetadataList。不新增通用数据加载器、权限管理器、领域状态机、DataTable 引擎或聊天运行时。Inspector 由这些组件组合，不另造一个全功能 Inspector framework。

实现归属：无业务依赖的外观放 pero-design；Split/Tabs 等行为留在 app-sdk。公共组件只从 `@pero/app-sdk/ui` 使用；Native 按同一契约在 pero_theme 实现，不导入 React。

## 4. 三类组合，不是三套设计系统

| 组合 | 使用场景 | 内容模型 |
| --- | --- | --- |
| Explorer | Data 目录、Paper 文库、Notebook 目录、Skills | 搜索/过滤 + 资源列表 + 可选详情；复杂预览可成为主面 |
| Operations | Environments、Compute | 页内导航 + 工具栏 + 列表/表格 + 可选对象详情；无条件时展示恢复路径 |
| Editor / Reader | Notebook 文档、Paper 阅读器、研究简报 | 紧凑对象动作 + 领域编辑/阅读面 + 按需上下文；正文滚动由编辑器/阅读器决定 |

一项应用可有多个组合：Paper 文库不是 Paper 阅读器，Notebook 目录不是 Notebook 编辑器。不要按 App 名称固定一个模板。

## 5. 可验收的视觉预算

这是新增 preset 的建议，不是本 PR 已修改的 token。合入运行时前应在共享 token 或公共组件定义一次。

| 项目 | 契约 |
| --- | --- |
| 工作区 inset | 默认 16；阅读/概览允许 24；edge-to-edge 内容为 0 |
| Inspector inset | 16；与对象头和 section 起始线一致 |
| 组内/组间间距 | 8/16/24，来自既有 spacing token |
| 字阶 | 沿用 24/18/14/12；局部对象头优先现有 heading 档，完整文档标题保留文档层级 |
| 面板头 | 按内容伸展；禁止固定高度裁切长标题或大字号 |
| 输入、按钮、图标按钮 | 复用当前组件 metrics；不在页面重新指定 36 或 40 |
| 正文宽度 | Reader 沿用共享 readerMaxWidth；表格、图形不受阅读宽度限制 |
| 选择与 hover | 采用共享 semantic roles；不双重叠加硬边框和高饱和底色 |
| 面板边界 | 由 Split/容器一处负责，不叠加双边框 |

## 6. 外部行为参考

以下是可访问性交互参考，不替代仓库已有实现，也不代表已完成合规验证：

- W3C APG Tabs: https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
- W3C APG Window Splitter: https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/

后续实现按 `migration.md` 的阶段和证据要求推进。不得在 PR 中将接口提案、编译通过或组件目录展示表述为全产品迁移完成。
