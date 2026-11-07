---
kind: design
date: 2026-11-06
status: accepted_design
---

# Compute 与 AI4S 环境能力：软件、资源组合和一次实际使用

本设计承接 [ADR 0029](../adr/0029-ai4s-environments.md) 和
[AI4S 环境设计](ai4s-environments.md)，扩展其多资源、Docker、VM 和服务组合部分。
用户已要求将设计登记为 [ADR 0030](../adr/0030-compute-environment-capabilities.md) 并开始实现。
本文记录已接受的设计，不是实现或验收声明；各阶段按实际交付单独记录。
COBOL 相关代码仍不提交；设计接受不表示已有运行资源被迁移。

## 1. 设计结论

Environment 是**为一次已有计算或验证绑定运行条件的资源组合**，不是实验本身、
某个安装目录、一台 VM 或一个任务调度器。用现有 Template / Instance / Binding /
Snapshot / Use 扩展表达组合，不再增加同义的 ComputeEnvironment / Capsule 聚合。

三个产品入口的职责：

- **Compute**：计算地点、资源配置与实例、可提供的执行能力、关联执行和回收情况。
- **Environments**：软件配方、准备结果、要求匹配、可复用的环境模板。
- **领域 App**：方法、输入、参数、实验预算、已有 attempt、结果与验证。

资源与软件界面相互引用，不要求先合并 App。删掉管理 App 不应删除 Host 的环境能力。
本地操作不要求启动 Go 控制面；远程资源继续经已有控制面和 Worker。

**不定义 `EnvironmentKind = local | docker | vm | slurm`。** 这些概念不在同一轴上：

| 维度 | 例子 | 负责回答 |
| --- | --- | --- |
| 执行地点 / Placement | 本机 Host、某 Worker、某站点 | 谁可访问数据和实际资源？ |
| 软件来源 / Software | 已有 venv、原生工具链、OCI 镜像、VM 基础盘 | 准备什么、实际用了什么软件？ |
| 资源供给 / Provisioning | 本机进程空间、Docker 容器、Tart VM、KubeVirt VM、站点 allocation | 怎样获得及释放资源？ |
| 操作能力 / Access | 受管进程、批作业、服务会话、终端、桌面 | 方法能执行哪种操作？ |

Docker 可以运行在 VM 中；Slurm 可以在分配的节点上启动容器；VM 可以同时提供
编译进程与桌面。上层方法选择所需能力，部署细节由已选择的适配器解释。
用户或站点先选定目标，Host 只在明确允许的候选中匹配，不新增自动 placement 调度器。

## 2. 当前证据与真实缺口

分析基于 Pero `62d004809af24983a6203a713df93a05703efc24` 和当前工作树，
Point `b45190a3db725953128b4a8a40e95a287aa9bfd7`。下表不是本轮实跑结果。

| 已检查位置 | 当前事实 | 对设计的约束 |
| --- | --- | --- |
| `apps/compute/README.md`、`backend/clusters.py` | 只保存连接草稿；无 SSH/Slurm 通路 | UI 记录不能冒充资源可用或作业已提交 |
| `crates/pero-runtime/src/environments/` | 有软件匹配、单 binding 快照和纯 Use 转换；没有 live Use 接线 | 扩展该核心，不能另建一套环境状态机 |
| `crates/pero-runtime/src/apps/local_environment.rs` | 本机 venv 准备、App 级绑定和后端重启 | 保留其 App 服务语义；每次科学计算绑定要单独接线 |
| `server/internal/environments/`、`runtimebinding/` | 已有特定 Kubernetes Worker 资源适配和 Run 绑定 | 它不是任意 App 作业接口；不要另复制一份远程资源所有权 |
| Point `environments/model`、`ports` | 多槽位、真实 Owner、运行代次、Use、准备与处置分别建模 | 借鉴语义和具体适配器，不搬入整个 service/storage/coordinator |
| Point `environments/recipes` | Docker/TK5/服务组合、VM 和专有编译器准备输入 | 配方不等于实例、可用授权或软件许可证 |
| Point Docker 编译和 Desktop provider | 实际执行分散在领域编译器与 Desktop 适配器 | 不存在一个可直接整体迁入的通用 Docker 环境引擎 |

