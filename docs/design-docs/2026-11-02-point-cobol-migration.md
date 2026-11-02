---
kind: verification_report
date: 2026-11-02
status: partial-migration-verified
---

# Point COBOL App → Pero：迁移试验

结论：可以先迁移独立的 COBOL 分析插件，再迁移工作台。不能把当前 Point
App 改个 schema 名称就当成 Pero App。领域实现继续由 Point 构建，Pero 只消费
外部 App bundle；不引入 Point Host、Session、Project 或 App runtime。

## 本次实际跑通的范围

入口：`tests/runtime/point-cobol-migration.mjs`。显式指定 Point checkout，读取其
已经构建的插件产物，不运行 Point 的构建脚本，不修改 Point 文件或用户安装。

试验包 `cobol-probe` 包含一个标明试验范围的最小 HTML 面板、回执 backend，和
Point 原有 COBOL 插件的 MCP 构建产物、Skills、references、第三方声明。
它不是完整 `cobol-modernization` App；本次没有启动或迁移原工作台界面/backend。

插件声明转换为 Pero `plugin.json`：显式列出 Skill 路径，stdio MCP 使用绝对
Node 路径和 `{pluginRoot}/bin/mcp.mjs`。本次只装配
`point-cobol-modernization` MCP，未挂载三个 mainframe MCP。

通过 `app-bundle.json` 的显式文件清单打包、暂存，然后删除输入包。Pero Host
安装、显式 prepare、enable 后，再删除暂存目录；后续会话只使用已安装副本。
插件自带 `runtime/cobol-mcp.mjs` 是领域 MCP 的独立构建产物，不是 Point Host runtime。

验证链路：真实 Pero Host → 真实 Go Harness → 原 Point MCP `legacy_inspect` →
Pero App Use MCP → App 回执 backend。先直接调用搬迁后的 MCP 取得完整基准结果，
再逐值比较 Harness 返回的结果，确保模型没有漏抄源码或改变分析配置。

使用 Point 的 `samples/fee-quote/cobol/FEE-QUOTE.cbl` 与 `QUOTE-IN.cpy`：

- 必须显式使用 `config.format: free`；默认 fixed 会产生语法诊断。
- 程序 `FEE-QUOTE`，9 个节点、16 条关系，0 个解析诊断、0 个缺失依赖。
- 风险计数为 4；这些风险并未因诊断为 0 而被忽略。
- 当前输入摘要：`sha256:1806360e6ce03ebc45bb6db9622e75b098c60c6650610d941365c66768883666`。
- MCP 实际列出 22 个工具；本次只调用 `legacy_inspect`，未执行或转换程序。
- 真实模型 `deepseek-flash`：允许路径 1 次审批、保存 1 条回执；拒绝路径 1 次
  审批、保存 0 条回执。两次都保留了与直接调用完全一致的分析结果。

审批通过 Host API 回答。本次没有新增 Desktop 人工点击或完整工作台截图验证，
也未验证 Point 编译、Java/C# 差分、TK5、IBM/CICS、业务接受或发布安装包。

## 完整工作台的契约差异

检查基于 Point `d8cfaf8a0`；运行报告记录完整 commit 和实际执行的二进制摘要。

| 边界 | Point 当前实现 | Pero 迁移工作 |
| --- | --- | --- |
| App 声明 | manifest 132,056 字节；`panelTabs`、`agentTools`、`entryPoint` | 原包安装实际被 `App manifest exceeds 64 KiB` 拒绝。由领域方导出 Pero 的 `panels`、`writes`、`backend.entry`；先按方法缩小切片，不直接提高全局上限。 |
| UI | React 模块 `ui/dist/index.mjs`；`@point/app-sdk`、共享组件和 CSS loader | 在 Point 侧新增独立 HTML 组合入口，迁移到 Pero SDK；原 UI 不能直接作为 iframe entry。保持领域视图和算法归属 Point。 |
| 上下文 | `/api/projects`、`/api/workspaces`、`/api/sessions` 和 Point 导航、对象、Run 视图 | 为 Pero 定义实际需要的工作区/项目引用和会话上下文；不复制 Point Project runtime，也不伪造这些 API 返回值。 |
| Node 生命周期 | `PORT`、`POINT_APP_DATA`、文本 readiness；HMAC `x-point-app-proxy` | 新增 owner-owned Pero backend 组合入口，接收 `PERO_APP_DATA/TOKEN`，绑定 loopback port 0，首行输出 `{"port":...}`；鉴权在入口转换一次。 |
| Agent 调用 | `activation: prepared`、4 sessions、`prepareTool`、`contextSchema`、`resultTool` 和 `toolProfiles` | Pero 目前只有固定 instructions、write allowlist 和预算。完整移植需要明确的 Prepared Method 值：固定方法、源码摘要、范围和结果回执，再接入现有 Host 会话；不能丢掉 prepare 约束或自动制造 Agent 签名。 |
| 工具 schema | 使用 `const`、`oneOf` 等较完整 JSON Schema；部分名字含下划线 | Pero 工具名使用连字符，当前参数校验是子集。试验确认 `const`、`pattern` 会被拒绝；简单约束可转 enum，其余约束在领域入口校验或另立明确的契约扩展。 |
| 执行授权 | Host 签名执行凭证、Session/epoch、原 requestId 对账、构建/运行回执 | 编译、生成后执行、主机写操作仍需单独迁移真实授权和回执协议；不能用 App token 冒充 Point Host proof。源分析试验的审批结果不证明这些工具已受控。 |
| 插件依赖 | 平台插件声明、目录式 Skills、`${CLAUDE_PLUGIN_ROOT}`、4 个 MCP | 本次已证明显式 Skill 清单、路径变量转换和独立 COBOL stdio MCP 可装配；主机工具按能力和权限分开迁移。 |

建议下一步的交付切片是 **源码快照 → 分析/图谱 → 保存分析回执**：在 Point
侧正式提供 owner-built Pero bundle 和 HTML 入口，复用现有分析领域包；先让
Pero 的独立 App 打开真实工作区并展示结果。随后单独实现 Prepared Method 契约，
再迁移 BMS frontend 和 Java/C# 构建/对照；主机运行时最后处理。

## 复现与证据

需要先有当前 `target/debug/pero-host` 和 `target/debug/pero-agent-acp`。
默认模型端使用 loopback 脚本，领域 MCP 与 Harness 始终是真实实现。

```sh
node tests/runtime/point-cobol-migration.mjs --point-root=/path/to/point
node tests/runtime/point-cobol-migration.mjs --point-root=/path/to/point --real
node tests/runtime/point-cobol-migration.mjs --point-root=/path/to/point --real --reject
node --test scripts/build/app-bundle.test.mjs
```

`--real` 显式启用真实模型，读取环境或本地 `.env` 中的 `DEEPSEEK_API_KEY`，
不把凭据写入报告。临时安装和进程在结束时清理。

报告位于 `test-results/point-cobol-migration/{scripted,real}-{allow,reject}.json`，
工具结果在对应 `*-tools.json`。报告包含源码版本、测试/Host/Harness/MCP 摘要、
冻结的会话声明、依赖 revision、完整分析结果及实际保存记录。未使用外部网络的
默认执行与真实模型执行分别记录；这些本地产物不提交仓库。
