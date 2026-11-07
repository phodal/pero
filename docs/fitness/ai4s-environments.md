---
kind: verification_report
date: 2026-11-02
---

# AI4S Environments P1

范围：纯领域模型、必要条件/偏好匹配、现有科学软件元数据观察、新证据中的可选观察。
不是科学求解/训练验收，不是 live Use 授权或已安装 Desktop 验收。
[ADR 0029](../adr/0029-ai4s-environments.md) 与 [计划](../exec-plans/2026-11-02-ai4s-environments.md)
规定后续接线；原 App 的批准、预算、Spec 和执行所有者继续生效。

2026-11-06 的 ADR 0030 核心扩展及最新检查记录见本文末尾；以下 P1 历史数据保持原版本含义。

## 测试版本与实现

- `7d416af5`：领域值、匹配、固定快照和纯 Use 转换；`4bbba881`：候选选择规则。
- `eef7c90f`：两个 App 的只读探针与新运行证据关联；`4ad5a72c`：Rust 配置解释器观察。
- 开发机 Darwin arm64，默认 `python3` 为 CPython 3.14.7。测试与探针没有安装依赖、
  创建科学 venv、启动 Agent、下载源码或调用真实科学训练。

领域核心在 [environments](../../crates/pero-runtime/src/environments/mod.rs)：
Profile 身份覆盖规范 JSON 的实际观察；Template/要求、Binding/Snapshot 与 Use 分开。
匹配先核对必要条件和观察时效，再按偏好计分；同分保留调用方顺序，不回退版本。
换 owner/incarnation/软件内容拒绝刷新；历史快照不覆盖。
Use 核心在 acquiring/unknown 时保留取消意图，迟到成功仅释放；未知不会重发 acquire。
这些 Use effects 本阶段没有接入实际进程或资源授权。

私有 [AppStore 检查](../../crates/pero-runtime/src/apps/environment.rs) 复用原解释器选择与
PATH 设置，以固定模块探针读取元数据。边界核对 schema、method、Profile 身份和内容摘要，
P1 最初只向内部调用者提供具名值；现有 [Environments UI](environments-ui.md)
通过 App-origin `/host/environment` 暴露相同只读观察，不增加准备或执行授权。
探测的是当前选定解释器，不是已经运行的 Desktop backend 的加载身份或远程 attestation。

Control 软件要求读取原 App manifest；原 Store 仍控制预算/attempt，真实 engine 入口仅增加
`environment-observation.json`，由原 artifact 清单保存哈希。PC-Gym 软件清单来自既有
REQUIRED_PACKAGES；新执行回执在原批准之后记录父进程 preflight 元数据，保留完整内联观察。
旧回执无该字段即未记录；导出和离线 checker 不新增在线 Host 或训练依赖。
PC-Gym 源文件变化自然改变已有 pipeline fingerprint，重跑需重新 prepare，不放宽旧 preflight。

## 实际检查

| 检查 | 实际结果 | 证明范围 |
| --- | --- | --- |
| `node scripts/cargo.mjs test -p pero-runtime --lib` | 83 passed | 原 Runtime 回归、纯模型和真实软件探针/匹配边界 |
| `node scripts/cargo.mjs test -p pero-host` | 43 passed | 原 Host 包含私有批准、权限与 App 生命周期边界 |
| `TMPDIR=/private/tmp python3 -m unittest discover -s apps/control-lab/test -p 'test_*.py'` | 49 tests，37 passed / 12 skipped | 新观察、原预算/验证/HTTP/持久化；缺失真实引擎的项目及显式 solver gate 未验收 |
| `TMPDIR=/private/tmp python3 -m unittest discover -s apps/paper-agent/test -p 'test_pcgym*.py'` | 48 passed | 原完整性、完整分母、fixture 进程取消与离线重算；无真实训练 |
| 同上 `-p 'test_reproduction_approval.py'` | 11 passed | 原精确批准、私有能力、取消与无重放 |
| 同上 `-p 'test_environment.py'` | 1 passed | PC-Gym 元数据、内容身份与科学 profile 区分 |
| `node --test scripts/build/app-bundle.test.mjs scripts/build/workbench-payload.test.mjs` | 5 passed | 原 App backend 打包和 staged Paper CLI/导出 |

