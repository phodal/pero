---
kind: verification_report
date: 2026-11-06
---

# Pero Native 字体、体验与设计系统复查

本轮已修复 Native 菜单导致 App 消失、Automations 未使用共享控件、
部分界面文字不跟随字号，以及 Lab 孔板大字号数字裁切等问题。
实际启动了 macOS Native，查看了产品清单中的 12 个 App；覆盖深浅主题、
14/18/24px 字号、窄窗、菜单与草稿保留。这里的“查看”只代表下表列出的状态，
不代表每个 App 的全部执行、失败恢复和辅助技术流程均通过验收。

## 版本与证据范围

- 初始源码为 `62d00480`；本轮优化基于 `1766b667` 加本报告记录的 UI 改动。
- 本轮 UI 提交：Native `1d03d691`、共享标题 `463b00bf`、Automations `003cf529`、
  Paper `495cdeaa`、Viewer `b8fe8997`、Lab `dca9222e`、Virtual Cell `fb6eec7d`、
  Connectors/Environments `919d33c9`，均提交到本地 master。
- 产品范围由 `products/pero.json` 定义，共 12 个内置 App；未纳入未发布的 COBOL App。
- 平台为 macOS，真实 Native GPUI 窗口和内嵌 Web App；浏览器补充使用 Chromium 本地 fixture。
- Native 菜单修复已在本轮早期构建并运行；后续 App CSS 重新构建并在 Native 中复查。
  工作区同时存在 GPUI 0.9 升级、执行环境重构等独立改动；本报告不为那些改动提供验收。
- Native 常规窗口为 1440 × 859 逻辑像素，另检查约 1000px 窄窗。
  浏览器补充检查 420 × 850 和 1180 × 850。
- 截图、AX 文本及构建日志保存在 `test-results/ux-review-2026-11-06/`，
  是本地忽略文件，没有将二进制截图提交到仓库。
- 最初屏幕锁定曾中断检查两次；之后完成的观察才计入结果。

## 已完成的优化

| 问题与影响 | 改动 | 验证结论 |
| --- | --- | --- |
| 打开设置菜单或标签切换器时，整个 App 被隐藏 | 将两种菜单归入已有的 composited popup 覆盖规则 | 实际 Native 中菜单与 App 同时可见；保留真正对话框的遮挡规则 |
| Automations 使用页面私有按钮、输入框、表格和空态 | 迁移至 SDK Button、Input、Textarea、Checkbox、Table、LibraryHeader、Feedback、EmptyState | 真实入口构建成功；Native 空态和浏览器编辑保存已检查 |
| 窄窗大字号时页面标题被省略 | LibraryHeader 标题换行，动作区自动换行 | 420px、深色、24px 下完整显示 Automations 与主操作 |
| Automations 保存按钮与说明挤在一起，详情规则溢出 | 保存动作独立成行；详情长字符串允许换行 | 最终编辑器与 RRULE 详情截图确认 |
| EnvironmentBrowser 异常页使用裸按钮 | 复用 LibraryHeader、Feedback、Button | 构建与类型检查通过；异常路径未注入，视觉未验收 |
| Paper/Viewer/Virtual Cell 等仍有固定字号界面文字 | 按用途使用 body、caption、heading、code token，控件高度随内容增长 | 相关 App 均构建；真实页面覆盖见下表，深层状态不推定通过 |
| Lab 24px 下孔板里的 200 被挤压 | 孔板宽度随 caption 增长，移除紧凑预览的 520px 上限；轴宽与行高缩放 | 最终 Native 深色24px 中两个 200 完整显示，96 孔布局保持 |
| Virtual Cell 长细胞群名称在条形统计中被省略 | 名称独占一行，数值与条形放下一行，侧栏随字号适度增长；禁止统计行纵向压缩 | Native 已看过名称布局；最终不压缩修复在浏览器真实入口确认，科学数值、身份和分母不变 |
| Connectors 重写共享 hover 语义 | 使用公共 hover token，标题/首字母使用字体 token | 实际 Native 目录可读，主题生成检查通过 |

