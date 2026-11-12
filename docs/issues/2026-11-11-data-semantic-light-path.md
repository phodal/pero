---
kind: issue
status: resolved
date: 2026-11-11
github_issue: 152
github_state: closed
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


收尾补充：`1e2df2eb` 增补双表、101行截断完整保存、转换失败与数据库缺失负例；
`7e5a54db` / `244e9234` 使不支持独立复算的定义显示禁用动作及原因。
最新正式 `run-SF1e7p` 六组真实Host/browser场景通过，新增暗色状态截图已检查。
Paper ManualRecords 已稳定，后续精确引用入口工作归 #143；本轮不再改动该文件。

## 真实对照续作 — 2026-11-12

用户要求补齐未完成验收，不能仅调整范围关闭 issue。本轮保留原冻结题集、
答案、D 参考和阈值，执行真实 A/B/C 对照并记录真实用量、延迟和失败。
本机无已运行本地模型，已有仓库 DeepSeek 配置；显式使用官方 HTTPS API 的
deepseek-flash，三个 repetition、每组 90 次问题请求，B 另含三次生成请求，
不自动重试。凭据仅从进程环境读取，不写入配置、日志或证据。

目前 Docker daemon 不可用，未发现现成 OrbStack/Ollama App 或模型文件。
上游部署验收保持未完成，不能以静态审查或轻路径通过代替真实 OAuth/Vault
及隔离验收。先完成独立可执行的模型比较，再记录剩余具体阻塞。

真实执行进展：270 次回答 + 3 次语义生成完成，原精确匹配 A=33/90、
B=32/90、C=87/90；部分 A/B 失败只有列别名或浮点精度差异，不能直接
用该分差声称科学语义收益。完整原始请求/响应、错误及 usage 已保留。

固定 NVIDIA 源码的后端、Frontend、MCP 镜像已实际构建，并在本任务
专用 Colima/内部网络启动。Frontend 认证/伪造身份/API token 撤销、
过期及当前角色降权的 14 项 HTTP 检查通过；真实只读 PostgreSQL 角色
拒绝 DDL、DML、catalog 越界、读服务器文件及带写入的多语句。

**实际失败：Vault fail-closed。** 仅配置 `VAULT_ADDR`、其余三项缺失，
经已认证 Frontend 创建连接返回 HTTP 201；实际 Postgres catalog 中
发现明文测试密码。只使用本任务合成密码，无真实来源凭据。
这与原验收门槛不符，不能报告完整上游接入通过。OAuth/MCP 随后由独立
23 项真实探针验证：PKCE、工具发现/实际 readiness 调用、撤销、过期、
角色降权和认证服务断开/恢复均通过；不是用 API token 结果代替它。
原始证据位于 `test-results/issue-152-real/upstream/`。本 issue 保持 open。

逐项结果、局限、费用估算和复跑命令见
[真实验收报告](../fitness/data-semantics-real.md)，提交的小型 JSON 摘要保留
用量、模型 fingerprint、镜像 identities 和失败门槛。原精确匹配分数不改；
额外诊断确认 A 的 30 项、B 的 24 项仅列别名/六位精度不同，不能把原分差
当成通用科学正确率收益。C 仍有三次 T08 真实绑定错误；B 有一次参数绑定错误。
人类维护时间、独立人工审查和完整生产隔离/出网仍未建立证据。

## 最终处理 — 2026-11-12

用户在审阅真实模型和部署验证结果后明确要求合并 PR #205、关闭 #152。
本研究以 **reuse-contract-only** 结案；当前不采纳完整 NVIDIA 服务。
Vault 部分配置导致明文存储的实测失败仍成立，独立人工维护成本、外部 SSO
与生产隔离/出网等未验证范围不因结案而转为通过。今后若要采用完整服务，
须另行限定任务，修复或阻断该回退并重新验收。

合并复核：5 项概念/loopback 测试通过，无未处理 review。PR CI 15 个 job
通过，Notebook browser 和 Canvas 两组失败与当前 master `ee0c1a90` 完全
相同（Table settings、paper-block、Verification 定位器）：
[主干 CI](https://github.com/phodal/pero/actions/runs/43149931560)、
[PR CI](https://github.com/phodal/pero/actions/runs/43153971435)。
Notebook tree 与 Canvas 测试文件在两端字节相同；未把这些已有失败报告为全绿。