Pero 已有 AI4S [来源研究](ai4s-environments-research.md)在 2026-11-02 对照了
Nextflow、AiiDA、Galaxy、atomate2、PyTorch、OpenMM 和实验室平台的官方资料。
本轮沿用其中的职责分析，未重新联网核验这些平台或把文档能力当作 Pero 实现。

## 3. 唯一所有者与核心对象

复用已有概念；以下是目标模型，非已发布 wire schema。

| 对象 | 自己拥有的内容与不变量 | 不吸收的内容 |
| --- | --- | --- |
| `SoftwareRecipe` / `SoftwareProfile` | 配方固定准备输入；Profile 记录实际软件及证据范围。配方、构建产物和运行时加载观察有不同身份 | CPU/GPU 配额、随机种子、模型权重、实验状态 |
| `EnvironmentRequirements` | 某方法版本的必要条件、允许替代、偏好；必要条件不可用时阻塞 | 科学容差、训练步骤、业务保真度的含义 |
| `EnvironmentTemplate` | 固定版本的命名资源槽位、软件引用、能力要求和连接关系 | workflow DAG、任意安装 shell、领域计算流程 |
| `EnvironmentInstance` / `EnvironmentBinding` | 实例聚合当前槽位绑定；每项保存实际 Owner、资源身份、运行代次、观察和处置策略 | 第二份 Run、排队状态或数据目录 |
| `EnvironmentSnapshot` | 本次选择的槽位、要求、软件与资源观察的不可变记录，明确未知项 | 覆盖历史观察、把缺失值填成默认值 |
| `EnvironmentUse` | 原 attempt/verification 对选定绑定和操作的使用，引用真实授权、停止和释放事实 | 调度、执行重试、科学 verdict |
| 原有 Method / Spec / Attempt / Artifact / Verification | 方法、输入含义、预算、执行、产物、比较和验收各自保持原所有者 | 这些对象不迁入环境聚合 |

`ExecutionOwner` 指现有 Host/Worker 或领域后端的进程/作业监督者，是职责名，
不是要求现在新增同名服务或接口。`ResourceOwner` 是实际创建、观察和处置资源的适配器。
资源 Owner 与执行 Owner 可以是同一个具体实现，但模型不推导它们必然相同。

### 软件模型必须解除 Python 中心假设

现有 `ProfileObservation.python` 为必填，不能表达纯 GnuCOBOL/JDK 或 VM 软件。
建议将解释器作为可选的具名软件组件，同时保留原生程序和平台观察；Python 包记录
必须关联其解释器，不能假定所有包共享一个全局解释器。初期支持实际消费者需要的
Python、原生程序和 OCI 镜像记录；VM 基础盘引用归其准备配方，客体探测产生软件观察。

不要用一个开放的 `map<string, any>` 代替这些类型，也不一次实现所有包管理器。
`Requirement::Native` 需支持明确的版本/制品要求；版本兼容关系由方法声明，
先用精确版本或显式集合，不新增通用 semver 求解器。

Profile 的几类身份必须分清：

- 配方摘要固定构建意图，不证明构建结果相同。
- OCI index digest、平台 manifest digest 和本地 image config ID 分别记录，不混为一个 hash。
- venv 包元数据不是全部安装文件的指纹；VM 基础盘摘要不是运行中可写盘的摘要。
- compiler/solver 的实际路径由 Owner 私下解析；公开记录保存身份和观测，不能由 UI 自报版本选择可执行程序。
- `observed`、`prepared`、文件完整性和运行时加载证据分别表述。一个总的“可信等级”不能替代这些事实。

## 4. 资源槽位与组合

一个模板声明完成某类操作所需的资源结构。一个 Use 只取得该操作实际需要的槽位。
以下为语义示例，不是可直接提交的配置格式：

