---
kind: analysis
date: 2026-11-05
---

# Terminal-Bench 失败修复审查

本次按 Session、工具结果、产物和官方 verifier 四层复核失败。取样快照为
2026-11-05 10:26:58（Asia/Shanghai）：87 个实际运行任务取得官方原始结果，
32 个 reward 为 1；89 题全套及后续修正尚未完成。这不是最终成功率。

本地证据位于 [全套记录](terminal-bench-full.md) 所述 full-04 artifact root。
`failure-repair-review-20261105.json` 留存快照字段、15 个带 plugin 回合错误的
任务及分析来源哈希。下列明细来自已经关闭的轨迹；未修改原始判分、输入或
运行中的二进制。本次修复验证不调用真实模型。

## 确认能修的运行时问题

`bn-fit-modify` 的人工主回合在 seq 13915 正常结束，之后后台完成通知在
seq 13916 启动第二回合，seq 13920 报 `runtime: run is inactive`。
其他任务也在尾部出现退休或取消错误，包括官方通过的任务。该快照有 15 个
任务带 plugin 回合错误，但不能据此认定它们全部由同一个竞态造成。

代码缺口在 `Agent.runTurn`：开始记录回合和消费 inbox 前，没有检查已经取消的
执行 context 及 agent 的退休/作用域状态。排队唤醒在等待 activity 边界期间，
其运行资格可能已经消失。这个入口缺口可以独立、确定性复现。

修复前，取消和到期案例仍生成一对 turn/start、turn/end，并消费后台通知；
退休及作用域取消案例也未被入口拒绝。修复在入口复用现有 authority 检查，
先拒绝失效执行，再允许创建回合。它不隐藏已启动回合的真实错误，不自动重试。
入口拒绝保留未消费通知；Host 显式移除会话仍可按既有契约丢弃输入。

验证覆盖 live、canceled、expired、retired、scope-canceled 五种状态，检查
provider 调用次数、native 回合记录和 inbox 消息身份。修复后的正常通知仍执行
一次；其他四种状态均零 provider 调用、零新回合、消息未被入口消费。
这是运行时正确性修复，尚未证明能使原来的解题失败转为通过。
详见 [canonical issue](../issues/2026-11-05-turn-start-after-retirement.md)。

## 会影响交付，但需要单独验收的改进

| 案例 | 轨迹中的决定性证据 | 根因与可修范围 |
| --- | --- | --- |
| `pypi-server`、`hf-model-inference` | 自测 HTTP 200；准确关联的后台任务在 Session 关闭时 context-canceled；官方随后连接失败 | 服务 owner 的生命周期与任务要求不一致。Bash 说明已经修正；仍需退出 agent 后的独立服务验收。不能通过取消正常清理来掩盖问题。 |
| `polyglot-c-py` | Python/C 自测通过，但交付目录多出 `cmain`；官方先因额外文件拒绝 | 缺少最终产物集合检查。编译产物应放在 scratch 目录，结束前按用户要求核对文件集合。移除 `cmain` 尚未被证明足以通过其他检查。 |
| `fix-git` | 已找回提交并开始合并，随后向无人值守 runner 提问，遗留 about 文件冲突 | 缺少无人交互场景下的任务收尾。可在明确的 benchmark 运行配置里说明交互条件和合理假设；不能把禁止澄清施加给普通用户会话。 |
| `password-recovery` | 观察到两个片段，却提交 11 字符前缀，违反明确的 23 字符及后缀约束 | 最终约束检查失败。可强化完成前核对；工具已经返回必要观察，不能按工具协议故障处理。 |
| `extract-moves-from-video` | 发现 curl，仅做环境检查，没有尝试下载或写 solution 文件，却称没有下载能力 | 能力判断与实际尝试不一致。应依据实际请求结果判断网络、依赖和下载能力；这条轨迹没有证明下载可用或不可用。 |
| `code-from-image` | 203 次响应、181 次 Bash，仍缺 output 文件；当时模型 route 未声明 image input | 模态限制叠加反复 OCR 猜测。需要明确能力匹配和策略调整；不能只修图片解码就宣称模型能看图。 |

服务问题的[说明修复和独立验收状态](../issues/2026-11-05-background-service-lifetime-guidance.md)
已有单独 tracker，本次没有重复新建实现或启动收费补跑。

