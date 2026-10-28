<p align="center">
  <img src="docs/assets/openpero-mark.svg" width="72" alt="Pero 标志">
</p>

<h1 align="center">Pero</h1>

<p align="center">
  <b>可组合的科研应用与分布式 Agent 协作。</b>
</p>

<p align="center">
  <a href="https://github.com/phodal/pero/releases">下载开发版</a> ·
  <a href="ROADMAP.md">路线图</a> ·
  <a href="DEVELOPMENT.md">开发指南</a> ·
  <a href="#当前状态">当前状态</a> ·
  <a href="#参与贡献">参与贡献</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <img src="docs/assets/openpero-overview.zh-CN.svg" alt="科研工作流：问题、任务、执行、复核与项目记忆" width="900">
</p>

> [!NOTE]
> **开发预览。** 已提供 macOS arm64 开发版，尚无稳定发布版。

## 为什么做

科研工作流往往从脚本、Notebook 或模型 Demo 开始。Pero 将它做成 App，既可独立运行，也可放进共享工作台与其他工具一起使用。Virtual Cell 是首个实例，提供细胞图谱探索与反应模拟。

长期目标是连接这些 App、Agent、合作者与算力，让输入、方法和结果保持可追溯。

![科研 App、Agent 能力与交付方式；虚线表示规划中的部分](docs/assets/openpero-building-blocks.svg)

## 当前状态

| 能力 | 状态 | 文档 |
| --- | --- | --- |
| Agent 对话、工作区、附件、中英文与主题 | 开发版可用 | [Desktop 指南](desktop/README.md) |
| 工作台或独立应用中的 Virtual Cell | macOS arm64 开发包已验证 | [App 指南](apps/README.md)、[验收记录](docs/fitness/products.md) |
| 共享任务与远程执行 | 本地流程已验证，真实远程环境待验收 | [验收记录](docs/fitness/remote-dispatch-verification.md) |
| GitHub 与 Roadmap 任务导入、认领及公开贡献 | 已实现，真实 GitHub PR 发布待验收 | [贡献指南](desktop/README.md#contribute-on-this-computer) |
| App 与 Agent 工具接线、多 Agent 编排及完整 AI4S 工作流 | 规划中 | [路线图](ROADMAP.md) |
| 独立结果验证与环境管理 | 规划中 | [路线图](ROADMAP.md) |

## 工作方式

目标流程是：固定任务的输入与检查规则，交给合作者或获准 Worker 执行，再复核记录下来的结果。计算可以留在个人电脑、实验室服务器或云端，协调服务可以自部署。

Agent 提出建议，由人批准重要操作与最终结论。导入任务不授予执行权限，运行记录保留复核所需的证据。

![Pero 架构：客户端、Cloud 协调、Host 执行、能力生态、执行环境与可信交付](docs/assets/openpero-architecture.svg)

实线框表示已有基础，虚线表示规划中的部分。实现细节见[架构文档](docs/ARCHITECTURE.md)，环境准备、构建与测试见[开发指南](DEVELOPMENT.md)。

## 参与贡献

提供科研场景、贡献方法或 App，或参与结果复核。从[路线图](ROADMAP.md)中选择范围明确的条目；较大的改动请先开 Issue 对齐范围与验收标准。代码改动需附可复现的检查方式。AI 辅助贡献遵循相同的审阅流程。
