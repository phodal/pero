# 主内容区统一迁移：实施顺序与 Agent 任务书

状态：提案。先阅读 [原则](README.md) 与 [组件接口声明](contract.d.ts)。新组件尚未实现、未导出；不能直接让五个模块分别照着声明写一套。

## 1. 依赖与并行边界

```text
F0 共享基础组件 + 参考页 + 导出 + 测试
 └─ F1 Data 真实迁移试点，稳定 API 与视觉证据
     ├─ F2 Environments
     ├─ F3 Compute
     ├─ F4 Paper（文库 / 阅读器分开验收）
     └─ F5 Notebook（目录 / 编辑器分开验收）
         └─ F6 跨 App / Native 对照验收与旧样式清理
```

共享层同一时段只由一个 owner 修改；模块 Agent 不并发改 token、SDK exports、分栏引擎和公共 CSS。基础契约缺能力时提交共享层变更建议，不复制组件。后续模块可以并行，但前提是共享组件已经可用且 API 冻结。

不要求删除领域功能、不迁移数据库、不更换 Notebook 编辑器，不把本任务扩大成导航重构或全站换色。

## 2. F0：给共享组件 Agent 的任务

### 读取顺序

AGENTS.md → DESIGN.md → packages/pero-design/README.md → 本契约 → DESIGN-REVIEW.md；继续遵守仓库 Architecture/ADR/fitness 阅读顺序与现有任务记录。

### 交付

| 内容 | 位置与要求 |
| --- | --- |
| ContentPane / InspectorHeader / ContentSection / MetadataList | 在 `packages/pero-design` 中按已有组织方式实现；四个组件无业务依赖 |
| 公共出口 | 实现与测试完成后更新 `packages/app-sdk/src/ui.tsx`；没有实现前不得导出声明 |
| 布局 preset | 复用 `spec/pero-design/design.tsp`；确需新增字段时一处定义并更新生成器，不手改输出 |
| 行为复用 | Split、Tabs、Toolbar、Button、Feedback、EmptyState 均调用既有实现 |
| Native 对齐 | 在 `crates/pero-theme` 记录相同的面板/标题/分组规则；需要时实现 GPUI 对应组件，单独验收 |
| 参考页 | 在现有 `packages/pero-design/catalog` 增加 Explorer、Operations、Editor 三个 composition 示例；不另建应用或新网站 |
| 验证 | 字体增长、深浅色、长标题、滚动 owner、空 slot、label、键盘、窄容器，以及现有 SDK tests/typecheck |
| 交接 | 列出真正可导入的名称、默认值、支持范围、未验证边界与参考截图 |

实现顺序：ContentPane 的布局 → InspectorHeader → Section/Metadata → 三类组合 → Data 试点。避免一次引入十几个未经使用验证的抽象。

Inspector 是 `ContentPane + InspectorHeader + Section` 的组合，不需要另一个管理器。ContentPane 位于 SplitPane 内，不能作为 SplitPane 的自定义替身：当前 Split 只识别直接 SplitPane 子元素。

### 运行时组合示意

以下是 F0 完成后的组合形状，不是当前可执行代码；具名领域 slot 由调用者传入。

```tsx
<AppFrame label={t('data')} actions={pageActions}>
  <Split storageKey={existingLayoutKey} collapseBelow={layout.collapseBelow}>
    <SplitPane id="data-browser" min={layout.mainMin} as="section">
      <ContentPane
        id="data-browser-content"
        label={t('datasets')}
        as="div"
        surface="list"
        inset="compact"
        toolbar={filters}
        feedback={catalogFeedback}
        scroll="pane"
      >
        {catalogBody}
      </ContentPane>
    </SplitPane>
    <SplitPane
      id="data-inspector"
      as="aside"
      aria-label={t('datasetDetails')}
      size={layout.inspectorWidth}
      min={layout.inspectorMin}
      hidden={!selectedDataset}
    >
      <ContentPane
        id="data-inspector-content"
        label={t('datasetDetails')}
        as="div"
        surface="reading"
        inset="compact"
        scroll="pane"
        header={inspectorHeader}
        feedback={detailFeedback}
      >
        {detailSections}
      </ContentPane>
    </SplitPane>
  </Split>
</AppFrame>
```