最初用系统默认 TMPDIR 跑 PC-Gym App/审批 suite 时，macOS `/var` 与 `/private/var` 的
路径别名触发既有 canonical-path 拒绝。改用真实 `/private/tmp` 后全部通过；没有改路径校验。
Control 的 skips 对应未安装 python-control/ngspice 以及未启用的真实求解 gate；不能计为通过。

## 真实只读观察

以同一默认 Python，在对应 `apps/<app>/backend` 目录运行
`python3 -E -s -B -m control_lab.environment python-control`、同模块 `ngspice`，以及
`python3 -E -s -B -m paper_agent.environment`。三者实际返回 metadata_only：

| 方法 | 实际观察 | 软件 Profile ID |
| --- | --- | --- |
| Control python-control | Python 3.14.7；缺 control/numpy/scipy/matplotlib，不满足 Host 的 3.12 要求 | `92f63c338574934ab8e9234766d5100a6f0e15179dadab1b4abfb0fd0174c463` |
| Control ngspice | 同上，且 ngspice missing | `186fb79a2251ccc5a4d2f8f98c4016c9a86401401760e3c64f1d0aeb540eb625` |
| Paper PC-Gym | 缺全部 10 项科学依赖；保留明确缺失，未训练 | `f5486d0a460f6bbf2464bec86fd83b927fd1fb7257101ffa41772b39f4589347` |

本地原始开发产物：`test-results/environments-p1/observations.json`（ignored，不随仓库交付）。
Rust 集成测试实际解析三个探针的规范内容身份，再调用同一个匹配核心；字段存在不等于获准。
观察不包含解释器/程序绝对路径或凭据。包元数据与可执行文件摘要仍不证明已加载库或包文件完整性。

## 剩余边界

无安装、依赖求解、prepared Profile claim、受管 Use 持久化/准入桥或独立科学解释器选择。
未建立实际 Control 双引擎通过、PC-Gym smoke/table6 新运行、UI/真实模型、GPU/HPC、
安装包、生产或论文科学接受。新的环境字段不修改原 Spec，也不补造历史运行观察。

## 2026-11-06：ADR 0030 核心扩展

设计提交 `ca28c9d1`，验证包含本批 Rust 环境核心改动；Darwin arm64，
Rust nightly-2026-10-28。只是核心/既有接线回归（L0），不是 Docker/VM 或产品验收。

- `software.rs` 增加明确 schema 的组件观察：Python 与所属包、原生工具版本/文件摘要、
  OCI index/manifest/config 的不同身份。V2 要求必须明确选择组件；不同解释器的包不混用。
- `composition.rs` 记录方法所选能力、必需连接闭包和实际 Owner/资源/scope/运行代次。
  只检查所需槽位；不需要的可选服务不会阻塞。资源别名不能伪造另一运行代次，且去重取得使用权。
- `usage.rs` 仍为唯一 Use 转换。多资源依次准入，全部满足才 Active；部分拒绝释放已授权项，
  未派发项标为 skipped；未知获取/释放不重放；晚到授权只释放；不同 target/快照/消费者不能混用。
- 历史 Profile 和单绑定 Snapshot 有固定 JSON 与独立计算的摘要金样；新的 enum 包装不改变它们。
  旧 `/host/environment` 继续只返回既有 v1 Python 观察。V2 核心类型不是已发布的 Host wire API。
- Use 原来就没有 live 持久化/恢复接线，本轮仍没有。成员事实是纯转换结果，不宣称能加载历史
  Use 日志或从磁盘恢复多资源执行；持久化格式、Owner effects 和真正执行在下一批接线。

实际检查：

| 命令 | 结果 | 范围 |
| --- | --- | --- |
| `node scripts/cargo.mjs test --locked -p pero-runtime --lib` | 122 passed，1 ignored | 核心、既有 App/ACP 回归及真实 Python 元数据探针；ignored 是既有可选软件/模型下载测试 |
| `node scripts/cargo.mjs test --locked -p pero-host` | 44 passed | 现有 Host 的授权、私有调用和生命周期回归 |
| `node --test packages/app-sdk/test/environments.test.mjs packages/app-sdk/test/environments-ui.test.mjs` | 23 passed | 现有观察合同、保留数据、错误恢复和组件交互；不是 Desktop 验收 |