源码迁移没有把科学图形、论文原文和缩略文档的全部字号机械替换。
保留原文阅读尺寸和缩略图的比例；界面标题、工具栏、元数据、源码视图分别使用对应 token。
调度、权限、执行状态和科学数据模型继续由原有领域实现负责。

## 12 个 App 的实际覆盖

| App | 实际观察 | 本轮修改 | 未覆盖范围 |
| --- | --- | --- | --- |
| Insights | Native 深色24px 空态 | 无额外修改 | 有内容报告、生成与失败恢复 |
| Data | Native 深色24px 空态 | 无额外修改 | 导入、图表交互和大数据表 |
| Virtual Cell | Native PBMC3k 图谱、群组、基因、属性与统计 | 界面字体、侧栏、条形标签 | 全部模型/体积/比较流程；热图长轴标签仍需改进 |
| Paper Agent | Native 深色24px 文库空态 | 阅读控件、来源与研究元数据、代码字体 | 最终 CSS 下的真实长论文、TeX、研究导入和批注 |
| Control Lab | Native 深色24px PID 准备界面 | 无额外修改 | 真实运行、结果与取消 |
| Lab | Native 浅色14px、深色24px、窄窗；最终孔板复查 | 行高、图标按钮、源码字体和孔板缩放 | 最终孔板版本的窄窗双向滚动、实验执行与失败恢复 |
| Compute | Native 深色24px 未连接状态 | 无额外修改 | 真实节点连接和作业 |
| HPC | Native 深色24px 真实目录及 Pi 方法 | 无额外修改 | 真实 benchmark 与远程执行 |
| Scientific Viewer | Native 默认分子视图，菜单覆盖修复 | 工具栏、文件列表、元数据与代码字体 | 最终 CSS 下每种导入格式、文件浏览器与 PDF 状态 |
| Connectors / 自定义 | Native 深色24px 真实连接器目录 | 标题字体与 hover 语义 | 授权、配置保存和外部连接 |
| Automations | Native 深色24px 空态；浏览器真实构建入口的列表、编辑、保存 | 公共控件与响应式布局迁移 | Native 有记录编辑、真实 Host 调度、真实 Agent 执行 |
| Environments | Native 深色24px 空态 | 异常页共享控件 | 异常页、创建/准备环境；并行环境重构不在此验收范围 |

另查看了 Native 应用商店、设置窗口、侧栏折叠、标签菜单、App 内聊天空态。
混合中英文未发送草稿在切换视图后保留；没有触发真实聊天或科学执行。

## 字体与视觉判断

系统字体的中文、英文和数字在已观察界面中清楚，未发现普遍的缺字或字形异常。
主要问题来自固定字号、固定高度与容器宽度，而非字体文件本身。
14px 常规密度适合桌面操作；24px 放大后，表单、导航和公共按钮跟随设置，
长内容更依赖换行与局部滚动，本轮修复了直接影响阅读的几处限制。

明暗主题中的表面、正文与次要文字层次可辨；青色主操作和选中态易于识别。
Virtual Cell 使用不同群组色并保留名称与数量，避免仅靠颜色识别。
这些是实际截图的视觉判断，没有完成逐个 token 的对比度测量或 WCAG 审计。

首批检查还发现中文工作台中部分 App 保持英文界面，以及 Virtual Cell 热图长群组
名称裁切。热图随后完成独立优化，浏览器复查见下文；Native 尚待复查。24px 时
工作台标签更容易省略，应通过切换标签菜单查完整名称。

## 行为与检查结果

