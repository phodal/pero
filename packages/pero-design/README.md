# Pero 组件库

用同一套组件规则实现 GPUI Desktop 和领域 App。页面组合组件，组件负责视觉和
交互呈现；会话、权限、路由、系统窗口操作和设置持久化仍由已有宿主负责。

## 来源与入口

| 内容 | 唯一维护入口 | 使用方 |
| --- | --- | --- |
| 品牌与语义颜色 | `DESIGN.md` | Native、Web、App |
| 尺寸、字阶、圆角 | `spec/pero-design/design.tsp` | 生成 Rust、TS、CSS |
| 窗口与侧栏 | 本包 `src/shell.tsx` / `crates/pero-theme/src/shell.rs` | 宿主壳层 |
| 列表、标题、阅读、输入 | 本包 `src/components.tsx` / `crates/pero-theme/src/design.rs` | 工作台页面 |
| Button、Tabs、Input、Split 等行为控件 | `packages/app-sdk/src/components` / GPUI Kit | 使用现有焦点与键盘实现 |

App 从 `@pero/app-sdk/ui` 引用公开组件。GPUI 从 `pero_theme` 引用。
不要在业务页面复制组件样式，也不要为相同组件再建立一个运行时。

## 组件职责

| 组件 | 放什么 | 不放什么 |
| --- | --- | --- |
| WindowTitlebar / window_bar | 窗口控制、内容标签、搜索等全局动作 | 与内容重复的标题、面包屑、说明 |
| Sidebar / sidebar_surface | 紧凑导航、与页面相接且不顶到上沿的右侧分隔线、会话行尾独立新建入口、应用与账户入口 | 未实现功能占位、额外卡片边框 |
| SidebarGroup / sidebar_group | 一组相关导航；跨任务域用 separated 分隔，必要时才给标签 | 每组都添加眉标或分隔线 |
| SidebarRow / sidebar_row | 图标、名称、必要计数和选中态 | 计数外再套徽章、说明段落 |
| LibraryHeader / library_header | 当前页面标题、必要副标题、局部动作 | 应用名和页面名重复、固定大块留白 |
| ListRow / list_row | 标题在前、元信息在后、独立行操作 | 多层卡片、整行嵌套按钮 |
| SessionRow / session_row（GPUI） | 常规字重会话标题、右侧状态、独立行尾菜单 | 状态挤占标题左对齐、读取即解决权限、重复状态文字 |
| ResearchResult / research_result（GPUI） | 会话中的结果标题与内容；research_note 保留来源和核验边界，research_table_style 复用可选择、可横向滚动的表格 | 格式标签、执行状态机、由显示文案推断验证结果 |
| ReaderFrame / reader_frame | 单行阅读工具栏与正文面 | 第二套标题或装饰性摘要 |
| SettingsGroup / settings_group | 无卡片的相关设置行 | 嵌套面板和逐行分隔 |
| ContentTab / content_tab | 内容名称、固定 / 预览 / 未保存状态、关闭 | 额外的大标题、固定宽度空白、嵌套按钮 |
| Tabs | 页内视图切换、键盘移动、关联面板 | 与窗口 Tab 重复命名当前 App |
| ToggleGroup | 同一内容的互斥表示方式或一组可切换选项 | 复制普通按钮的选中皮肤、代替关联面板的 Tabs |
| AppBar / Toolbar | 当前内容的工具与操作 | 默认重复 App 名、全局导航 |
| IconButton / ghost_icon_button | 统一点击区域、可访问名称、提示 | 无标签的图标、第二个下拉箭头 |
| DropdownMenu | 操作菜单，使用已有 Radix / GPUI 菜单行为 | 把操作伪装成当前选中值 |
| Select / NativeSelect | Select 统一短列表、搜索与分组长列表；NativeSelect 仅用于必须保留系统弹层的兼容场景 | 无意混用系统弹层和共享弹层、替换表单校验 |
| FilePicker | 单文件 / 多文件、忙碌禁用、选中文件名 | 默认浏览器文件框、业务校验与上传逻辑 |
| Field / Input / Textarea | 关联标签、帮助和校验信息；保留原生表单语义 | 用 placeholder 代替标签、出错清空输入 |
| Slider | 有界连续数值，方向键 / Home / End 与原生表单值 | 自建鼠标拖动和另一套数值状态 |
| Checkbox / RadioGroup / Switch | 多选、单选和即时开关；选中与焦点分别呈现 | 用状态颜色代替名称和选中语义 |
| Card / Badge | 中性、蓝色、杏色内容身份；明确标注的结果状态 | 把暖色内容卡片当作警告、每个分组都加卡片 |
| Feedback / EmptyState / Progress | 局部状态、无数据下一步、真实进度 | 把加载当空态、把执行完成当领域通过 |
| EmptyIllustration / LoadingSkeleton | 成功空态的静态 SVG 插画 / 首次请求的结构占位 | 用骨架表示无数据、用空态表示失败或缺权限 |
| Dialog / Popover / Tooltip | 独立任务或低频细节、关联提示、返回触发器的焦点 | 主任务多层折叠、错误只放浮层里 |
| Table | 有名称的滚动区域、表头与真实行数据、键盘滚动 | 隐去缺失分母、把排序或结果判定放进通用组件 |
| Composer | 输入、附件、工具和提交状态 | 自动执行、第二份会话状态 |