本轮没有修改产品 UI，没有创建 Docker/VM、拉镜像、启动科学训练或运行真实模型请求。
未实现：ResourceOwner I/O、本次执行批准/持久化/派发、真实容器取消/回收、VM/服务组合、
PC-Gym 计算解释器切换和 Slurm。不能用上述核心 PASS 宣称这些后端已支持。
COBOL App 代码没有纳入设计提交；本批平台核心实现通过独立 PR 提交。

PR 隔离 worktree 复核：显式设置 `PERO_GPUI_KIT_PATH=/Users/phodal/test/gpui-kit`，
并把 Rust nightly 与 `/opt/homebrew/bin` 放入测试 PATH。最初 worktree 的系统 Python
解析为 Xcode Python 3.9，不能加载现有 PC-Gym 注解；切换到已有 Homebrew Python 后
Runtime 全套再次通过。SDK 测试使用已有包内 jsdom 依赖。没有降低探针要求或把失败计为通过。

## 2026-11-06: live local, Docker, Compose and Slurm owner evidence

Branch `codex/environment-runtime`, commits through `b9e98821`, macOS arm64.
ADR/core PR #147 merged to the repository default `master` as `08a0e6a2`.
This follow-up implements validated Use replay, Host SQLite commit-before-effect,
shared local process supervision, and local/Docker process owners. The private
Host handoff is exercised with an existing-attempt reference; it is not yet wired
to the production Control/Paper scientific admission routes.

Actual Docker context `colima-pero-benchmark-rosetta` runs a Linux arm64 daemon;
the explicit scientific fixture image uses linux/amd64 emulation. Daemon
`beede0d6-387a-4e23-8547-dce7482ae7c6` returned a containerd image index for ordinary
inspect and a platform manifest for `--platform`. The model now preserves unknown
config digests instead of calling either value an image config ID.

Verified independently of the default suite's opt-in skips:

- Local method output, real container method output, readiness-observed running
  cancellation, and absence of the original container after cleanup.
- Actual ngspice 42 voltage divider under Host `BoundProcess`: numerical output
  5 V within 1e-6, Released Use retained after SQLite reopen. Evidence in
  `test-results/compute/ngspice-57363/{stdout.log,use.json,uses.sqlite}`.
- Native Compose deploys two healthy services on an internal network, client
  reads the original service's output, resource evidence survives reopen, and
  removing exact containers/networks retains named-volume data. The test then
  explicitly removes its own fixture volume.
- Slurm 23.11.4 single-node fixture: actual submitted job, allocation-side payload
  hash check, output, terminal observation, and separately running-job cancellation.
  The submission intent prevents a second `sbatch`; numeric job ID is checked
  against cluster, comment/operation and submit time. Missing controller history
  remains unknown, requiring accounting reconciliation. No accounting fallback
  or production scheduler integration is claimed.
- Slurm evidence: `test-results/compute/pero-compute-68638762-4abe-429c-9e53-c0970fcc89e9`
  (completion) and `pero-compute-6b9dd47f-f9e3-4764-9e7b-4bc2b58582fd` (cancel),
  including submission/receipt, allocation and terminal JSON.

`pero-runtime --lib`: 126 passed, 4 explicit opt-in ignored. The Docker, Compose
and Slurm opt-ins listed above were separately run successfully. This is L2 for
these adapter paths, not full App/Native/release acceptance. Docker CLI waits are
bounded to 30 seconds and observations to 8 MiB; timeouts never authorize retries.

Authorized local VM resources are being prepared separately: official Alpine
3.22.6 arm64 SHA-512-verified cloud image with per-instance QEMU overlay/SSH key,
Tart Ubuntu 24.04 clone, and an isolated k3d/KubeVirt 1.9.1 cluster using emulation.
QEMU and Tart both returned actual guest boot IDs and executed commands; both
also confirmed stopping. KubeVirt VM startup and production VM owner integration
remain in progress. Keys, images, overlays and kubeconfig remain ignored.

