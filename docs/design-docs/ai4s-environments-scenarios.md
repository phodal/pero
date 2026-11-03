---
kind: analysis
date: 2026-11-02
---

# AI4S Environment：用两个已有科学场景检验边界

状态：设计映射与 P1 观察检验；完整受管 Use 接线仍待实现，不启动真实求解器或训练。
既有测试文件代表已有断言，历史实跑回执代表其记录的版本；两者都不是本次新验收。
P1 新代码与实际测试结果见 [验证记录](../fitness/ai4s-environments.md)：已增加纯模型、
只读探针和新运行证据中的观察字段；以下原批准、预算和计算所有权保持不变。

## 约束与共同模型

沿用 [ADR 0026](../adr/0026-hpc-benchmark-library.md)：Compute 拥有通用 Worker 身份、
placement、资源授权、租约、取消与恢复。领域 App 拥有实验规范及科学证据；当前
Host 监督的 App 后端仍可监督其有界本地计算。Environment 不新增任务调度器，
也不把本地领域 attempt 自动注册成第二份 Task/Run。

以下是拟议概念，不是当前已支持的协议字段：

| 概念 | 在两个场景中的含义 | 不拥有的内容 |
| --- | --- | --- |
| 软件 Profile | 解释器、锁定依赖、原生程序制品和目标平台的版本化准备结果 | seed、场景、训练步数、科学容差 |
| Requirements / EnvironmentTemplate | 方法需要的软件、CPU、可读输入和输出槽位；引用 Profile/Recipe | 候选搜索、训练策略、实验审批 |
| Binding / Snapshot | 实际解释器、依赖清单、求解器身份、源码及数据引用、观察时间 | 把声明当观察；把版本字符串当完整制品校验 |
| Use | 一个已有领域 attempt 对固定绑定的使用，引用原 Owner 授权及释放结果 | 新授权权威、第二份执行状态机、自动重试 |

软件定义固定准备输入；实际安装记录与执行观察单独保存。相同定义不证明构建字节
一致；快照摘要不证明观察可信。平台、软件制品身份和已知缺口均要明确。
App 服务环境与科学计算环境可暂时相同，但必须可分别引用；未来切换计算 Profile
不能通过修改仍运行的 App venv 实现。数据、模型、参数继续按领域规范引用。

## 场景一：Control Lab 的控制器与电路计算

### 当前事实与所有者

- [experiments.py](../../apps/control-lab/backend/control_lab/experiments.py) 的
  `ExperimentSpec` 固定模型、单位、场景、搜索空间、候选预算、方法版本和标准；
  其 `Template` 是科学方法模板，不是拟议的 EnvironmentTemplate。
- [store.py](../../apps/control-lab/backend/control_lab/store.py) 的 `ExperimentStore`
  拥有候选、候选锁、批次 operation、trial/attempt、进度、证据预算与持久记录。
  每个 trial 绑定一个候选与场景，并在求解前保存 attempt；输出在该 trial 独立目录。
  重启将未完成 trial 标为失败并保留文件，读取记录不会重派发求解器。
- [engines.py](../../apps/control-lab/backend/control_lab/engines.py) 执行真实求解：
  python-control 在 App 后端解释器中运行；ngspice 以子进程运行，程序由 PATH 解析。
  缺失引擎明确不可用，不用解析公式或 fixture 波形代替。Windows ngspice 当前拒绝运行。
- [verification.py](../../apps/control-lab/backend/control_lab/verification.py) 从已保存
  Observation 及冻结标准重算检查，不调用求解器。输入摘要、曲线单位、采样坐标、
  求解器版本和制品哈希属于科学证据；该独立逻辑尚不等于独立进程或信任隔离。