| 检查 | 结果与边界 |
| --- | --- |
| Native UI 库测试 | 本轮早期构建 64/64；不是对并行 GPUI 升级的最终验证 |
| App SDK 单元测试 | 159/159，类型检查通过 |
| App SDK token 检查 | 3/3，生成文件未手改 |
| Automations 类型检查与测试 | 5/5；调度规则与导航边界不变 |
| Lab 类型检查与 UI 测试 | 10/10；协议、体积、元数据与批准规则保持 |
| Virtual Cell 类型检查与 UI 测试 | 7/7；身份、表达顺序、分母与质量守恒规则保持 |
| Environments、组件目录 | 类型检查通过；组件目录构建通过 |
| 全部 12 个 App | 构建成功；最终 Lab/Automations/Virtual Cell 样式分别补构建 |
| 根目录 `npm run check` | 通过：TypeScript、主题/设计/token/协议生成检查、984 条双语消息、85 个图标 |
| 浏览器 Automations 交互 | 输入中文/英文；选择 Weekly；保存为 Paused；重新编辑内容保持；详情 RRULE 换行 |
| Native 菜单和草稿 | 设置/标签菜单下 App 保持显示；草稿在切换后保留 |

Automations 浏览器服务明确为本地 mock fixture；保存记录没有写入真实调度器，
也没有启动 Agent。页面包含旧调度不可用提示，Run now 按状态禁用。
Select 点击选择通过；本轮工具发送 Escape 超时，未将此记为键盘通过，也不足以判定产品缺陷。
Virtual Cell 最后的浏览器补充直接使用生产 dist 与自带 PBMC3k 观测数据，
仅注入深色24px App context，没有提供工作流后端，所以顶部出现预期的 API 404；
此处只验证静态图谱与布局。8 个统计按钮高度均为约77px、flex-shrink 为0，
不再将两行内容挤入一行。这个补充不能替代 Native 最终复验。
最后重启 Native 后曾显示未连接，随后 Mac 再次锁屏，未完成最终统计行的
Native 复验及本次临时字号的恢复；不据此推断断连根因或宣称最终 Native 全通过。
初次 shell 检查因 PATH 缺少 cargo/rustfmt 失败，加入本机 toolchain 路径重跑后通过。
构建保留已有 reader Wasm glue 的 direct eval 警告，不影响本轮构建成功。

物理中文 IME、VoiceOver、完整键盘路径、减少动态效果、网络故障恢复、
签名安装包、其他操作系统，以及所有 App 在两种主题/三种字号下的全状态矩阵尚未验证。
因此本轮可以确认上述优化交付，不能宣布“全套设计系统已完成全部产品验收”。

## 关键截图索引

| 证据 | 本地路径 |
| --- | --- |
| 原始菜单隐藏 App | [02-settings-menu-hides-app.png](../../test-results/ux-review-2026-11-06/02-settings-menu-hides-app.png) |
| 设置菜单修复 | [09-native-menu-fixed.png](../../test-results/ux-review-2026-11-06/09-native-menu-fixed.png) |
| 标签菜单修复 / Viewer | [10-native-tab-switcher.png](../../test-results/ux-review-2026-11-06/10-native-tab-switcher.png) |
| Native 约1000px窄窗 | [24-native-narrow-dark-24.png](../../test-results/ux-review-2026-11-06/24-native-narrow-dark-24.png) |
| 聊天草稿保留 | [26-native-chat-draft-retained.png](../../test-results/ux-review-2026-11-06/26-native-chat-draft-retained.png) |
| Automations 420px/深色24px | [33-automations420-dark24-final.png](../../test-results/ux-review-2026-11-06/33-automations420-dark24-final.png) |
| Lab 最终深色24px孔板 | [36-lab-dark24-final.png](../../test-results/ux-review-2026-11-06/36-lab-dark24-final.png) |
| Automations 最终详情换行 | [38-automations-details-final.png](../../test-results/ux-review-2026-11-06/38-automations-details-final.png) |
| Automations 最终编辑器 | [39-automations-editor-final.png](../../test-results/ux-review-2026-11-06/39-automations-editor-final.png) |
| Virtual Cell 最终浏览器布局补充 | [41-virtual-cell-browser24-final.png](../../test-results/ux-review-2026-11-06/41-virtual-cell-browser24-final.png) |

