---
kind: progress_note
date: 2026-11-07
github_issue: 156
github_url: https://github.com/phodal/pero/issues/156
---

# Skills 市场实施边界

对应 [#156](https://github.com/phodal/pero/issues/156)。用户已授权目录整理、产品实现、验证和向上游提交 PR。

## 所有者与数据流

1. 离线采集器读取固定 Git 提交、ZIP 与明确声明的子模块，保留原文、许可证、资源摘要和重复来源；不执行第三方代码。JSON 是市场目录，中文索引用于人工审查。
2. Rust `skill_market` 领域值拥有安装版本与选择规则；store 负责 profile 持久化。Host 验证 App capability，并在短锁内准备和发布获取结果。外部获取期间不持有全局 store 锁。
3. Go 插件获取复用现有 Harness，按固定提交适配单个静态 skill，装配其有效静态文本引用。未知执行语义、越界路径、符号链接和 ZIP 安装明确拒绝；不安装 Python/系统依赖。
4. 普通 Pero 会话冻结启用版本；输入框也可显式选择任一已安装版本。App 会话继续沿用既有声明。更新、回退和移除不改写旧会话已加载的内容。
5. “去使用”通过受管 Skills iframe 的共享 shell 桥打开普通聊天草稿，调用现有 `resolve_context` 解析安装来源，添加可移除的技能引用；不自动发送或切换全局启用。

## UI 迁移

- 旧：40 项分页、左列表右正文 split、全局操作反馈。
- 新：12 项横向列表、研究任务排序、独立用途摘要与分类、右侧详情抽屉、逐项任务/取消/重试、发现/已安装管理和聊天入口。
- 复用 `@pero/app-sdk/ui` 公开组件。共享 `Dialog` 增加 `presentation="drawer"`，保留 Escape、焦点循环、关闭和 footer；沿用主题 token 和共享内容图标。
- 编辑说明位于 `apps/skills/ui-src/editorial.json`，由列表和搜索共用，完整身份及固定版本匹配。来源原文、许可依据和“未运行”状态保持可访问。
- 刷新失败保留已有目录，安装失败局限于对应任务。窄窗详情使用全视口，不把来源信息挤出操作区。
- 移除旧 split 样式；Skills builder 不再复制未使用的文档阅读器，避免无关载荷导致受管 App 更新失败。

## 验证与剩余范围

原工作区已观察 Host 拒绝 capability、排序错误、并发阻塞及无用阅读器打包等失败，之后使用同一行为测试验证修复。PR 从最新上游独立移植，重新运行目录、App、Rust、Go、工程检查与接线测试；详细结果统一维护在[验证记录](../fitness/skills-marketplace.md)。市场专用 CI 配置已准备，但提交账号令牌缺少 `workflow` scope，GitHub 拒绝工作流修改；该配置保留为本地补丁，本次 PR 包含可直接运行的专项测试和本地验收证据。公共 Git 和付费模型保持显式 opt-in。

静态安装成功不证明外部依赖存在或科学方法正确。Native 窗口、签名包、真实模型和科研结果验收仍需后续执行，不能据本次 fixture 通过关闭整个 #156。