```text
EnvironmentTemplate
  identity: id + version + definitionDigest
  slots:
    compute: execution capability + software requirements + placement constraints
    database: service capability + prepared recipe reference
    desktop: interactive capability + prepared recipe reference
  links:
    compute -> database.sql
    desktop -> compute.terminal
```

每个槽位有明确的取得方式：附着已有资源、创建专用资源、从已有池领取。
同一个实际资源可以提供多个命名能力；VM 同时提供进程和桌面时，引用同一个资源
绑定，不能因为两个能力槽位就创建两台 VM 或把相同资源重复锁定。

方法的 Requirements 固定所需能力与槽位选择，并包括其必需连接的依赖闭包；
UI 不能任意删掉数据库槽位来绕过要求。准备整个实例和使用其中一项能力是不同动作：
未使用的可选服务失败不自动阻塞不依赖它的方法，已选必需服务失败则必须阻塞。

每项绑定有独立处置策略：detach、retain、return 或 destroy。只有实际 Owner 支持的
策略才可选择；引用别人管理的资源不能获得删除权。Use 结束不等于销毁实例。

### 软件封装不决定操作能力

最先需要的能力族如下；具体入口由受信装配选择，不暴露万能 `run(command)`。

| 能力族 | 本次明确含义 | 不能推导的能力 |
| --- | --- | --- |
| 受管进程 | 固定方法入口、有界输入输出、实际进程身份和停止确认 | SSH 可用不自动表示可跟踪整个进程树 |
| 批作业 | 站点提交、外部 job/step 身份、状态/产物读取、原作业取消 | 提交成功不是已分配节点；Slurm ID 不是 Pero Run ID |
| 服务会话 | 特定服务端点、连接范围和会话释放 | 能连数据库不表示可任意读写所有数据 |
| 终端 / 桌面 | 观察、输入及其会话身份；可分别授予 | 有屏幕不表示有受管进程；终端关闭不表示远端作业取消 |

操作、隔离、取消和资源限额分别报告支持程度。不可取消的 TK5 reader job 应明确
拒绝“要求可取消”的方法，不通过杀掉终端窗口伪装成停止。只支持 VNC 的旧 VM
仍可提供桌面，但不能承诺自动原生编译与进程回收。

### 服务组合优先复用原生部署单元

同一 Docker daemon 下的 GnuCOBOL + TK5 + CICS/IMS + desktop，优先用一个固定版本
Compose 配方作为准备单元，由 Docker/Compose Owner 保存实际子资源集合。
Environment 只投影需要使用的成员和连接，不在 Rust 中重写 Compose 的启动控制器。

`links` 表达通信关系与允许的调用方向，不是“执行完 A 再执行 B”的科学工作流。
单个组合的健康检查由配方定义，使用某能力前还要有对应的 readiness 观察。
容器 running、端口开放、SQL 可查询、科学模型可用是不同条件。

跨 Docker 与 VM 的组合由已有 Host 环境协调入口逐项申请并保存结果；不假装跨
Owner 有原子事务。准备中途失败时，记录成功项和未结项；只按已选策略清理本次
创建的资源，保留共享数据和外部附着资源。未知效果先对账原操作，不重做整组准备。
先支持明确指定的成员与连接，不新增跨云部署 DSL、通用依赖求解器或调度平台。

连接必须有部署可实现性：同 daemon、同网络、VM 客体可达或已配置站点通道。
不把宿主 `localhost` 交给容器当成数据库地址，不隐式开公网端口。
公共快照只保存端点/会话引用；地址与凭据在实际 Owner 的私有授权通道解析。

## 5. 四段流程与审批

### Prepare：准备可复用条件

由用户/站点显式准备软件或资源配方。观察不触发安装；计算批准不隐含拉镜像、
下载模型、安装工具或获取商业许可。持久化原操作 ID 后调用实际准备 Owner。
准备得到软件/资源事实，尚未获得执行某个科学方法的批准。