本报告为验证记录；后续待验收范围继续使用
[同一个问题记录](../issues/2026-11-06-design-system-runtime-gaps.md)，不另建重复 tracker。


## 第二批优化与补充验证

首批之后继续审查真实入口的普通控件，提交 `4d539cd8` 完成以下迁移：

| 消费者 | 修改 | 保留的行为 |
| --- | --- | --- |
| HPC 结果表 | 原生 checkbox → SDK Checkbox | 只允许已完成且无操作中的运行参加比较；最多八项；已选项仍能取消 |
| Paper PDF 页码 | 原生 number input → SDK Input；宽度随字符尺寸增长 | 页码范围、上下页、滚动导航保持；移除固定 34/38/44px 宽度和私有皮肤 |
| Paper 复现参数 | 只读策略字段 → SDK Input | 策略仍为只读，不改变冻结和执行条件 |
| Insights / Virtual Cell | 异常页 → LibraryHeader、Feedback、Button | 错误使用 alert 语义，保留明确的重新加载动作 |

HPC 原测试使用“行内第一个 button”定位查看操作，迁移 Checkbox 后暴露了位置假设。
现改为按 `Inspect: old-run` 的操作名称定位；原有历史规格与执行/验证状态断言通过。
Insights 的旧 recap CSS 仅由旧回顾模块引入，当前首页只导入其中的类型；当前入口
实际使用 `pulse-home-result.css` 的 Pero token，未据旧文件的 grep 结果改动首页样式。

Virtual Cell 的补充优化包括：

- 体积控制改用 SDK Slider，移除页面私有滑块颜色与焦点皮肤；数值范围、步长与切片映射保持。
- 热图按实际 SVG 文字宽度计算左边距；最小行高避免文字重叠，底部为旋转列标签预留空间。
- 画布最小尺寸随 caption 字号增长；空间不足时在热图内部横向滚动，保留清晰文字与完整矩阵。
- 超长行列标识按 20 字符显示省略，完整标识保留在 title；原始数据、颜色比例、选择 ID 和导出不变。
- 滚动区域可键盘聚焦，并有命名和焦点轮廓；未扩展原有科学单元格的键盘选择功能。

补充运行使用实际 `apps/virtual-cell/dist` 页面和本地 Host context 外壳，深色24px，
默认1280×720及420×850。PBMC3k 数据来自 App 内置样例；体积图明确显示“教学示例 ·
非实验结果”。外壳没有运行后端，因此页面顶部 API 404 属于 fixture 的已知限制，
不能据此证明真实 API 或执行流程通过。

实际观察：长群组名 `FCGR3A+ Monocytes` 在图内完整显示；窄窗页面宽度与 scrollWidth
均为420px，整页没有水平溢出。热图内部宽386px、画布约730px；方向键使 scrollLeft
从0增长，证明隐藏列可通过局部滚动访问。体积滑块的方向右键使表面不透明度从
0.55变为0.56，AX 也报告了同一数值。浏览器临时窗口尺寸已复原。

证据位于同一忽略目录：

- `42-heatmap-dark24.png`：最终默认窗口的热图。
- `43-volume-slider-dark24.png`：共享滑块和0.56读数。
- `44-heatmap-narrow-dark24.png`：最终420px窄窗长标签与局部滚动布局。

补充检查：HPC 类型检查与UI测试1/1、Paper类型检查、Insights类型检查与测试6/6、
Virtual Cell类型检查与测试7/7通过；四个受影响App入口构建通过，复用了已有的
`web/dist-reader`产物。根目录 `npm run check` 通过，包含984条双语消息和85个共享图标。
没有重新构建或验收Native二进制，也没有新增或修改生成的设计token。

补充Native检查仍被macOS锁屏挡住。此批错误边界没有注入真实运行异常；Paper真实PDF
页码、复现参数和HPC真实结果表的最终视觉状态仍待验收。第二批浏览器证据不替代这些
Native验收，也不等于完整设计系统的全部状态、主题和辅助技术流程已经通过。


## 第三批：Data 与 Paper 检索动作