窗口栏的拖动、双击、macOS 红绿灯留位由 Desktop 控制器负责。Web 组件不模拟
系统窗口按钮。折叠侧栏保留可访问名称；焦点和选中状态是不同状态。
`SidebarGroup label` 在展开时显示，并为分组提供可访问名称；折叠时只隐藏可见标题。
折叠导航应提供 `lead` 图标；名称保留给辅助技术，计数隐藏，不给每行添加分隔线。
没有图标的行保留文字回退，长名称截断；字符串名称自动提供原生提示，富文本名称可用 `aria-label` / `title` 补充。

## 基础规则

产品层级、颜色使用与标题作用域以 [DESIGN.md](../../DESIGN.md) 为准；以下说明组件默认值与用法。

- 默认字阶 24 / 18 / 14 / 12。Caption 与 Label 是同一个 12px 档位。
  缩小 UI 字号时，辅助文字仍保持至少 12px。
- 按钮、选择框和菜单使用同一正文系统字体、常规字重；标题和分组名称才增加字重。
  内容标签使用独立 13px 字阶、14px 图标和至少 24px 关闭区域，随 UI 字号增长；8px 圆角卡片配 4px 间隔；选中使用 accent-soft / accent-text 与细边框，hover 使用中性表面，关闭按钮保留独立反馈。
- 侧栏导航 32px、内容标签 30px、窗口栏 42px；分栏标签条上下各留 4px。操作和输入最低 24px，
  按当前文字行高增长；间距和圆角不随字体等比例膨胀。
- 新组件使用 `--pero-spacing-1` 至 `--pero-spacing-6`，对应间距 4 / 8 / 12 / 16 / 20 / 24，图标间距 6。侧栏外边距 10，分组间距 16。
- 页内 Tabs 的 `navigation` 变体用于服务目录／已安装等同级视图：无外框和贯穿底线，保留共享 Tabs 的选中指示线，以共享间距、正文文字与中等字重区分当前页。`page` 保留内容分隔线，`content` 用于窗口内容标签。鼠标选择不显示键盘焦点框，方向键与 Tab 导航保留 2px 焦点。
- ToggleGroup 用于正文 / PDF / TeX 等内容表示切换；`type="single"` 使用 radiogroup / radio 与 `aria-checked`，多选使用 `aria-pressed`。Tabs 和 ToggleGroup 共用鼠标与键盘焦点规则，2px 键盘焦点向内绘制，避免滚动工具栏裁切；必选状态由调用方忽略空值。
- 选中导航使用主题的强调背景与文字配对，默认是青色；分类和内容强调按 DESIGN 的颜色用途选择，不能与选中或错误状态混淆。
- GPUI 会话列表使用 `session_row`：28px 行高、13px 常规字重标题、14px 右侧状态槽，随界面字号增长。列表选中使用中性 `surface-muted`，与全局导航区分；状态与菜单靠近，菜单保留完整点击区域。菜单在 hover、选中、展开或键盘焦点进入时显示。项目文件夹使用稳定的主题分类色，错误、运行和待处理仍使用语义色。未读由 ChatPanel 管理，点开清除未读；待授权、问题和登录状态由原会话状态管理，不随阅读清除。
- 只在内容确实需要分隔时使用 0.5px 分隔线。输入边界 1px；文本输入、Textarea 与搜索框的键盘焦点使用贴合边框的 1px 中性细线，其他控件的键盘焦点 2px。
- 每个操作区有清晰的主要动作；“新聊天”使用会话行尾的独立 +，侧栏不重复品牌标题或大按钮。折叠后仍可达。
- Insights / 论文、执行环境 / 应用商店之间用 `SidebarGroup separated` 明确划分任务域，避免每行加分隔。
- 状态由调用方传入。加载、运行、成功、错误、禁用要能区分；出错保留用户输入。
- 主内容成功为空时，用 `EmptyState` 的 `icon={<EmptyIllustration kind="data" />}`、说明与下一步操作；筛选无匹配用 `kind="search" size="compact"`。插画为装饰，不另报读或获取焦点；已有内容刷新时保留内容。`LoadingSkeleton` 只用于真实加载，形状对应即将出现的内容。
- 内容标签标识打开的对象；页面保留不同作用域的标题和完整文档标题，只删除没有导航价值的重复名称。
- 多栏 Web 页面使用 App SDK 的 Split / SplitPane，配置最小宽度、窄窗堆叠和持久化键。