Remaining product gates: trusted method registration and bounded input staging,
Control/Paper reserve-admit-dispatch integration, independent PC-Gym runtime,
Compute/Environments management UI for nonlocal resources, Compose member Use
projection, VM adapters and KubeVirt control-plane binding, Slurm allocation-side
Use binding/accounting reconciliation, and backend-specific release evidence.
No COBOL App code is included in these commits.


## 2026-11-06 independent PC-Gym runtime

The fixed Paper method can now use a trusted `PERO_PAPER_SCIENTIFIC_PYTHON`
selection independently of its App service interpreter. Workbench and standalone
Electron forward this setting to Host; Host forwards it only to the authorized
Paper deployment. App/public request bodies cannot select an executable.
A `ScientificPython` observation freezes the entry path (preserving venv links),
executable SHA-256, version and package inventory. Freeze, approval and dispatch
use this observation. Changed environments refuse new work; existing decisions,
request reconciliation and original-process cancellation retain their saved owner.
This is an observed environment, not a complete artifact lock or an attestation.

Historical macOS arm64 acceptance used App Python 3.15.2 and an isolated scientific
Python 3.12.16 with ten required packages. The opt-in
`tests/environments/pcgym-runtime.py` performed real PC-Gym CPU smoke using the
pinned upstream checkout, both DDPG policies and MPC oracle, and independently
recomputed the exported result with the App interpreter using `-E -s -S`.
It also started another real worker, changed the configured selection, and
confirmed that cancellation still stopped the original attempt.

- Spec: `f237e6e5d062f25116aba62404575b2689bf517b478df261e17d4a4db6fb9117`.
- Completed attempt: `374ea0e241a52ce785440b9c88ca65edd1b16ba30275dd14e70cbc3c4a5d123a`.
- Cancelled attempt: `695a4b32326be51ba62a6335eab41991985bc1e48802c5326c60f4d05d1bf7eb`.
- `numeric_recomputation=PASS`, `execution_evidence=CONSISTENT`,
  `paper_verdict=INCONCLUSIVE`; no claim to reproduce the full paper experiment.
- Local evidence: ignored `test-results/compute/pcgym-separated-runtime-cancel/result.json`
  and its export/checker directory. These are local artifacts, not repository files.
- Regressions: 49 PC-Gym tests and 12 Host approval tests pass; `npm run check` passes.

The Paper/PDF selection metadata in this exercise is explicitly synthetic.
This proves actual method execution and the App's approval seam, not original PDF
recognition, Desktop selection, signed packages, or durable Host Use integration.
Production Profile selection and reserve/admit/dispatch remain separate P2/P3 work.

## 2026-11-06 KubeVirt fixture limits

Two isolated k3d clusters were prepared without changing the user's kubeconfig
or Docker context. ARM KubeVirt 1.9.1 deployed, but guest startup failed:
ARM requires host-passthrough, which the selected QEMU software emulation cannot
provide. An x86 K3s 1.36.4 fixture under Docker/Rosetta reached node Ready but
containerd refused pod sandboxes with `seccomp is not supported`, including
with a Pod-level Unconfined setting. Neither is accepted as a running KubeVirt VM.
Both nodes were stopped after preserving VM/VMI/pod/event JSON under the ignored
`test-results/compute-tools/pero-*-*.json` paths. Private images/config remain
available for a suitable Linux execution host. The earlier manually owned QEMU
process was also stopped via its own QMP socket; Tart and the reproducible QEMU
fixture were already stopped. Slurm's isolated validation service remains available.


### PR #149 review verification — 2026-11-07

The historical real-solver receipt above did not record a source revision or
exact executable paths/command. It predates the review change `3d204659` and
must not be read as validation of that change. Its command shape was
`<App Python> tests/environments/pcgym-runtime.py --science-python <scientific Python> --checkout <pinned PC-Gym checkout> --output <new evidence directory>`;
the exact historical invocation is unavailable. No solver acceptance was rerun
in this review. New runtime-bound specifications require the same interpreter
identity even for imported handoffs lacking local observation metadata; a new
executable/path requires a fresh freeze and approval. Legacy unbound specs keep
their original version/package compatibility rule. Launch/decoding failures now
produce a typed refusal, and interpreter processes receive the existing minimal
observation environment instead of App/compute credentials.
