---
kind: github_mirror
github_issue: 60
github_state: open
github_url: https://github.com/phodal/pero/issues/60
---

# feat(hpc): 基于 ReFrame 的可复现基准库 App

## 用户故事

作为研究者，我希望在 Pero 中选择一个有版本、环境要求和检查标准的计算基准，运行它并检查原始证据，再比较同一规格的多次结果，从而积累可复现、可独立验证的研究基准。

ReFrame 是执行端的基准 runner。App 的产品对象是基准、运行证据、独立检查和比较；Slurm/OpenFOAM 是后续真实环境验收场景。

## 与 Compute 的边界

| 所有者 | 职责 |
| --- | --- |
| Compute / 现有 Task、Run、Worker、Host | 执行机器与资源、授权、领取、租约、通用执行生命周期、取消与恢复 |
| 基准库 App | 方法与输入版本、环境要求、预登记检查、运行证据关联、独立复验、可比性判定与结果比较 |
| ReFrame | 在获准执行端装配并运行已选择的基准，产生 runner 日志和报告 |
| 领域检查器 | 从固定输入和原始输出计算指标，按预登记门槛判定 PASS、FAIL 或 INCOMPLETE |

App 不增加 Worker 注册、资源调度、通用任务队列、第二套审批或任意代码执行接口。未来远程执行关联已有 Run/attempt 和产物引用，不把 App 本地记录变成另一套 Compute Run。

## 第一版可用闭环

2026-11-02：以下勾选表示本地工作区实现与开发验收，代码按独立关注点提交；尚未发布。两个方法为 π 中点积分与 Poisson 1D 有限差分。真实 ReFrame 4.10.4 的 9 项 Python 测试、9 项实际 Desktop 流程检查通过，页面错误为 0；包含 ZIP 离线复验、损坏证据清除旧 PASS 和共享 Chat 草稿。本轮复核后通用 App 契约套件也已通过；图形结果、浅深色及证据哈希一致性已复验。

- [x] 提供标准 Pero App，基准目录展示方法、版本、固定输入、资源要求、检查门槛和当前可用性。
- [x] 使用锁定版本 ReFrame 实际运行至少一个本地 CPU 数值参考基准；提供第二个不同方法以验证基准定义与检查可扩展。
- [x] 保存输入规格摘要、runner/解释器版本、执行位置、原始输出、日志和检查器版本；执行完成与检查通过分开。
- [x] 独立检查器根据原始数据验算；缺失、非有限值、规格不符或证据损坏不能 PASS。
- [x] 持久保存运行历史，重启后可查看与复验；受中断的执行保留中断/待核对状态，不自动重放。
- [x] 仅比较相同方法版本、输入规格和检查规则的结果；不同规格给出不可比较原因。实际耗时与数值误差分别展示。
- [x] 导出包含输入、原始输出、日志、摘要、检查器和使用说明的结果包，能够脱离 Pero 复验。
- [x] 通过已有 App/Host 会话工具暴露有界操作，复用共享 Chat；不另建 Agent 会话或审批。
- [x] 验证浅色/深色、窄窗口、加载/空/运行/成功/失败/不可用、键盘操作与重启持久性。

本地参考结果明确标注 Local reference：它证明 ReFrame 接入、数值检查和产品流程，不证明 Slurm、MPI、多机性能或模型实验精度。没有集群账号不阻塞第一版 App 的开发验收。

## OpenFOAM / Slurm 后续验收

保留固定 Hagen–Poiseuille 圆管层流 Re=100 场景：锁定 OpenFOAM 发行版、solver、网格、流体性质、充分发展入口、取压截面和环境。解析压降为 Δp = 32 μ U L / D²，明确运动压强与静压、μ 与 ν 的单位转换。

以下项目在真实站点接入后分别验收，不能用本地参考或 fixture 勾选：

- [ ] 通过已有获准执行入口，在真实 Slurm allocation 内运行至少一个多 MPI ranks 作业，保存 job ID、节点/ranks、环境与原始结果。
- [ ] 提交前保存原身份、submission key 与规格摘要；受理回执丢失或执行端重启后对账原 job，未知时不重新提交。
- [ ] 使用 squeue 观察活动作业、sacct 对账终态与退出码；区分取消请求和调度器确认终态。
- [ ] 预登记质量不平衡、压降误差、非有限值和收敛/稳态检查；初始讨论值为质量不平衡 0.1%、压降误差 2%，不得看到结果后放宽。
- [ ] 保留一次真实运行、一次取消和一次恢复/回执丢失的证据；结果包能独立重验。

站点未配置时显示明确不可用和所需条件，不生成假作业或假科学结果。

## 完成标准与后续集成

第一版 App 可独立交付；真实 Slurm/OpenFOAM 的验收状态单独保留，未通过前不宣称完整 HPC 站点交付。#59 的多机贡献可以执行本库中的方法，双方复用已有执行权威；本 App 不依赖 #59 整体关闭，也不复制其调度能力。#58 的领域方法和结果展示可按契约接入。

后续增加基准应主要增加定义、固定输入与检查器；自动网格搜索、多集群调度、资源供应和研究结论接受不属于首版。

## 参考

- [Pero 当前架构](https://github.com/phodal/pero/blob/main/docs/ARCHITECTURE.md)
- [现有任务执行边界](https://github.com/phodal/pero/blob/main/docs/adr/0002-remote-task-dispatch.md)
- [ReFrame](https://github.com/reframe-hpc/reframe)、[执行管线](https://reframe-hpc.readthedocs.io/en/stable/pipeline.html)
- [Slurm sbatch](https://slurm.schedmd.com/sbatch.html)、[sacct](https://slurm.schedmd.com/sacct.html)
- [OpenFOAM 运动压强](https://doc.openfoam.com/2312/tools/processing/solvers/algorithm-kinematic-pressure/)