### Resolve：固定本次执行选择

领域方法提供已有 Spec/输入引用、Requirements、固定入口和输出声明。
Host 在选定地点解析软件、资源和访问引用，生成本次选择的摘要供原批准机制使用。
方法参数与源码只保留一份领域定义；这里传引用与固定内容，不复制一份科学 DTO。

被批准的是方法版本、输入版本、工具链/镜像、允许的资源约束、操作范围和输出范围。
App 服务环境、Agent 运行环境与方法计算环境分别引用；修改其中一项不暗中替换另两项。

### Bind / Use：实际取得本次使用

原执行 Owner 先保存未启动的 attempt。环境核心保存 acquiring Use，shell 调用真实
Owner 准入并写回回执；原执行 Owner 消费准确的授权与绑定后才能进入计算入口。
Use 保存执行引用，不另创建第二个 attempt。采用 ADR 0029 已定义的 reserve/admit/
dispatch 交接，补齐接线而不是绕过原领域预算和批准。

多槽位准入按固定次序逐项记录；全部必要授权到齐之前不派发方法。失败时释放已取得
的使用权，未知项保持未结；不实现分布式锁或跨 Owner 原子提交。每个 Use 有一个
协调者，远程已有 RuntimeBinding 的基础设施身份只引用，不能在本地再次领取同一资源。
现有 `apply_use` 扩展保存每项取得/释放事实，并从它们推导聚合状态；provider
只回报实际效果，不再实现另一份环境 Use 状态机。

**Slurm 的特殊顺序：** 先固定软件和允许的 allocation 条件并批准提交，由原批作业
Owner 保存 job 身份；排队期间只有提交事实，尚无节点运行快照。分配后，受管作业
入口在科学 payload 前观察实际条件并建立执行绑定，不满足则停止该 payload。
不能要求先拿到节点才能提交，也不能把提交授权当作在任意节点上计算的授权。
具体节点在已批准约束内的解析不等于换方法；超出条件则重新选择/批准。

### Observe / End：保留事实并结束使用

运行期间的新增事实以关联观察追加，不覆盖原快照。实际 solver、GPU/driver、
加载库等可能只能在启动后得到，记录观察阶段和来源；启动前必需条件仍必须先证实。
原执行 Owner 保存结果与停止事实，再结算 Use。结果成功、使用权释放和资源清理
分别记录；清理失败不能抹掉已经存在的结果，也不能显示资源已释放。

沿用现有 Use 转换：acquiring → active → releasing → released；未知获取/释放
分别保持 unknown；取消意图不可回退。未知派发不自动重试。重启只对账原对象，
重新计算必须由原执行/领域规则创建新的 attempt。

## 6. 资源身份与后端对齐

| 后端 | 冻结/观察的关键身份 | 准备、执行与释放边界 |
| --- | --- | --- |
| 本机 | Host 身份、实际解释器/程序指纹、进程启动身份与专用工作区 | 不把 PID 单独当稳定身份；复用原进程监督和工作区租约；共享软件保留 |
| Docker | 明确 context 对应的 daemon 身份、平台镜像身份、完整 container ID、实际启动代次 | 不跟随 tag/context 漂移；CLI 退出不是容器停止；只回收原 ID 的自有容器 |
| Compose | 配方摘要、实际成员/网络/卷身份、每项运行代次 | project name 只作定位提示；不能按相同名称清理其他创建批次；卷按保存策略保留 |
| Tart | Owner 身份、clone 身份、基础镜像、客体 boot ID | 同名/IP 不等于同次启动；桌面与 guest 执行分别准入；已写入盘不冒充不可变镜像 |
| QEMU | Owner 管理的实例身份、进程启动代次、基础盘/overlay 引用、可获得的客体启动信息 | 进程启动身份不足以检测客体内部重启；缺 guest 能力时仅发布可证实的桌面能力 |
| KubeVirt | 集群、namespace、VM UID、DataVolume 身份、VMI UID | VM 资源与运行代次分开；沿用现有控制面 Owner，不在 Desktop 另持控制器 |
| Kubernetes Worker | 原 RuntimeBinding、Pod UID、容器代次/镜像与已有租约 | 继续由 server 创建/释放，Worker 继续拥有原执行 journal |
| Slurm | 站点/集群、提交回执、job ID 与提交时间、实际 allocation/step | 不单用可复用的数字 job ID；squeue 无记录不证明已停止，核对原 job/step 与 accounting |

