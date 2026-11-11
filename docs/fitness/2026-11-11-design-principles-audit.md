---
kind: verification_report
date: 2026-11-11
---

# Design 原则与 Apps / Native 实现审查

当前结论：初始审查的 **8 项确定缺口均已实现修复**，3 类风险的实现也已调整；
Paper 自动研究重新组织了新建、已保存计划、运行记录和证据的呈现。
真实 Native 已验证研究草稿切换保留、保存不启动 Agent、Notebook Insert 的 Escape 与焦点返回，
以及 Notebook / Paper 的24px界面字号与 Paper 深色主题。Reader / Diff 画面、Native故障注入、
VoiceOver、物理IME及全15-App深层状态仍未完整验收，因此不宣称产品设计全量通过。

下面第一阶段保留初始发现与证据，第二阶段记录修复后的实现和本轮验收。

## 第一阶段：初始审查

第一阶段结论：设计体系的维护源与共享实现已经建立，但当时 Apps 和 Native **尚未全部满足**。
发现 8 项确定缺口，以及 3 类需要继续运行验证的风险；该阶段没有修改产品代码。
共享基础设施与生成检查通过，不能替代草稿、异步状态、键盘与真实 Native 验收。
该阶段源码引用已固定到 `7607c741`，不将修复后移动的行号当作初始实现。

### 基线与覆盖

- 源码：`7607c741eb95414bdd921f29ddbe7a1087e3219e`，开始时工作区干净。
- 平台：macOS 27.2，GPUI Native 开发构建、Wry App WebView；Notebook 另用 Codex 内置浏览器。
- 本轮重建全部 15 个产品 App，并用 nightly-2026-10-28 重建 Native。
- Native 使用隔离 profile `/tmp/pero-design-audit-20261111-current` 与临时凭据存储；未运行 Agent 或科学实验。
- 源码盘点覆盖 [products/pero.json](../../products/pero.json) 的 15 个 App；深入检查 Notebook、Paper、Control Lab 与 Native 壳。
- 当前源码的运行观察覆盖：Notebook 编辑界面及 Insert 菜单、Paper 文库与自动研究草稿、Control Lab 准备界面、Native 导航/Tab/设置菜单和明暗主题。
- Native Notebook 正文受隔离 profile 的环境未准备阻塞，只观察了环境卡；浏览器 Notebook 是真实构建与 Rust Host、固定测试记录，不能替代 Native 正文验收。

本地证据目录（截图在本轮保存后重新打开检查，未纳入 Git）：
`/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/`。

发现本机 Paper bundle 落后源码后，先重建并重启隔离 Native，再记录 `07` 起的当前截图。
`04`–`06` 的旧 bundle 截图不作为当前实现证据；`10` 是中间加载态，不作为准备页面验收。
`01`–`02` 为重建前 Notebook 观察，最终判断使用重建后的 `14`–`15`。
`03` 为本轮已重建 Native 的聊天壳截图，App bundle 的旧版本不影响该壳观察。

### 原则的唯一维护源

