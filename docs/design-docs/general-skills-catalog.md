# 通用 Skills 复审索引

https://github.com/phodal/pero/issues/200

五个已有文档/表格条目跨范围发现，原 ID、类型、固定提交、正文摘要和许可保持不变；旧专有许可和未知许可仍阻止安装。
非科研排除项未被批量准入；同正文且同资源指纹才可作为别名合并。

12 个新通用条目，5 个已有文档类跨范围引用；覆盖计划、工程、验证、环境、创作、协作与文档。

| 技能 | 用途 | 兼容状态 | 固定来源与许可 |
| --- | --- | --- | --- |
| 任务澄清 | 梳理目标、约束和备选设计，形成可讨论的说明。 | requires_adaptation | [obra/superpowers/skills/brainstorming/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/brainstorming/SKILL.md) · [MIT](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE) |
| 编写实施计划 | 把已确认需求拆成文件、接口、测试和交付步骤。 | requires_adaptation | [obra/superpowers/skills/writing-plans/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/writing-plans/SKILL.md) · [MIT](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE) |
| 系统排错 | 先复现和收集证据，再定位原因并验证最小修复。 | static_instructions | [obra/superpowers/skills/systematic-debugging/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/systematic-debugging/SKILL.md) · [MIT](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE) |
| 测试驱动开发 | 通过失败测试、最小实现和回归检查约束行为。 | static_instructions | [obra/superpowers/skills/test-driven-development/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/test-driven-development/SKILL.md) · [MIT](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE) |
| 完成前独立核查 | 用实际命令结果检查完成声明，并明确失败和未验证范围。 | static_instructions | [obra/superpowers/skills/verification-before-completion/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/verification-before-completion/SKILL.md) · [MIT](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE) |
| 处理代码评审 | 结合当前代码核查评审意见，逐项修复并记录证据。 | static_instructions | [obra/superpowers/skills/receiving-code-review/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/receiving-code-review/SKILL.md) · [MIT](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE) |
| 隔离工作区准备 | 检查 Git 工作区和基线，准备可保留的隔离 checkout。 | requires_adaptation | [obra/superpowers/skills/using-git-worktrees/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/using-git-worktrees/SKILL.md) · [MIT](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE) |
| 技能创作与核查 | 用任务场景检验技能说明，整理触发条件和资源。 | requires_adaptation | [obra/superpowers/skills/writing-skills/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/writing-skills/SKILL.md) · [MIT](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE) |
| 整理开发交付 | 检查测试与分支状态，准备合并或 PR 的可审查交接。 | requires_adaptation | [obra/superpowers/skills/finishing-a-development-branch/SKILL.md](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/skills/finishing-a-development-branch/SKILL.md) · [MIT](https://github.com/obra/superpowers/blob/22f0b463e7a5e579904dd6211a520321035526f7/LICENSE) |
| 网页功能验证 | 用 Playwright 观察页面、核对交互并保存截图和日志。 | requires_adaptation | [anthropics/skills/skills/webapp-testing/SKILL.md](https://github.com/anthropics/skills/blob/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/webapp-testing/SKILL.md) · [Apache-2.0](https://github.com/anthropics/skills/blob/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/webapp-testing/LICENSE.txt) |
| 创建与评估技能 | 整理技能指引、资源与评估样例，迭代触发说明。 | requires_adaptation | [anthropics/skills/skills/skill-creator/SKILL.md](https://github.com/anthropics/skills/blob/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/skill-creator/SKILL.md) · [Apache-2.0](https://github.com/anthropics/skills/blob/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/skill-creator/LICENSE.txt) |
| 整理项目交接 | 按受众组织状态、问题和下一步，准备交接或内部沟通草稿。 | static_instructions | [anthropics/skills/skills/internal-comms/SKILL.md](https://github.com/anthropics/skills/blob/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/internal-comms/SKILL.md) · [Apache-2.0](https://github.com/anthropics/skills/blob/2c5958ecac7cee2b583967a2c4981d0f4a75c579/skills/internal-comms/LICENSE.txt) |

## 旧排除项复审去向

共 95 个候选路径。needs_review 不等于可安装，也不表示已核对新版正文。

- `K-Dense-AI/scientific-agent-skills/skills/autoskill/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `K-Dense-AI/scientific-agent-skills/skills/get-available-resources/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `K-Dense-AI/scientific-agent-skills/skills/pi-agent/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `LeonChaoX/qinyan-academic-skills/skills/17-平台与基础设施/get-available-resources/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `LeonChaoX/qinyan-academic-skills/skills/17-平台与基础设施/iso-13485-certification/SKILL.md` — excluded：不在本轮研究工程闭环范围。
- `meleantonio/awesome-econ-ai-stuff/_skills/engineering/commit-push-pr/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `meleantonio/awesome-econ-ai-stuff/_skills/engineering/sdd/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `meleantonio/awesome-econ-ai-stuff/_skills/engineering/code-simplifier/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `meleantonio/awesome-econ-ai-stuff/_skills/engineering/techdebt/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/architecture-design/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/mcp-integration/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/code-review-excellence/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/hook-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/frontend-design/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/command-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/agent-identifier/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/daily-coding/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/bug-detective/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/git-workflow/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/skill-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/skill-improver/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/plugin-structure/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/skill-quality-reviewer/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/verification-loop/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/ui-ux-pro-max/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/web-design-reviewer/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/webapp-testing/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `Galaxy-Dawn/claude-scholar/skills/uv-package-manager/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/skills/skills/internal-comms/SKILL.md` — reviewed：在本增量中固定新版正文、许可与工具条件；旧排除记录保留供科研子集对账。
- `anthropics/skills/skills/mcp-builder/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/skills/skills/canvas-design/SKILL.md` — excluded：不在本轮研究工程闭环范围。
- `anthropics/skills/skills/brand-guidelines/SKILL.md` — excluded：不在本轮研究工程闭环范围。
- `anthropics/skills/skills/frontend-design/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/skills/skills/algorithmic-art/SKILL.md` — excluded：不在本轮研究工程闭环范围。
- `anthropics/skills/skills/skill-creator/SKILL.md` — reviewed：在本增量中固定新版正文、许可与工具条件；旧排除记录保留供科研子集对账。
- `anthropics/skills/skills/web-artifacts-builder/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/skills/skills/slack-gif-creator/SKILL.md` — excluded：不在本轮研究工程闭环范围。
- `anthropics/skills/skills/webapp-testing/SKILL.md` — reviewed：在本增量中固定新版正文、许可与工具条件；旧排除记录保留供科研子集对账。
- `anthropics/skills/template/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/hookify/skills/writing-rules/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/frontend-design/skills/frontend-design/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/example-plugin/skills/example-skill/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/claude-code-setup/skills/claude-automation-recommender/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/external_plugins/stripe/skills/stripe-best-practices/SKILL.md` — excluded：不在本轮研究工程闭环范围。
- `anthropics/claude-plugins-official/plugins/claude-md-management/skills/claude-md-improver/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/plugin-dev/skills/agent-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/plugin-dev/skills/hook-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/plugin-dev/skills/command-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/plugin-dev/skills/plugin-structure/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/plugin-dev/skills/skill-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/plugin-dev/skills/mcp-integration/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `anthropics/claude-plugins-official/plugins/plugin-dev/skills/plugin-settings/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/09-meleantonio-awesome-econ-ai-stuff/_skills/engineering/techdebt/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/09-meleantonio-awesome-econ-ai-stuff/_skills/engineering/commit-push-pr/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/09-meleantonio-awesome-econ-ai-stuff/_skills/engineering/sdd/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/09-meleantonio-awesome-econ-ai-stuff/_skills/engineering/code-simplifier/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/skills/commit/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/skills/deep-audit/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/12-pedrohcgs-claude-code-my-workflow/dot-claude/skills/learn/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/14-luischanci-claude-code-research-starter/dot-claude/skills/commit/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/15-Felpix-Studios-social-science-research/skills/deep-audit/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/17-DAAF-Contribution-Community-daaf/dot-claude/skills/agent-authoring/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/17-DAAF-Contribution-Community-daaf/dot-claude/skills/skill-authoring/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/28-maxwell2732-paper-replicate-agent-demo/dot-claude/skills/commit/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/27-dariia-m-my_claude_skills/dont-lie/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/29-quarcs-lab-project20XXy/dot-claude/skills/handoff/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/bug-detective/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/code-review-excellence/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/agent-identifier/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/command-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/daily-coding/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/git-workflow/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/architecture-design/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/frontend-design/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/mcp-integration/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/hook-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/plugin-structure/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/ui-ux-pro-max/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/skill-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/skill-improver/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/web-design-reviewer/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/webapp-testing/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/verification-loop/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/skill-quality-reviewer/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/33-Galaxy-Dawn-claude-scholar/skills/uv-package-manager/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/41-sticerd-eee-sewage-econometrics-check/skills/commit/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/42-wanshuiyin-ARIS/skills/meta-optimize/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/42-wanshuiyin-ARIS/skills/skills-codex/meta-optimize/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/43-wentorai-research-plugins/skills/domains/business/strategic-management-guide/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/55-ab604-claude-code-r-skills/skills/tdd-workflow/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/67-econfin-workflow-toolkit/agent-browser/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/67-econfin-workflow-toolkit/command-development/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/67-econfin-workflow-toolkit/do-agent/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/67-econfin-workflow-toolkit/skill-creator/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
- `brycewang-stanford/Auto-Empirical-Research-Skills/skills/67-econfin-workflow-toolkit/web-access/SKILL.md` — needs_review：仅有旧非科研分类证据；未逐条建立当前许可/工具兼容依据，不开放安装。
