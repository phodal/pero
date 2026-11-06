---
kind: execution_plan
date: 2026-11-02
status: core_extension_in_progress
---

# AI4S Environments 分阶段实施

目标：让 Control Lab 与固定 PC-Gym 计算分别声明环境要求、绑定实际条件，并从结果追溯
本次使用。每个阶段单独交付和验收，不以文档、fixture 或历史科学运行代替新接线证据。

依据：[ADR 0029](../adr/0029-ai4s-environments.md)、[领域与接口设计](../design-docs/ai4s-environments.md)、
[两场景映射](../design-docs/ai4s-environments-scenarios.md)、[研究依据](../design-docs/ai4s-environments-research.md)。
与 [ADR 0026](../adr/0026-hpc-benchmark-library.md) 的 Compute 分工一致；没有新的执行服务。

## ADR 0030：2026-11-06 实现进展

[组合环境设计](../design-docs/2026-11-06-compute-environment-capabilities.md) 已以
[ADR 0030](../adr/0030-compute-environment-capabilities.md) 登记，设计提交 `ca28c9d1`。
本批完成 A 阶段的纯核心扩展，以独立 PR 交付：

- [x] V2 具名 Python/原生程序/OCI 软件组件，包要求关联指定解释器；保留旧观察字节结构和摘要。
- [x] 多槽位、能力连接依赖闭包、实际资源与运行代次；相同资源的槽位别名合并为一次 Use target。
- [x] 明确 V2 快照；旧单资源快照摘要不变；未知、过期、不就绪、能力缺失、身份漂移均阻塞。
- [x] 扩展唯一 `apply_use` 核心：逐项准入、部分失败释放、取消后迟到授权、未知效果和重复回执。
- [x] 真实既有 Python 元数据探针、Runtime/Host 与 Environments SDK 回归。
- [ ] A 后续与 B：持久化/恢复格式、Host 准入与原执行入口交接、本机与 Docker 具体 Owner、显式准备与真实执行/取消。
- [ ] C/D/E：Compose 服务组合、Tart/QEMU/KubeVirt、PC-Gym 独立计算环境与真实 Slurm。