`layout` 是 F0 确定的共享 preset，不由每个 App 定义。`existingLayoutKey` 保留原有布局 preference。复杂数据预览可在独立对象页采用更宽主工作面，不能一律塞入窄 Inspector。

## 3. 五个模块的具体任务

### F1 Data：第一个实际消费者

起点：`apps/data/ui-src/index.tsx`、它使用的 Workspace/领域组件与 CSS。当前已经使用 AppFrame、Split、ListRow、Feedback 等，迁移是归并组合样式，不是重写数据管理器。

改动：统一目录工具栏/列表；用 InspectorHeader 呈现对象身份与一个主要对象动作；详情卡片拆为 ContentSection + MetadataList；数据 preview/schema/table 作为领域主面保留。将 page/header/list/inspector 的通用 CSS 移回共享层。

必须保留：导入、过滤、归档、选择保持、asset/version 身份、检查结果范围、复制与下载、Ask Agent、项目关联的实际语义。Stored、integrity、parser/indexing 不合并成一个绿色 ready；解析不可用时清楚解释下一步。

验收：成功空目录、无匹配、初次加载失败、刷新失败保留内容、长文件名/hash、不同格式、有/无 preview、Inspector 收起、Host Chat 打开后的窄容器。不要用一张正常数据截图代替其他状态。

### F2 Environments：运行条件管理

起点：`apps/environments` 与现有 `EnvironmentBrowser` / `EnvironmentInspector` 的实际 owner。先确定哪些控件被 Paper/Control Lab 等共享，不在 App 内复制。

改动：页内导航与局部动作复用 AppBar；列表/详情用共享面板；统一未创建、准备中、准备失败、不可用反馈；依赖、版本、日志分组，不重复增加“快捷操作”卡。

必须保留：App 服务环境、计算环境、软件检查的真实边界；主机/集群/软件依赖的关联；配置保存、启动停止、安装与授权行为。不把缺环境渲染成运行失败，也不为视觉一致将不同概念并成一个资源。

验收：无环境、已有环境、准备中、失败恢复、长路径、日志滚动、缺权限、共用 Inspector 消费者的回归。

### F3 Compute：作业与执行证据

起点：`apps/compute/ui-src/index.tsx` 以及 TaskReport、cluster dialog 和样式。当前入口已有 jobs/reports/clusters 等视图，不能因为旧截图只有两个 Tab 就回退现有功能。

改动：与 Environments 对齐 AppBar/Toolbar/列表或表格/详情结构；未连接调度器使用 prerequisite feedback；执行记录、日志、资源请求和结果分组，真实报告保持领域呈现。

必须保留：cluster selection、execution receipt 身份、调度器状态与观察时间、作业取消语义、TaskReport 和 payload/snapshot 等证据。不把历史回执冒充实时队列，不把 completed 显示成 validated。

验收：未连接、无已知记录、已有回执、读取失败、后台刷新、长日志/命令、取消中/已取消（实际支持时）、窄窗。不能为截图造出并不存在的后端状态。

### F4 Paper：文库和阅读器分别迁移

起点：`apps/paper-agent`，以及真实被调用的共享 reader/native preview。先记录每个视图由 Web 还是 GPUI 渲染，不假设改 CSS 就会更新原生面板。

文库：统一搜索、过滤、排序、资源列表与 Inspector；保留 collections、discover、research 等实际导航及功能，不把“统一风格”偷换成删除入口。

Inspector：完整题名、作者/来源、读取状态、一个阅读动作；摘要/笔记/关联按真实内容显示。无可用 AI 摘要时不常驻一个占满空间的禁用能力卡。

阅读器：正文/PDF/TeX 使用原有表示切换和 Reader 路径；让阅读区获得空间。相同面板和工具栏视觉规则，不强制使用文库的固定两列。

必须保留：引用身份、原文和 TeX/PDF 内容、阅读位置、笔记、研究结果、Agent 上下文及未核验边界。

验收：长题名、摘要/全文缺失、多个来源、阅读模式切换、阅读位置恢复、窄窗、Web/Native 分开记录。

### F5 Notebook：外框统一，编辑器不重建

起点：`apps/notebook/ui-src/frame.tsx`、NotebookHome、writing layout 和 editor 周边；沿用 `packages/notebook` 的领域模型。

