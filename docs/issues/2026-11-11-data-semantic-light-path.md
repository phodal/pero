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

## 产品接线续作（2026-11-11，在隔离分支进行）

范围扩展为现有 Data / Paper / research-assets 的产品轻路径；不建立第二个 Catalog、
Agent、Run 或授权 owner。Data 新的 SemanticQueries 持有不可变投影、审查定义与回执；
只读引擎由产品与原 D 实验共享。独立整表 count/sum/mean 直接读固定导出，以 Decimal
复算，缺失原始导出会失败，历史读取本身不执行查询。更复杂 SQL 暂无通用独立检查器。

Paper 只保存已有 ResearchClaim、冻结 PDF 的 SourceVersion 和 Data 对象 ID；
Host 使用原 research-assets 授权能力取服务端回执。UI 使用共享组件新增 Data Queries
和 Paper Data query evidence；原数据分析和手工研究记录仍保留。未引入新 token/局部控件样式。

首次验证：Data 69 个测试、原离线概念 3 个测试通过。后续真实 Host/browser、
评估驱动和部署边界结论将在本记录追加；目前不能宣称完整 P2 或真实 A/B/C 验收完成。

## 产品接线交付与选型结论

- `772dbc52`：Data 固定投影、审查定义、查询回执、共用只读引擎。
- `8f74f09c`：Queries UI、原始导出独立复算、结果优先与历史读取。
- `b38e7c91`：现有 Host 授权 handoff，Paper 精确 Claim + 原 PDF SourceVersion。
- `7fff4a86`：真实 Host/浏览器纵向验收与可运行 A/B/C 本地模型比较驱动。
- `c0286308`：拒绝重复结果列名，避免跨表结果转为映射时丢列。

正式 `run-7WBMTO` 的五组场景通过，包含授权负例、更新数据/定义后旧结果不变、
真实 Host 重启与实际 PDF 页/引文高亮；截图已检查。Data 70 tests、Paper新链接测试
及原记录5 tests、两个UI typecheck/build、原D独立复算与15项边界检查通过。
完整证据和逐项DoD映射见 [fitness记录](../fitness/data-semantics.md)。

[ADR 0035](../adr/0035-data-semantic-contract.md) 明确选择 **reuse-contract-only**。
真实 A/B/C 模型对照、usage/成本、人类维护时间、上游全栈隔离/OAuth/Vault验收仍未验证。
270次脚本回放只证明比较驱动可运行，不是模型对照结果。没有付费模型调用或新长期凭据。
上游实际预测开关检查 `KUMO_RFM_API_URL`，不是旧注释声称的 API_KEY；轻路径不载入该客户端。
本 issue 保持 open，不能以产品闭环或人工 D SQL 成功替代剩余验收。
