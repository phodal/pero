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