| 内容 | 维护源 |
| --- | --- |
| 产品原则、气质、品牌与语义颜色 | [DESIGN.md](../../DESIGN.md) |
| 尺寸、字阶、圆角和共享几何 | [design.tsp](../../spec/pero-design/design.tsp) |
| 组件用途、两端 API 和交互契约 | [组件库](../../packages/pero-design/README.md) |
| 真实场景与证据要求 | [DESIGN-REVIEW.md](../../DESIGN-REVIEW.md) |
| 开发执行规则 | [AGENTS.md](../../AGENTS.md#ui) |

以下是既有规范的整理，不新增另一套设计标准。正式规范没有要求全青色、全无卡片或一律展开。
允许领域配色、插画、轻染表面和低频细节折叠；是否采用由当前任务与信息价值决定。

| 原则 | 可以验收的要求 | Apps 本轮结论 | Native 本轮结论 |
| --- | --- | --- | --- |
| 内容优先、层级清楚 | 当前对象、内容、下一步和状态清楚；删无价值重复 | Notebook / Control Lab 抽样符合 | 导航、Tab、内容职责可辨 |
| 按任务阶段呈现 | 准备看输入与条件，执行看进度，结果看产出与验证 | Control Lab 准备态符合；完整转换未覆盖 | 环境前置卡有原因与解决入口 |
| 渐进披露有理由 | 主路径直达，低频独立细节才折叠；阻塞直接显示 | 抽样可达；不据此推断全部折叠合理 | 未全面检查各 App 浮层 |
| 状态忠于事实 | 空、缺失、失败、未执行分别表达；检查分母保留 | Paper 首次失败混入成功空态（A3） | 全局 App 错误未隔离（N1） |
| 密度适合任务 | 阅读舒适；长标题、窄窗、大字号仍可操作 | Paper 固定字阶有缺口；Notebook 固定高度为待验风险 | Reader / Diff 大字号为待验风险，未确认裁切 |
| 专业、轻快、有温度 | 柔和表面与鲜明重点有层次，局部冷暖色合理 | Control Lab 明暗主题抽样符合 | 壳选中态与内容层次清楚 |
| 保留工作上下文 | 切换保留草稿/位置，失败保留输入，关闭视图不停止任务 | Paper 自动研究丢草稿（A1） | N1 会遮住仍可用 App；关闭/取消未全面覆盖 |
| 结果有依据 | 来源、缺失、冲突、未核验可见；执行与科学验证分开 | Notebook 有快照/检查/限制；结果分页受执行条件阻塞（A2） | 未运行科学结果验收 |
| 壳层职责清晰 | Titlebar 全局、Sidebar 导航、Tab 对象、AppBar 局部 | 抽样布局可辨；Paper 自动研究控件绕过 SDK（A5） | 导航与 Tab 清楚，设置菜单 Escape 关闭 |
| 色彩按语义使用 | 文字≥4.5:1，必要输入边界/焦点≥3:1；明暗分别检查 | 抽样可读；未逐页面测量对比 | Composer 错用装饰边界，未达规定目标（N3） |
| 图标稳定且可操作 | 已知 App 有领域图形；小尺寸可辨；图标按钮有名称 | 共享 registry 有 Notebook 漏映射（N2） | Sidebar / Tab 实拍回退网格（N2） |
| 公共组件与真实验收 | Apps 用 SDK、GPUI 用 pero_theme；改源再生成；分端验收 | 生成链通过，Notebook 菜单和 Paper 自动研究有缺口 | 真实 Native 已抽样；其余状态仍不能标全部通过 |

### 确定缺口与处理顺序

所有 P2 为当前可定位的产品问题；优先恢复工作上下文，再修状态隔离与读取，最后补齐共享交互。

#### A1 · P2 · Paper 自动研究切换视图丢失草稿

复现：自动研究 → 填研究问题 → 文库 → 自动研究。未保存的问题无提示清空。
真实 Native 截图 `08` 有输入，`09` 返回后为空；生产 React 组件重挂也复现。
[index.tsx:435](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/paper-agent/ui-src/index.tsx#L435) 条件卸载，
[research-programs.tsx:40](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/paper-agent/ui-src/research-programs.tsx#L40) 仅用组件局部 state 保存计划。
违反 DESIGN 的“切换视图保留草稿”。应让草稿由稳定所有者保留，并覆盖普通导航、关闭和保存失败的恢复。

#### A2 · P2 · 阅读已保存研究记录的分页依赖 Agent 条件

没有 Agent / workspace 时，打开已保存多轮计划后 Next 可点，但读取次数 `1 → 1`、页码仍为 `1 / 2`。
生产 React 组件重现通过；未在 Native 注入此数据。
[research-programs.tsx:59](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/paper-agent/ui-src/research-programs.tsx#L59) 将读取 effect 与执行条件绑定，
[同文件:142](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/paper-agent/ui-src/research-programs.tsx#L142) 分页按钮只改 offset。
应把只读分页与 Agent 执行准入分开，保留取消与执行原有所有权。

#### A3 · P2 · Paper 首次读取失败同时显示成功空态

生产组件让 list 请求失败后，页面同时出现 `list unavailable` alert 和首次使用引导。
[reload:45](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/paper-agent/ui-src/research-programs.tsx#L45) 失败后结束 loading，
[render:107](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/paper-agent/ui-src/research-programs.tsx#L107) 用“非 loading 且列表空”推导成功空态。
应独立表达数据是否已成功加载、当前请求和错误，并在失败区域给重试；已有列表刷新失败保留内容。

#### A4 · P2 · Notebook 自建菜单缺 Escape 退出契约

浏览器实测 Insert → Escape 后仍展开，焦点仍在 Insert，见 `14`。
[InsertMenu:44](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/notebook/ui-src/editor.tsx#L44) 只处理指针关闭，触发 Button 没有展开状态关联；
[NotebookMenu:247](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/notebook/ui-src/workspace-views.tsx#L247) 的 File / View / Help 也存在同类源码缺口。
后者没有逐一运行验收。相邻 FormatMenu 已有独立 Escape 处理，当前行为不一致。
应复用或扩展公共 Menu / Popover，覆盖指针与键盘打开、Escape、焦点返回、子菜单和浮层裁切。

#### A5 · P2 · Paper 自动研究重新建立私有普通控件与字阶

[research-programs.tsx:108](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/paper-agent/ui-src/research-programs.tsx#L108) 使用私有 button / input / textarea / select / details，
[research-programs.css:7](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/paper-agent/ui-src/research-programs.css#L7) 等固定 12 / 14 / 18px 字阶，输入边界使用装饰 border。
与 SDK 复用、输入边界及用户字号规则不一致。Native `08`–`09` 可见真实表单，但没有据此声称完成大字号验收。
应迁移到共享控件和语义字阶，保留计划限制、执行额度、准入和历史结果语义。

#### N1 · P2 · Native 全局 App 错误覆盖仍可用 App

这是源码确定的失败传播路径，尚未在真实窗口做故障注入。
[apps.rs:349](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/crates/pero-ui/src/apps.rs#L349) 将 `apps_error` 写入全局 `apps.error`；catalog 解析失败也写入相同字段。
[native_app_surface.rs:669](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/crates/pero-ui/src/native_app_surface.rs#L669) 把它合并成每个当前 App 的错误，
[同文件:723](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/crates/pero-ui/src/native_app_surface.rs#L723) 随后停止渲染保留的 WebView。
因此列表/其他 App 的失败会把正常 App 展示成“打开失败”。应按请求与对象隔离错误；同一 App 仍有效时保留内容和重试入口。

#### N2 · P2 · Notebook 缺少 App 图标映射

Native Sidebar 和 Tab 实拍均显示通用网格，见 `12`。
[catalog.json:70](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/packages/icons/catalog.json#L70) 已有 Notebook 图形，
[content.json:131](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/packages/icons/content.json#L131) 的 App 映射漏了 notebook；
只有 ipynb 文件映射。两处调用同一 `app_icon`，未知 App 回退 layout-grid。
应补共享内容 registry 后生成产物，再分别验证 Web / Native 实际小尺寸。

#### N3 · P2 · Native Composer 必要输入边界未达规范目标

[appearance.rs:52](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/crates/pero-theme/src/appearance.rs#L52) 的 compound editor 用装饰 `border`，
[composer.rs:475](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/crates/pero-chat-ui/src/composer.rs#L475) 关闭 Textarea 自身边界。
按 DESIGN 当前默认色计算，未聚焦边界与输入底色：浅色 `#C5D3E0 / #FFFFFF` 为 **1.53:1**，
深色 `#34485D / #121F2E` 为 **1.77:1**，低于 DESIGN 必要输入边界的 3:1 目标。
这是源码配对计算，并非仅从截图推断，也不等于整页 WCAG 判定。
应使用 `input-border`，并按文本输入焦点规则核对实际聚焦/错误组合。

### 尚未确认为画面缺陷的风险

| 风险 | 当前证据 | 继续验收的具体条件 |
| --- | --- | --- |
| Notebook 大字号控件高度 | [styles.css:68](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/notebook/ui-src/styles.css#L68)、[79](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/notebook/ui-src/styles.css#L79)、[95](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/apps/notebook/ui-src/styles.css#L95) 覆盖公共控件为 24 / 28px | UI 字号 24px、长标签、窄窗下检查裁字、点击范围与焦点；本轮未实拍裁切 |
| Native Reader / Diff 大字号 | [design.rs:294](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/crates/pero-theme/src/design.rs#L294) Reader 标题框固定32px；[changes_view.rs:412](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/crates/pero-chat-ui/src/changes_view.rs#L412)、502、673 有固定12/13px字和28px按钮 | Markdown 长标题与 Diff 在大字号下分别检查；本轮未打开真实 Diff / Reader 状态 |
| 分栏恢复默认不一致 | [view.rs:85](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/crates/pero-ui/src/view.rs#L85)、[workspace_view.rs:688](https://github.com/phodal/pero/blob/7607c741eb95414bdd921f29ddbe7a1087e3219e/crates/pero-ui/src/workspace_view.rs#L688) Sidebar / Chat 未找到恢复默认入口；Sessions 已支持双击 | 验证方向键、Home/End、恢复默认、重启与窄窗不覆盖保存宽度；属于验收缺口 |

未把 Native reduced-motion 报成缺陷：GPUI 动画框架读取系统 reduce-motion，Native 淡出也有检查。
仍需运行观察实际动态效果，不能把源码排除误报写成完整通过。

### 15-App 静态盘点

“复用”只说明当前共享控件接线，不是设计合规率。隐藏文件输入、打印表格、科学绘图命中区、文档缩略图不因 raw 标签或固定像素自动判错。

| App | 源码盘点 | 本轮运行/仍需验收 |
| --- | --- | --- |
| Insights | 普通控件使用 SDK | 首次失败、刷新保留、窄窗键盘未覆盖 |
| Data | SDK 与公共 Split | 大表滚动、排序选中、局部恢复未覆盖 |
| Notebook | 主体使用 SDK；自建菜单和局部高度覆盖 | 浏览器明暗与 Insert 已查；Native 正文受环境前置阻塞 |
| Virtual Cell | 普通控件使用 SDK，科学图形单独处理 | Native 热图水平访问与图形选择未覆盖 |
| Paper | Library / Reader 复用充分；自动研究有私有控件 | 文库与草稿切换已查；三项生产组件故障重现 |
| Control Lab | SDK、Split、独立请求状态与对象身份 | Native 准备界面明暗已查；运行/取消/结果转换未覆盖 |
| Lab | SDK 与公共 Split | Native Popover Escape、孔板选择未覆盖 |
| Compute | SDK 与公共 Split | 机器编辑草稿、失败恢复、执行前置未覆盖 |
| HPC | SDK 与公共 Split | 比较上限、部分验证与图形键盘未覆盖 |
| LCMS2Yield | 主控件复用；反应选择 raw button 与5个 raw details | 选择/焦点、上传失败、窄窗未覆盖 |
| Scientific Viewer | SDK 与 Split，序列定位命中区属专业交互 | feature 键盘、阅读字号、切换保留未覆盖 |
| Connectors | 本地 ui.tsx 转导出 SDK，间接复用有效 | 授权/拒绝/撤销、表单草稿、Native 焦点未覆盖 |
| Automations | SDK、Table 与 token 字阶 | 编辑草稿、首次失败、刷新与运行状态未覆盖 |
| Environments | SDK EnvironmentBrowser | 创建草稿、拒绝恢复、日志/绑定、Native 字号未覆盖 |
| Skills | SDK；详情标题仍固定24px | 详情大字号、安装/更新/取消和窄窗未覆盖 |

### 本轮截图步骤

| 步骤 | 操作和健康度 | 已检查的截图 |
| --- | --- | --- |
| 1 | Native 聊天与导航：层级可辨；Composer 边界见N3 | `03-native-chat.png` |
| 2 | 当前 Paper 文库：空态与添加入口清楚 | `07-current-native-paper-library.png` |
| 3 | Paper 自动研究填写草稿：可编辑；普通控件复用见A5 | `08-current-native-paper-draft.png` |
| 4 | 切文库再返回：失败，草稿清空 | `09-current-native-paper-draft-lost.png` |
| 5 | Control Lab 等待首次加载后：准备阶段聚焦模型、输入和判据，无空结果图常驻 | `11-current-native-control-lab-ready.png` |
| 6 | Native Notebook：正文阻塞于环境前置；原因和准备入口清楚，图标有缺口 | `12-native-notebook-environment-required.png` |
| 7 | Native 主题切深色：壳与 Control Lab 层次可辨 | `13-native-control-lab-dark.png` |
| 8 | 重建后浏览器 Notebook Insert → Escape：失败，菜单仍展开 | `14-current-notebook-insert-escape.png` |
| 9 | 浏览器 Notebook 深色：抽样可读，保留内容 | `15-current-notebook-dark.png` |
| 10 | Native 设置菜单 → Escape：通过关闭；仅此菜单，不能推及 App Popover | AX观察，无另存截图 |

![步骤1 Native 聊天与导航](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/03-native-chat.png)

![步骤2 当前 Paper 文库](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/07-current-native-paper-library.png)

![步骤3 当前 Paper 草稿](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/08-current-native-paper-draft.png)

![步骤4 切换后草稿丢失](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/09-current-native-paper-draft-lost.png)

![步骤5 Control Lab 准备界面](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/11-current-native-control-lab-ready.png)

![步骤6 Native Notebook 环境前置与图标](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/12-native-notebook-environment-required.png)

![步骤7 Control Lab 深色准备界面](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/13-native-control-lab-dark.png)

![步骤8 Insert 按 Escape 后仍展开](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/14-current-notebook-insert-escape.png)

![步骤9 Notebook 深色](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-audit/15-current-notebook-dark.png)

### 检查与证据边界

| 检查 | 本轮结果 |
| --- | --- |
| theme / design / App SDK token / icon 生成检查 | 全部通过；85图标、44 Kit assets |
| `node --test packages/pero-design/src/tokens.test.mjs` | 3/3通过；仅所列 token 配对与生成契约 |
| `npm run build:apps` | 15个产品 App 全部构建通过 |
| Native nightly debug build | 通过；使用本轮新构建运行 |
| 生产 ResearchPrograms React/jsdom 重现 | 3/3断言证明缺陷存在；不是修复后通过 |
| Native / 浏览器截图与交互 | 仅上表列出的实际状态 |

可复跑生产组件重现：证据目录下 `node reproduce-paper.mjs`，输出保存在 `paper-reproduction.jsonl`。
脚本引用当前 checkout 的生产组件和已有 UI test runtime，不调用真实 Agent / 服务。

本轮没有完成全15-App的状态转换、窄窗、大字号、物理IME、VoiceOver、reduced-motion运行观察、跨平台或签名安装包验收。
没有把构建成功、截图存在或历史“12 Apps 已检查”换算成当前全部通过。
既有 [canonical tracker](../issues/2026-11-06-design-system-runtime-gaps.md) 中的 Native Lab Popover / 热图缺口继续保留；本轮未重验，不作关闭。

## 第二阶段：修复交付与自动研究重设计

实现基于 `7607c741` 加本轮尚未提交的修复，使用重新构建的15个 App 和 Native。
第一阶段截图和缺陷描述只证明修复前的状态；当前实现与验收以下表为准。

### 原8项缺口的修复

| 原发现 | 旧实现 → 当前实现 | 保留的行为与验证边界 |
| --- | --- | --- |
| A1 研究草稿切换丢失 | 条件卸载 → [稳定挂载的研究工作区](../../apps/paper-agent/ui-src/index.tsx)，由 [研究界面状态](../../apps/paper-agent/ui-src/research-program-state.ts) 保留草稿 | 真实 Native 填写问题、范围、纳入/排除标准并选择起始论文，切文库再返回后均保留；这不代表未保存草稿跨进程恢复 |
| A2 已保存记录分页依赖Agent | 读取附着于执行准入 → 只读记录/分页与Agent启动条件分离 | 生产组件覆盖无Agent条件的历史阅读和分页；执行仍由原有准入与Host拥有 |
| A3 失败混入成功空态 | 用空数组推导空态 → 独立数据是否加载、请求进度和错误 | 首次失败给读取重试，不呈现成功空态；刷新失败保留已有列表；生产组件回归通过 |
| A4 Notebook菜单键盘缺口 | Insert / Format / File / View / Help私有details浮层 → [共享Popover组合](../../apps/notebook/ui-src/notebook-menu.tsx) | 显式使用 [keepMounted](../../packages/app-sdk/src/components/popover.tsx) 保留科学工具和Dialog状态；子组逐层退出，Dialog方向键不被外层菜单夺走；真实Native的Insert Escape关闭并返回焦点 |
| A5 自动研究私有控件与固定字阶 | 页面自建普通控件 → [SDK控件与按阶段组织的页面](../../apps/paper-agent/ui-src/research-programs.tsx)、[共享字阶布局](../../apps/paper-agent/ui-src/research-programs.css) | 保留起始论文、范围/筛选、获取策略、预算和停止条件；保存与启动继续为独立操作；Native24px及深色实拍可读，保存区可达 |
| N1 全局App错误遮住正常页面 | 全局错误直接作为页面打开失败 → [按App/Panel记录打开错误](../../crates/pero-ui/src/apps.rs)，[保留页面不受目录错误覆盖](../../crates/pero-ui/src/native_app_surface.rs) | Native事件保留失败请求身份，页面自身错误仍显示；领域行为测试通过，尚未做真实Native目录/其他App失败注入 |
| N2 Notebook图标漏映射 | 已有SVG但App映射缺项 → [共享内容registry登记Notebook](../../packages/icons/content.json) 并生成Rust/TS产物 | Sidebar与Tab继续走同一映射；生成检查通过，不新增另一套图标资源 |
| N3 Composer输入边界 | 装饰border / 品牌focus → [input_border / text_muted细线](../../crates/pero-theme/src/appearance.rs) | 使用当前明暗主题语义配对；不更改Composer输入与提交状态所有权，不据此宣称整页无障碍通过 |

### 自动研究的当前页面结构

- 新建计划聚焦研究问题、可检索的起始论文和研究范围，消除空历史栏占据正文的布局；缺论文时提供前往文库入口，返回后保留已填草稿。
- 纳入/排除标准、原文获取和执行预算按任务分组；条件与额度在保存、启动前可查，不把预算或停止条件隐藏成执行后的诊断。
- 已保存计划显示研究问题、状态、明确的启动/暂停等可用动作、运行记录与证据；领域状态不由展示文案推断。保存计划不会启动Agent。
- 列表、读取和能力查询各自反馈；同对象更新保留可用内容与编辑状态，失败贴近所属区域并提供重试。
- 执行查询未确认或失败时保留上次记录，禁止据此启动新执行；选择其他计划失败后，后台刷新不会擦掉错误，重试仍指向原失败计划。
- 所有普通输入、按钮、选择、反馈和披露复用SDK，布局随字号与窗口变化，主要操作仍有可达位置。保留来源、未核验边界与完整使用/检查范围。

### 原3类风险的调整

| 原风险 | 当前调整 | 尚未完成的实际验收 |
| --- | --- | --- |
| Notebook固定控件高度 | 工具栏、状态操作和相关表格控制从固定24/28px改为共享control-height；标题恢复可见中性焦点细线 | Native Notebook24px已观察；全部长标签、窄窗和所有科学工具未逐项覆盖 |
| Native Reader / Diff大字号 | [Reader标题框](../../crates/pero-theme/src/design.rs) 允许随控件和标题增长；[Diff](../../crates/pero-chat-ui/src/changes_view.rs) 使用共享Body/Caption与图标按钮尺寸 | 尚未打开真实Reader / Diff的大字号、长标题画面；只记实现调整，不记视觉通过 |
| Sidebar / Chat恢复默认 | [Sidebar](../../crates/pero-ui/src/view.rs)、[Chat分栏](../../crates/pero-ui/src/workspace_view.rs) 增加双击和Enter恢复默认；Sidebar同时支持Home/End | 真实Native侧栏拖动260→340后双击恢复260，260→300后Enter恢复260，AX确认；Chat、重启和窄窗偏好保留仍未实际验收 |

### 本轮Native截图与步骤

证据目录：
`/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/`。
以下截图由主审在真实Native窗口观察并检查。`05-native-saved-plan.png`是保存后的中间态，
不作为最终已保存计划页面证据；最终已保存计划使用`12`，最终响应布局使用`11`、`13`–`15`。
隔离profile中的论文均明确标注为界面验收样例，不作科学证据。

| 步骤 | 实际观察与结果 | 最终证据 |
| --- | --- | --- |
| 1 | 新建自动研究：问题、论文与范围有明确层级，主路径可达 | `01-native-new-research.png` |
| 2 | 填写四个研究字段并选择起始论文 | `03-native-draft-before-navigation.png` |
| 3 | 切文库再返回：四个字段与论文选择保留 | `04-native-draft-retained.png` |
| 4 | 真实保存并重新读取计划：显示“计划已保存，尚未启动”，范围、论文与全部额度可核对，未运行Agent | `12-native-saved-plan-final.png` |
| 5 | Notebook Insert指针打开后Escape：菜单关闭、焦点返回 | `06-native-notebook-escape-fixed.png` |
| 6 | Native Notebook界面字号24px：工具栏和正文可操作 | `07-native-notebook-ui24.png` |
| 7 | 自动研究界面字号24px：字段可读 | `08-native-research-ui24.png` |
| 8 | 滚到计划底部：24px字号下保存区与预算可达 | `09-native-research-ui24-footer.png` |
| 9 | 自动研究深色主题、24px字号：层次与阅读可辨 | `10-native-research-dark-ui24.png` |
| 10 | Native侧栏拖动后分别双击、Enter：均恢复260默认宽度 | AX观察；只接受侧栏当前窗口路径 |
| 11 | 最终默认字号：已有历史计划时问题/范围与起始论文并排，保存区同屏可达；明暗主题可读 | `11-native-research-final-dark.png`、`15-native-research-final-light.png` |
| 12 | 最终24px字号：改为纵向排列，滚动后预算和保存区完整可达 | `13-native-research-final-ui24.png`、`14-native-research-final-ui24-footer.png` |

![修复步骤1 新建自动研究](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/01-native-new-research.png)

![修复步骤2 已填写研究草稿](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/03-native-draft-before-navigation.png)

![修复步骤3 导航返回后草稿保留](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/04-native-draft-retained.png)

![修复步骤5 Native Notebook Escape关闭菜单](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/06-native-notebook-escape-fixed.png)

![修复步骤6 Native Notebook24px界面字号](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/07-native-notebook-ui24.png)

![修复步骤7 自动研究24px界面字号](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/08-native-research-ui24.png)

![修复步骤8 自动研究24px保存区可达](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/09-native-research-ui24-footer.png)

![修复步骤9 自动研究深色24px界面字号](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/10-native-research-dark-ui24.png)

![最终已保存计划核对](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/12-native-saved-plan-final.png)

![最终自动研究浅色界面](/Users/phodal/.codex/visualizations/2026/11/11/01a1c9b3-26cc-7133-9b92-adea8bc9e719/design-fixes/15-native-research-final-light.png)

### 修复阶段检查与剩余范围

| 检查 | 实际结果与边界 |
| --- | --- |
| Paper研究界面与状态测试 | 18/18通过；覆盖草稿、读取/分页、失败恢复与执行动作边界 |
| Notebook / SDK相关组合回归 | 20/20通过；覆盖五个入口的Escape/焦点、子组逐层关闭、科学工具保留挂载、Dialog按键与原有编辑行为 |
| Notebook / SDK typecheck | 通过 |
| Notebook source-extraction-ui | 使用已准备的 `/tmp/pero-control-canvas.to82UQ/bin/python`，单独重跑1/1通过 |
| Notebook快捷键基线 | Ctrl+Shift+S在 `research-print-tools.test.ts:77:65` 仍失败；以 `git show HEAD` 的原始测试和原始text-tools临时编译，复现同一断言。未修改该无关绑定或测试，不声称完整84项全绿 |
| 根 `npm run check` | 通过 |
| 15个产品App构建 | 通过 |
| Native构建与测试 | 构建通过；相关32项测试通过；真实Native故障注入尚未执行 |
| 运行验收 | 仅上表列明的真实Native状态，不推广到未操作的App、菜单和领域流程 |

此阶段没有执行新的真实Agent研究或科学实验，也没有验证科学结论。
Reader / Diff实际大字号画面、Native目录/其他App失败注入、VoiceOver、物理IME、全15-App状态转换、
跨平台和签名安装包仍未完整覆盖。历史Lab Popover / Virtual Cell热图的独立缺口也未由Notebook菜单通过自动关闭。
canonical设计问题记录保持 `in_progress`；这次8项代码修复完成不等于整套产品设计验收完成。

### 提交前同步验证

提交前同步了远端 `cc1be321`，将本轮改动按9个主题提交重放到最新master。
Notebook编辑器的唯一冲突同时保留远端的未知文档保护、dirty状态、MyST/IPYNB插入与保留内容导出，以及本轮共享菜单。
同步后根检查、Paper回归18/18、Notebook/SDK原组合20/20、文档保护与MyST/IPYNB回归15/15均通过；
Notebook typecheck与产品bundle构建通过。Native代码无远端重叠修改，沿用本轮已完成的构建、32项测试与实拍记录。
真实Native截图来自同步前的隔离构建，不代表远端新增MyST/IPYNB功能的Native验收。
