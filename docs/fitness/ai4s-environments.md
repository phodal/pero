---
kind: verification_report
date: 2026-11-02
---

# AI4S Environments P1

范围：纯领域模型、必要条件/偏好匹配、现有科学软件元数据观察、新证据中的可选观察。
不是科学求解/训练验收，不是 live Use 授权或已安装 Desktop 验收。
[ADR 0029](../adr/0029-ai4s-environments.md) 与 [计划](../exec-plans/2026-11-02-ai4s-environments.md)
规定后续接线；原 App 的批准、预算、Spec 和执行所有者继续生效。

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