## 不能当作 harness bug 的解题失败

| 案例 | 具体失败 | 判断 |
| --- | --- | --- |
| `bn-fit-modify` | 把 parent/child 元组直接写入 to/from，之后自测重新解释 to 为 parent | 自测接受了实现自身的错误约定。尾部 plugin 错误是另一个问题；修复回合入口不修复 CSV 语义。 |
| `extract-elf` | 示例地址步长为 4，候选采用 8 字节；官方报 45 个错误值 | 数据解释和假设验证失败。一次 scratch 编译错误不等于最终错值的根因。 |
| `count-dataset-tokens` | 提交统计包含 system/user/template 开销，偏离要求的 reasoning/solution 字段 | 计数对象错误，工具执行成功也无法保证选对指标。 |
| `feal-differential-cryptanalysis` | 331 次响应后正常结束，仍交付 NotImplementedError 骨架 | 长探索没有完成算法。应评估模型/推理配置、策略调整和时间分配；没有证据支持修一个 tool wrapper 就能解决。 |
| DNA、Scheme 无限步数修正 | 移除 512 ceiling 后仍 raw zero：DNA 缺 primers；Scheme evaluator 仍失败 | 隐藏预算问题确实存在且已修；预算移除与解题成功是两个结论。不能继续用放宽限制解释所有失败。 |

可复用的 prompt 改进是核对约束、保持自测与规格一致、在停滞时调整策略。
具体题目的参考答案和 hidden-test 细节只用于事后审查，不应写进 runtime prompt。
下一轮应固定模型、官方输入、时限和配置，分别评估这些行为改动。

## 工具失败的分类

87 个结果的快照含 654 次显式失败调用；isError、非零退出及 owner failure
相互重叠，不能相加，也不代表 654 个产品缺陷。失败命令可以是有效诊断，
通过的任务同样会包含中间失败。之前 59 题的封闭审查提供以下具体例子：

- Write 越过 `/app`：正确拒绝。不要放宽文件权限来消除失败计数。
- Read `/tmp`：原错误误称 plugin 资源问题，当前已修诊断并提示使用 workspace
  scratch；原有权限边界保留。
- Edit 的 old_text 匹配不唯一：正确拒绝，应重新读取后做精确修改。
- TaskOutput 请求 900000ms，schema 最大 600000ms：正确拒绝超限参数。
- Read/Write 尚未激活：应按实际声明先发现工具；不要绕过 deferred 准入。
- TaskOutput/TaskStop 可能返回被观察任务的失败。必须回溯原 Bash 和任务身份，
  才能区分操作自身失败、已结束命令的失败与成功停止。
- 已人工确认 10 次验证失败被最终 shell 零退出掩盖。保持真实 shell 状态，
  将输出识别结果作为带来源的复核证据；不能用正则自动改写官方判分。

## Token、网络和评测环境

该快照中跨请求累计携带约 1.32 GB 工具结果历史，未使用 schema 约 25.5 MB。
这是反复序列化的字节量，不是唯一文本大小、provider token 或可节省费用。
冻结 launcher 没有声明 context window，未启用自动压缩；当前 CLI 已有压缩、
不缩短摘要的重复抑制、Skill 恢复去重及压缩 usage 记账。下一步应验证明确
启用后的任务完成情况和总 usage，包括压缩调用自身，不能只继续裁剪 schema。

精确参数重复检测也不足以判断停滞：图片任务的大量 OCR/裁剪调用参数不同，
但没有完成产物。可增加基于错误类型、文件变化和验证进展的提示；它应是策略
建议，不能替代用户要求的官方时限或重新引入任意请求上限。

`video-processing` 的最后请求在约 514 秒内收到 38 个文本块、161 个字符，
最终缺少 `[DONE]`。已有 idle timeout 无法仅凭总时间识别持续慢速的小块输出。
可以评估显式总请求时限及进度记录；自动重发可能重复收费，不能默认启用。
这次失败响应的 usage 未知。此前 C4 的安全传输错误分类已经修复，历史原因
仍不能反推为某一种网络错误。

uv/uvx 缺失、HF fixture 网络失败、镜像别名 metadata 与 Rosetta syscall
限制都有独立证据。前置依赖和镜像控制已经落地，后续正式验收仍按各 tracker
记录。QEMU 的原生 x86 对照按用户要求延后。runner 就绪、功能断言执行及
候选正确性分别记录，不能把环境控制通过换算成 benchmark 通过。

