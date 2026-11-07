<p align="center">
  <img src="docs/assets/openpero-mark.svg" width="72" alt="Pero 标志">
</p>

<h1 align="center">Pero</h1>

<p align="center">
  <b>读论文、运行科研应用，复核结果背后的证据。</b>
</p>

<p align="center">
  <a href="#开始体验">开始体验</a> ·
  <a href="#一个科研实例">科研实例</a> ·
  <a href="#当前状态">当前状态</a> ·
  <a href="DEVELOPMENT.md">开发指南</a> ·
  <a href="ROADMAP.md">路线图</a> ·
  <a href="README.md">English</a>
</p>

Pero 是面向研究者与科研软件开发者的桌面工作台。把论文原文、领域 App 和 Agent 对话放在同一个工作空间，查看保存的结果，并回到支持它的来源。

- **带着证据读论文。** Paper 保存原始 PDF，支持围绕所选资料提问，将报告引用定位到实际读过的原文片段。
- **检查数据，动手探索方法。** Data 无需模型即可检查和绘制选定数据版本；Virtual Cell 提供细胞图谱、本地反应模拟和有界的扰动比较。领域 App 管理自己的输入与结果。
- **把研究工作联系起来。** 本地研究项目关联目标与 App 记录；Agent 会话保留工具活动和有版本的交付物。

> [!NOTE]
> **开发预览，尚无稳定发布版。** 下文能力说明对应当前源码。下载的安装包是特定版本快照，可能不含较新的功能。运行成功或数值一致，不等于科学结论成立。

## 开始体验

### 下载开发版

