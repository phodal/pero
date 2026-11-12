---
kind: local_issue
status: resolved
date: 2026-11-12
---

# 重复点击 App 讨论入口堆叠相同草稿

HPC 的“与 Agent 讨论”每次点击都会重复追加同一段提示和同一对象的引用卡片。
共享 Composer 直接追加收到的内容；App 对象冻结时还会产生随机 ID，使相同快照
被视为不同引用。重复信息挤占输入区与上下文预算。

App 对象快照身份应由冻结对象内容决定，不包含观察时间；对象、修订、选区、
面板和运行实例的变化仍产生独立引用。共享 Composer 对 App 引用按身份去重，
已有完整讨论提示不重复添加。用户手写内容、显式替换、清空后重新添加及普通文件
引用的既有编辑行为需要保留。讨论入口仍只填写草稿，不自动提交。

受影响消费者：Electron 工作台、独立 App Chat 和 Native 使用的共享 Composer，
以及共用的 AppChatContext 冻结入口。没有组件或 token 迁移。

验证：共享 Chat Native-feature 单元测试 48 项及图片集成测试 1 项通过；
App Use 单元套件与 TypeScript 检查通过，Wasm、Web、Desktop 构建通过。
macOS 隔离 Electron 使用真实 HPC 后端检查连续点击、保留用户追加文字、切换方法、
清空后重加及明暗主题，全部通过，页面错误为空。已查看浅色重复点击截图，草稿
保留一个提示和一个引用。证据在 `test-results/app-chat-dedup/`。
Native 实际窗口、独立产品及真实模型未验证；用户改写提示后不做模糊语义去重。
