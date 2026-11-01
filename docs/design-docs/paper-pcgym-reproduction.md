# PC-Gym CSTR Table 6：自动研究的首个实现增量

日期：2026-11-01。Refs #77 / #79。Pero 核查基线：
`85453242733bef06b34f210bc22aa00b34291280`。

**本次交付是固定案例的 CLI、可加载 Skill、领域契约和独立检查器，不是已完成的
Desktop / Paper App 全链路集成。没有运行完整 PC-Gym 训练。**
此文明确已实现内容与整个场景仍需完成的连接；分支通过 Draft PR 评审。

## 1. 核实的案例与问题

论文：[arXiv 2410.22093v4](https://arxiv.org/html/2410.22093v4#S6.SS3)，
Section 6.3 / Equation 37 / Table 6。原文的温度约束为 321–327 K，表中报告
Base / Shaped / Oracle 的数值分别为 0.0727 / 0.0003 / 0.0000。
这些是论文报告值，不是本次实验结果。

作者代码固定到
[`fbfb36bf84b494cd157cff88292e1fd1b864cee5`](https://github.com/MaximilianB2/pc-gym/tree/fbfb36bf84b494cd157cff88292e1fd1b864cee5)。
此提交与论文原实验的精确对应关系未建立。代码仓库存在、代码可读，均不意味着原始
训练状态或 Table 6 数据已经取得。

| 发现 | 依据 | 对实现的影响 |
| --- | --- | --- |
| 指标粒度分歧 | 论文 Eq.37 的指示函数评价整条 episode；`constraint_violation_vis.py` 对所有样本的越界布尔值求均值 | 必须同时计算 episode 与 sample，不能偷偷用其中一种解释论文表格 |
| 奖励边界顺序 | `custom_reward.py` 的 `[327,321]` 被解包为 `lower_bound,upper_bound`，再用于相反命名的边界比较 | 保留原函数并记录审计发现，不能在复现驱动里悄悄修复后声称重跑了原实现 |
| 配置共享 | `env_params = env_params_con` 后调用 pop | 驱动使用独立深拷贝，并把这一行为列为 adaptation，不声称逐字重放原脚本 |
| 原始随机状态缺口 | 公开 DDPG 训练调用没有显式 seed | 新 seed 是研究者选择，不能当作作者 seed；环境版本也须实际记录 |
| 原始制品缺口 | 本轮没有取得 Table 6 对应的原始 checkpoint/逐轨迹数据 | 新训练仅称 adapted upstream rerun；不得拿其他 CSTR CSV 或预存图片充当该表数据 |

源码：[训练](https://github.com/MaximilianB2/pc-gym/blob/fbfb36bf84b494cd157cff88292e1fd1b864cee5/pc-gym_paper/constraint_showcase/constraint_paper.py)、
[指标](https://github.com/MaximilianB2/pc-gym/blob/fbfb36bf84b494cd157cff88292e1fd1b864cee5/pc-gym_paper/constraint_showcase/constraint_violation_vis.py)、
[奖励](https://github.com/MaximilianB2/pc-gym/blob/fbfb36bf84b494cd157cff88292e1fd1b864cee5/pc-gym_paper/constraint_showcase/custom_reward.py)、
[评估器](https://github.com/MaximilianB2/pc-gym/blob/fbfb36bf84b494cd157cff88292e1fd1b864cee5/src/pcgym/policy_evaluation.py)。

已做一个有边界的真实源码探针：对 blob `284967c39bfd7b444378810373cb805f9584c914`
的原始奖励函数，提供自有合成输入，令 T=324 K、浓度恰好等于设定值、控制量不变。
`con=False` 返回 0，`con=True` 返回 -0.0036。这证明此函数在该输入下给合法温度附加了
惩罚；不证明作者原始训练实际采用了这些状态或解释，也不属于 PC-Gym 环境/策略复现。

若总共 50 个 episode，episode 指示量的均值间隔是 1/50；若是每条 60 个样本，样本比例
分母为 3000。代码包含这个条件性的量化一致性检查，但**不能据此推断作者本意**。
打印精度用于该诊断，不是事后设定的复现容差。

## 2. 明确的工作流

```text
已有 Paper 阅读工具观察固定论文及原文位置
    ↓
prepare：固定 checkout → 校验字节 → AST 审计 → 环境清单 → Spec
    ↓ 用户审查准确 digest、环境、资源与方法偏离
run：真实 DDPG base + shaped 训练 → 真实 MPC oracle / 策略 rollout
    ↓
原始 numeric NPZ + temperature JSON + 实际执行回执
    ↓
独立 Python 进程：双口径重算 / 分母 / 身份与摘要检查
    ↓
verification.json + 可离线重算的 ZIP
```

这里的“独立”是逻辑/进程层面的重算，不是安全隔离的盲评或独立科学团队复验。
同一 OS 账号可以修改文件；摘要只负责内容关联，没有远端 attestation。

## 3. 领域契约

`Claim` 保存固定论文、表/公式位置、报告值；`metric` 与 `implemented_metric`
分别保存原文和代码的具名 `MetricDefinition`，`metric_resolution=unresolved`。
这两种定义也进入 `ReproductionSpec.metrics` 的内容摘要，不能只改粒度再复用旧协议。

令 `v_it = I(T_it < 321 K 或 T_it > 327 K)`，两端点允许：

| measurement_grain | metric_definition | 分子 / 分母 |
| --- | --- | --- |
| episode | `sum_i I(any_t v_it) / N` | 至少一个点越界的 episode 数 / 全部 N 条 episode |
| sample | `sum_i sum_t v_it / sum_i n_i` | 越界采样点数 / 全部已登记采样点数 |

一条 60 点轨迹仅 1 点越界时，分别为 **1/1 = 100%** 和 **1/60 ≈ 1.67%**。
若 50 条轨迹中只有这 1 点越界，则分别为 **1/50 = 2%** 和 **1/3000 ≈ 0.0333%**。
sample 是所有点的 pooled proportion，不是持续时间加权，也不是将来允许不同长度时的
各 episode 比例均值。当前 Spec 固定每条 60 点，包含初始状态，即上游评估器的
初始点加 59 次状态转移；不应未经核对改成 60 次转移加初始点的 61 点分母。
Checker 保留整数分子、完整分母和双口径结果；缺样本直接拒绝，不删除失败轨迹。
原始指标解释和实验身份未解决前，比较差值只是诊断，不设科学通过容差。

模板来源标为 curated reference；只有现有 Paper 的真实阅读才产生 observed passage。

`ReproductionSpec` 固定代码提交、来源 manifest digest、驱动/checker 字节指纹、Python
版本、依赖版本、seed、profile、训练步数、轨迹/样本数、wall-time 和方法偏离。
可选 `PaperAnchor` 为真实 passage/document/file digest 留出连接点；当前 CLI 尚未从
App 自动填充它，不能凭标题或固定页号生成锚点。

`Observation` 按 policy → episode → sample 保存 Kelvin 温度，保留初始状态；必须包含
base/shaped/oracle 和全部预登记样本。错误单位、重复 policy、少 episode/样本、布尔值、
NaN/Inf、错误 spec/attempt 都拒绝。没有“只保留成功部分”评分。

`Verification` 分开记录：执行回执一致性、数值重算、论文结论、接受决定。即使所有数值
靠近论文，本案例的 `paper_verdict` 仍为 `INCONCLUSIVE`，因为原指标解释和原实验身份
未解决。新增已确认解释应建立新的协议/检查版本，不开放一个 Agent 可任意调节的 PASS 开关。

## 4. 实现文件与职责

| 文件 | 责任 |
| --- | --- |
| `pcgym_domain.py` | 纯值契约、冻结校验、双粒度计数、结果语义；无 I/O、求解器或模型调用 |
| `pcgym_sources.py` | 固定 checkout 与四个 source blob 校验、静态 AST 证据位置、依赖清单 |
| `pcgym_runtime.py` | 真实 PC-Gym / SB3 / CasADi 适配；不执行训练/可视化脚本，不读取未知 pickle |
| `pcgym.py` | prepare/run/status/verify/export；前台执行、超时/取消/失败记录、独立检查子进程 |
| `paper-code-audit/SKILL.md` + `references/pcgym-table6.md` | 通用审计入口；按需读取 PC-Gym 固定案例的执行说明 |
| `test_pcgym_reproduction.py` | 自有 fixture 领域与持久化/CLI/离线交接测试；不冒充真实科研计算 |

既有 Paper 的 `research-step`/observed evidence、资源导入、Host 权限/进程树和 Go Skill
catalog 不变。没有新增 Agent Runtime、模型 client、网络下载器或调度器。
PC-Gym 并不是现有 python-control adapter，本次不把它伪装成 Control Lab 已有算法。

## 5. 操作方式

先由操作员准备已授权、固定 commit 的 PC-Gym checkout 和科学 Python 环境。
**不在本次代码中自动 clone / pip install / 下载模型。** 上游 requirements 本身未完整
锁版本；本实现保存实际 dependency inventory，不声称已经建立作者环境或跨平台完全可复现。

在 Pero 根目录，用选定 Python：

```sh
export PYTHONPATH="$PWD/apps/paper-agent/backend"
python -m paper_agent.pcgym prepare \
  --checkout /absolute/approved/pc-gym \
  --output /absolute/new/pcgym-study \
  --profile table6 --seed 0 --timeout-seconds 3600
```

CLI 需要 Python 3.10+，本轮使用 Python 3.12.11 验证。

结果含 `spec_id`、真实缺依赖和审计发现。依赖缺失是 BLOCKED，不能将计划成功当作实验完成。
安装/更换环境后重新 prepare 到新目录，不编辑旧 Spec。

审查并授权后：

```sh
python -m paper_agent.pcgym run --bundle /absolute/pcgym-study \
  --spec-sha <prepare返回的完整digest> --confirm-execution --accept-audit-findings
python -m paper_agent.pcgym status --bundle /absolute/pcgym-study
python -m paper_agent.pcgym verify --bundle /absolute/pcgym-study --attempt <actual-attempt-id>
python -m paper_agent.pcgym export --bundle /absolute/pcgym-study \
  --attempt <actual-attempt-id> --output /absolute/new/evidence.zip
```

`table6` 使用作者脚本中的 25,000 training steps、50 repetitions、60 samples、26 分钟
simulator setting、MPC horizon 20，并使用未更改的 `custom_reward.py`。不同于论文某些
其他 CSTR 段落/图示的 25 分钟，不擅自合并配置。新 seed、深拷贝、独立评估环境等偏离
全部写入 Spec。完整 profile 的实际成本尚未测量；一小时是可修改的执行预算，不是耗时估计。

`smoke` 为 128 requested training steps / 2 repetitions；同时记录实际步数、warmup
和梯度更新次数，避免仅采样而未更新。仅检查真实依赖与连接是否能工作，不能作为
Table 6 结果。任何引擎缺失直接失败，无手写曲线 fallback。

已有 Go Harness 可显式配置 `--skills-root /approved/installed-paper-agent/skills`，按其
name+digest 接口读取 Skill。该接口只读取 `SKILL.md`；案例 references 必须经独立获准的
文件读取工具访问，不代表 catalog 已支持引用文件。Desktop 内置 picker 未更新，不能声称它自动出现。

## 6. 安全、恢复与结果交接

源文件只在固定路径、固定 blob 及干净 checkout 下准入。运行只由精确 Spec 确认启动，
无任意 shell command 参数；科学环境仍须操作员信任，此 CLI 不是不可信代码沙箱。
子进程不脱离 Host 进程组，移除应用/provider 凭据环境，保留当前 attempt 的日志。
取消/超时终止该固定 worker；不能确认停止则保留 unknown 和锁。进程硬崩溃后的记录不
伪装成实时状态，不自动删除锁或重放。跨平台与完整进程树清理仍需要 Host 实测。

包内包含原始数值、协议、检查器和校验清单；`python verify.py` 可无 Agent/求解器重算。
`verify` 遇到回执摘要不匹配返回非零退出码并记录 FAIL；`export` 拒绝打包该结果。
省略第三方完整论文/源码、checkpoint 二进制、私有绝对路径和执行日志；checkpoint 摘要
留在环境回执。要重新训练仍需原 checkout 和科学依赖，不能把离线重算称为无依赖重训。

## 7. 全场景后续接线与验收（尚未完成）

1. **Paper 结果拥有者**：最小 ResearchStore、真实 PDF passage/annotation/digest 与认证 API
   已在下节收敛；完整 study 结果导航与 UI 回写仍未接通。
2. **运行绑定**：将授权后的 Spec 映射到已有 Host/Worker 的实际执行身份；当前 CLI 本地
   回执不是受信远端 execution receipt，不能让 Agent 上传 JSON 就取得科学通过。
3. **工具声明与能力暴露**：固定审计/证据路由已声明，默认计算仍禁用。Host 实际执行
   审批与能力发现尚待接线；不把 reading-only `experiments=[]` 放宽成模型自报结果。
4. **原文回写**：从选区进入案例，显示两种口径、原始整数计数和诊断，点击回到实际冻结
   原文。缺失和 metric conflict 可见；浏览旧记录不得触发运行。
5. **真实引擎**：执行实际 smoke，然后完整 profile；检查每个新产物来自该 attempt，
   保留失败与方法偏离。原定义未解决时 INCONCLUSIVE 是合法科研结果，不是要修成绿色的 UI bug。
6. **产品与交接**：真实 Desktop / ACP 轨迹、重启/取消/错误、窄窗/主题、独立目录重算；
   将 fixture、真实依赖、真实模型、真实科学检查分别记账。

首个 PR 应保持 Draft；只引用 #77/#79，不自动关闭。上述缺口不是已经完成的产品能力。

## 8. Paper 接线收敛（#81 → #82）

只有 `pcgym_domain` / `pcgym_sources` / `pcgym_runtime` / `pcgym` 一套契约、
审计、执行器与检查器。`pcgym_app` 仅把这套实现接到现有 ResearchStore 和
认证的 `/api/reproduction/step`；`reproduction-step` 是固定 App 写路由。
没有新的 Agent 循环、通用执行器或 UI。

- `case` 离线返回固定案例；`inspect-source` 才显式请求四个固定提交源码之一，
  核对 Git blob 后持久保存。源码或请求体不能授予执行许可。
- `audit` 从已保存的 v4 PDF 第 20 页观察 Table 6 / Eq.37，并保留真实
  PdfPassage、原 PDF digest、Paper 内容版本及可选标注。重复 JSON 请求幂等。
- `freeze` 需要可信装配提供固定 checkout；绑定已审计源码、精确环境、预算和
  PDF/标注摘要。当前发布的 server 没有该配置，因此明确返回 unavailable；
  不能通过 HTTP 传入路径、解释器或开启计算。通常继续用明确授权的 CLI。
- 可信测试/嵌入装配可显式启用固定 checkout 的本地计算；它只启动同一 CLI。
  一个冻结 Spec 只允许一次 HTTP 启动请求；重复 requestId 查询原请求，不能
  重放副作用。中断或启动效果不明保留 unknown；取消只针对本装配仍持有的进程，
  不凭持久 PID 杀进程，也不自动清除未解决的运行锁。
- `verify` 使用同一独立重算器，`export` 返回 JSON 证据视图；可携带离线检查器的
  ZIP 继续由 CLI `export` 生成。两者都不返回本地执行配置。
- `includeOracle=false`（CLI `--no-oracle`）在运行前冻结两策略覆盖；检查器仅要求
  已登记策略，仍拒绝缺失/额外策略。该选项不改变科学结论的 INCONCLUSIVE。

安装包精确包含通用 Skill 和三个公开参考文件，不复制任意 skills 目录。
文件随包交付不代表 Desktop picker 自动发现、Host 自动读取 references，或真实
Provider 已完成验收。无训练、模型下载或完整 Table 6 重现实验属于本次收敛验证。
