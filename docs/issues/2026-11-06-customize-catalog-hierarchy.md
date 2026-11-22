---
kind: issue
status: resolved
date: 2026-11-06
---

# Customize catalog obscures service discovery with competing controls

The actual Native catalog shows a full-width search beside competing actions,
repeated host-capability badges and decorative placeholder-like art, a long row
of category choices, and full setup instructions on every service card. Titles
truncate before a person can identify the service. Legacy font rules also drift
from the shared component typography. The displayed update time is the local
snapshot read time, not a provider's update time.

Keep the service/installed views, installation and permission owners, retained
refresh results and recovery actions. Use shared navigation and controls, a
compact category selector, identifiable built-in capability entries and readable
service cards. Show essential availability and access conditions while browsing;
keep full setup prerequisites visible before configuration or installation.
Remove the persistent snapshot timestamp; a failed refresh still identifies
retained results. Verify real Native appearance separately from browser fixtures.


Implementation: `42aab97b`, `40dca903`, `63f53a49`. The independent review also
identified installation permission disclosure and shared-secret deletion impact;
both now have regression coverage. All 45 Connectors tests and 14 actual App frame
scenarios passed, alongside shared Tabs tests and root checks. The shared catalog
contains the navigation variant; the App consumes SDK Card and control styles.

Acceptance completed after unlock on source `17a67bcc`: actual Native catalog
and installed views use the shared Card surface and spaced Tabs with the shared
selected underline. Pointer switching has no lingering focus rectangle; Left
returns to the catalog with visible keyboard focus. Screenshots are linked in
`packages/pero-design/VERIFICATION.md`. The saved Compute cluster selection was
also observed after restart; scheduler execution remains outside this change.

## 2026-11-22 目录浏览

两个目录采用相同的紧凑标题、结果计数和搜索筛选栏。服务目录的单列服务行
迁移到 SDK CatalogCard 网格，分类标签改为 Select，保留前置要求、配置、管理
和文档入口。内置能力独立展示。发现和已安装技能从 12 张卡片改为每页 24 行的
ListRow，按任务排序，对完整结果筛选后分页，页码固定在滚动区外。
SkillHub 继续按上游分页读取发布版本。

基于 `31a70c5c4` 和本次工作区改动验证。实际 Native 开发窗口中检查了中文浅色
技能列表与 MCP 网格。Electron 使用 1,778 个技能、106 个服务验证分页、筛选、
清除、详情、连接配置入口及英文切换中文，检查了深色窄窗口。截图保存在
`test-results/customize-catalog/` 与 `test-results/skills-market/`。

## 2026-11-22 连接弹窗遮罩

App 内的原生 `<dialog>` 只覆盖自己的 iframe 或 WebView。连接配置会占用整个工作台，
使用 SDK 的 `scope="window"`，由 Workbench 遮住 App 外的侧栏、标签栏和其他窗格。
遮罩统一使用设计契约的 33% 黑色。连接表单、嵌套弹窗、Escape 和焦点仍由 SDK 管理。

macOS Native 开发壳实测飞书连接打开后侧栏和标签栏一起变暗。点侧栏不会导航，并可
继续按 Escape 关闭。Electron 专项用 GitHub 连接验证遮罩覆盖、底部截图按钮隐藏、
侧栏点击拦截、Escape 关闭和焦点回到「添加连接」。截图位于
`test-results/customize-catalog/native-window-modal-zh.png` 与
`test-results/skills-market/mcp-window-modal.png`。Linux、Windows 和签名安装包尚未实测。