Data 的排序表头和已保存图表入口改为 SDK Button；Paper Discover 的链接添加、
重试、标题展开、已保存入口和添加论文操作改为共享 Button。删除相应私有皮肤；
标题使用正文档字号，窄窗结果正文占满一行，操作在下一行显示。

Data 使用隔离临时数据目录中的真实 Python 后端，导入三条观测并保存图表。
两次点击 value 表头分别得到10/20/30和30/20/10，已保存图表可打开真实折线与来源。
Paper 使用实际生产 bundle 和本地模拟检索 API：中英文混合查询、详情展开、503后
保留查询与结果、局部重试恢复、添加后变为“已在文库”均已观察。未调用外部文献
服务或下载真实论文。最终浅色14px和深色24px、420px窄窗已截图；窄窗标题完整换行。

Native 此后已解锁：深色24px的最终 Virtual Cell 统计行和完整热图长标签已在
真实 App 中确认，取代前文“最终布局仅浏览器可见”的历史限制。热图获得焦点，
但本轮 Native 方向键/水平滚轮未观察到横向移动，不能记为 Native 横向访问通过。
浏览器已证明局部滚动，不据此推断 WebKit 内的相同行为。

Data 类型检查、UI测试8/8，Paper类型检查、UI测试7/7，两个App构建及根目录
check通过（984条双语消息、85个图标）。证据继续保存在忽略目录，不提交二进制：

- `45-data-sort-dark24.png`：真实后端排序。
- `46-paper-retained-search-dark24.png`：503时保留检索内容（标题布局调整前）。
- `47-paper-saved-dark24.png`：添加状态完成（标题布局调整前）。
- `48-data-light14.png`、`49-paper-light14.png`：最终默认字号。
- `50-paper-narrow-dark24.png`：最终窄窗正文布局。
- `51-native-heatmap-dark24.png`：Native最终统计行与长标签。

其余标准组件迁移继续使用同一个 tracker；以上不代表全套状态矩阵完成。


## 最终批次：标准组件全面迁移

在前三批基础上，本轮继续覆盖产品清单内 12 个 App 的普通控件。迁移清单及保留行为
记录在同一个问题 tracker，避免把组件替换与领域规则重写混在一起。

| 范围 | 最终实现与保留行为 |
| --- | --- |
| Paper 阅读与文库 | 目录、引用、证据单元格、文库预览使用 Button，保留阅读定位、草稿、引用身份及双击阅读 |
| 科学选择 | Lab 孔位、Viewer 分子、Control Lab 检查使用 ghost Button；Viewer 文件选项使用 unstyled Button 基础，保留 listbox、方向焦点、缩略图与双击语义 |
| 表格 | SDK 增加 children 形式，Data、HPC、Lab、Viewer、Paper 使用统一的表格皮肤和命名滚动区；保留排序、原始行号、选择、行列合并、来源 caption 和精确数值 |
| 进度 | Paper 研究下载、Cell 数据集下载和验证使用 Progress；无总量时保持不确定进度 |
| 反馈 | Connectors 复用 Feedback 和 link Button；Feedback 根节点由 p 改为 div，保证嵌套日志和恢复按钮实际保留在 alert 内 |
| 详情 | 89 处原生 details 迁移为 88 处 Disclosure 和 1 处 Lab 说明 Popover；共享 inline 变体取代重复箭头、焦点和 summary 皮肤 |
| 自动展开 | 安装失败日志、飞书配置、Paper 复现准备保留显式局部状态，既响应状态变化，也允许用户自行收起 |
| 旧模块 | Insights legacy recap 同步共享按钮和用途 token；当前首页不挂载该模块，仅记源码覆盖 |

最终源码盘点：这些 App 的 `ui-src` TSX 中没有直接声明普通 button、input、textarea、
select、table、progress 或 details。此结论仅限上述入口与标签范围，不能代替视觉或交互验收。
第三方 PDF/科学绘图、外部超链接、论文原文布局和专用 listbox 仍保留各自语义。
没有用空壳通用组件承接原有领域状态、权限、调度或科学执行规则。