本体验说明使用已公开发布的 [2026-11-04 开发预览版](https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261104)，包含下列文件。更新的已发布安装包请查看 [Releases](https://github.com/phodal/pero/releases)；仅有 Git 标签不代表安装包已可下载。

| 产品 | 平台 | 文件 |
| --- | --- | --- |
| Pero，Electron 工作台 | macOS Apple Silicon | `Pero-macos-arm64.dmg` |
| Pero，Electron 工作台 | Windows x64 | `Pero-windows-x64.zip` |
| Pero，Electron 工作台 | Linux x64 | `Pero-linux-x64.tar.gz` |
| Pero Native，GPUI 工作台 | macOS Apple Silicon | `Pero-Native-macos-arm64.dmg` |

选择适合系统的文件，并阅读该版本发布说明。下载页附有构建信息和 SHA256SUMS。macOS 包采用 ad-hoc 签名，未经公证；Windows/Linux 包为未签名开发版。Electron 与 Native 使用独立的数据配置。此版本不包含独立 Virtual Cell 安装包。各版本的实际检查与边界见[发行验证记录](docs/fitness/release-products.md)。

### 第一次体验：读一篇论文，核对回答中的证据（Electron）

*下方四张图依据实际界面截图，并按源码补全报告控件绘制，是简化示意，不是产品截图。图中部分导航晚于 11 月 4 日安装包；下方编号步骤使用该版本已有的控件。*

从 **Electron 工作台**侧栏的**论文 / Papers**开始，准备一篇你想读的公开、可选取文字的 PDF。本地导入、阅读和高亮不需要模型账户或 API Key；向 AI 提问是另一个需要主动发起的步骤。

1. 打开**论文**。若出现**准备环境 / Prepare environment**，点击并等待**环境已就绪**。新配置首次准备可能联网下载 uv、CPython 3.12 和指定版本的 PDF 依赖，放入受管 Python 环境。Native 另有[新配置限制](DEVELOPMENT.md#native-fresh-profile-limitation)。
2. 选择**添加论文 → PDF → 导入 PDF**，选取文件，也可以把 PDF 拖进 App。导入后会打开保存的原始 PDF。首次建议用可选取文字的文件，不要默认扫描页已有可检索文本。

![入库：从文库添加论文并导入 PDF](docs/assets/openpero-paper-research-01-add.zh-CN.svg)

3. 阅读论文，选中一段文字，点击**高亮**保存原文标注。到这里无需配置模型。

![阅读：使用论文阅读器查看原始 PDF](docs/assets/openpero-paper-research-02-read.zh-CN.svg)

4. 想提问时，点击**询问 AI / Ask AI**，或选中文字后点击**讨论选段 / Discuss selection**。它会带着论文上下文打开共享对话，不会替你发送问题。发送前需配置 Agent：内置 Agent 在**设置 → 内置 Agent**中设置 API 服务和 Key，外部 Agent 使用各自的登录方式。PDF 全文研究需要 Agent 支持 HTTP MCP，见 [Agent 配置](desktop/README.md#agents-and-conversations)。

![提问：将选段带入共享对话并发送问题](docs/assets/openpero-paper-research-03-ask.zh-CN.svg)

5. 发送一个具体问题，例如：**“这篇论文的方法有哪些证据支持？有哪些限制需要回到原文核对？请引用原文片段。”** 报告保存后，收起对话，点击阅读器顶栏的时钟图标（**研究记录**），再打开已保存的问题/报告。点击引用查看原始 PDF 中的对应片段。若**引用证据**列出多个匹配位置，请选择相关位置，不要默认某一个就是答案。
6. 在已保存的报告上选择**从此处追问 / Continue from here**，再发送追问，继续核对。保留尚未回答的问题和证据缺口；引用只能定位来源，不代表科学结论已获验证。

![回查：打开保存的报告，通过引用核对原文](docs/assets/openpero-paper-research-04-review.zh-CN.svg)

环境准备好后，本地阅读无需模型调用。AI 提问可能把论文内容发送给所选服务商，并产生其模型费用；不需要启动可选的控制面服务。离线准备及已有 Python 绑定见 [Python 环境设置](DEVELOPMENT.md#python-environments-and-advanced-overrides)。

上述编号步骤使用的控件同时存在于 11 月 4 日源码标签和当前源码。[已有 Paper 流程记录](docs/fitness/paper-harness-journey.md)区分了使用测试 Agent 的开发版 Desktop 检查与历史真实 Agent 检查；本次 README 更新不代表重新验收了安装包或真实模型。详见 [Paper 阅读与提问边界](apps/paper-agent/README.md#pdf-reading)。下文较新的研究工作流不属于 11 月 4 日安装包的能力承诺。

### 体验最新源码

先完成[开发环境配置](DEVELOPMENT.md#desktop-from-source)，包括指定版本的 GPUI Kit，再在仓库根目录运行：

```sh
npm run dev:paper  # 在独立开发配置中打开 Paper
```

打开 Paper 不会自动开始研究。需要领域示例时，`npm run dev:apps` 会在另一个独立开发配置中打开 Virtual Cell。

### 补充体验：无需模型的数据检查

Data 可以辅助核对科研输入。在 Electron 中打开 **Data**，若提示则先准备 Python 环境；无需模型账户或 API Key。

<details>
<summary>导入 6 条合成记录，绘制计数图并保存视图</summary>

1. 将 [first-dataset.json](docs/examples/first-dataset.json) 保存到本机。它包含 **6 条合成演示记录**，不是真实实验测量。
2. 点击 **Add data**，选择文件，检查导入信息后点击 **Import**。
3. 选择数据集，查看 **Fields** 和 **Checks**：预期为 6 条记录，缺失字段、null、空字符串和重复行均为 0。
4. 打开 **Chart**，保留 **Data = Current aggregation**，将 **Group by** 设为 `condition`、**Measure** 设为 `signal`、**Aggregate** 设为 **Count**。两组应各有 3 条记录。
5. 返回 **Table**，填写视图名称并点击 **Save view**，再从 **History → Saved views** 打开。**Export reference** 导出数据集/版本引用和检查报告，不包含原文件，也不是可执行实验包。

离线准备、已有 Python 环境及高级覆盖配置请看 [Python 环境设置](DEVELOPMENT.md#python-environments-and-advanced-overrides)。`PERO_APP_PYTHON` 并不能通用覆盖已保存的 App 环境绑定。

这些步骤使用 11 月 4 日源码标签中已有的控件。预期计数来自示例数据，不表示本次已逐一点击验证各平台下载包。[Data 使用边界](apps/data/README.md)和[验证记录](docs/fitness/data-workspace.md)区分源码检查与 Desktop 验收。当前源码的 CSV 数值解释能力晚于该安装包，因此这里使用 JSON。

</details>

## 一个科研实例

**能否根据原始输入，独立复算论文中的一个数值？** 当前 Fisher（1936）案例围绕 Table III 的物种内离差平方和展开：

1. 绑定原始 PDF 区域，以及从 Table I 核对的两个物种共 100 条测量值。
2. 在计算前固定公式、单位、输入与比较规则。
3. 计算结果，再用独立进程和精确有理数算法复核。
4. 保存结果标注并导出证据 ZIP；解压后可运行 `python -I -S verify.py` 独立检查。

[已记录的运行](docs/fitness/paper-fisher-reproduction.md)得到 **19.1434 cm²**，与选定的论文数值一致。独立数值检查仅使用 Python 标准库，无需模型或网络。这是预先选定案例中单个结果的重分析；整篇论文的结论仍为 `NOT_ASSESSED`（未评估）。

当前 App 路径已有后端/API、导出和重启检查；这次增量的浏览器交互、Native/Electron 集成和安装包验收仍未完成。可按[固定案例说明](apps/paper-agent/skills/paper-reproduction/references/reproduction-protocol.md#fixed-real-source-reanalysis-fisher-table-iii)检查或复算。它不代表已经能够“复现任意论文”。

交互式领域实例可看 [Virtual Cell](apps/virtual-cell/README.md)：它提供 PBMC3k 参考图谱和本地一级反应模拟。反应与体素示例用于演示，不是拟合的生物模型或已获接受的科学结果。

## 当前状态

实现、运行验收与科学复核分别记录在[质量门禁](docs/fitness/README.md)中。

| 范围 | 已有基础 | 尚未完成的边界 |
| --- | --- | --- |
| 论文与研究 | 保存来源、带引用报告、显式续研；有界的自动研究计划与导出 | 自动研究已完成受控全链路检查，真实模型与独立人工质量验收待完成。[验证](docs/fitness/paper-autonomous-research.md) |
| App 与项目 | 本地 App、有界 Agent 工具、研究目标与 App 记录引用 | App 与共享 Task/Run 的通用接线、共享项目记忆和团队同步仍在规划中。[项目](docs/fitness/research-projects.md) · [App Use](docs/fitness/app-use.md) |
| Agent 与交付 | ACP 会话、审批界面、历史、本地插件、会话内 MCP 和产物版本 | Provider/平台覆盖各有边界；产物有版本不等于通过独立科学复核。[产物](docs/fitness/session-artifacts.md) · [连接器](docs/fitness/connectors.md) |
| 任务与计算 | 任务分派、Worker 租约/取消/恢复；本地、Docker、Compose、Slurm 资源适配的局部证据 | 生产科学 App 准入和更广泛平台验收待完成。[环境](docs/fitness/ai4s-environments.md) |
| 客户端与协作 | Desktop 开发包，以及独立的 Web 预览 | 共享 Web/移动科研客户端、完整的跨人员研究工作流仍在规划中。[路线图](ROADMAP.md) |

## 数据、权限与费用

- **本地保存有明确边界。** App 在执行机器保存领域数据，项目引用这些记录。使用远程模型、文献服务、MCP 连接器或共享任务服务时，所选提示词、来源内容或任务数据可能发送给相应服务。本地存储不等于所有流程都离线。
- **只运行可信 App 和工具。** App 后端与本地插件是受信任代码，不是通用进程沙箱。Agent 操作遵循所选会话的权限策略；处理敏感资料前，应检查工作区、工具和权限策略。
- **自行配置模型访问。** 内置 Agent 需要配置 API Provider；外部 Agent 使用各自的认证。模型订阅/API 调用及远程算力由相应服务方另行计费。用量只展示 Provider 实际报告的数据，未报告不等于零费用；研究调用次数和时长限制不是账单上限。见 [Agent 配置](desktop/README.md#agents-and-conversations)。
- **由研究者复核结论。** 来源可追溯、执行成功、数值检查通过和科学结论获接受，是不同层次的判断。未解决的证据缺口应继续保留。

## 方向与架构

拟议路线是先复核已发表结果，再比较实验，最后让研究跨人员、跨环境持续推进。每一阶段都需要自己的验收证据。[路线图](ROADMAP.md)区分了已有基础与待完成工作。

![目标科研工作流：问题、任务、执行、复核与项目记忆](docs/assets/openpero-overview.zh-CN.svg)

*目标工作流示意，不代表完整的跨人员研究闭环已经实现。*

![科研路线建议：复核已发表结果，比较实验，再跨人员与环境持续研究](docs/assets/openpero-research-roadmap.zh-CN.svg)

App 管理领域方法与数据，Host 管理本机进程、凭据和 Agent 会话；可选的 Go 控制面协调共享任务与 Worker。本地 App 计算无需启动该控制面服务。

### 架构与组合示意图

以下为架构示意，不是产品截图。实线框表示已有实现基础，虚线框和连线表示规划能力或待接通的关系，不代表端到端流程已通过验收。

![科研 App、Agent 能力与交付方式](docs/assets/openpero-building-blocks.zh-CN.svg)

![Pero 架构：客户端、协调、Host 执行、环境与交付](docs/assets/openpero-architecture.zh-CN.svg)

职责边界和实现细节见[架构文档](docs/ARCHITECTURE.md)、[决策记录](docs/adr/README.md)与[开发指南](DEVELOPMENT.md)。

## 参与贡献

带来一个具体的科研问题、有来源的小型公开数据集、方法/App，或一份独立结果复核。较大的改动请先开 [Issue](https://github.com/phodal/pero/issues) 对齐范围与验收标准，附上可复现检查，并说明尚未验证的部分。AI 辅助贡献遵循相同审阅流程。详见[贡献指南](CONTRIBUTING.md)，也欢迎加入[社区](https://github.com/openpero/community)。

**许可现状：** 仓库目前没有顶层项目许可证，请勿默认获得统一的开源复用授权。所含第三方组件保留各自的声明和许可证；项目层面的复用与分发条款需向维护者确认。

<p align="center">
  <a href="https://github.com/openpero/community">
    <img src="docs/assets/wechat-group.jpg" width="240" alt="微信群：Pero - 瞎摸 AI4S">
  </a>
</p>