- [Host App 准备](../../crates/pero-runtime/src/apps/mod.rs) 读取已选 Python 配置和
  backend dependencies，必要时绑定 `environment/pero-python312` 并调用
  [preparation.rs](../../crates/pero-runtime/src/apps/preparation.rs)。它检查/安装声明依赖，
  已满足时复用；当前不是按依赖内容寻址、不可变的软件 Profile 仓库。
  [python.rs](../../crates/pero-runtime/src/apps/python.rs) 的 bundled 匹配接受 3.12 补丁版本；
  科研快照仍须记录实际补丁版本。ngspice 不由这个 Python 准备流程下载安装。
- Agent 写操作受现有 session Goal、实验 ID、Spec hash 和工具权限约束，见
  [HTTP 入口](../../apps/control-lab/backend/control_lab/http.py) 与
  [既有设计](control-lab.md)。环境选择不得扩大原 Goal 或改写冻结预算。

### 拟议映射与迁移

1. 先把当前实际 Python 环境与 ngspice 登记成可观察绑定，生成软件快照；已有
   ExperimentSpec、候选、trial ID、input digest 和历史记录保持原义。
2. 方法要求引用 Python Profile；电路方法另要求 ngspice 原生程序绑定。请求的采样、
   物理场景、理想运放假设和验收阈值留在 ExperimentSpec，不进入软件 Profile。
3. 预算仍由 ExperimentStore 准入。保存原 attempt 后、进入求解器前为该 attempt
   建立 Use；准备失败、未启动和实际执行失败按原领域规则记录，不通过新环境记录
   抹掉已消耗的 attempt 或预算。取消确认前不得把 Use 标为已释放。
4. 引擎返回的实际版本与制品引用关联同一快照。搜寻与最终验证各自的 trial 使用各自
   attempt/Use，允许复用同一软件 Profile；这不要求创建两份相同 venv。
5. 真正支持另一个科学解释器时，需要给现有 engine 执行接缝增加有界进程入口，
   保持一个 numerical core 与一个 Store 执行所有者。仅添加解释器选择框无法改变
   目前在后端进程内运行的 python-control。此进程迁移是后续实现，不在本文完成。

## 场景二：Paper 的固定 PC-Gym 复现

### 当前事实与所有者

- [pcgym_domain.py](../../apps/paper-agent/backend/paper_agent/pcgym_domain.py) 的
  `ReproductionSpec` 固定源码清单、pipeline digest、准确 Python 版本、声明包版本、
  seed、steps/episodes/samples、超时、policy 覆盖与 PDF anchor。
  这里的 `profile=smoke/table6` 是实验规模，必须与软件 Profile 区分。
- [pcgym_sources.py](../../apps/paper-agent/backend/paper_agent/pcgym_sources.py) 固定
  upstream commit/blob、审计改动和依赖清单。当前包版本清单不是完整的依赖制品锁。
- [pcgym_app.py](../../apps/paper-agent/backend/paper_agent/pcgym_app.py) 保存 annotation /
  PDF binding、Spec、item、request/attempt 关联与私有审批；checkout 来自受信配置。
  它冻结 `sys.executable`，并用该解释器调用现有 CLI；HTTP 不能选择任意路径或解释器。
- [pcgym.py](../../apps/paper-agent/backend/paper_agent/pcgym.py) 是现有执行与取消所有者：
  保存 attempt、运行锁、进程结果和回执；worker 执行
  [pcgym_runtime.py](../../apps/paper-agent/backend/paper_agent/pcgym_runtime.py)，
  preflight 核对 Python、pipeline、源码及包版本。CPU、单 torch 线程、seed 和原始
  reward 的加载均有明确实现。计算路径不安装依赖、不下载代码、不调用模型。
- [私有 Host 入口](../../crates/pero-host/src/paper_reproduction.rs) 只接受原 item/spec/request
  身份及私有 decision；[Main 确认](../../desktop/src/main/reproduction-approval.ts) 展示
  Host 冻结摘要。[审批核心](../../apps/paper-agent/backend/paper_agent/reproduction_approval.py)
  要求消费原 ticket 并持久化决定后才能派发；公开路由、Agent 写操作和环境就绪均不授予运行权。