目录：复用 Explorer 的列表/搜索/状态规则。编辑：紧凑文档头、保存反馈、现有编辑 Toolbar、编辑画布和可选引用/属性面板。使用 ContentPane `scroll="content"`，让编辑器保有滚动和选择管理。

必须保留：未保存草稿、保存序列、冲突/新版本提示、undo/redo、光标/选区、表格/公式/科研块、引用、附件、历史与键盘快捷键。不要为了统一布局改变 editor key、重建 editor 或让自动保存丢状态。

验收：新文档、长文档、未保存/保存中/已保存/冲突、长表格、公式/代码块、切换文档再返回、Inspector 与 Chat 开关、撤销与重做。

## 4. 通用 Agent 指令

将下面内容与上述对应模块段落一并交给执行 Agent：

```text
任务：仅统一 <MODULE> 的主内容区 UI；不修改全局 Sidebar/窗口 Tabs/品牌，不改变业务逻辑。

先读 AGENTS.md、DESIGN.md、packages/pero-design/README.md、
docs/design-docs/workspace-content-ui/README.md、migration.md，以及 DESIGN-REVIEW.md。

前置门禁：确认 F0 的四个组件已经在实际 SDK 中实现、导出并有参考页。
contract.d.ts 只是提案，不可作为运行时导入。基础组件未就绪时先完成页面盘点与迁移表，
不要自行复制实现或提交一个不可运行的消费端。

1. 记录现有入口、共享依赖、状态、主要操作、滚动 owner，以及必须保留的行为。
2. 为每个视图选择 Explorer、Operations 或 Editor/Reader 组合，不按 App 名强制单模板。
3. 使用既有 AppFrame/AppBar/Toolbar/Split/Tabs 和已实现的新组件；应用只提供领域 slot。
4. 保留 i18n、对象身份、Host Chat、权限、状态机、导航和 preference 的 owner。
5. 禁止新增通用按钮/标题/空态/选中/分栏的页面级皮肤，禁止改生成输出。
6. 沿用既有测试命令，检查真实 App 的正常、空、加载、失败、刷新和缺条件状态。
7. 检查深浅色、中英文、长内容、窄容器，以及打开 Host Chat 后的布局。
8. 在同一任务记录写旧组件/样式 -> 新组件、行为保持项、验证证据和未验证边界。
9. 移除本模块已无引用的旧样式，不清理其他 Agent 所属模块。
10. 提交小范围 Draft PR；不自行合并。不把类型检查通过描述为 UI 或 Native 验收通过。
```

## 5. 合并门禁

| 门禁 | 必须有的证据 |
| --- | --- |
| 公共 API | 实际存在的导出和调用者；没有从 docs 导入提案声明 |
| 主题与 token | 只改合法源文件；两主题截图；生成差异已检查 |
| 标题与动作 | 当前对象明确、无重复标题/主按钮、操作未因宿主去重消失 |
| 几何与滚动 | 只有预期滚动 owner；长内容可达；split keyboard/拖动/恢复正确 |
| 异步与空态 | 无加载闪空、刷新不抹掉内容、失败不冒充空集合、缺条件有恢复入口 |
| 领域语义 | 数据、执行、验证、保存等状态没有被视觉层合并或重新推断 |
| 回归 | 模块真实主要路径通过；Notebook 草稿/undo 或 Compute 执行语义保留 |
| Agent | 同一 Host 会话与权限路径，无第二套聊天状态；对象上下文正确 |
| 多表面 | Hosted/standalone（支持时）分别验收；Native 未测明确写出 |
| 证据 | PR 附真实前后截图、运行命令/结果、人工检查项与已知限制 |

建议截图窗口：1440×900、1024×768、800×700，另加 Host Chat 开启状态；同时记录 App 实际容器宽度。窗口尺寸不是响应式的唯一依据。字体增大到实际支持的档位检查内容不裁切。至少覆盖一次中英文切换。

CI 继续复用已有目标，优先受影响包与行为测试；不为了视觉规则另建昂贵全仓扫描器。静态检查只是补充，不能替代真实页面和动态状态验证。

## 6. 本次提案的交付边界

本次新增原则、TypeScript 声明、实施依赖和任务书。不修改业务页、公共导出、token 源、CSS、API 或 Native 运行时。不声称已完成 UI 改造、构建验证或可访问性验收。下一项可执行工程任务是 F0，不是同时启动五个独立的重设计。
