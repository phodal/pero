# Harness 工具与 Prompt 适配对照

kind: analysis

分析日期：2026-11-03。Pero 基线：`17f4b1e3156171e45f29bb721b367877867f8157`。
来源版本和获取方式见 [source lock](harness-tool-prompt-sources.json)。
本文归纳实际契约，没有复制第三方完整 prompt、实现或测试源码。

## 结论与范围

Pero 的主要问题已经不是缺少基础文件、Shell、Agent 或 MCP 工具。
Claude 插件入口已补齐大部分常用工具，但 generic 入口、插件入口、宿主桥接入口的能力不同；
prompt、工具描述、结果中的恢复指引还没有处处与当前调用者的实际能力保持一致。
优先统一这个契约，再补多文件 patch、交互进程、延迟发现和计划状态，收益高于增加工具同义名称。

本次比较发现：

1. Pi 将工具自己的简短指导与 active loadout 绑定；Qwen 从实际声明快照过滤部分指导和示例；
   Codex 按模型元数据、环境、功能开关和策略构造可执行工具计划。应借鉴这些装配机制。
2. 最新 DSH 已有 `apply_patch`、`read_image`、`grep/glob`、持久 Shell、终端和团队相关包。
   旧 DSH 基线的缺口不能直接延用。需要区分“上游有实现”“组合中启用”“Pero 已适配”。
3. DSH 当前 base/standard/PTC 组合实际设置 `applyPatch: false`，与工具源码中“shipped on”的注释不符。
   组合文件比注释更能说明默认能力。这不是 DSH 完全没有 patch 工具。
4. Pero 的 MCP resource prompt 会向不具备相关工具的受限子代理推荐工具；本次修复这个具体问题。
5. `Read` 声明 PNG/JPEG/GIF/WebP，但当前 OpenAI-compatible adapter 只接收 PNG/JPEG，
   且图片模态、字节与尺寸限制更窄。这是需要打通的工具与 provider 契约。
6. 按用户更正路径，已读取 `claude-code-extracted` 的真实提取模块。
   这份历史提取快照与当日官方文档要分开比较；它不是完整官方开源运行时。

静态研究不能证明 prompt“最佳”。本文给出可执行的适配顺序和评测条件；
真实模型 A/B、外部服务验收和全部插件业务验收不属于已完成证据。

## 来源与证据边界

