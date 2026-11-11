---
kind: issue
status: in_progress
date: 2026-11-11
github_issue: 200
github_state: open
github_url: https://github.com/phodal/pero/issues/200
---

# 通用 Skills：统一目录与按需使用

## WHAT / WHY

科研市场的准入仅识别科研类型，UI 另行猜测许可状态；通用方法无法按同一身份发现和管理。
扩展现有 skill_market，不增加执行器或 App 装配 owner。旧来源 pin、安装 state 和会话不迁移。

## 分阶段实施

- P0：逐项复审固定来源与现有排除项，保留/排除/待适配有明确记录；目录增量合并到同一发布入口。
- P1：general_skill 类型、Host 准入投影、全部/通用/科研筛选；详情保留条件和未运行说明。
- P2：复用逐项安装、取消、重试、版本与聊天引用；真实 Host/Git/Harness 的本地接线验证。
- P3：固定 CSV/文档、真实脚本、独立检查与报告；真实模型单独 opt-in。

## UI 迁移

Skills App 复用公开 Select 增加技能范围筛选；原列表、抽屉、已安装管理、键盘导航和草稿入口保留。
前端许可猜测改为消费 Host installation 结果。没有准入投影的旧 Host 显示待核查，不能误报可直接安装。

## 验证状态

实施中；以下不作为已完成验收：真实模型、Native、签名包及跨平台验证。

## 2026-11-11 实施结果

- 独立分支 `codex/skills-general-200`，基线 `b1b95293`。P0 增量包含 12 个通用候选：
  5 个可静态安装、7 个需要宿主/工具适配；5 个已有文档类 ID 同时可在通用范围发现。
  95 个旧非科研排除路径均有去向，待核查项没有被批量安装。旧科研 JSON 的
  1,766 个 ID、kind、source 与 license 不改写。通用分类覆盖六类，另共享文档类。
- P1 发布与开发构建使用同一合并函数，生成 1,778 项、34 个固定来源快照的目录。
  `SkillCatalogEntry::installable` 是许可/通用兼容准入 owner，Host 投影供列表和
  已安装快照消费；旧 Host 缺少投影时显示未知。没有新增市场或执行器。
- Go 单技能获取保留固定提交的祖先 LICENSE/NOTICE，adapter version 由 2 升为 3。
  SKILL.md SHA 不变；新目录保留许可文本，安装回执记录 revision/adapterVersion。
  原有会话仍引用旧安装目录和已加载内容，不重写历史；许可证文件不是执行授权。
  Component / Context 的正文摘要仍只标识正文，不把它说成整个资源包摘要。
- P2 沿用普通聊天现有引用列表。Electron 实测通用+科研两个技能保持未自动启用，
  显式选入同一未发送草稿，提交后同一真实 ACP/Harness 回环请求收到两份正文。
  App 声明、权限及装配代码未修改，未进行所有 App 的实机回归。
- 发现原 concurrent 接线测试等待 Host 退出后的安装回执，退出并不保证该响应顺序。
  测试改为观察获取 readiness → Host 退出 → 原安装 state 保留，不用 sleep 猜调度。
- P3 已准备固定 CSV/brief、手写分析脚本、行为测试、报告和 Decimal 独立检查。
  四个完整配对的均值 13 → 16 mg/L，平均变化 3 mg/L；p5 缺测未插补。
  9 项独立检查包含两个方法 ID/revision/SHA 与真实公共获取回执逐一相等。
  这是确定性准备，未让模型执行研究，不是统计显著性或科研效果证明。

实际命令、截图及平台边界见 [验证记录](../fitness/skills-marketplace.md#200-通用增量2026-11-11)。
本 issue 保持开放：待适配候选、真实模型混合任务、Notebook 附件、Native、其他平台/Agent
和签名包仍未验收。不修改工作流，不自动合并或对外发布。
