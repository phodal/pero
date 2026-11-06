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

仍有两项明确体验欠缺：中文工作台中部分 App 保持英文界面；Virtual Cell
热图长群组名称在图形左边缘被裁切。后者位于科学 SVG 布局，本轮条形统计修复
没有覆盖它。24px 时工作台标签更容易省略，应通过切换标签菜单查完整名称。

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
