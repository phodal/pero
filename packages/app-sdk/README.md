# Pero App SDK

App 界面、Agent 对象与宿主交互的公共契约。App 使用自己的 React，运行时和
权限由 Pero Host 提供。初始化上下文只含公开身份、权限和展示状态；后端 token
和 Host 凭据留在宿主。
源码许可与上游署名见 [NOTICE](NOTICE.md)。

## 模块

| 入口 | 功能 |
| --- | --- |
| `@pero/app-sdk` | Provider、App 信息、API、事件、国际化、Agent、会话与宿主挂载槽 |
| `/ui` | 控件、表格、树、菜单、弹层、Markdown、结果视图、CodeMirror、布局 |
| `/chart` | 声明式 SVG 图表、交互式时间序列、配色与线型 |
| `/core` | 权限作用域 API、事件 hub、消息标记解析 |
| `/surface` | 对象注册、快照、修订号、参数校验、mention 搜索 |
| `/client` | 当前 App 文档的模块注册与单一 React 实例 |
| `/tokens.css`、`/tokens-css` | 静态样式或运行时样式安装 |
| `/themes` | 明暗、高对比度主题及密度样式的选择和订阅 |
| `/fonts.css` | 可选字体；默认沿用宿主字体 |

内置 App 构建器从 package exports 解析全部子路径。每个 App 的 SDK 与界面
使用同一个 App 自有 React；不同 App 与 Workbench 不共享 React。

## UI 功能

- 表单：Button、IconButton、Input、Textarea、FilePicker、Field、Select、
  MultiSelect、Checkbox（含 indeterminate）、RadioGroup、Switch、ToggleGroup、TimeField。
- 导航与数据：Tabs、FileTree、TreeView、Table、SuggestionList、Stepper。
- 弹层：DropdownMenu、ContextMenu、Popover、Dialog、Tooltip、InfoTip。
  Portal 使用触发器所属文档，并保留原生 dialog 的顶层与焦点语义。
- 内容与状态：Card、Disclosure、EmptyState、Feedback、Progress、Skeleton、
  MarkdownText、ResultView。结构化结果校验行数、数值、引用与 provenance。
- 布局：AppFrame、AppBar、PageHeader、Toolbar、Split、SplitPane、SplitPaneHandle，
  以及 Pero 的列表、阅读、搜索和 Composer 组件。

两个或更多并排面板使用 `Split` / `SplitPane`；一个 pane 不指定 size，其余 pane
给出 size 和 min。storageKey 保存在 App 自己的存储中；窄窗口通过 collapseBelow 堆叠。

## 组件分层

`/ui` 是自有样式的控件库。不另开包，也不使用 Tailwind、`cva` 或 `cn()`。颜色、
字号和行高来自仓库的色彩规范和 `spec/pero-design/design.tsp`。样式使用
`--pero-*` 与 `data-variant`，由 `ensureUiStyles` 写入 App 自己的 document。

行为原语只在状态机难写、且已经有真实用法时引入：

- Radix：Checkbox、Switch、RadioGroup、Tabs、ToggleGroup、DropdownMenu、
  ContextMenu，以及 Button、Toolbar、Card 的 `Slot`。键盘和 ARIA 归原语，外观归 SDK。
- React Aria：TreeView、FileTree、TimeField。
- 自有实现：Dialog 使用原生 `<dialog>`，保留顶层、焦点归还和表单提交。Select
  是带搜索、分组、缩进、footer 和原生 `name` 的受控列表。Popover 把主题变量拷进
  portal 所在 document。这三项不迁到 Radix。

复合组件只在组合本身是 API 时使用：`Tabs.*`、`DropdownMenu.*`、`ContextMenu.*`。
单一交互使用封闭 props：`Button`、`Select`、`Dialog`。主操作和次操作是 `Button`
的 `primary` 与 `ghost`。空状态只有 `EmptyState`，包含 heading、description 和 actions。

控件在 `packages/app-sdk/src/components`，一个概念一个文件。工作台 chrome 在
`packages/pero-design`，由 `/ui` 再导出：SidebarRow、ListRow、LibraryHeader、
ReaderFrame、SearchField、SettingsGroup、SettingsRow、Badge、Composer。
`PageHeader` / `AppBar` 是 App 内的紧凑行；`LibraryHeader` 是栏目标题、副标题和
尾部操作。两者密度不同，不合并。

这套控件就是 App 的设计系统。14px 界面下，按钮、输入和选择器高 24px，标签高 30px，
圆角使用 `--pero-radius-xs`，主操作使用 `--pero-action`。App 使用这些控件，不再为
同一控件另写高度、圆角或主色。领域布局、阅读排版和科学图形留在各自的 App。

PDF、TeX、发现、证据和研究包仍是领域画面。不按目录补 ScrollArea、Sheet、Command、
Calendar、Sonner、NavigationMenu、Slider。宿主通知、`Split`、`Disclosure` 和
`Feedback` 已经覆盖对应任务。

## 代码、高亮与差异

`CodeViewer` 是只读源码视图：行号、搜索、折叠、定位、选中行、语法高亮和
`lineMarks` 行装饰。支持 COBOL、Java、SQL、JCL、JSON、JavaScript/TypeScript、
JSX/TSX、CSS、HTML 和纯文本。`startLine` 用于绝对行号；`documentId` 变化会
清理旧文档的定位状态。`ranges` 表达可折叠区段；`lineMarks` 传入行范围和 CSS 类。

