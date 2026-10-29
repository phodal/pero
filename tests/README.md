# Tests

同一行为只在一层证明。验收层级 L0–L3 与命令入口见 [docs/fitness/README.md](../docs/fitness/README.md#acceptance-levels)。`docs/fitness/` 里的其余文件是当日验证记录，不是这套测试的说明。

截图和 `result.json` 写到仓库根的 `test-results/`，已被 gitignore。

## 后台桌面测试

桌面 E2E 共用 `e2e/electron.mjs`，默认启动隐藏的真实 Electron。主进程、
preload/IPC、GPUI、Host 和各套件原有的 Agent/App 后端继续运行；不把桌面桥换成
浏览器 mock。窗口不显示，macOS 使用 accessory 策略避免激活 Dock；动画帧保持
运行，键盘与组字通过 CDP 页面焦点接入。启动器会检查窗口是否隐藏，旧 Desktop
或 Product 构建会报错，需先重新构建。

```sh
npm run build
npm run test:e2e
npm run test:i18n
# 显式前台验收或调试；会占用输入焦点。
PERO_TEST_HEADED=1 npm run test:e2e
# Linux 独立 runner：真实可见窗口运行在虚拟显示中。
PERO_TEST_HEADED=1 PERO_TEST_SOFTWARE_GL=1 xvfb-run -a -s '-screen 0 1920x1200x24' npm run test:e2e
```

`PERO_TEST_HEADED=1` 也适用于其他桌面套件；PowerShell 用
`$env:PERO_TEST_HEADED='1'` 设置。`PERO_TEST_SOFTWARE_GL=1` 显式选择 ANGLE
SwiftShader WebGL2，供无 GPU 的 runner 使用。Linux 隐藏模式仍需 X11/Xvfb。
普通 `npm run dev` 不受这些测试默认值影响。`graphics.mjs` 是原生显示检查，
同样要求 `PERO_TEST_HEADED=1`；graphics CI 已显式设置。release smoke 继续
使用其仅限独立 CI runner 的原有入口。

`app-use.mjs` 与 `app-use-workbench.mjs` 验证真实截图和隐藏窗口拒绝规则，要求
`PERO_TEST_HEADED=1`，默认会在启动 Electron 前拒绝运行。用独立 VM/runner 的
桌面或 Linux Xvfb 执行，保持产品原有的“隐藏窗口不能捕获”规则。

后台结果覆盖各套件既有的应用链路；原生窗口激活、物理输入法、系统弹窗和真实
硬件 GPU 需在相应平台单独验收。fixture、真实 provider 和安装包的边界保持各
套件原有定义。套件仍顺序运行，独立 profile 不代表所有系统资源都已隔离。

## 目录

| 路径 | 层级 | 命令 | 证明什么 |
| --- | --- | --- | --- |
| 各 crate 的 `#[cfg(test)]`，以及 `crates/pero-worker/tests/remote.rs` | L0 | `npm test` | `pero-contracts`、`pero-runtime`、`pero-host`、`pero-ui`、`pero-worker`：Unicode echo、语言偏好、流式队列、工具行折叠、Worker 租约与假协调服务 |
| `runtime/acp_lifecycle.rs` | L0 | `npm test` | ACP 会话状态机。由 `crates/pero-runtime/src/acp/session.rs` 以 `#[path]` 编入，不经过 UI |
| `runtime/lifecycle-agent.mjs` | L0 | 同上 | 状态机专用 fixture。场景由 `PERO_FIXTURE_SCENARIO` 选择，不读仓库、不发网络 |
| `contracts/host.mjs` | L0 | `npm run test:contracts` | 真实 `pero-host --stdio` 的每一行 JSONL 符合 `protocol/generated/host.schema.json` |
| `fixtures/acp-agent.mjs` | L0 / L1 | contracts 与 e2e 共用 | 脚本化 ACP：`toolmatrix`、权限、等待、长流式。普通展示场景不执行命令或文件写入；显式 `contribution-fixture` 场景在临时贡献工作区写入文档 |
| `e2e/desktop.mjs` | L1 | `npm run test:e2e` | 顺序执行 `workbench.mjs` 和 `toolcalls.mjs`，各启动一次真实 Electron |
| `e2e/workbench.mjs` | L1 | 同上 | 中文组字、多轮、取消、权限、千段长流式、上滚不跳动、刷新后历史还在 |
| `e2e/toolcalls.mjs` | L1 | 同上 | 九种工具行、diff、失败、取消、附件上下文 |
| `e2e/local-execution.mjs` | L1 | `npm run test:local-execution` | 首次引导、明确授权本机执行、真实 Host/Worker 与 ACP fixture、加密配置、重启自动恢复、停止/继续和账号隔离 |
| `e2e/local-roadmap.mjs` | L1 | `npm run test:local-roadmap` | Cloud 请求挂起时仍可加载本地 ROADMAP；搜索、已完成项、切换来源、真实 Host/ACP 临时文件写入、来源不变、文件错误恢复与明暗/窄窗 |
| `runtime/local-worker-host.mjs` | L1 | `node tests/runtime/local-worker-host.mjs` | 临时目录与 loopback Cloud 下的真实 Host/Worker 生命周期、异常/EOF 清理、凭据不进入公共状态 |
| `e2e/composer.mjs` | L1 | `npm run test:composer` | 类型化上下文、`@`/`/`、键盘与 token 删除/撤销、冻结快照、图片粘贴、Agent 声明的模式/强度/权限，以及明暗主题和窄窗口 |
| `e2e/i18n.mjs` | L1 | `npm run test:i18n` | 中英文切换、原生菜单、重启后偏好、用户原文不翻译、无 Host 的预览窗口。文案源见 [locales/README.md](../locales/README.md) |
| `e2e/remote.mjs` | L2 | `npm run test:remote` | Electron、Go、PostgreSQL、`pero-worker` 和 ACP fixture 的一轮创建、执行、取消和断线恢复。需要 `PERO_TEST_DATABASE_URL` |
| `e2e/github.mjs` + `server/internal/httpapi/desktop_github_test.go` | L2 | `npm run test:github` | Go harness 启动真实 PostgreSQL/API 和只读 GitHub fixture；两个 Electron 客户端认领、释放、接手并经独立 Worker 执行，验证项目可见范围和自动派发不重复。需要 `PERO_TEST_DATABASE_URL` |
| `e2e/connector.mjs` + `server/internal/httpapi/desktop_connector_test.go` | L2 | `npm run test:connector` | 真实 Desktop 连接表单、Go/PostgreSQL 与 GitHub/ROADMAP fixture：客户端范围、来源完整数量、分页、标签、父子关系、已完成项禁用执行、重启恢复；不启动 Agent/Worker |
| 同上，公开仓库模式 | L2 | `npm run test:connector:live` | 本地 Go/PostgreSQL/Desktop 只读读取 `api.github.com` 的公开 `phodal/pero` Issue 与固定提交 ROADMAP，对照独立行清单检查完整数量；不执行任务、不写 GitHub |
| `e2e/remote-settings.mjs` | L1 | `npm run test:remote-settings` | 真实 Electron OS 加密存储与 Host 偏好写入，配合本地 HTTP fixture 验证重启、权限不升级、断开持久化、存储错误恢复及凭据不进入诊断 |
| `e2e/community.mjs` + `server/internal/community/http_test.go` | L2 | `npm run test:community` | Go/PostgreSQL 与 Chromium 验证公开任务、OAuth fixture、Worker 归属、认领、验收记分、撤销及来源变化；需要 `PERO_TEST_DATABASE_URL` |
| `e2e/real-session.mjs` | L2 | `npm run test:e2e:real` | 本机 Codex 登录，回复恰好是 `PERO_DESKTOP_OK`。不进默认验收 |
| `e2e/contribution.mjs` + `community/contributor_desktop_test.go` | L2 | `npm run test:contribution` | 新 OAuth 用户无需项目授权，认领公开需求、克隆独立工作区、ACP 实际写文件、审阅 diff、Git 实际 commit/push、PR 替身与回填失败恢复。需要隔离 PostgreSQL；`PERO_CONTRIBUTION_REAL_AGENT=1` 使用真实 Codex 工具，GitHub 仍为替身 |

`test:e2e` 和 `test:i18n` 使用已有的开发构建，自己不编译。先跑 `npm run build`。`test:contracts` 会先编译 Host。

三个连接器命令也先执行 `npm run build`，并使用本机可用的 OS 凭据加密存储。
`test:connector` 与 `test:connector:live` 还需要 Go、可用的 PostgreSQL，以及
指向隔离测试数据库的 `PERO_TEST_DATABASE_URL`；harness 创建并清理独立 schema。
`test:connector:live` 额外需要访问 `https://api.github.com` 和足够的公开 API 配额，
无需 GitHub token，来源数量随仓库快照变化。`test:remote-settings` 不需要 Go、数据库
或外网。三个命令均不需要模型登录或 Worker；截图和结果分别在
`test-results/connector/fixture/`、`test-results/connector/live/`、
`test-results/remote-settings/`。

## 任务树与全景

`node tests/e2e/task-browser.mjs` 使用当前仓库 ROADMAP 和临时 Go/PostgreSQL
服务验证“领域 → 功能 → 任务”、默认未完成范围、完整公开任务集、树/全景切换、
搜索与动态计数、原地范围/验收、逐级键盘操作、
URL 恢复、390px 深色与无 JavaScript 回退。设置 `PERO_TEST_DATABASE_URL`，可用
`PERO_CHROMIUM_PATH` 指定本机 Chromium。截图和结果在 `test-results/task-browser/`。
它不访问线上任务中心、不执行 Agent，也不发布 GitHub 内容。

## 线上任务发现

`PERO_DEPLOYMENT_E2E=1 node tests/e2e/task-browser-live.mjs` 验证真实
`https://app.openpero.com/tasks`，逐项核对当前仓库 Roadmap 的标题、源码行、
功能路径和勾选状态，并检查搜索、行内验收、全景、键盘、刷新与移动端。
可用 `PERO_TASK_BROWSER_REVISION` 指定公开来源链接的完整 commit SHA；它与
部署的服务端版本分别记录。该脚本只读公开页面，不登录或认领任务。
截图及结果位于 `test-results/task-browser-live/`。贡献执行回归使用前面的本地套件。

## 层外

- `npm test` 包含 `pero-worker`。`crates/pero-worker/tests/remote.rs` 自己起本地假协调服务，不使用 PostgreSQL。
- Go 控制面在 `server/`。`go test ./...` 在没有 `PERO_TEST_DATABASE_URL` 时跳过 PostgreSQL 集成用例。见 [server/README.md](../server/README.md)。
- 远程协议的整条链路在 `e2e/remote.mjs`，不另放一份不启动界面的契约脚本。
- GitHub 共享认领的整条链路在 `e2e/github.mjs`；GitHub 和 ACP 上游为 fixture，不证明真实模型、GitHub 写回或线上部署。公开仓库的只读检查另记在 [remote-dispatch-verification.md](../docs/fitness/remote-dispatch-verification.md)。
- 连接表单及 Issue/ROADMAP 来源读取由 `e2e/connector.mjs` 验证；live 模式的服务仍运行在本地，没有部署 openpero.com。ROADMAP 服务端配置见 [server/README.md](../server/README.md#github-issue-intake)。
- L3（签名安装包、升级）不在这个目录。

## 桌面套件怎么断言

工作台是 GPUI 画布，没有可定位的 DOM。脚本读 `window.peroDiagnostics.snapshot()`，点击用固定坐标，组字走 Chromium 的 IME 接口。这能确认组合事件进了输入框，不能代替物理 macOS 输入法，也不能代替签名包或真机 GPU。

`i18n.mjs` 负责偏好切换本身。`workbench.mjs`、`toolcalls.mjs` 和 `remote.mjs` 末尾仍会切英文、深色和窄窗口，用来拍长会话、工具行和远程任务。这些画面没有第二份，所以留在各自的脚本里。

## 契约脚本的覆盖规则

`contracts/host.mjs` 走完 echo、locale、加密连接偏好写入/拒绝/断开、workspace、附件、会话、权限、模型、排队、取消、认证失败、关闭和重启回放。Host 发出 schema 里没有的 `kind` 会失败。schema 里有、这次没走到的 `kind` 只打印，目前不失败。

## 先不动的部分

- Host 契约里没走到的 `kind` 继续只打印。`disconnected` 和 `notice` 由 Electron 发出，stdio 里的 Host 进程发不出来。
- 诊断快照里还没有稳定命中区域，e2e 继续用固定坐标。

## 工作区内容与共享聊天

`npm run test:workspace` 使用独立 profile、真实 Electron/GPUI、Virtual Cell
iframe 和 ACP fixture 验证内容标签切换、草稿保留、关闭与源对象删除的区别、
App 文档保留、拖动和键盘调整聊天宽度、Host 偏好重启恢复、全局错误不被 iframe
遮挡，以及明暗和窄窗。它不会调用真实模型；结果与截图在
`test-results/workspace/`。构建前置条件和边界见
[Workspace 验证记录](../docs/fitness/workspace.md)。

## App Use

`PERO_TEST_HEADED=1 npm run test:app-use` runs the task/SDK behavior tests, the official MCP client
contract, strict-CSP cross-origin browser checks, then actual Workbench and App
Product Electron fixtures in sequence. Build Host, Web, Desktop and Virtual Cell
assets first. It sends no real model request. Captures and results are written to
`test-results/app-use*`. The Product suite also proves frozen Composer refs,
image annotation/undo, explicit-file grants, automatic declared writes, Agent-policy denial and
PNG/receipt hash consistency. Workbench checks that a delayed context result
returns to its original draft after a conversation switch. Only Agent-originated
permission requests appear; Desktop adds no second approval.

`npm run test:app-use:real` opts into one read-only live Codex prompt against the
actual App. It uses the installed provider login, writes evidence under
`test-results/app-use-real`, and stays outside the default deterministic suite.
See `docs/fitness/app-use.md` for acceptance boundaries.