Point 的语义可移植程度也要分别记录：

- model/ports 的多槽位、Owner 观察、准备/使用/处置分离适合作为语义参考。
- Docker/Desktop、Tart、KubeVirt 的具体探测与回收逻辑可按固定源版本适配；
  不移入其 Project 授权、独立状态存储或第二套 coordinator。
- COBOL Docker/TK5、CICS/IMS 和 VM 配方仍由领域配方目录维护；Compute 解释部署
  和资源事实，COBOL 解释数据集、主机操作及 fidelity。
- Point 部分后端本身仍有 KVM、guest consent、商业介质和真实站点验收缺口。
  搬入描述或通过 mock 不得标成 Pero 已支持；每种实际后端单独验收。

## 7. AI4S 对抽象提出的额外要求

### 输入、数据位置与可写状态

环境只引用输入的内容身份、位置及已获准的访问方式。方法拥有数据划分、样本、
模型权重、力场和训练集语义；输入数据准备/复制仍由数据或执行 Owner 完成。

固定输入、每次独立输出目录和长期可写状态分别声明。真实输入可能很大或不能出站，
因此支持在批准站点内 stage/reference，不能为了生成环境快照默认下载所有数据。
引用可见不等于具备读取权限；数据 locality、所需空间和访问方式属于准入条件。

数据库需要区分软件实例与数据版本。容器 image digest 不能固定数据库内容；
可复现实验需要领域提供事务快照、数据集版本或实际查询结果引用。不可观察的动态
状态如实保留，不宣称完整可复现。物理样本的消耗和仪器校准归实验室领域所有者，
不能用 volume reset 或环境重建替代。

### 数值条件与资源预算

方法规定允许的精度、设备类别、线程条件和验证标准；环境记录实际硬件、driver、
运行库、设备分配和可证实的设置。seed 与算法仍在 Spec，但可引用它投影出的执行要求。
相同镜像和 seed 不承诺跨 CPU/GPU、BLAS、driver 的相同结果。

科学预算（候选数、episode、样本量）由领域 Owner 执行；基础设施预算（CPU、
内存、GPU、墙钟时间、输出空间）由实际执行/资源 Owner 执行。区分 requested、
allocated、enforced、observed；平台不能强制的限制必须报告，不能把 UI 数字写成保证。

### 重现、缓存、恢复与验证

环境匹配只回答运行条件是否满足。结果是否可比较由方法/验证器判断，不使用
`snapshotDigest 相同 => 可比较`，也不因摘要不同就否认方法明确允许的比较。

方法 checkpoint 必须包含其需要的模型、优化器、随机状态与数据游标等信息；
环境只检查声明的恢复条件，不决定恢复是否科学有效。VM snapshot 是机器状态，
不是通用的科研 checkpoint。缓存复用、恢复控制流程、恢复数值计算和重新运行
由各自原有 Owner 处理，不进入环境生命周期。

验证可以使用同一软件制品，但应有独立 Use 和只读候选输入。逻辑独立、独立进程、
不同环境和不同信任主体分别描述。退出 0、数值检查通过、原论文复现和业务接受
保持独立；环境不产生最终科学 PASS，也不调整容差。

## 8. 用真实场景检验模型