## 本次代码验证

新增入口回归先在修复前失败，修复后通过。完整 core、nativetools、ACP 和
ACP CLI 的 race suites 及对应 go vet 通过；standalone Harness Bazel target
通过。冻结全套和收费补跑配置均未因本次审查改变。

## 后续：同步最新主线后的离线复核

当前 PR 分支远端为 `7c6d4952`，没有新的同分支提交。拉取后合入
`origin/master` 的五个新提交，形成 `02ecac447579f10557c5d846333cd139ed775653`。
这些提交涉及 UI/CI；与 `7c6d4952` 比较，`harness/go` 和 Session reporter
没有变化。本节审查的是旧轨迹在最新源码下的含义，没有启动新一轮模型运行。

原 status 文件仍由旧 watcher 刷新；审查将必要字段冻结到独立的
`status-snapshot.json`，保留源文件当时的哈希及时间，不把后续更新时间当成新结果。
按 trial 身份重新关联 87 个 result、verifier stdout/CTRF 和 Session summary。
总数仍是 89 个槽位、87 个官方判分、32 个原始 reward one。两个未判分槽位
不凭旧状态标签推断当前仍在运行；四个 timeout/reward-one 也不升级为有效通过。
这不是最新代码的全套分数。

### 55 个原始零分如何停止

| 停止分类 | 数量 | 含义 |
| --- | ---: | --- |
| 正常结束后官方零分 | 26 | 包括错误实现、缺少产物、服务退出及部分 verifier 启动失败，不能全部归为算法错误 |
| 官方 agent 超时 | 19 | 在时限内未取得通过；另有四个超时任务 raw reward one，不在本表中 |
| 单次输出耗尽 | 4 | 最后一条响应均为 8192 tokens，生成的 Write 参数不完整 |
| 旧的隐藏 512 步上限 | 2 | 已单独修正并补跑，DNA/Scheme 仍零分，不能只归因于限制 |
| agent 异常退出 | 4 | 三题记录泛化 provider 错误，video 另有持续慢速流证据；历史传输根因不能补猜 |

独立检查 verifier 阶段：55 个零分中，47 个报告了 pytest，七个缺少 runner
命令，一个 fixture setup 失败。这是与上表交叉的另一维度，不能额外相加。
七题是 `large-scale-text-editing`、`llm-inference-batching-scheduler`、
`mcmc-sampling-stan`、`merge-diff-arc-agi-task`、`model-extraction-relu-logits`、
`qemu-alpine-ssh`、`qemu-startup`；fixture 失败为 `reshard-c4-data`。
环境先阻止了判定，但不能反过来证明候选正确；QEMU 还有独立的 Rosetta
signalfd 限制证据。

### 不能用失败调用数解释零分

87 个任务共 9,487 个工具调用，按 reporter 的三个失败 flag 取并集为 654：
Bash 608、Read 11、TaskOutput 18、Write 14、Edit 2、TaskStop 1。
`failed`/`interrupted` 状态之和与这个 flag 并集不同，不能换用或重复相加。

零分任务是 482/7,055（6.83%），reward-one 任务是 172/2,432（7.07%）。
这不构成因果实验，但明确不支持把较多失败调用直接当作低分原因。
`fix-git` 原轨迹零显式失败仍遗留冲突；`count-dataset-tokens` 只有一次失败
调用仍选错计数对象。前述十次 shell 零退出掩盖验证失败，也说明应看实际
断言和产物，不能只看 exit code 或错误率。

### 四次大型 Write 截断是同一种可处理场景

重新拼接最后一步的 `assistant/chunk.content[].argumentsDelta`，四题均只有
未完成的 Write JSON，未进入实际 `tool/call`。来源、seq、参数字节及解析结果
保存在独立审查 JSON，不保留或执行残缺参数。

| 任务 | 最后输出 tokens | 未完成参数 UTF-8 字节 |
| --- | ---: | ---: |
| adaptive-rejection-sampler | 8192 | 28,938 |
| headless-terminal | 8192 | 32,623 |
| make-doom-for-mips | 8192 | 32,862 |
| make-mips-interpreter | 8192 | 25,930 |