## 颜色与状态契约

- 中性色面用 `surface` / `surface-muted`；hover、pressed 使用各自角色，不能复用选中态。
- `Button variant="link"` 用于内容中的继续动作和对象链接，使用 link 前景、透明底及普通中性 hover，保留共享焦点和禁用语义。
- 普通控件悬停统一使用中性 `surface-hover`，不添加强调色侧线。选中态保持，
  键盘焦点独立描边；主操作使用 `action-hover`，保持文字对比。
- 主操作用 `action` / `action-hover` / `action-pressed` 配 `on-action`。
  选中内容用 `accent-soft` 配 `accent-text`，键盘焦点独立使用 `focus`。
- 文本输入、Textarea 与搜索框的焦点细线使用 `text-muted`，不外扩；校验失败时沿用 `error` 边界，禁用状态保持不可编辑。明暗主题都检查细线与实际输入表面的对比。
- `CardHeader tone="blue" | "apricot"` 只为卡头提供内容身份色，正文可保留中性 `Card`；缺少明确内容类别时使用默认 neutral，不按列位置上色。
- `Card tone="blue" | "apricot"` 和对应 Badge 表达内容身份；`variant="soft"`
  用轻染色底。两种 tone 都有 surface / soft / strong / text，明暗主题分别生成。
- 业务状态使用 neutral / info / success / warning / error，始终带文字；正常未执行使用 neutral。
- `Feedback` 默认 inline，跨行恢复动作使用 `variant="block"`；error 是 alert，
  其他消息是 status，empty 不主动播报。重复错误应在最接近问题的位置呈现一次。
  根节点为 div，支持恢复按钮、日志与 Disclosure；不要将 Feedback 放在段落内部。
- Native `feedback` 使用同一层级：状态图标、简短标题、说明、紧凑动作；原始日志
  放在可展开的技术详情。环境尚未准备、准备中、准备失败分别呈现，不把缺少环境当作执行失败。
- `Field` 通过 children 回调把 id、aria-describedby、aria-invalid 交给输入。
  页面负责校验、保留草稿和恢复动作；组件不增加业务状态机。
- 短列表 Select 默认最小 160px、搜索列表 260px，浮层受视口限制；字号选择用 `menuMinWidth={0}` 跟随触发器。设置菜单按内容测量，设置窗口默认 760px。
- `Progress` 只接收实际完成值与总量；没有依据时使用不确定进度，不能伪造百分比。
- Dialog 长标题和 footer 可换行；嵌套 Select 的第一次 Escape 关闭选择框，
  第二次关闭 Dialog，逐层返回焦点。Table 的命名滚动区域可以聚焦后用方向键滚动。

`Table` 支持数据驱动的 `rows` / `columns`，也支持保留来源结构的 children 形式：

```tsx
<Table label="观测记录" density="compact">
  <thead><tr><th scope="col">时间</th><th scope="col">数值</th></tr></thead>
  <tbody><tr><th scope="row">1</th><td>30</td></tr></tbody>
</Table>
```

两种形式共用命名、可聚焦的滚动区域与表格皮肤。children 形式默认自动列宽，
使用固定 colgroup 时可指定 `layout="fixed"`。消费者保留来源 caption、rowSpan、
colSpan、排序及选择状态，通过 `aria-sort` / `aria-selected` 表达；组件不拥有领域规则。
`className` 指向滚动容器，`tableClassName` 指向 table，避免迁移后 CSS 误指向容器。

`Disclosure` 默认 `variant="block"`；元数据、来源、诊断日志用 `variant="inline"`。
共享组件提供单一展开指示器和键盘焦点，调用方不叠加私有箭头。内容关闭时保持挂载。
`defaultOpen` 仅决定首次状态；自动展开/收起的面板使用 `open` 和 `onOpenChange`，
由现有状态所有者处理失败、配置或证据变化，并保留用户手动切换。

异步页面分别管理数据可用性、请求进度与领域结论。已有内容刷新时保留草稿、选中和焦点；
刷新失败说明正在显示旧数据并提供局部重试。取消请求的等待状态与确认取消分开显示。
切换对象才重置对象内选择，不能因同一对象轮询而重挂载整个编辑器。

LibraryHeader 的 `density="compact"` 取消目录页默认的 64px 最小高度，用共享 8px 垂直间距随内容高度排列，适合阅读页顶部。
标题保留完整内容并允许换行；窄窗或大字号下，动作区换到下一行，不能依赖标题省略来容纳操作。

