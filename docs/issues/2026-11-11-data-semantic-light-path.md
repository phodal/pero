---
kind: issue
status: in_progress
date: 2026-11-11
github_issue: 152
github_state: open
github_url: https://github.com/phodal/pero/issues/152
---

# Data 语义层：固定评测与只读轻路径

Data 已有不可变资产和固定导出；问题是如何审查与版本化术语、单位、分母和跨表定义，
并独立检查查询回执。不能把人工 SQL 的正确结果当成语义模型的收益。

本轮范围：P0 + 无模型的轻路径 P1 研究原型，位于 `experiments/data-semantics`。
固定 UCI Iris CC-BY-4.0 原始字节与 NVIDIA 官方 commit，另有明确标记的合成陷阱。
预先冻结 30 题（12 基础、8 陷阱、5 澄清、5 拒绝）和分母，D 为人工参考，A/B/C 未评估。
复用现有 Data import/export 创建只读派生 SQLite 副本；不增加产品查询入口、Catalog、
Agent、权限 owner 或 Run。定义审查是本地 SQL/口径审查，不是研究者科学接受。

上游部署、OAuth/Vault、多用户隔离、出网、ask_question 和付费模型不在本轮执行范围。
不修改 #200 已交付分支，不启动 Electron。