| 场景 | 资源与软件绑定 | 领域继续拥有 | 关键反例 / 验收门槛 |
| --- | --- | --- | --- |
| COBOL → Java 差分 | GnuCOBOL 与 JDK，可在本机/不同容器；相同冻结输入、不同输出目录 | 源码闭包、编译选项、stdout/文件比较、运行 fidelity | Java 产物不是原生 COBOL 基线；两次执行与一个对照结果分别记录 |
| TK5 + CICS/IMS + 桌面 | Compose 服务组合、可写卷、终端和受管批处理能力 | JCL/数据集、3270 场景、主机状态规则 | 仅操作终端时不领取全部槽位；无取消能力的 reader job 不能宣称可取消 |
| NetCOBOL VM | 基础盘 + 独立 overlay、Windows guest、编译入口与桌面 | 许可证/介质、源程序/运行格式、vendor-native 解释 | VNC 可用不证明 compiler 可用；客体重启后旧 Use 不得继续输入 |
| Control / ngspice | Python 软件或原生 solver、每 attempt 输入输出 | 候选/场景、预算、物理单位、误差检查 | 服务 venv 改变不应切换既有运行；原场景分母不变 |
| PC-Gym | 固定 Python/torch、计算入口、CPU/GPU 条件、源码/数据引用 | seed/steps/policies、原 ticket、checkpoint、论文判断 | 新软件绑定覆盖原批准和 worker/checker；不能从 ready 自动训练 |
| HPC / OpenFOAM | 站点、Slurm allocation、MPI/solver 软件与 rank 观察 | 网格/边界条件、ReFrame 方法、收敛和数值检查 | MPI/节点分配须真实观察；本机参考计算不能充当 OpenFOAM 结果 |
| Lab 仿真 / 将来仪器 | 软件模拟器，或有独立 Owner 的设备会话 | Protocol IR、样品/液体状态、校准、观察和不可逆动作 | 仿真资源初始化可重复，不意味着真实样品操作可 replay |

COBOL 与 ngspice 验证“原生程序不是 Python”；PC-Gym 验证“App 与科学环境不同”；
Slurm 验证“批准时未必有运行实例”；VM 与 TK5 验证“可交互不等于可取消/可运行”；
Lab 验证“环境不能拥有实验世界状态”。这几项共同约束抽象，而非只为 COBOL 改名。

## 9. Pero 代码与协议落点

| 位置 | 拟议改动 | 依赖方向 / 防止重复所有权 |
| --- | --- | --- |
| `crates/pero-runtime/src/environments/` | 软件模型去 Python 强制依赖；具名要求；多 binding 快照；扩展现有 Use 聚合 | 纯值与 effects，不读取 clock/process/fs，不依赖 provider 或生成协议 |
| `crates/pero-runtime/src/apps/` | App 服务环境兼容适配；方法准入对接；保留安装和后端生命周期 | 不把所有科学方法塞进 `ScientificMethod` 枚举；固定方法描述由受信 App 装配提供 |
| `crates/pero-runtime/src/environment_owners/`（拟新增） | 本机与 Docker I/O 适配；随后本地 VM；复用现有进程/凭据接缝 | 适配器依赖纯核心；仅在两个真实实现共用时提取 consumer 所需的最小 port |
| `crates/pero-host/` | 装配 Owner、持久化、受管 App 来源授权和非阻塞 I/O 接线 | 不在持有 AppStore 全局锁时等待 pull/VM 启动；不另开公共执行 HTTP 服务 |
| `server/internal/environments/`、`runtimebinding/` 与 Worker | 扩展已有远程资源实现和既有执行引用 | 不在 Rust 与 Go 同时协调同一个资源/Use；远程引用经既有通道投影 |
| `protocol/`、`packages/app-sdk/` | 一份版本化边界合同、生成表示、资源/软件选择与证据组件 | transport 入口校验一次；UI 不复写准入规则，不持 Docker/SSH 凭据 |
| `apps/compute/`、`apps/environments/` | 资源与软件管理消费者 | Compose/Docker/VM 不由 Python UI 后端直接调用 |
| COBOL / Control / Paper / HPC | 保持方法、领域 Spec/attempt/verifier；接入计算绑定 | 不复制全部记录到平台，不创建并行 Task/Run |