最新 `harness/loop.go` 仍正确丢弃 max-tokens 响应中的所有工具调用；ACP 返回
`max_tokens`，engineering feedback 的 CanContinue 为 false。原 benchmark
adapter 只提交一次 prompt，随即进入 verifier，因而这类任务没有恢复机会。
这是大文件生成策略与调用方恢复策略的缺口，不应撤销
[截断调用不可执行的契约](../issues/2026-10-28-harness-upstream-parity.md)。
可验证的改进是分块构建文件，并在显式的 benchmark 配置里，于原官方时限内
记录并恢复输出截断，要求重新生成更小的完整操作。不能执行或直接重放半截 JSON，
也不能将这种恢复悄悄施加给普通 ACP 调用方。单纯增大输出 cap 尚无效果证据。

### 通过了但仍很贵：压缩和进度提示为何没起作用

21 个超时/旧步数限制的零分任务记录 498,904,640 tokens，占 87 个任务
842,870,007 的 59.2%。这些是包含 cache read 的已记录用量，不是费用。
原始全套没有声明 context window，因此未启用自动压缩。

独立的新 runtime `polyglot-c-py` 补跑通过，但用掉 220 次响应、42 次失败
调用和 13,321,025 tokens。重新核对响应 usage 后，其峰值 prompt 是
103,829 tokens。启动配置为 1,000,000 context、默认 0.8 threshold，实际
压缩阈值 800,000；本次根本没有接近阈值，故模型 compaction 为零。
容量声明与成本控制是不同目的：声明大窗口不会主动缩短这个轨迹。

162 次 tool-history replacement 只裁剪可替换的旧工具文本，保护错误和近期
结果，也不消除 assistant 的代码/tool-call 参数。它不是 162 次摘要，更不能
作为省 token 的证据。应使用现有 threshold/retain 配置做单因素成本实验，
而不是重复新增压缩引擎或继续只削减 schema。

当前 progress 规则匹配精确重复、结果不变的交替调用、连续同类失败和窄 Git
总览；Write/Edit/等待操作重置链。polyglot 的命令、错误和源码持续变化，因此
零次提醒符合当前实现。下一步需要观察验证是否取得进展，不能把任意写入等同于
有用进展，也不能把未进展提示改成任意请求次数上限。

### 为什么已有反馈没有解决所有交付错误

engineering delivery 检查挂在正常 TurnStopping 且 CanContinue 为 true 时。
它可以帮助正常收尾，不能在 agent 超时后补写产物，也不会在 max-tokens 时
绕过停止契约。新 polyglot/fix-git 补跑的 contract feedback-attempt 都为零；
最终自行清理/解冲突不能作为 hook 自动纠错的验收。

`bn-fit-modify` 的自测改变 parent/child 语义、密码长度约束遗漏、统计对象选错、
FEAL 交付未实现骨架，仍分别属于规格保真、最终约束及解题策略问题。通用提示
能要求核对，但不替代独立测试。中途检查必须绑定公开要求及真实产物/验证结果，
不把 hidden tests 或模型自行编造的 oracle 写入 prompt。

此前服务 owner/deferred 发现修复已经在独立 PyPI 补跑通过；polyglot 和
fix-git 也各有通过记录，详见 [runtime 重跑](terminal-bench-runtime-rerun.md)。
这些都是小样本且存在版本/配置变化，不能把原 55 个零分统一解释为已经修好。

### 后续优先级与证据

1. 固定 runner 依赖、镜像/网络就绪和严格停止证据，先保证能执行官方断言。
2. 针对四个大型 Write 场景验证分块写入和显式输出截断恢复。
3. 在原时限内更早检查公开交付物和验证进展，遇到未改善的编译/算法试探时调整
   策略；保留必要诊断，不靠继续放大请求上限。
4. 单独调整现有 compaction threshold/retain，并记账摘要调用，验证对正确性和
   总 usage 的影响；复杂算法、视觉任务的模型/模态配置另做配对实验。

离线复核工具及完整 55 题表位于 benchmark artifact root 的
`failure-audit-20261105-latest/{audit.py,audit.json,audit.md}`。
JSON 绑定快照、87 份摘要、四份截断 Session、verifier 证据和所审源码哈希。
检查确认三个失败 flag 的并集与原快照一致，四份残缺 Write 均未执行。
本轮只同步主线并生成分析，没有修改 runtime 行为、冻结输入或官方 reward。