`RadioGroupItem variant="card"` 将标题、说明和身份图标组合为可扫读的选择面，
仍由 RadioGroup 管理单选、方向键与表单值。选中标记保持可见，hover、选中、焦点
使用共享主题。选中标记参与组件自身布局，为长文本和大字号保留空间；调用方只排列卡片和内容，不覆盖内部标记或内容容器。不要在卡片中嵌套其他操作控件。

## 使用

```tsx
import { Sidebar, SidebarGroup, SidebarRow, WindowTitlebar, LibraryHeader } from '@pero/app-sdk/ui';

<WindowTitlebar leading={windowControls} tabs={contentTabs} actions={globalActions} />
<Sidebar label="主导航" collapsed={collapsed}>
  {newTaskButton}
  <SidebarGroup>
    <SidebarRow label="研究项目" lead={folderIcon} selected={page === 'projects'} onClick={openProjects} />
  </SidebarGroup>
</Sidebar>
<LibraryHeader title={project.title} actions={projectActions} />
```

`Sidebar` 不规定宽度；交给宿主的 Split。`WindowTitlebar` 不带标题属性；
`leading`、`tabs`、`actions` 是内容插槽。`LibraryHeader` 的副标题只有提供时才出现。

## 交互目录

目录导入上面的真实组件和 App SDK 控件，包含折叠侧栏、可调分栏、搜索空状态、
内容标签的固定 / 预览 / 未保存状态、关闭保护、长标题、Tab 键盘操作、
下拉菜单、Select、文件导入、字号 / 明暗切换、输入禁用和错误恢复。
“表单与反馈”包含真实 Field、Slider、Checkbox、Switch、RadioGroup、Table、
Card、Badge、Feedback、Progress 和嵌套选择框 Dialog。它不连接 Agent。

首次安装（仓库根目录的工具依赖也需已安装）：

```sh
npm install --prefix packages/app-sdk --workspaces=false --ignore-scripts --package-lock=false
npm install --prefix packages/pero-design --workspaces=false --ignore-scripts --package-lock=false
npm run dev:design
```

```sh
npm run gen:design
npm --prefix packages/pero-design run typecheck
npm --prefix packages/pero-design run build
npm --prefix packages/app-sdk run typecheck
node --test packages/pero-design/src/tokens.test.mjs
```

构建目录是 `target/design-catalog`。生成文件不手改；尺寸从 TypeSpec 修改后重新生成。

## 已迁移与后续边界

已迁移 Desktop 侧栏、窗口栏、两套内容标签容器、窗格操作 / 标签菜单触发器、
会话新建入口，以及共享标题、列表、设置组、搜索框的基础规则。原生窗口拖动、
标签拖放、MRU、关闭确认仍由原有 Workbench 状态机负责。

Scientific Viewer 使用 AppBar、FilePicker、DropdownMenu、Select、Tabs，PDF 工具复用
Button / Input / Textarea。Virtual Cell 使用多文件 FilePicker；Lab 使用 FilePicker 和
Select、Input、Textarea；Control Lab 使用共享选择器、输入、Slider、Card、Badge、
Feedback、Table、RadioGroup、Dialog 和 Progress。准备阶段把可调参数、模型条件、
验收条件和预算直接展示；有数据后展示曲线、核验与证据列表，原始证据独立查看。
所有内置 App 已重新构建。
Paper Agent 的 17 处普通选择框和 Automations 的日程选择使用共享 Select；
原来的禁用条件、历史选择、审阅重置和调度值仍由各 App 管理。
科学图形及原始证据流程保持领域实现。

Web 控件皮肤由 `components/ui-styles.ts` / `select-styles.mjs` 注入，`ui.css` 负责布局；
不再为 Button、Input、Tabs、Card、Field、Feedback、Checkbox 和文件控件维护竞争的静态皮肤。SDK 的静态和动态 token
入口都引入生成的 design contract，`npm run gen:design` 同时刷新两份入口；
`npm run check` 检查它们是否过期。

旧 SDK 的 `--pero-space-*` 是 2px 兼容间距，保留给尚未迁移的业务 CSS；新库用
`--pero-spacing-*`，避免过去两套同名 token 互相覆盖。旧字号别名映射到四档标准字阶，
不再产生低于 12px 的界面文字。新增页面不再使用兼容间距或在局部写控件皮肤。

GPUI 菜单继续使用 Kit 的语义、焦点与子菜单实现，以及 Pero 共享主题；通过现有
不可变补丁机制让菜单行高随字号增长，保留上游行为。历史 App 的领域布局与第三方科学编辑器不属于
已全部迁移的范围，不能把目录验收当成所有领域页面的完整验收。

后续修改某个页面时，先迁移到以上组件，再删除该页面重复的标题、边框、尺寸和
状态文案。科学图形、原文排版和领域执行流程不由通用壳组件改写。

验证范围与已知限制见 [VERIFICATION.md](VERIFICATION.md)。
