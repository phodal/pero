---
name: deep-research
description: 使用所选原始 Research Skills 完成人工确认、大纲、并行逐项研究、原校验器验证和 Markdown 报告，再向调用者交付真实报告原文。
allowed-tools: Skill, Read, Write, Glob, Bash, WebSearch, WebFetch, Agent, Task, AskUserQuestion
---

# Deep Research compatibility entry

本入口编排所选来源的原始 research、research-deep、research-report 三阶段，不另造简化搜索流程。保持当前 root 会话，以保留原始人工确认与回答通道；不要把三阶段放进无法提问的子会话。

研究请求：$ARGUMENTS

## 阶段执行

1. 使用 Skill 加载 `deep-research:research`，传入完整研究请求，执行其中原始步骤。确认 items/fields 框架、时间范围、已有字段文件、batch_size、items_per_agent 和最终 outline。不要用调用者的普通执行授权代替这些选择。领域事实需要明确字段用于保存来源链接和不确定性，以满足调用者的引用要求。
2. 确认真实的 `outline.yaml` 和 `fields.yaml` 已保存，然后使用 Skill 加载 `deep-research:research-deep`。按原 prompt 模板为 items 启动 `web-search-agent` 后台任务。它必须先 Read 所选策略模块，再进行多查询、多来源检索。保留原 `model: opus`，仅使用 operator 已声明的模型映射。
3. 后台任务通过实际完成通知和产物跟踪，不调用 TaskOutput。结果 JSON 文件刚存在不代表任务完成；必须有原 validator 成功回执且后台任务真正成功结束。失败、取消、字段不完整或不确定项都要保留并说明。每批完成后，得到用户同意才进入下一批；不得自动替用户选择。
4. 使用 Skill 加载 `deep-research:research-report`，让用户选择摘要展示字段，按原要求生成并真实执行 `generate_report.py`，保留完整字段覆盖、双语分类、复杂值与不确定项规则。最终结果是实际生成的 `{topic_slug}/report.md`。

## 向调用者交付真实研究结果

Skill 加载时返回的是定义和激活回执，**不是已完成研究报告**。三阶段全部成功前，不得把这个定义 JSON、模板或普通 WebSearch 返回当作 deep-research 原文。

报告生成后必须使用 Read 回读实际 `report.md`，检查来源链接、覆盖范围和不确定性说明；Read 的显示行号不是原文件内容。若调用者已经创建知识分析任务目录，使用一次受现有审批约束的 Bash 文件复制，将实际 report.md 原样复制到该目录的 `research/deep-research-raw.md`，再比较文件字节/摘要确认一致。不要经模型重新改写这个 raw 文件。

随后继续调用者已加载的分析流程，基于真实 raw 报告写来源台账、面向目标读者的报告和摘要。不得遗漏正文附近的引用，不得把低可信来源单独作为关键结论依据。保留上游 `outline.yaml`、`fields.yaml`、逐项 JSON、执行/验证记录、生成脚本和原 report.md，供断点恢复与复查。

如果当前会话不支持原人工确认、没有 Web、Bash、显式 opus 路由或可用的 Python/PyYAML，或任何必要步骤未实际完成，应记录缺失与失败并停止，不降级成伪研究报告，也不安装到全局技能目录。
