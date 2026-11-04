---
kind: design
date: 2026-11-02
status: p1_implemented
---

# AI4S Environments：方法所需条件与本次实际使用

本设计把 Environment 定义为：**为已有科学方法解析、观察和绑定执行条件的领域对象**。
同一研究可以经过多个环境；每次具体计算与验证分别保留自己的 Use 和实际快照。
P1 已实现纯值模型、匹配、配置解释器的只读观察及新执行证据关联；无新增公共环境 API，
无 live Use 准入，也未运行科学验收。实际范围见 [P1 验证记录](../fitness/ai4s-environments.md)。

决策见 [ADR 0029](../adr/0029-ai4s-environments.md)，研究依据见
[研究记录](ai4s-environments-research.md)，两个真实场景的设计检验见
[Control Lab / PC-Gym 映射](ai4s-environments-scenarios.md)，交付顺序见
[实施计划](../exec-plans/2026-11-02-ai4s-environments.md)。

## 1. 问题与范围

现有基础包括 Rust Host 的 App/Python 准备、App 自有实验台账和进程、工作区租约，
以及 Go server 的 Kubernetes Owner、RuntimeBinding 和既有 Worker 协议。
它们尚未提供跨科研方法的环境选择、实际条件绑定和结果追溯合同。

首版覆盖 Control Lab 的 python-control/ngspice，以及 Paper 的固定 PC-Gym CPU smoke。
先观察当前环境，再分离 App 与计算解释器；本地使用不要求启动 Go server。
后续以真实需求接远程计算。GPU/HPC、托管科学服务和仪器是边界检验对象，不是首版能力承诺。

| 概念 | 唯一所有者 | Environment 关联什么 |
| --- | --- | --- |
| 科学方法、模型、参数、单位、seed、实验预算 | App 的 ExperimentSpec / ReproductionSpec 或既有 Playbook | 方法与要求的版本引用 |
| 数据内容、划分、模型权重、力场 | 输入资产与领域方法 | 准确输入引用及获准访问的绑定；不复制领域含义 |
| 科学软件、原生程序、镜像 | 软件准备 Owner | 配方、实际制品和观察 |
| 机器、设备、挂载、凭据、实际授权 | Host / Compute / 原资源 Owner | 资源身份、能力观察和非秘密授权引用 |
| 执行、取消、重启恢复、进程结果 | 原 App 执行 Owner 或 Host / Worker | 本次 Use 和外部执行身份引用 |
| 原始输出、Observation、Verification、接受 | 产物及领域检查器 / 研究者 | 快照引用；不产生科学 PASS |

Gym 的环境动力学、奖励和初始状态属于方法；App 服务环境、Agent 环境、科学计算环境
分别管理。关闭聊天不暗示计算取消，退出 App 时仍执行现有进程监督和停止策略。

## 2. 领域模型

以下为完整目标模型的命名与不变量，不是已发布 wire schema。P1 只实现本地软件观察所需的
基础值与转换；多资源槽位、准备执行器和 live Owner 接线留待后续。所有 ID、时间与观察由 shell 传入。
源码/锁文件内容改变产生新身份；路径、版本标签、镜像 tag 均不能代替内容或运行身份。

| 类型 | 必要内容 | 核心不变量 |
| --- | --- | --- |
| `SoftwareRecipe` | schema、解释器/基础制品引用、依赖锁引用、平台、受支持准备方式 | 固定准备输入；声明不授予下载、安装或执行权限 |
| `SoftwareProfile` | recipe 引用（可缺）、实际解释器/软件制品记录、平台、准备回执、证据范围 | `prepared` 与 `observed` 明确区分；已有环境登记不能虚构完整锁或可重建性 |
| `EnvironmentRequirements` | 方法版本、必要条件、偏好、输入访问要求 | 必要条件不满足就阻塞；仅允许方法预先声明的兼容选择 |
| `EnvironmentTemplate` | id/version/digest、命名槽位、Profile/Recipe 引用、资源要求 | 固定定义；不包含工作流 DAG、科学目标或任意 shell 安装命令 |
| `EnvironmentBinding` | slot、实际 Owner、资源引用、incarnation、观察引用 | 同名资源换代不接续旧绑定；软件/数据身份和运行身份分别记录 |
| `EnvironmentInstance` | 固定 Template、bindings、关联使用记录 | 每个实例仅有一个协调所有者；可用性由当前要求和观察推导 |
| `EnvironmentSnapshot` | 固定要求与解析引用、实际 bindings、观测时间、有效条件、未知项 | 不可变；后续观察追加新记录，不覆盖历史使用证据 |
| `EnvironmentUse` | id、consumer、要求引用、snapshot 引用、操作方向、use/release 意图、授权/释放引用、state | consumer 指向已有 attempt 或 verification；不再创建一份执行状态机 |