`ResourceTemplate` 是 V2 多槽位定义；`EnvironmentSnapshot` 保留旧投影并包容组合快照。
本轮没有开放接收 V2 的 App 公共 API，没有真实 ResourceOwner，也没有把 effects 当作
已经执行。验收数据见 [环境核心验证](../fitness/ai4s-environments.md#2026-11-06adr-0030-核心扩展)。
P2–P4 的真实执行门槛仍保持未完成。

## P0：文档与场景检查（已完成）

- [x] 研究矩阵、领域定义、状态归属、语义接口与不采用的方案。
- [x] 核查 Control Lab 和 PC-Gym 的当前源码、测试入口及迁移缺口。
- [x] 固定各阶段交付物、回归边界和停止条件。

P0 交付是设计级检查；ADR 现接受 P1 范围，P2–P4 仍待实现。
P0 运行现有纯领域测试核对文档依据，其 PASS 只说明既有行为。
设计阶段实际核对：Control 的 `test_experiments.py` 1 项、`test_verification.py` 4 项，
PC-Gym 的 `test_pcgym_reproduction.py` 34 项，合计 39 项通过；没有执行真实求解或训练。

## P1：纯模型与现有环境观察

- [x] 在 Rust Runtime 中定义 Profile/Requirements/Template/Binding/Snapshot/Use 具名类型、
  纯匹配与 Use 转换；先不添加通用 registry、Store interface 或网络服务。
- [x] 固定两个 App 的方法软件要求声明；方法版本仍关联原 Spec/pipeline provenance，
  PC-Gym 的 smoke/table6 保持科学档位语义。
- [x] 通过现有 Host 准备/配置接缝观察当前 Python、依赖、ngspice、平台及缺失信息。
  本阶段不改变 App 解释器、安装依赖或启用原先不可用的引擎。
- [x] 在原 receipt 中增加可选观察引用，旧记录缺字段即未记录环境，不迁移原 Spec hash。

实际代码与测试、探针事实及缺口见 [P1 记录](../fitness/ai4s-environments.md)。
Rust `AppStore::inspect_environment` 只探测配置的解释器，不启动/安装 App；Control 新运行保存
观察制品并由原 Store 记录哈希，PC-Gym 新回执内联观察并沿用原导出 manifest。

门槛：一个按概念组织的表覆盖同名异内容、观察缺失、条件不满足、允许偏好、换代失效、
固定历史快照，以及 acquire 中取消/晚到成功只释放。纯测试传入固定时间和 ID。
两个现有环境均可报告实际条件与阻塞，不把包版本清单标为完整锁、固定构建或已获准。
Profile 已准备、能导入、原进程成功分别表达。未实现的操作不进入 Host 公共协议。

## P2：attempt-scoped Use 与原执行入口接线

- [ ] 新增 `protocol/environments.tsp` 的最小版本化值合同及边界转换；只发布已实现操作。
- [ ] 实现设计中的私有 reserve → admit → dispatch → observe/end 交接。原 Python Owner
  创建/保存原 attempt 并提供准确描述；Host 从实际 backend 与原批准上下文取得 consumer。
  Rust 持久化 Use；Python 消费准确准入回执后才运行。Control 批次仍由原 Store 推进。
- [ ] 把 consumer、要求/解析/快照及 use 引用关联到原 request、attempt 和回执；不新建 Run。
- [ ] 取消、关闭、版本改变和未知回复都保留原停止路径；重启按原 ID 观察，不自动重派发。
- [ ] 受管验证独立 Use；导出的标准库 checker 继续脱离 Host 运行，外部回执可在导入时关联。

门槛：真实 loopback/受管进程交接测试覆盖每个持久化边界后的回复丢失、重复请求、
错误 backend/consumer/Spec、取消后迟到准入、执行完成但尚未释放、缺少停止确认。
至少一次实际 Control 引擎和一次真实 PC-Gym CPU smoke 的记录必须关联实际 Use；
fixture 进程仅证明交接，不能充当科学计算结果。已有批准、预算、完整性与离线重算均通过。
缺少科学依赖时本阶段保持未验收，先报告准备缺口，不临时安装或改用 fixture 曲线。

## P3：计算解释器分离与可复用软件准备

- [ ] 显式登记计算 Profile；App 服务 Profile 与科学计算 Profile 独立引用。
- [ ] 为 python-control 提供有界计算子进程，保持原 numerical core、输入输出合同和 Store。
  ngspice 使用实际绑定程序；不在运行中通过变化的 PATH 静默选择其他 executable。
- [ ] PC-Gym 选择的解释器贯通 freeze、批准摘要、launch、worker、checker 和导出；
  代码/依赖加载观察与固定描述一致，旧 Spec/preflight 不被放宽。
- [ ] 复用 Host 准备逻辑形成明确 Recipe/Profile；变更新建版本，不覆盖正在使用的环境。
  没有完整制品锁的 adopted 环境保持 observed，不声称可以从零重建。
- [ ] 缺依赖时单独提供经授权的准备动作；准备成功后重新固定绑定与批准，不自动启动计算。
- [ ] 界面显示计算所用环境、阻塞、准备进度和结果关联。优先接原任务界面，不先建大型环境编辑器。

门槛：两个独立软件选择和工作目录可并存；切换/准备计算环境不改变 App 服务解释器或
原结果来源。改变 Profile 后旧 ticket/批准不可用；取消仍能停止原进程。
真实 Control 双引擎与 PC-Gym smoke、离线 checker、缺依赖恢复和重开历史均有回执。
实际界面验收覆盖 light/dark、窄窗、键盘、准备失败、运行与取消，并保留截图。

## P4：远程执行、驻留与替换接缝

- [ ] 按一个实际科研任务选择既有 Worker/RuntimeBinding 后端，关联同一方法与输入引用。
- [ ] 保留 Go 对资源创建、观察和释放的唯一所有权；Rust 只关联其准确执行/资源回执。
- [ ] 分别保存提交时要求和分配后观察；验证数据驻留、输出取回、取消和未知效果对账。
- [ ] 第二个真实实现出现后才抽取 consumer 所需的最小端口；沿用已有架构边界检查机制。

门槛：真实远程任务及独立检查通过，准确记录实际分配和数据位置，无静默本地 fallback。
本地通过不能推出 GPU、MPI、Slurm、集群隔离或生产部署通过。Slurm/外部工作流若被选中，
保留其原 job/run 身份和调度权威，不复制其内部队列。仪器、样品和托管科学服务另行设计。

## 两场景的行为检查表

| 输入 / 事件 | Control Lab 的预期 | PC-Gym 的预期 |
| --- | --- | --- |
| 环境观察缺失或不满足必要条件 | solver 不启动；保留原预算/attempt 准入事实 | 不训练；保留准确缺包与原请求状态 |
| 已有环境与要求匹配 | 原 Store 准入后绑定 attempt Use | 原精确批准且消费回执后绑定 attempt Use |
| 软件或科学解释器改变 | 原 Spec/结果不修改；新执行绑定重新批准；科学要求变化时新建 Spec 版本 | 原 ticket 拒绝；新 Spec/请求覆盖新执行身份 |
| acquiring 时取消，随后收到成功 | release 意图不回退，释放晚到授权 | 同左；原 request 可取消且绝不启动 worker |
| 运行取消或回复中断 | 保存部分文件；观测停止后释放，未知不重试 | 保存原 attempt；原 owner/ID 对账，未知不重训 |
| 原始输出被改动或缺失 | Observation/验证按原规则拒绝，不能删场景 | integrity/checker 拒绝，保留完整 policy/episode/sample 分母 |
| 环境就绪、数值检查通过 | 不自动表示工程接受 | paper verdict 仍由原规则决定，未知原实验不变成复现 PASS |
| 离线导出重算 | 保留原输入、观察与检查版本 | 无 Agent/训练依赖/Host 仍可重算，结果关联原 attempt |

## 验证方式与证据记录

以下命令均从仓库根运行。实现时按改动选择检查，不为文档变更重建整个 Desktop。

```sh
# 既有纯领域行为；不调用模型、不运行真实训练
python3 -m unittest discover -s apps/control-lab/test -p 'test_experiments.py'
python3 -m unittest discover -s apps/control-lab/test -p 'test_verification.py'
python3 -m unittest discover -s apps/paper-agent/test -p 'test_pcgym_reproduction.py'

# P1/P2 起：实际 Rust 核心与新增合同，具体过滤名随实现确定
node scripts/cargo.mjs test -p pero-runtime
npm run check

# 真引擎门槛，必须预先明确准备环境；不能以 skip 为通过
CONTROL_LAB_REQUIRE_SOLVERS=1 python3 -m unittest discover -s apps/control-lab/test -p 'test_*.py'
```

PC-Gym smoke/verify/export 按 [既有 CLI](../design-docs/paper-pcgym-reproduction.md#5-操作方式)
在明确准备和批准的环境中执行；实际解释器、源码、Profile、Spec 和全部策略结果须记录。
UI 起点为 [Control E2E](../../tests/e2e/control-lab.mjs) 与
[Paper native E2E](../../tests/e2e/paper-reproduction-native.mjs)，新行为需扩展原 suite。
P4 再运行受影响的 Go/Worker 测试和真实后端 gate，不把未配置的 skip 计入验收。

后续每阶段在 `docs/fitness/` 的对应记录中保存 source revision、系统、Profile/Use/attempt、
实际命令与输出、证据位置、验收等级和缺口。源码、fixture、真实科学计算、UI、真实 Agent、
安装包与生产分别报告；P1 记录只证明模型和软件元数据观察，不宣称科学运行 PASS。

## 实施纪律与停止条件

每个阶段按模型、接线或场景迁移拆分 Conventional Commit；每次只提交相关文件/片段，
保留并发工作树。文档提到的类型/API 不代表需要一次性实现全部操作。
无法确认原执行停止、未知派发结果、无法证实必需条件或预算/批准绑定变化时停止准入，
保留原记录并给出恢复入口。环境层不降低科学标准、不自动补造历史观察、不为缺少依赖
引入替代曲线或隐式下载。本计划没有承诺全量 table6 训练、自动 checkpoint 续跑或通用 GC。

## 2026-11-06 UI steering

The user requested Design alignment of the local creation form while continuing
the environment implementation. The shared manager now uses LibraryHeader,
ghost Back, Field/Input/Select and a named software summary on shared Card;
workspace `surface` becomes full-height `bg`. Existing preparation and binding
behavior is preserved, with the sandboxed submission bug fixed. Migration and
actual Electron evidence are in the [preparation report](../fitness/local-environment-preparation.md).
This does not close the remaining Docker/VM/Compose/Slurm execution gates.