共享库的必要扩展集中在 Table、Disclosure 和 Feedback，已同步公开组件契约。
Table 回归覆盖排序、选择和来源行列跨度；Feedback 回归重新解析 HTML，确认嵌套诊断
仍在 alert 内。Control Lab 的 SDK core 运行时路径通过 allowJs 纳入类型解析，
保留真实 AppApiError 状态码行为，没有将运行时入口指向仅声明文件。

### 最终自动验证

所有 12 个 App 在最终组件迁移后重新构建成功，复用已有 `web/dist-reader`。
SDK 类型检查及全部 161 项测试通过。受影响 App 的类型检查与 UI 测试通过：
Paper 7、Data 8、Lab 10、HPC 1、Viewer 23、Cell 7、Connectors 45、
Control Lab 46、Insights 6；Compute 类型检查通过。根目录 `npm run check` 通过，
包含生成文件一致性、984 条双语消息及 85 个共享图标；`git diff --check` 通过。
这些计数是本轮实际执行结果，不代表真实科学运行或远端服务已验收。
已有 KaTeX/JSDOM、Node localStorage 实验功能和 reader Wasm direct eval 提示仍存在。

### 最终运行证据与限制

- Data 最终生产 bundle 连接隔离目录中的真实后端；共享 Table 按数值升序，选中记录仍为原始 record 2，未因排序改变记录身份。
- Paper 最终生产 bundle 中点击长标题后共享 Disclosure 打开，aria-expanded 与 details.open 均为 true，只有一个共享展开指示器。
- Native 深色24px中 Cell 最终长标签与热图已确认；Lab 96孔板及数值可读，实际共享 Simulation only Popover 可打开。
- Native 中 Escape 未观察到关闭该浮层，热图方向键/水平滚轮也未观察到横向移动。浏览器对应路径的通过不能替代 WebKit/Native；目前未确定是焦点路由、工具输入还是产品问题。
- 后续另一项 Native 工作重启应用，最后一次观察停留在“正在打开应用”。此前已完成截图仍有效；不将该状态归因于本批组件迁移，也不宣称重启后全部恢复已验收。
- 临时字号/主题的恢复未完成。物理中文 IME、VoiceOver、跨平台和完整主题/字号/业务状态矩阵仍未验证。

最终证据位于同一忽略目录：

| 证据 | 路径 |
| --- | --- |
| 共享 Table 排序与选择 | [52-data-shared-table.png](../../test-results/ux-review-2026-11-06/52-data-shared-table.png) |
| 共享 Disclosure 展开 | [53-paper-shared-disclosure.png](../../test-results/ux-review-2026-11-06/53-paper-shared-disclosure.png) |
| Native 共享 Popover 与孔板 | [54-native-lab-shared-popover.png](../../test-results/ux-review-2026-11-06/54-native-lab-shared-popover.png) |

本轮标准组件替换与代码交付完成；完整 Native 辅助技术与键盘验收继续保留在原 tracker，
不能据源码盘点归零宣布全产品验收完成。截图未加入 Git，避免提交二进制证据。


## 远端整合后的复验

本轮组件提交已同步到远端默认分支 master，整合点为 `f93ddc07`。
独立工作树中验证的 App、SDK、Native 源码及本报告与该整合点一致。
最终复验：SDK 类型检查、161/161 项 SDK 测试、166/166 项 App 测试、
产品内全部 App 的类型检查（Insights 由根目录与构建覆盖）、12 个生产 bundle
构建及根目录 check 全部通过。根目录检查使用本机已安装 Rust toolchain 和
`PERO_GPUI_KIT_PATH=/Users/phodal/test/gpui-kit`；工作树复用现有 reader Wasm
及已安装依赖，初次缺少这些环境路径的失败不记为源码缺陷。
本复验没有扩大前文 Native 键盘、物理 IME、VoiceOver 或真实执行的验收范围。
