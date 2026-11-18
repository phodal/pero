# Pero 官方文档竞品调研

调研日期 2026-11-18。首版面向第一次使用 Pero 的研究者。读者从官网进入文档后，可以找到适合自己平台的开发预览包，导入一篇 PDF 并记录标注，再按需配置 Agent 提问，沿着引用核对原文。

## 官方文档对照

| 项目 | 官方文档怎么组织 | Pero 可采用的做法 |
| --- | --- | --- |
| Claude Science | 最接近 Pero 的 AI 科研工作台。上手页按操作系统介绍安装和首次环境准备，随后用示例项目说明授权、执行和在哪查看结果。产物页单独说明版本及来源记录，Reviewer 页明确复核范围。 [上手](https://claude.com/docs/claude-science/get-started) · [产物](https://claude.com/docs/claude-science/artifacts) · [Reviewer](https://claude.com/docs/claude-science/the-reviewer) | 在安装页说明首次准备的条件。在 Paper 教程里指出研究记录和原文证据的入口，在概念页解释引用、执行记录和科学结论各自能说明什么。 |
| JupyterLab | 相邻的交互计算工作台。文档首页分出上手、用户指南、扩展开发、贡献和 API 参考。工作台界面页用可定位的界面名称和截图介绍文件、标签页与工作区。 [文档首页](https://jupyterlab.readthedocs.io/en/stable/) · [界面指南](https://jupyterlab.readthedocs.io/en/stable/user/interface.html) | 从用户的目标进入文档，步骤沿用实际界面名称。开发者参考集中链接到仓库里的开发指南和架构记录。 |
| marimo | 相邻的可复现 Python Notebook。快速上手先给可运行的内置教程，再按任务介绍编辑、结对、导出和发布。可选的 AI 功能有独立配置步骤。 [快速上手](https://docs.marimo.io/getting_started/quickstart/) | 把导入、阅读、高亮作为完整的首次体验，Agent 配置与提问放在后续步骤。每一步都说明读者应看到什么。 |
| Nextflow | 相邻的科研流程执行工具。首个脚本教程给出前置条件、示例输出和结果目录。执行器指南单独说明本机、HPC 与云的配置和前置条件。 [首个脚本](https://docs.seqera.io/nextflow/your-first-script) · [执行器](https://docs.seqera.io/nextflow/executor) | 工作流写清输入、结果和复核入口。计算环境与科研方法分别说明，远程资源、运行记录和验收范围跟随各自的验证记录。 |

## 首版文档结构

| 页面 | 回答的问题 |
| --- | --- |
| 文档首页 | Pero 适合哪些研究任务？我该从哪开始？ |
| 安装 | 我该下载哪个包？首次启动和准备 Paper 环境需要什么？ |
| 从一篇论文开始 | 怎样导入、阅读和高亮？启用 Agent 后怎样提问、找到保存的报告并核对引用？ |
| 科研工作流 | 下一步可以阅读论文、检查数据、组织研究记录或尝试计算与复核中的哪些流程？ |
| 概念与参考 | Project、App、Agent 与执行环境如何分工？引用、执行和复核记录有哪些证据边界？ |

中英文使用相同的页面层级和语言切换入口，沿用官网的构建与发布路径。下载说明以发布页为准，功能范围以对应源码和应用说明为准。安装包、开发构建、真实模型及科学复核的证据分别引用对应记录。 [Pero 发布页](https://github.com/phodal/pero/releases) · [Paper 使用说明](../apps/paper-agent/README.md#pdf-reading) · [验收分级](../docs/fitness/README.md#acceptance-levels) · [科研工作流验证](../docs/fitness/science-p0-p1-integration.md)

## 本地验证

2026-11-18，在 `452b12d29` 加本文档改动的工作树运行 `node pages/scripts/build.mjs`，用 macOS Chrome 打开本地生成站点。检查了两个官网入口、十页文档、站内链接和章节锚点，以及 320、390、1024 和 1440 像素宽度下的横向溢出。实际操作了移动菜单、中英文同主题跳转、深色偏好保留和键盘跳转，关闭 JavaScript 后仍可阅读文档和切换语言。

实际查看的截图包括中文概览（`pero-guide-zh.png`）、英文 Paper 教程（`pero-paper-en.png`）和中文窄屏深色 Paper 教程（`pero-paper-mobile-dark.png`）。本轮验证范围为本地静态站点。线上 Pages 发布、桌面包安装和真实模型流程尚未重跑。

## 手册扩充验证

2026-11-18，基于 `fd0020e38` 扩充为十个主题。安装新增校验、首次启动与排错，参考页增加记录位置、结果复核和验收分级。Paper 增加固定版本的跟做来源，Data 和 Notebook 给出可核对的输入与预期输出，研究项目、Agent 和计算环境各有独立指南。新功能注明源码构建或对应预览版条件。

运行 `node pages/scripts/build.mjs`，检查两种语言的 20 个页面、旧锚点、站内链接、图例与示例素材。在 macOS Chrome 检查 320、390、1024、1440 像素宽度、有锚点的双语跳转、Data 样例下载、Paper 示意图和导航选中。查看了桌面中文参考页（`pero-handbook-reference.png`）和移动端深色英文 Data 页（`pero-handbook-data-mobile.png`）。依据现有源码和验收记录编写步骤，此次网页验证未重新运行桌面 App、模型或远程计算环境。

## 后续补充

- 重新走一遍公开预览包的 Paper 上手流程，补上与包版本绑定的截图和常见卡点。
- 等到有真实计算站点的验收记录后，再补站点级操作教程。