- CLI checker 回读原 observations/receipt，核对 attempt、Spec 和准确字节哈希，重算
  episode/sample 两种完整分母。独立数值检查可通过也不改变 unresolved 的论文判断。
  [历史真实 smoke](../fitness/paper-pcgym-smoke.md) 已记录原版本的 CPU 实跑和离线重算；
  这不证明当前 Environment 模型、当前源码或完整 Desktop 链路通过。

### 拟议映射与迁移

1. 先登记已明确准备的科学环境，记录解释器及实际包版本，保留当前 preflight。
   软件 Profile 后续补上平台、制品/锁和准备回执，不能把旧包清单重新标成完整锁。
2. Paper 的服务 Profile 与 PC-Gym 计算 Profile 分开引用。新增科学解释器绑定要贯通
   freeze、approval binding、CLI launch、worker import 和实际快照；现有 `sys.executable`
   绑定不允许靠环境字段绕过。旧 Spec 与批准内容不重写；变更生成新的 Spec/请求。
3. 受管计算要求引用原源码/输入和 CPU 能力，软件 Profile 不吸收 reward、Gym action /
   observation space、seed 或 `smoke/table6`。这些仍由领域规范与源码解释。
4. 原 request 在创建计算前固定 Profile/binding 身份；已有 CLI 分配并保存 attempt 后，
   在科学代码执行前为其关联 Use。不要为取得 Use 伪造第二份执行 attempt 或提前运行。
5. 私有批准摘要必须覆盖实际计算绑定；选中不同环境后不得复用原 ticket。
   依赖准备与计算是两个动作，准备成功不能自动训练。已有取消按原 request/owner
   路由，即使 PDF、当前环境配置或证据损坏也应保留原停止路径。
6. 结束 worker、回收原进程后才结算 Use；未知结果沿原 ID 对账。重新运行是经授权的
   新 attempt，原输出、失败和取消记录继续保留。checker 可用另一个只读绑定；
   checker Use 不能获得计算写权限，也不能以重算替代新训练。

## 设计验收矩阵

下列为后续门槛，不是本次 PASS 清单。每次记录源码、Profile/快照、attempt、系统、
完整结果及缺口；fixture、真实引擎、UI、真实 Agent、安装包分别验收。