`SoftwareProfile` 是可复用的软件记录，不拥有 CPU/GPU 分配或另一个进程生命周期。
同一 Profile 可以用于多个独立工作目录；正在使用的 Profile 不原地安装升级。
登记现有 venv 首版只报告实际清单；包版本/安装元数据摘要不宣称文件级完整性或远程证明。
已准备制品还应记录真实解释器版本/身份，不能把可变路径或 `python3.12` 选择符当成固定字节。

### 方法声明与类型边界

方法继续由 App 拥有，增加版本化执行声明：方法/实现引用、输入与输出 schema 引用、
EnvironmentRequirements/Template 引用及受信入口引用。参数、单位、seed、评价规则仍来自
原 Spec；入口由 composition root 映射到现有程序/路由，UI/Agent 不提交可执行路径或命令。

必要条件按实际支持的条件定义具名类型，例如 Profile 身份、Python 版本、NativeProgram 身份、
CPU 执行方式与输入访问模式。首版不做通用 semver 求解器或自由字符串 capability 注册中心。
领域特有条件由 App 的具名类型解释；跨边界只传 schema/version 与固定内容引用。

一个资源可以被引用但不可访问；身份、观察和授权必须分别成立。普通变量可进入配方，
凭据只由实际 Owner 解析；公共快照无 bearer、密钥或私有绝对路径。

## 3. 要求、解析与观察

1. **要求**在原 Spec/批准绑定中固定：软件、数据访问、资源与允许替代。
2. **解析**选择具体 Profile、输入版本和执行目标，保存固定内容身份。
3. **观察**记录实际软件、资源分配、数值运行属性及其时间和未知项。

排队作业在提交时未必知道实际节点。先保存要求与外部 job 身份，分配后、计算准入前
核对可观察条件；启动后才可知的属性作为关联回执追加。无法观察的必需条件保持阻塞。
声明或 API 接受成功不能冒充实际分配、库已加载或授权生效。

`ready` 是相对要求的匹配结果，不是永久全局绿色状态。检查可用的软件仍不等于任务已获准。
硬件精度/线程等实际属性须与方法要求对照；科学容差仍由固定验证策略决定。
相同软件在不同硬件上的结果是否可比较，由方法规则判断，不只比较快照 digest。

## 4. 转换与生命周期

核心采用 `(state, command, now) -> (next, effects) | error`，只处理值。
shell 做持久化、进程/文件/网络 I/O，调用原 Owner，并将真实效果回执送回核心。
不为未知结果生成新的操作 ID，不增加后台重派发循环或分布式协调机制。

| Use 当前状态 / 输入 | 下一状态或结果 | 所有者动作 |
| --- | --- | --- |
| 无记录 / `BeginUse` | `acquiring`，固定 consumer、要求、解析和操作 ID | 先持久化，再请求现有执行/资源 Owner 准入 |
| `acquiring` / 原 Owner 确认准确绑定与权限，意图仍为 use | `active`，固定 snapshot 与回执 | 原执行入口再次核对未取消和原批准后启动；Use 本身不启动算法 |
| `acquiring` / 确认未获准且无未结效果 | `released`，保留 not-started 原因与确认 | 结束此次申请；不伪造计算失败 |
| `acquiring` / 回执中断或结果不明 | `unknown`，方向为 acquire | 查询原 ID；不得直接执行或重新申请替代资源 |
| `acquiring` / `unknown(acquire)` / 请求结束 | 持久化 release 意图，保留原未结操作 | 关闭准入；晚到 acquire 成功只进入 releasing 并释放，绝不启动计算 |
| `active` / 请求结束 | `releasing` | 原执行 Owner 先停止/确认完成，再释放本次使用权 |
| `releasing` / Owner 确认停止与释放 | `released`，保存回执 | 不删除共享软件和输入，不擅自清理输出 |
| `releasing` / 效果不明 | `unknown`，方向为 release | 保留占用与原引用，对账原操作 |
| `unknown` / 原 ID 对账 | 按已保存意图进入 active/releasing/released 或仍 unknown | 只接受原 Owner 事实；release 意图不可回退为 use |

相同 ID、相同内容返回原记录；相同 ID 不同 consumer/要求拒绝。
资源观察失效时由原 Owner 停止准入/取消或对账；Use 未获释放确认前不能声称 released。
Use 状态不代替 attempt 的 running/failed/completed，也不代替 Profile 的准备进度。
实例的 unavailable/available/degraded 从绑定推导；模板发布停用不改写历史版本。