| 对照对象 | 固定版本 | 获取与证据范围 |
| --- | --- | --- |
| Pi | `90b42bca6ed161b8e7ee40ceda9755205c2882ec` | 新克隆到 `$AI_REFERENCE_ROOT/pi-mono`；旧地址重定向到 [earendil-works/pi](https://github.com/earendil-works/pi)；MIT |
| Qwen Code | `6fe83a82457def9ab8daa43bf833b4cfdf192bd2` | 新克隆到 `$AI_REFERENCE_ROOT/qwen-code`；[官方仓库](https://github.com/QwenLM/qwen-code)；Apache-2.0 |
| Codex | `fc39cfcacd8c6efaf561269e882ea76bdc1dff42` | 使用已有 `$AI_REFERENCE_ROOT/codex`；只读检查，无 pull/reset；观察时与 origin HEAD 相同；Apache-2.0 |
| DSH | `8bd073392eef6f54e921a093b95076248eb08cbb` | 新克隆到 `$AI_REFERENCE_ROOT/deepseek-harness`；[官方仓库](https://github.com/deepseek-ai/deepseek-harness)；MIT |
| Claude 提取快照 | `1dbf34de9b8652da95ba6c8cca47b764d535a5d9` | 用户更正后的 `$AI_REFERENCE_ROOT/claude-code-extracted`；只读检查，无执行；解包重组产物，不作为官方开源源码 |
| Claude 当前文档 | 2026-11-03 官方文档快照 | 工具/技能/子代理/MCP 的公开行为，不能据此证明内部当前实现 |

`$AI_REFERENCE_ROOT` 指本地参考仓库父目录。未安装依赖或执行新下载的项目代码。
既有 [行为对齐](../fitness/harness-behavior-parity.md) 使用 DSH `f3803c9…`；
本报告使用更新版本，二者的结论须按版本分别理解，不能据此宣称完整兼容。

Codex 官方 [prompting 入口](https://developers.openai.com/codex/prompting)
实际跳转到 [Prompting](https://learn.chatgpt.com/docs/prompting)，本次已读取正文。
它主要说明用户如何提供目标、上下文、边界和验证要求；内部装配结论以固定提交源码为准。

## 当前 Pero：三个能力面

| 能力面 | 实际工具与条件 | 对 prompt 的要求 |
| --- | --- | --- |
| 通用 headless native | 显式 workspace 才有 `read_file/write_file/edit_file/list_directory/search_files`；shell 独立开关；搜索是 literal、有界遍历；Windows replacement 另有限制 | 不能假定有 Bash、正则 Grep、Glob、图片 Read 或 NotebookEdit；当前名称和参数必须与 schema 一致 |
| 选择 Claude 插件的 CLI | 在同一 native executor 上替换定义为 `Read/Write/Edit/Glob/Grep/Bash`，增加 NotebookEdit、Agent、Skill、Task* 等；Web/LSP 仍需实际配置 | 保留插件所需兼容名称，明确 RE2、路径、媒体、后台任务与 Claude 版本差异 |
| 宿主桥接 / DSH profile | 动态 catalog、output projection、权限与 provider 由宿主组合提供 | 以最终过滤后的声明与实际执行 owner 为准；包存在、源码含某名字，都不是本轮可调用的证明 |

本地依据：[`nativetools/tools.go`](../../harness/go/nativetools/tools.go)、
[`nativetools/claude.go`](../../harness/go/nativetools/claude.go)、
[`main.go`](../../harness/go/cmd/pero-agent-acp/main.go)、
[`tools_resolve.go`](../../harness/go/harness/tools_resolve.go)。
`--plugin-dir` 的存在会影响整套 native 工具定义；CLI 适配与库的默认行为应分别验收。

## 工具能力矩阵

“有”仅表示该固定版本有实现；条件启用和默认选择写在格内。不是跨项目行为等价断言。

| 能力 | Pero Go 当前 | DSH 当前 | Pi | Codex | Qwen Code |
| --- | --- | --- | --- | --- | --- |
| 文本读取、精确编辑、写入 | 有，通用/Claude 参数不同 | 有，观察策略可选 | 有，默认 coding 4 tools | 主要 Shell + apply_patch，受模型/策略选择 | 有，读后再写检查 |
| 结构化正则/Glob | Claude profile 有 RE2/本地遍历；通用只有 literal/list | `tool-fs-search` 的 ripgrep/Glob | catalog 有 grep/find/ls，默认 coding 不全启用 | 常用 Shell 的 rg；不能假定专用 read/search 工具永远存在 | 有专用工具 |
| 多文件 patch | native 未注册 | 已实现；base/standard/PTC 默认关闭 | 内置 edit 支持多个替换，不等于多文件 patch | 有；freeform grammar，模型元数据决定注册 | 本次目录未发现 apply_patch，已有 edit/write 不能当作多文件 patch |
| 本地图片 | Claude Read 回 image block；provider 契约有缺口 | read_image 依赖 attachment store 和模型能力 | read 识别媒体并按模型配置处理 | view_image + 模型能力选择 | read_file 描述随模型模态变化 |
| PDF / notebook 输出读取 | PDF pages 未支持；NotebookEdit 不等于 notebook 输出呈现 | 不能仅因 read_image 推断 PDF 完整支持 | 不以 PDF renderer 作为核心保证 | 不能从 view_image 推断 PDF 工具 | 多模态读取按模型/运行环境配置 |
| 非交互 Shell 与后台任务 | 有；Claude Bash 真 task_id、TaskOutput/TaskStop | Shell + jobs | bash/powershell，取消/timeout 清理 | exec_command + write_stdin，取决于 unified exec | Shell + TaskStop，区分任务类型 |
| 交互 stdin / PTY | native Bash 未提供交互 stdin；后台任务不等价 | 持久 Shell 与 experimental terminal 包存在；不代表默认启用 | 默认 bash 不是 Codex 式持久 PTY 工具 | 有，受 feature/policy 限制 | 依 Shell 模式与运行环境 |
| Agent | 一次性 generic；Claude Agent 有恢复、后台、worktree | subagent/control/team 包 | 核心不内建，扩展可提供 | spawn/wait/message 等按模式启用 | Agent + team/角色限制 |
| 用户问答 | 有真实通道才向 exact root 暴露 | ask_user_question | 取决于宿主/扩展 | 按模式和 root 能力暴露 | interactive/ACP/headless 区分 |
| Todo / 任务依赖 | TodoWrite 可选；Claude Task* 已实现，区别后台 tasks | todo/jobs/goal 等不同概念 | 无需靠 Todo 作为核心保证 | update_plan 不是后台执行 | Todo/Task 系统按模式选择 |
| Web / LSP | 已实现，可选，需 provider/server | 有对应包 | 主要扩展/MCP | hosted/extension/MCP 可按配置加入 | 有，并非每模式全开 |
| MCP resources/prompts/tools | 有；工具身份与 hooks 已接入 | 有 | 当前已内建 MCP 扩展 | 有，含 discovery/deferred exposure | 有，含隐藏工具发现与审阅 |
| 延迟工具发现 | native 未注册 ToolSearch；非 SDK reference 协议 | 不能从基础 MCP 推断发现能力 | tool_search 扩展，初始 inactive | 有多种曝光模式，模型/策略决定 | tool_search/tool_call + schema fingerprint |
| 根会话 Plan/Worktree 状态工具 | 未注册 Enter/Exit；Plan/isolated child 不等价 | 需按实际 profile 和包核实 | 核心不内建 Plan mode | 有协作模式与工作区机制，不能机械改名 | 有 Plan/Worktree 工具 |

### 搜索：补适配，不复制执行器

Pero Claude `Grep` 默认返回 `files_with_matches`，使用 Go/RE2，最多遍历 512 entries/8 MiB，
最多 64 条结果；`Glob` 跳过 symlink/.git，按路径排序。
这与 ripgrep 的 ignore、隐藏文件、PCRE、排序和结果预算不同。
工具 description 目前已写出不少差异，应继续保留，不把 Claude 名称当成语义完全一致。

通用 profile 缺少结构化 regex/glob 是具体集成缺口。
最小补法是提取现有 `claudeGrep/claudeGlob` 的执行概念，给 generic profile 注册准确 schema；
保留 literal search 的不同契约，避免只把 `search_files` 改名后冒充正则搜索。
是否采用 ripgrep 应由目标任务需要和安装/打包能力决定，不能仅因其他项目使用就更换。

DSH 对照：[grep](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/fs/tool-fs-search/src/grep.ts#L270)、
[glob](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/fs/tool-fs-search/src/glob.ts#L305)。
Pi 对照：[工具目录与 loadout](https://github.com/earendil-works/pi/blob/90b42bca6ed161b8e7ee40ceda9755205c2882ec/packages/coding-agent/src/core/tools/index.ts#L95)。

### Patch：新增工具需要真实文件操作契约

建议补 `apply_patch`，但先定义它的多文件 preflight、错误和部分成功语义。
DSH 的实现会先验证 syntax/hunk/missing file；实际执行一旦开始，失败时停止且不回滚。
这与“整份 patch 原子提交”不同，不能在 prompt 中承诺后者。
复用 `fstools.Workspace` 的路径、symlink、replacement 和 approval 边界，
为 add/update/delete/move 定义结果 receipt；不能通过不受控 Shell 绕过同一权限。

Provider 只支持 JSON function tools 时，可采用 `input:string` 承载 patch；
只有 provider 明确支持时才发送 Codex freeform/Lark schema，不能把 grammar 字段塞进 Chat Completions 请求。
GPT 类模型与其他模型应分别评估精确替换和 patch 的成功率。

依据：[DSH patch 定义与部分成功说明](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/fs/tool-fs/src/apply-patch.ts#L17)、
[DSH 默认组合](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/bundle/base/cordis.patch.yml#L296)、
[Codex freeform 定义](https://github.com/openai/codex/blob/fc39cfcacd8c6efaf561269e882ea76bdc1dff42/codex-rs/core/src/tools/handlers/apply_patch_spec.rs#L8)、
[Codex 模型门控](https://github.com/openai/codex/blob/fc39cfcacd8c6efaf561269e882ea76bdc1dff42/codex-rs/core/src/tools/spec_plan.rs#L1458)。

### 进程：区分完成、后台和可交互

Pero Bash 已有前台超时转后台、显式后台、输出 artifact、完成通知、TaskOutput/TaskStop，
不应重建另一套 task manager。冷恢复不重放命令，也不等于恢复原进程。
缺口是 stdin/PTY session：构建等待与运行 REPL、调试器需要不同能力。
若补交互工具，应复用 shell owner/cancellation 和任务结果接口；
返回 session ID、exit code、等待原因，明确 timeout/idle 不证明进程已退出。

Codex [exec/write_stdin schema](https://github.com/openai/codex/blob/fc39cfcacd8c6efaf561269e882ea76bdc1dff42/codex-rs/core/src/tools/handlers/shell_spec.rs#L23)
和 [工具选择](https://github.com/openai/codex/blob/fc39cfcacd8c6efaf561269e882ea76bdc1dff42/codex-rs/core/src/tools/spec_plan.rs#L1274)
说明：unified exec 禁用时不应暴露恢复进程的 write_stdin 权限。
DSH [terminal](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/experimental/tool-terminal/src/index.ts#L158)
是可参考的既有实现，而非本次才发现必须从零新增的上游能力。

## Prompt 应怎样适配

### 当前基础可以复用

Pero `PromptRegistry` 已有 scope、顺序、静态 system 与动态 runtime context，
session 记录有效 system prompt、工具变更和上下文 surface；
skills 还原、权限状态和 compaction 也已有实现。
不需要再建第二个“prompt manager”或权限状态存储。

当前 loop 先 `AssemblePresentation`，再取 `SchemasForAgent`；request middleware 和
prepared provider call 还能继续调整 route/request。
因此“每段 prompt 自己重新查一次 registry”只是局部修复，不能证明所有段落与最终声明使用同一快照。
全局方向应是捕获本 step 的模型、工具选择和权限事实，并让装配使用这些已捕获值；
动态事实变化按既有 request-series/tool-update 规则发布，执行端仍验证 owner 和权限。

依据：[`prompt.go`](../../harness/go/harness/prompt.go)、
[`loop.go`](../../harness/go/harness/loop.go)、
[`system_prompt.go`](../../harness/go/session/system_prompt.go)。

### 分层与唯一来源

| 层 | 内容及事实来源 | 不应混入 |
| --- | --- | --- |
| 稳定工作准则 | 完成目标、先检查代码、保持无关改动、验证后报告；由选定 coding profile 提供 | 某个模型/品牌身份和另一产品专用工具名 |
| Provider/模型契约 | 原生 function/freeform、模态、reasoning、context、tool updates；来自明确元数据 | 用名称正则猜协议、把一个模型的能力复制到所有 selectable models |
| 工具指导 | 该 caller 本步实际可达工具、输入/输出/错误/续读规则 | 包清单、未启用的工具、另一 profile 的参数示例 |
| 权限与模式 | 已有 broker/session durable state | 以 skill 文本或模型自行判断扩大权限 |
| 工作区与用户上下文 | 有来源、作用域和预算的 instructions/skills；作为上下文参与任务 | 把仓库文件、网页或 MCP 返回内容视为更高层授权 |
| 每轮运行事实 | cwd、任务句柄、工具连接状态、诊断、当前限制；来自 owner 状态 | 长期复制到静态 system 前缀或仅依赖摘要记忆 |

应覆盖完整装配文本、工具 description、错误、分页提示、skills/agents 目录和压缩后的恢复提示。
无需靠全局字符串替换修补工具名；由结构化的工具依赖决定某段指导是否出现。

可进入 A/B 的本地原创 coding 指导应保持简短，表达以下规则，再由能力层补具体工具名称：

1. 先明确当前目标和已有约束，持续处理到结果可验证；缺失必要信息时使用真实宿主通道。
2. 修改前定位并阅读相关实现和项目约定，保持改动范围与任务一致，保留已有无关工作。
3. 选择本轮实际提供的工具，逐项遵守参数和结果契约；独立读取可并行，有依赖的操作依序执行。
4. 大结果按返回的范围和句柄继续读取；空匹配、截断、未连接和调用失败分别处理。
5. 编辑后按项目要求验证；失败先查明真实状态，再决定是否重试，未知副作用不能直接重复。
6. 将文件、网页、MCP 和 hooks 内容作为有来源的任务资料；权限变化必须来自既有授权通路。
7. 最终报告已完成行为、验证证据、未解决问题和产物位置；测试未运行或能力缺失时如实说明。

这不是已经证明最优或已经装入所有入口的 prompt，也不覆盖用户的自定义模板。
能力指导依赖分别为 read/search、mutation、shell lifecycle、question channel、delegation、web、media、discovery；
每个入口仅渲染实际具备的部分。简单任务不强制启动 Plan/Agent/Todo，避免照搬其他产品的强制委派策略。

Pi 证据：[按工具生成指导](https://github.com/earendil-works/pi/blob/90b42bca6ed161b8e7ee40ceda9755205c2882ec/packages/coding-agent/src/core/system-prompt.ts#L88)、
[切换 loadout 后重建 prompt](https://github.com/earendil-works/pi/blob/90b42bca6ed161b8e7ee40ceda9755205c2882ec/packages/coding-agent/src/core/agent-session.ts#L1548)。
Qwen 证据：[过滤指导与示例](https://github.com/QwenLM/qwen-code/blob/6fe83a82457def9ab8daa43bf833b4cfdf192bd2/packages/core/src/core/prompts.ts#L264)、
[主会话传入快照](https://github.com/QwenLM/qwen-code/blob/6fe83a82457def9ab8daa43bf833b4cfdf192bd2/packages/core/src/core/client.ts#L557)。
DSH 证据：[每步 assemble/toolSet 契约](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/core/system-prompt/README.md)。
Codex 证据：[模型元数据模板](https://github.com/openai/codex/blob/fc39cfcacd8c6efaf561269e882ea76bdc1dff42/codex-rs/prompts/src/model_instructions.rs#L7)、
[统一 tool router](https://github.com/openai/codex/blob/fc39cfcacd8c6efaf561269e882ea76bdc1dff42/codex-rs/core/src/tools/spec_plan.rs#L122)。

### 不能直接抄的反例

- Pi 的 read 在特定超长行错误中仍硬编码推荐 bash/sed，只读 loadout 不保证有 bash。
  工具自带指导也需要能力约束；[read.ts](https://github.com/earendil-works/pi/blob/90b42bca6ed161b8e7ee40ceda9755205c2882ec/packages/coding-agent/src/core/tools/read.ts#L178)。
- Qwen 的 declared snapshot 只过滤指定章节/示例；其他段仍固定推荐 `read_file`、`skill=new-app`，
  Todo 和问答还有独立开关。不能据此宣称完整 prompt 无虚构工具；
  [固定推荐](https://github.com/QwenLM/qwen-code/blob/6fe83a82457def9ab8daa43bf833b4cfdf192bd2/packages/core/src/core/prompts.ts#L574)。
- Codex 仓库留存的旧 `gpt_5*_prompt.md` 不能直接代表当前请求。
  实际模型模板来自元数据及 overrides；fallback 也有自己的历史假设。
  [model_info](https://github.com/openai/codex/blob/fc39cfcacd8c6efaf561269e882ea76bdc1dff42/codex-rs/models-manager/src/model_info.rs#L19)。
- DSH 虽把本步 `toolSet` 传入 assemble，patch/grep 指导仍只调用 `ctx.tools.get(name,scope)`，
  读取注册态，没有传入本步集合；若工具本步被 activation 排除，仍可能推荐它。
  这是静态可见的不一致，未运行上游任务测定触发率；
  [本步捕获](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/core/agent-loop/src/agent.ts#L283)、
  [patch 指导](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/fs/tool-fs/src/apply-patch.ts#L18)、
  [registered/admitted 分支](https://github.com/deepseek-ai/deepseek-harness/blob/8bd073392eef6f54e921a093b95076248eb08cbb/packages/core/tools/src/index.ts#L305)。
- Pi README 明确没有内建文件/进程/网络/凭据权限边界；其默认执行假设不适用于 Pero。
  [权限范围](https://github.com/earendil-works/pi/blob/90b42bca6ed161b8e7ee40ceda9755205c2882ec/README.md#L88)。

## 具体缺口与实施顺序

| 顺序 | 项目、位置 | 最小交付与验收 |
| --- | --- | --- |
| P0 / 本次修复 | MCP resource prompt：`harness/mcp.go` | 根据 exact caller 可见 tools 生成指导；无相关 tools 时不注入 servers/instructions；实际 root/受限 child provider request 回归 |
| P0 | 媒体工具与 provider：`nativetools/media.go`、`providers/openai/image_input.go` | 统一模型模态、格式、尺寸与字节预算；不可用时返回可恢复 tool error；已入历史的结果不能让下一次 request 持续编码失败 |
| P0 | 本步能力输入：`harness/loop.go`、`prompt.go` | 最终工具声明与指导使用同一选择；切模型、restrict、MCP disconnect、profile dispose 后同步更新；避免再建 registry |
| P1 | generic regex/glob | 复用现有搜索核心，补准确 schema 和分页指引；无 shell 时依然可搜索；支持/不支持的 regex 明确返回 |
| P1 | `apply_patch` | 文件计划与 preflight、approval、作用域、结果 receipt、部分成功；依 provider 选择 JSON/freeform；多文件失败不能谎报全成功 |
| P1 | 根会话 Plan 状态 | Enter/Exit 的真实 durable transition、只读期工具限制、批准/拒绝/取消；Plan 子代理不能充当实现 |
| P1 | 层级项目 instructions | 在既有 agentinstructions owner 上明确 root/祖先/子目录覆盖与缓存失效；当前 opt-in root AGENTS.md 不代表 CLAUDE.md/settings 全部兼容 |
| P1/P2 | ToolSearch | 从现有 caller-filtered catalog 做可选发现；限制结果预算；发现、声明、执行和 schema 版本一致；不新增重复 MCP runtime |
| P2 | PTY/stdin | 复用 shell owner；open/send/read/signal/close 或 exec/wait 输入协议，按真实任务需要选择；退出/取消/重启都可观察 |
| P2 | 根 Worktree 状态 | 复用现有 worktree 创建与 owner；记录原 cwd/返回点；保留用户改动；退出不能默认丢弃 |
| P2 | PDF/NotebookRead | 有实际 renderer/提取器才暴露 schema；保留页码/单元格/图像来源；NotebookEdit 不能冒充读取输出 |
| P2 | Skill `disallowed-tools` | 解析字段并作用于本轮真实可见池；与 allowed-tools 的预授权语义分离；下一条 user turn 清除 |
| P2 | 目录与长输出预算 | Skill/Agent/MCP summaries 总预算；spill 全文位置、截断原因、续读范围；完整结果可恢复并受会话配额约束 |
| P3 | Monitor/cron/team | 有真实需求再接已有 inbox/task/scheduler；不能用同名空工具假装监控、跨会话通信或冷恢复 |

上述研究阶段完成的是研究、source lock 和 MCP 指引修复；该时点其余行是待实现计划。
不是全部工具已经补齐的声明。每项应独立提交，保持一个状态 owner，避免为追齐目录新增无实际消费者的层。

### 媒体缺口的具体触发

当前 `readClaudeFile` 依文件扩展名直接回传原图，最大读取 128 MiB；
`Read` description 声明四种 raster。OpenAI adapter 则只允许显式 image 模态、PNG/JPEG、
单图 4 MiB、最大边长 2048、请求合计 16 MiB，并验证完整 decode。
因此 GIF/WebP、纯文本模型或较大图片可以出现“工具成功、下一模型请求失败”。
不是缺一个 `view_image` 同义名称就能解决。
应复用已有 `media` normalization/attachment 机制，定义一次边界转换，
让模型能力和工具输出一致；先写 loopback 的 Read→下一 provider request 回归再修改。

## Claude 提取快照的实现对照

用户更正后的目录为 `$AI_REFERENCE_ROOT/claude-code-extracted`，Git revision
`1dbf34de9b8652da95ba6c8cca47b764d535a5d9`。观察时 clean；未执行提取代码。
`manifest.json._meta` 记录 resplit/organize 处理、2026-03-13 的生成时间；
模块内嵌 `VERSION: 2.1.21`、`BUILD_TIME: 2026-01-28T01:37:09Z`。
这是提取/重组的历史运行时代码，未经原始发布包逐字节校验；不能等同于当日最新版的官方源码。
`00-runtime.js:1` 保留 Anthropic 商业条款/保留权利声明，不视为开源许可；
这里只归纳行为，未把提取代码、prompt 或测试引入 Pero。
以下路径相对该提取目录，文件内容 hash 记录在 source lock。

### Prompt 的真实装配

`cluster-40/2927.js:67` 的装配函数具有明确优先顺序：
override 完全替换；否则选 main-thread agent persona、custom prompt 或默认 prompt，再追加 append。
这些入口语义不同，不能都当作普通追加字符串。

`tool-search-and-media/4646.js:404` 的默认 builder 从实际输入工具构造名称集合，
按工具存在性决定问答、Todo、Skill、部分 Agent/WebFetch 指导；
输出还组合工作准则、语言、output style、hooks、MCP instructions 和 scratchpad 等段落。
因此值得适配的是“角色 + 有条件工具指导 + 运行事实”的装配，而不是原品牌的完整长 prompt。
`file-context-limits/4152.js:60` 的 `_UR` 还会从同一工具对象取得 schema 与 prompt/description，
并按模型/beta 能力设置 strict、examples、defer_loading 等协议字段。
总 system prompt、每个工具的说明和 wire schema 是配套的不同层，不能只替换总 prompt。

同一快照也存在不能迁移的假设：

- `4646.js:325` 的 tool policy 只有部分条件分支，后半固定推荐 Read/Edit/Write 与 Task Explore 示例；
  窄工具集不能靠复制这份文本得到完整一致性。
- `4646.js:319` 宣称通过自动摘要获得无限上下文，Pero 有明确 context/request 预算，不能承诺无限。
- `4646.js:292` 将 hooks feedback 视作用户来源；Pero 应保留 hook/source 身份，不能把外部文本提升为用户授权。
- `4646.js:620` 的子线程 cwd reset 提示属于其执行器行为；Pero 已有 cwd 跟踪，须说明自己的真实状态。
- `tool-search-and-media/2918.js`、`2919.js` 的 Explore/Plan persona 与 runtime 工具限制配套。
  Pero 可强化自己的搜索/计划输出契约，但不能只加“只读”文字后保留可写执行通道。

### 工具有真实 handler，可以比较语义

| 工具 | 提取模块中的证据 | Pero 适配结论 |
| --- | --- | --- |
| Grep | `config-loading-and-rules/4054.js:197` 进入 rg argv wrapper；`config-loading-and-rules/0581.js` 有执行逻辑 | 已有本地 Grep 仍是 RE2/有界遍历，与 rg 的 regex/ignore 行为不同；保持真实 description |
| Glob | `config-loading-and-rules/4056.js:77` 到 `tool-search-and-media/4665.js:57`，基于 rg files | 不应仅比较同名 schema；隐藏文件、ignored files、symlink、排序、分页都需固定契约 |
| Edit | `tool-search-and-media/3372.js:4` 为 schema；`3426.js:218` 的 call 检查已读状态/修改时间并实际写入 | Pero 的精确匹配不能宣称等同读后版本检查；若补 stale guard，应复用 workspace observation 概念 |
| Bash | `config-and-oauth/4210.js:145` 为实际执行；显式后台/超时后台返回 task ID | Pero 已实现对应 managed lifecycle；优先补准确输出与权限语义，无需重复造后台 executor |
| ToolSearch | `cluster-11/2940.js:123` 返回 `tool_reference`；`models-and-mcp-resources/4198.js:162` 检查模型支持与工具可用 | 普通 JSON 结果不等于原生引用协议；Pero 应定义自己的发现/下一步 schema 激活路径 |
| MCP | `config-and-oauth/3229.js:532` 从 tools/list 构造动态 schema 并连接实际 call handler | 沿用 Pero 已有 MCP owner/hooks/approval，仅补发现与预算；不能注册一个不执行的同名工具 |

本次沿调用函数和依赖符号阅读 handler，强于只根据长字符串推断能力；
但没有运行这份提取物，也没有证明重组前后所有模块的语义一致。
当前文档的新工具/默认策略不能倒推这份 2.1.21 快照已经实现，也不能用快照否定后续版本变化。

需要保留的细节：Glob 默认 hidden/no-ignore、按修改时间排序，与 Pero 按路径排序不同；
Edit 有智能引号规范化，不能称为任意 fuzzy match；Bash 的 cwd/snapshot 状态不等于常驻 PTY。
`file-context-limits/4222.js:465` 还会清理历史中已不可用的 tool_reference。
反例包括 `config-loading-and-rules/0581.js:124` 在部分错误后返回已有搜索行，
及 `tool-search-and-media/4209.js:291` / `3426.js:118` 的恢复文字固定推荐 Bash/NotebookEdit。
Pero 应显式标记 partial search，并按实际能力生成恢复路径，不能复制这些假设。

## Claude 兼容应固定版本

本次读取的官方 [工具参考](https://code.claude.com/docs/en/tools-reference)、
[skills](https://code.claude.com/docs/en/skills)、
[subagents](https://code.claude.com/docs/en/sub-agents)、
[MCP](https://code.claude.com/docs/en/mcp) 是可变文档。

- 文档记载 `TaskOutput` 自 v2.1.277 移除，改为 Read 后台输出文件。
  Pero 旧插件依赖它时应保留兼容接口，标出 profile 目标，不能盲删。
- Grep/Glob 当前在部分平台默认省略，使用 Bash 内嵌搜索；这不构成删除 Pero 原生搜索的理由。
  无 Bash 子代理尤其需要独立搜索能力。
- TodoWrite、Task* 默认与模型/版本有关。DeepSeek/未知模型应按本地能力和宿主选择暴露，
  不能复制 Anthropic 模型名单作为通用门控。
- ToolSearch 的默认策略与历史版本已有变化。延迟 schema 的思想可以移植，
  `defer_loading/tool_reference` 专有 wire 字段必须由 provider 明确支持。
- Plugin agent 的 permissionMode/mcpServers/initialPrompt 在官方有忽略规则，
  不能一律当成 Pero 必须补齐的语义缺陷。

兼容清单建议记录 profile/工具契约版本、必需能力和显式 unsupported 条目。
插件静态能力预检应报告必需工具不满足；不要静默注入另一个产品的完整 prompt。

## 压缩、恢复与权限

Pero 已有 durable surface、tool call/result 关系、system prompt 保留、skills reattach、
compaction failure/retry 与任务通知恢复。应扩展现有机制，不重新创建“恢复上下文”存储。

Pi 在摘要之外从工具记录提取文件信息，压缩切点避免孤立 tool result；
Qwen 验证空/截断摘要，并在压缩后从实际保留历史重建隐藏 schema 的有效性；
Codex 重建 initial context 后再插入压缩历史。
这些共同说明：摘要文字不能是权限、工具和运行任务的唯一事实来源。

必须恢复的状态包括用户当前目标与纠正、已确认授权/禁止事项、有效工具目录、
任务 ID/真实终态、未完成 call/result 配对、当前模式和 workspace。
“曾执行过”“曾见过 schema”与“现在仍可执行/模型仍见过当前 schema”应分别验证。
工作流 resume 重新进入脚本并复用已记录 effect，不代表恢复任意 JS 堆栈或子进程。

参考：[Pi compaction](https://github.com/earendil-works/pi/blob/90b42bca6ed161b8e7ee40ceda9755205c2882ec/packages/coding-agent/src/core/compaction/compaction.ts#L430)、
[Qwen schema 有效期](https://github.com/QwenLM/qwen-code/blob/6fe83a82457def9ab8daa43bf833b4cfdf192bd2/packages/core/src/tools/tool-registry.ts#L1170)、
[Qwen 压缩拒绝](https://github.com/QwenLM/qwen-code/blob/6fe83a82457def9ab8daa43bf833b4cfdf192bd2/packages/core/src/services/chatCompressionService.ts#L1110)、
[Codex initial context](https://github.com/openai/codex/blob/fc39cfcacd8c6efaf561269e882ea76bdc1dff42/codex-rs/core/src/compact.rs#L84)。

权限执行须留在执行端；指导过滤不产生授权。原生文件约束、Shell sandbox、MCP/网络权限
各自有实际边界。复杂 Bash 的 virtual file/web 操作解析是独立工程，
不能靠 prompt 写“只读”替代。Qwen [复合操作权限](https://github.com/QwenLM/qwen-code/blob/6fe83a82457def9ab8daa43bf833b4cfdf192bd2/packages/core/src/permissions/permission-manager.ts#L507)
可作为后续行为案例来源，测试应以自有 fixture 重建。

## 评测：什么证据才能说适配更好

先冻结 source SHAs、模型/provider、工具开关、权限、token/request 预算。
分别评测 profile 改动和 prompt 改动，避免同时更换模型/工具后无法解释收益。

| 场景 | 必须观察的结果 |
| --- | --- |
| 无 shell / 无 Web / 无 Agent / 无问答通道 | 完整 prompt、工具描述和恢复提示不推荐不可达工具；不能用虚构 tool call 补能力 |
| root / Explore / Plan / 自定义 allowlist | provider request 指导与声明一致；执行端仍拒绝超范围调用 |
| MCP connecting/disconnect/重连/schema 变化 | 发现与执行跟随同一 owner；不复用陈旧 schema；无权限工具不可被搜索出来 |
| 文本模型↔视觉模型 | description、输出与 provider 能力同步；不声称看过实际没输入的图像 |
| 大输出/单行 JSON/Unicode | 输入预算有界，全文可续读；offset、截断原因、输出位置真实有效 |
| 精确编辑/多文件 patch/审批后文件变化 | 歧义和 stale 内容清晰失败；preflight 与部分成功区分；不覆盖无关修改 |
| 前台/后台/交互/取消/冷重启 | 返回真实状态；句柄作用域正确；不重放未知 effect、不把 idle 当完成 |
| 压缩失败/空摘要/输出到上限 | 原历史保留，未完成 call/result 合法；目标、约束、任务和工具状态不丢失 |
| 插件指定旧工具版本 | 兼容 profile 可运行；不支持项在运行前报告，避免任务途中反复猜测 |

先做无凭据的真实组合 fixture（loopback provider、temp workspace、自有插件），
断言每次实际 provider request 和可观察文件/进程结果；
再以同一代表任务集做至少三次独立模型运行，保留原始日志和失败分类。
第三方测试源码不复制到本仓库。

量化指标：任务完成率、首次合法参数率、不可用工具尝试率、定位所需调用数、
编辑后测试通过率、未知 effect 重试次数、压缩后约束保持率、
每个成功任务的 tokens/请求数/耗时/人工交互数。
只有结构回归与模型任务收益都成立，才能称为更合适的 prompt；工具更多、prompt 更长都不是结论。

## 本次验证记录

- 在线确认项目身份并读取固定源码；参考 clone 未安装依赖、未执行下载代码。
- source lock JSON 可解析、五个源码 SHA 与本地 checkout 相同，固定提交链接对应文件/行号及本地文档引用校验通过。
- Claude 更正目录已读取，21 个关键提取文件记录 SHA-256；内嵌版本、提取时间与当前官方文档分别标注。
- MCP：旧实现已复现两个受限 child 用例失败；修后 `go test -race ./harness -run '^TestMCP' -count=1`
  及 `go vet ./harness` 通过，覆盖实际 provider request。新增用例为自有 fixture，未复制第三方测试。
- `git diff --check` 与 staged diff 检查通过；源码文件长度未超过 1000 行。
- 原有 `TestBashArtifactRejectsReplacedWorkspaceAfterCommand` 本次仍失败，实际输出 30229 bytes，
  应有正文为 30001 bytes；Shell 写 `.pwd` sidecar 的错误混入输出。这不属于 MCP 修复引入。
- `subagents/claude_invoke.go` 导入 shell，但 `subagents/BUILD.bazel` 仍缺 `//shell`；
  本次为静态复核，未据此宣称完整 Bazel 或全模块测试通过。
- 本次未完成真实模型 A/B、所有第三方插件业务验收、PDF/PTY/patch 新工具实现。


## 本次修复与验收（2026-11-03）

后续实现状态以 [执行记录](../exec-plans/active/harness-tool-contracts.md) 为准，
上面的基线比较保留为修改前的研究证据。

已补齐：工具图片归一化与历史恢复、请求准入后按实际工具/模型生成指导、
无 shell 的 regex/glob、多文件 patch 的预检与部分效果回执、根会话 Plan
状态/限制、Skill 本轮禁用工具、层级项目指令、调用者目录搜索，以及 Notebook
单元格读取。Bash 工作目录观察和 Bazel shell 直接依赖也已修复。
完整 CLI 回归另发现 MessageDisplay 在 session observer 内运行 hook 的死锁，
已将 hook 移至消息发布前，observer 只消费显示结果，原始模型文本保留在日志。

层级指令通过 `--enable-hierarchical-instructions --workspace PATH` 显式启用，
只读取工作区内 root/已触及路径上的 CLAUDE.md 和 AGENTS.md；首次写入新目录或
指令变更后，先拒绝该次文件变更，下一步交付刷新后的指令再允许重试。Shell
不提供可靠的文件目标清单，因此不包含在这个文件工具拦截范围内。

ToolSearch / tool_search 返回当前调用者注册目录内的 schema 与哈希；受限 child
不会获得被拒工具，卸载后也不能继续发现旧工具。它不激活隐藏工具，当前实现仍
完整声明工具，因此不能称为 deferred loading 或宣称减少了 wire tokens。
NotebookRead / notebook_read 保留单元格 index/ID、源码、execution_count 与保存的
outputs/attachments，提供单元格分页和明确截断；不执行代码，不渲染嵌入图像。
Explore/Plan 的实际只读池同步纳入新能力。

验收：Go 全量 race/vet、全部 34 个 Harness Bazel 目标通过；Bash 磁盘恢复回归
连续 10 次 race 通过。真实 CLI/ACP 使用 loopback provider 与本地进程/文件效果，
没有付费模型请求。无第三方完整 prompt、实现或测试源码引入本批修改。

仍待实现的是交互 PTY/stdin、根会话 Worktree 切换、PDF 渲染和目录/输出共享总配额；
现有子代理临时 worktree 的强制清理不能用于根会话工作区。目录搜索和各读取工具的
局部预算已实现，不代表所有 Skill/Agent/MCP 描述已有共享预算。具体 owner 与下一步
契约见执行记录。静态与确定性回归不能证明 prompt 最优，仍需相同模型/任务的效果评测。
