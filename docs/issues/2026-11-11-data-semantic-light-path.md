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

## 本轮完成（2026-11-11）

- 源与定义冻结 `fb348c11`；题集、人工计划和分母冻结 `fce56377`，均先于查询执行。
- 实现 `64682970` 复用真实 Data import/export，在派生 SQLite 执行审查定义、参数绑定、
  只读授权、VM 预算与信号取消；独立 CSV/Decimal 检查器复算全部 20 个答案。
- 正式执行三轮：公共题 12/12、合成题 8/8；预先编写的澄清/拒绝意图各 5/5；
  90 份回执来源完整、15 项执行/完整性检查通过。后两组不算模型理解准确率。
- 新数据版本和 mm 定义发布后，旧 cm 回执、原始资产及导出未变。
- 3 个概念测试和现有 Data 67 个测试通过；独立检查器拒绝了同步更新哈希的错误均值。
- [验证记录](../fitness/data-semantics.md)；[实现与上游审查](../../experiments/data-semantics/README.md)。

## 剩余范围

A/B/C 同模型同预算比较、实际 usage/维护成本、语义收益以及 P2 Paper/历史 UI 闭环仍未评估。
生产租户权限、Vault、出网策略、完整服务部署和研究者接受尚未验证。暂不采纳完整上游服务；
仅保留轻量定义/回执实验。该 issue 保持开放，不把 D 人工 SQL 正确率当成关闭依据。