新增目录是实现候选，不是要立即建立空接口树。先用 local + Docker 两个实际实现
确定 `observe/acquire/release` 需要哪些方法；prepare/dispose/交互控制按真实能力分开。
不要强迫每个 Owner 实现 `Build/Start/Exec/Stop/Destroy/Snapshot/Resume` 的万能接口。

与已有协议兼容时，旧的软件观察保持原 schema/hash 可读；新的多资源快照明确升版。
不能通过把 Python 字段改成 optional 就重新计算旧 Profile 的身份。旧记录不回填
当前机器信息，旧 App 级绑定在完成迁移前继续按原义工作。

## 10. 分阶段实现与完成门槛

覆盖范围包含 VM 和服务组合；按下列次序交付，避免把“支持类型”误报成“后端已接通”。
本设计没有授权额外的分布式协调/锁框架；若实际部署出现新需要，再给具体问题、
发生条件和成本另行评估。

| 阶段 | 交付 | 必须证明的行为 |
| --- | --- | --- |
| A：模型和兼容 | 软件组件、资源/运行身份、多槽位、要求和 Use 选择；保持旧证据 | 无 Python 的工具链可表示；必要条件未知时拒绝；资源重启不沿用旧 Use；历史 hash 不变 |
| B：本机 + Docker 闭环 | Host 源码快照、显式准备、真实运行/取消、产物和 Use 释放；COBOL 与 ngspice 两个消费者 | 未提交源码进入固定输入；tag/context 漂移阻塞；杀 CLI 后确认容器；错误/取消保留输出；无自动重放 |
| C：Compose 服务组合 | 固定 TK5/CICS/IMS/desktop 配方、成员观察、连接与卷保留 | 部分准备失败可定位；只申请所需槽位；原容器/卷归属可证明；服务端点准备与业务可用性分开 |
| D：VM | Tart、QEMU 本地适配；KubeVirt 走现有远程 Owner | 实际 guest 启动/重启、旧 Use 拒绝、桌面与进程能力区分、原实例停止/处置；无介质/KVM 则报告阻塞 |
| E：AI4S 与批调度 | PC-Gym 独立计算环境贯通批准/worker/checker；HPC 对接真实站点 | 原预算与批准不变；排队到 allocation 的绑定正确；实际 MPI/solver、cancel/accounting、离线验证 |

各阶段至少覆盖核心行为表、少量真实 I/O 接线测试和对应后端 opt-in 验收；
不为每种 transport 重复核心规则。UI 检查真实 App 的准备/失败/重试/运行/取消/
恢复、明暗/窄窗/键盘；Web、Electron、Native、安装包分别报告。

当前执行资源只做了只读盘点：默认 Docker context `colima` 未连接 daemon，
`colima-pero-benchmark-rosetta` 可返回 daemon 信息。此事实不证明 COBOL 镜像、
VM、KubeVirt 或 Slurm 已可用；后续测试必须显式选择 context，不更改全局默认。

### 明确推迟的抽象

不新增跨云自动调度、通用 workflow DSL、任意 shell recipe、环境专属审批队列、
跨 Owner 分布式事务、通用缓存/断点恢复、统一科研 PASS 或自动 volume GC。
这些都不是完成当前 local/Docker/VM/服务组合的必要前提。

## 11. 与迁移工作的关系

[COBOL 迁移记录](2026-11-02-point-cobol-migration.md)继续拥有迁移范围和实测证据。
这里拥有通用能力设计；实现结果必须回写各自 fitness 记录，不能仅把本文状态改为
implemented 来宣称所有后端完成。当前 COBOL App 的 IR 推演仍不是原生基线。

源码快照从明确选择的工作区文件捕获内容和摘要，可包含未提交文件；不静默使用
Point 配方导出器的 `git archive HEAD`。复制/打包不执行 git commit，保留用户的
“COBOL 相关代码不提交”约束。数据、产物和软件准备有各自身份与来源记录。