| 层次 / 场景 | 应保留的证据与判断 | 当前入口 / 后续缺口 |
| --- | --- | --- |
| 纯模型：Profile/绑定 | 输入变更产生新身份；声明与观察分离；不支持能力拒绝；旧快照固定；同 attempt 的 Use 不跟随新绑定 | [P1 值模型测试](../../crates/pero-runtime/src/environments/tests.rs) 已实现；managed Use 交接仍待 P2；复用原领域 Spec |
| Control 领域回归 | Spec/候选/场景固定；baseline、增量/批量 search 同预算；最终候选先锁定；失败也计入原准入 | [experiments](../../apps/control-lab/test/test_experiments.py)、[store](../../apps/control-lab/test/test_store.py)、[sample limit](../../apps/control-lab/test/test_sample_limit.py) 的现有断言须保留 |
| Control 真实本地引擎 | 实际 python-control 与 ngspice 均运行；保存输入、原始表与版本；P/PI、RC/滤波器对独立公式；缺引擎不能替代 | [engines](../../apps/control-lab/test/test_engines.py) 已有 no-skip 门禁 `CONTROL_LAB_REQUIRE_SOLVERS=1`；未来再证明 Profile 与实际 executable 绑定，本次未运行 |
| Control 独立检查 | 只读保存曲线与固定标准；完整 search/final 分母；单位、internal stability、缺失/非有限样本正确处理 | [verification](../../apps/control-lab/test/test_verification.py)；逻辑独立、进程分离、信任隔离分别报告 |
| PC-Gym 纯模型/完整性 | 双指标完整分母、policy 覆盖、原始源码和 PDF binding、Spec/attempt/输出哈希一致；不增加可调科学 PASS 开关 | [reproduction](../../apps/paper-agent/test/test_pcgym_reproduction.py)；软件 Profile 迁移不得重算历史身份 |
| PC-Gym 真实 CPU smoke | 固定真实 upstream；smoke 为每个 DDPG 128 steps、2 episodes × 60 samples；记录实际 steps/updates、CPU/线程、checkpoint 和全部 policy 数据 | [runtime](../../apps/paper-agent/backend/paper_agent/pcgym_runtime.py)、[历史回执](../fitness/paper-pcgym-smoke.md)；新模型需新实跑，不启动 table6 全量训练来替代该门槛 |
| PC-Gym 独立重算 | 独立 checker 读取准确原字节；导出后在无科学依赖环境重新计算；receipt 一致、数值检查与 paper verdict 分开展示 | [CLI/checker](../../apps/paper-agent/backend/paper_agent/pcgym.py)、[现有测试](../../apps/paper-agent/test/test_pcgym_reproduction.py)；论文仍 INCONCLUSIVE |
| 精确审批与能力 | prepare 不执行；错 ticket、binding、item 或环境拒绝；allow 一次；重复请求不派发；未批准环境准备不扩大权限 | [approval tests](../../apps/paper-agent/test/test_reproduction_approval.py)、[Main tests](../../desktop/src/main/apps-reproduction.test.ts)；未来需覆盖科学解释器变化 |
| 取消、重启、未知效果 | 观测原 owner 退出后才释放；未知不重放；原 request 仍可取消；失败与部分文件保留 | [Control I/O](../../apps/control-lab/test/test_store_io.py)、[PC-Gym lifecycle](../../apps/paper-agent/test/test_pcgym_lifecycle.py)；环境记录不能另发取消或 retry loop |
| 实际 UI | 准备/阻塞/运行/成功/失败/取消均有反馈；App 服务与计算环境可辨；结果定位准确快照；light/dark、窄窗、键盘与关闭后恢复 | [Control E2E](../../tests/e2e/control-lab.mjs)、[Paper native](../../tests/e2e/paper-reproduction-native.mjs)、[Paper component](../../tests/e2e/paper-reproduction-component.mjs) 为已有入口；新环境交互需真实截图和回执 |

## 不可回归的科学与执行边界

- Control 的 40,000 evidence sample-points、80 attempts 和 15 MiB 导出边界仍由原模块
  解释；ngspice 自适应点数不能裁剪成通过。失败/部分输出不重置已消耗预算。
- Control 搜索和最终验证各保留原场景分母；现有 saved observations 不得因新增
  环境字段被重新签成新结果。环境匹配不改变原阈值、单位或科学假设。
- PC-Gym 的 episode 与 sample 分母、可选 Oracle 覆盖、原 reward、原始缺口和
  adaptations 全部保留；真实 smoke 或检查器 PASS 均不解决论文 Table 6 的歧义。
- 不因环境就绪跳过精确审批；不因环境变化自动重训、换设备或退回其他解释器。
  取消请求不是停止回执，超时不是进程消失，记录恢复不是重新执行。
- 科学输出只按引用交给 Agent；Environment 不复制研究台账、凭据、预算、
  审批或执行状态。未来远程执行关联既有 Compute Run/attempt 与制品引用。

## 两个场景得出的设计结论

两者共同需要软件 Profile、实际绑定/快照与 attempt-scoped Use；领域 Spec、
方法输入、预算、输出和 verifier 已有所有者。共同模型足以表达准备与追溯，
但当前两个 App 都尚未具备独立科学解释器接线，不能把该能力写成已实现。
P1 已验证登记/观察核心与新证据关联，接下来实现受管 Use，再接独立本地计算解释器；GPU、集群、Slurm、
仪器及通用 Recipe 执行均不由这两个 CPU 场景推导为已支持。