结束 Use 与清理资源分开：先确认原计算停止和使用权释放，再由资源所有者按保留策略清理。
首版只登记已有资源并保留软件，不实现通用 destroy、租约回收器或跨 Host 自动 GC。
现有 WorkspaceLease/进程锁仍由原入口持有；环境适配器引用实际结果，不再次获取同一把锁。

## 5. 计划接口

以下是语义合同；P1 已实现纯匹配/选择与只读观察，其余按阶段接线。
[Environments UI](../fitness/environments-ui.md) 通过 App-origin `/host/environment`
发布固定方法的软件观察；这不包含下表的准入/Use 操作，也不承诺为 P2 wire schema。
适配器消费领域值；transport 在边界校验一次，并映射具名错误，不重复实现核心规则。

| 操作 | 输入 → 输出 | I/O 与授权边界 |
| --- | --- | --- |
| `InspectProfile` | 受信配置选择的环境引用 → Profile 观察、缺失项 | 固定版本/导入探针；无安装、clone、模型下载 |
| `PrepareProfile` | 已批准 Recipe 引用 + request ID → 准备记录/回执 | 复用 Host 准备；独立显式操作，不由 Inspect/执行批准隐式触发 |
| `Match` | requirements + 已观察候选 + now → resolved selection 或具名阻塞 | 纯函数；必要要求与偏好分开，不降级 |
| `Bind` | template + 原 Owner observation → 下一实例/快照 | 核心核对身份和条件；观察由实际 Owner 提供 |
| `BeginUse` | consumer + 固定选择 + 原批准引用 → Use 或 not-started | consumer/批准由可信调用上下文解析，不信任 App body 自报 |
| `ObserveUse` | 原 use ID → 使用事实/关联观察 | 无启动、续跑或重新创建资源的效果 |
| `EndUse` | 原 use ID + 原执行结束事实 → 释放结果 | 取消走原执行 Owner；不以 UI 消失或 TTL 代替停止确认 |
| `ReconcileUse` | 原 use ID/操作方向 → 原 Owner outcome | 只查原操作；未知不算已停止 |

核心错误至少区分 `RequirementUnsatisfied`、`ObservationMissing`、`IdentityChanged`、
`NotAuthorized`、`UseConflict`、`OutcomeUnknown`。日志中实际 I/O 失败保留可恢复信息，
不把全部错误压成“环境不可用”。缺少硬内存/磁盘限制能力时如实报告，不虚报已强制预算。

### 代码与协议落点

- 本地领域核心位于 `crates/pero-runtime/src/environments/`：具名值、匹配和纯 Use 转换。
  不依赖 Host、transport、生成协议、clock 或 filesystem；暂不另建 crate 或 Go daemon。
- Rust Host 复用 App 配置、准备与 stdio 边界；Python 后端把接收的固定描述解为
  frozen dataclass，继续拥有科学进程和领域台账，不复制环境生命周期。
- P2 才新增 `protocol/environments.tsp` 与对应边界转换；本轮不发布 schema。
  Rust/TS/Go 的 wire 表示共享合同，不在每个语言里另写相同状态转换。
- 远程 Go `runtimebinding` 继续独占 Run 的基础设施创建、观察、释放；Rust Host/Worker
  只引用该记录及其真实回执，不复制第二份资源生命周期。每个 Use 的协调者只能有一个。
- 只有第二个真实实现出现时，consumer 才抽取最小 Owner/Store 端口。
  首版用已有本地准备/进程 seam；不预建覆盖所有平台的接口继承树。

### Python 执行 Owner 与 Rust Use 的交接

P1 已实现只读观察，不能把既有执行包装成已有 Use。P2 接入单次计算准入，复用 Host 到受管
App 后端的私有认证传输；不增加 Python 可调用的公共 Host HTTP 服务。

| 顺序 | 责任与持久化边界 |
| --- | --- |
| reserve | 原 Python Owner 按原批准/预算保存已有 attempt 的未启动记录及固定执行描述；描述返回原 request/attempt、Spec、要求、软件选择和输入/输出引用 |
| admit | Host 从实际 App/backend 实例和原调用上下文核对描述；Rust 先保存 acquiring Use 与原 attempt 引用，再调用真实准入 Owner；成功后保存 active 回执 |
| dispatch | Host 通过固定私有入口把该回执交还原 Owner；Python 核对原批准/取消/预算与描述，持久化原 attempt 对回执的一次消费，再进入已有计算入口 |
| observe/end | Python 在原台账保存运行、停止与输出事实；Host 按原 request/attempt 读取这些事实并结束 Use；Python 也保存 use 引用，双方只关联、不复制对方状态 |