```tsx
<CodeViewer label="源码" text={source} language="cobol" documentId={digest}
  line={diagnostic.line}
  ranges={[{startLine: 20, endLine: 34}]}
  lineMarks={[{startLine: 27, endLine: 27, className: 'diagnostic'}]}/>
```

`CodeCompare` 支持原生文本 diff、映射区块、同步滚动、定位和评审评论。
`CodeEditor` 用于受控 Mermaid 草稿，支持撤销/重做、缩进和禁用状态。
`CommandLine` 只读显示带高亮的命令。SDK 没有 LSP、代码执行或任意字符区间的
持久批注功能。

## 图表

`DocumentChart` 接受 schemaVersion 1 的文档，绘制 bar、horizontalBar、line、area、
histogram。未知字段、无效输入与不支持的图表族会显示错误状态；保留原始顺序和
null，不自动补零。输入最多 2 MiB / 2000 行，浏览器以 UTF-8 字节计量。

`TimeSeriesLanes` / `LaneChart` 使用 uPlot，支持多 lane、baseline、同步光标、样本
选择、区间选择、事件标记、区间装饰、明暗主题切换、resize 与 dispose。null 是断线。
`seriesStyle` 同时提供颜色与 dash，图表不只依靠颜色区分系列。

## Provider 与宿主

通常使用 `<AppProvider>`。它从 App 专用协议读取公开身份与权限，并接收宿主的
语言、外观、可见性消息。自定义宿主使用 `<AppSdkProvider host={host}>` 或
`<AppApiProvider ...>`，提供 `AppHost` 契约中的回调。Provider 更新展示状态时保留
API、事件和能力接口；权限、会话或 Host 变化会替换相应接口。

- `useAppApi`：request/get/post/put/patch/del；readFile 只读取本 App 的显式 input grant。
  请求受声明路径限制；宿主固定的身份 header 优先于调用方的 header。
- `useAppEvents`：精确事件或 `namespace:*` 声明；回调保持最新并在卸载时释放。
- `useAppI18n`：zh/en 字典与变量插值。`createAppExamples` / `useAppExamples`
  提供默认示例、显式重试、取消、摘要校验与导入适配器；示例 schema 是
  `pero.app.example.v1`。
- `useNavigate` / `useNotify` / `useNavBadge`：宿主导航、通知与 App 计数。
  Workbench 导航支持 `/projects`、`/tasks` 等页面和 `/apps/<name>/<panel>`。
  独立 App 产品按自己的导航范围提供这些回调。
- `useHostCapability(name)` 只返回已声明、可由宿主提供的能力；否则返回 null。
- `AppConversation`、`AppSessionConversation`、`AppProjectRunConversation`、
  `AppDesktop` 是 Host 所有界面的挂载槽。没有相应挂载能力时显示 fallback。
  Project Run 选择由宿主返回，SDK 不制造 Project 归属或执行权限。
- `AppTitlebar` 使用宿主提供的 Portal；没有 slot 时原位显示。

默认 Pero Host 目前提供 App 草稿会话，以及 Electron 的通用 conversation 槽；
原生界面暂未提供内嵌 conversation 槽。绑定特定 Session、Project Run、Desktop
的挂载接口由自定义 Host 回调实现，默认 Host 会显示 fallback。默认聊天桥接只支持
message、mode、attachments、capture 和 approveGoal；指定目标会话、自动提交、
placement、reveal、fresh 与 plugins 需要宿主实现相应的 launchChat 回调。
这些是宿主能力边界；公共 SDK 类型和 Provider 会保留并转交完整调用参数。

## Agent 与对象

`useAppAgent` 提供 prepare、start、lookup、status、events、cancel、retry、terminal。
Host 保留会话、工具、审批、凭据和 Run 归属；SDK 不运行模型。原有 Pero
info/refresh 与 prompt/agentId/sessionId 调用继续可用。

本地 Host 的 Run 使用 workspaceId。requestId 固定一次输入，重复 start 不重复执行；
lookup 用于丢失响应后的查询，retry 使用新的 requestId。terminal 只读列出该 Run
实际借用的终端；未借用终端时列表为空，不能通过此接口创建终端或发送输入。

需要 prepare 的 App 在 agentPlugin 中声明 prepareTool（引用已有 write 名称）和
contextSchema。prepareTool 不加入 Agent tools allowlist。Host 校验输入，调用 App
固定的准备路由，校验最多 16 KiB 的返回 context；start 再依据当前声明接纳外部传入的
context，并将它冻结到 Run。普通交互式 App 不需要声明准备方法。

`useAppObject` / `createAppSurface` 共用一个对象模型：声明状态、动作、summary 和
只读 mentions。相等状态保留修订号，动作总是使用最新闭包。mention 搜索支持取消，
旧修订的异步结果不会进入当前快照。surface 本身不授予执行权限；Host 决定动作许可。

## 验证

```sh
npm run typecheck --workspace @pero/app-sdk
npm test --workspace @pero/app-sdk
node scripts/build/app-sdk-tokens.mjs --check
node --test scripts/build/apps.test.mjs
node tests/e2e/app-sdk.mjs
node tests/contracts/app-agent-runs.mjs
```

公共导出清单位于 `test/contracts/public-exports.json`，行为测试使用实际组件和
Provider。浏览器测试验证选择器搜索、dialog 内 Portal、焦点与 Escape、菜单、
代码视图、SVG/uPlot、暗色与窄窗口；截图输出到 `test-results/app-sdk/`。
这些截图是独立 SDK fixture；Host 生命周期、Desktop HTTP 传输、准备上下文、API
权限和二进制 input grant 由契约另行验证，不等同于安装包验收。