批量 Control 搜索的候选/场景顺序仍由 Python 决定；原 operation 逐次提供待准入 attempt，
Host 只响应其环境请求，不选择下一候选、不复制批次队列。私有入口不注册为 App/Agent
通用写路由，不接受 body 自报授权、任意 attempt 或解释器路径；PC-Gym 沿用私有 compute
capability 和原 ticket 消费约束。未批准操作不得通过 reserve 创建新的计算授权。

原 Owner 未拿到并消费准确回执前不进入 solver。reserve/admit/dispatch 任一步回复中断，
重启只读取原 attempt/Use/消费事实；不能确认未启动时保持待核对，不重发 dispatch。
取消先保存原停止意图；晚到回执只清理。该交接要在 P2 的 loopback/进程测试中证明，
不是现有能力，不能只加 receipt 字段就宣称接通。

## 6. 与批准、预算、验证和旧记录的关系

环境准备授权和科学计算批准不同。Profile/解释器/资源选择改变时，更新原批准绑定并重新批准；
环境记录不能扩大已有工具、文件、数据或预算权限。Control Lab Goal、PC-Gym 私有 ticket、
Host 工作区锁和各 App 的计算预算继续由原所有者执行。
按原批准要求得到排队后的实际分配并补录观察，不等于改变已批准的选择；超出原约束才
需要重新选择和批准。沿用原审批路径，不追加一个独立环境审批队列。

先在现有 record/receipt 附加可选环境引用，不重写历史 Spec hash。旧记录标为 legacy/未记录，
不能从当前机器补造历史环境。需要把环境要求纳入新 Spec 时，显式升版本；PC-Gym 新版本同时
覆盖 digest、批准、worker/checker、导出与离线验证，不能只放宽原 preflight。

分离科学解释器需要固定计算入口、输入/输出文件和实际解释器绑定。Control Lab 的 in-process
Python 计算与 Paper 当前解释器选择都需迁移；UI selector 本身不完成分离。
先固定实际软件与输入再批准科学执行；批准后发生变化必须阻塞原调用。

Pero 管理的执行与验证申请不同 Use，可复用软件制品但 consumer、输出访问和回执不同。
PC-Gym 的标准库离线重算无须训练依赖；独立进程不宣称安全盲评或独立科研团队复验。
独立导出的 checker 继续无 Host/环境协调器运行，可产生包含输入、检查器与实际观察的
外部验证回执；导入后关联原证据，不能补造一个历史 managed Use。
运行成功、回执完整、数值检查通过、论文结论和人工接受分别保存。

## 7. 恢复、复用与范围限制

| 行为 | 保留的责任 |
| --- | --- |
| 环境重建 | 软件 Owner 根据固定准备输入产生新观察；不声称实验输出相同 |
| 结果复用 | 方法/执行 Owner 判断完整输入、方法及条件是否满足复用规则；保留原 attempt |
| 工作流恢复 | 原执行 Owner 恢复已保存的编排或观察外部 job；不自动重发已接受的动作 |
| checkpoint 续算 | 方法声明支持的模型/优化器/RNG/数据游标及软硬件兼容；显式关联原 attempt |
| 新实验/新版本重跑 | 创建原领域体系中的新 attempt/Spec，保留差异和批准 |

首版不包含自动结果缓存、checkpoint 续跑、通用工作流 DSL、科学服务市场、仪器/样品台账，
也不把可信本地 App 改造成不可信代码沙箱。现有隔离配置继续按 ADR 0017/0018 单独准入。
后续外部工作流和托管服务可以保留其执行身份与不透明字段；必需而不可证的条件不能标为满足。

## 8. 验收与后续决策

本设计已完成两场景的源码职责映射和 P1 软件观察检验；科学运行与 P2+ 接线验收仍待实施。逐阶段门槛和命令见
[实施计划](../exec-plans/2026-11-02-ai4s-environments.md)，行为案例见
[场景验收矩阵](ai4s-environments-scenarios.md)。
只有两个场景都能表达要求、准确绑定、not-started、取消/未知、输出和独立检查，才提取共享层。
远程接入须另证资源分配、数据驻留、原执行身份和释放；仪器后端须再证实时观察与原控制租约。
这份文档不关闭现有科学验收问题，不代表任一部署、安装包或论文复现已通过。
