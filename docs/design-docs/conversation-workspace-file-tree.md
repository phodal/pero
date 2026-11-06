# 会话工作区文件树

kind: analysis

2026-11-06，关联 #145。状态：源码调研与建议，尚未实现文件树。
这是科学会话 canonical tracker 的补充分析，不另建 active issue。

## 当前实例

真实 GPT / ACP 分子验收的工作区中有：

| 文件 | 大小 | 实际内容 |
| --- | --- | --- |
| `request.json` | 68 bytes | `format: smiles`，输入 `CCO`、`C[C@H](O)C(=O)O`、`invalid@@` |
| `result.json` | 13,717 bytes | RDKit 2026.09.1，两个成功记录的 SVG/描述符，一个 `Invalid molecule` 错误 |

例如乙醇的 MolWt 为 `46.069`，ExactMolWt 为 `46.041864812`；不应改写原始精度。
两个 SVG 嵌在 JSON 字符串中，不是独立 `.svg` 文件；文件树不能把它们冒充为磁盘子文件。
可以在未来的分子预览中解释这些字段，原始 JSON 仍由现有 Reader 阅读。

实际文件位于测试的临时 workspace；该目录消失后，树应显示工作区不可用。
`result.json` 同时有已交付的会话 artifact 快照。实时文件与交付版本需要保持不同身份：
覆盖磁盘文件不能改变旧实验的附件证据，文件缺失也不能使已保存附件不可读。
验收出处：`test-results/scientific-molecules-real-approved/result.json`（ignored）。

## 本机项目对照

以下是 `/Users/phodal/ai` 下当前检出的源码观察，未运行这些项目作视觉验收。

| 项目 | 实际实现 | Pero 可借鉴的部分 |
| --- | --- | --- |
| Qwen Code | `packages/web-shell/client/components/artifacts/WorkspaceFileBrowser.tsx` 用 `@pierre/trees`，展开时 `actions.listDirectory`，旁边放预览；工作区所有权由 `useArtifactWorkspaceTarget.ts` 处理 | 会话标题打开 Files、按层加载、保留选择与展开；React/Pierre 不直接移植 GPUI |
| deepseek-harness | `packages/client/ui-sidebar-files` 在会话右侧提供文件树；`directory-node.ts` 管理展开目录的读取/监听生命周期；`packages/api/workspace-files` 从 Session 解析根目录 | 最接近会话产品：每 pane 保留树状态，文件打开与目录浏览独立，浏览不启动 Agent |
| Zed | `crates/project_panel/src/project_panel.rs` 由 Project/Worktree 提供条目，Panel 管选择/展开，`uniform_list` 渲染可见行 | GPUI 虚拟列表、键盘导航、当前文件定位、单击预览；不复制整套 IDE 文件操作 |
| Pi | `packages/env/src/list-files.ts` 通过 daemon 提供 local/remote `listFiles`，能力不可用明确返回；TUI autocomplete 使用文件枚举 | 文件访问归执行环境，界面不假定文件都在客户端本机；不是现成侧边树 |
| Codex | `codex-rs/tui/src/file_search.rs` 是 `@` 文件搜索的会话编排 | 可参考搜索/输入引用；本次检查的开源 TUI 路径不能当作 Desktop 文件树源码 |

`claude-code-extracted` 是提取模块快照；本轮未确认可复用的侧栏文件树实现，故不据此作 UI 推荐。

## 推荐交互

保留左侧会话导航。在现有会话右侧区域增加 `Files / Artifacts` 切换：
Files 展示当前会话工作区，Artifacts 展示已交付版本。打开文件不离开会话。

```text
会话导航 │ 科研会话                     │ Files  Artifacts
         │ 公式、图、实验表格           │ workspace             ⟳
         │                             │   request.json
         │                             │   result.json
         │                             │ [选中文件的 Reader]
```

宽面板内树与 Reader 并排，窄面板点文件进入 Reader 并保留返回树入口；
复用现有窄窗面板策略，不用固定多列挤压会话。宽度与显示偏好通过 Host settings 保存。
树使用 `pero_theme` 的 surface-muted，阅读面使用 surface，选择使用既有 selection token；
共享文件/目录图标、紧凑行距和清晰缩进，不新增 LaTeX、JSON renderer 等技术标题。

首期包含逐层展开、目录优先排序、选择/键盘导航、刷新、打开 JSON/文本及复制相对路径。
区分目录为空、读取中、读取失败、条目截断、工作区不可用；刷新失败保留旧列表并给重试入口。
树不提供写操作；既有 Reader 的编辑/保存权限继续由原 owner 决定。
上传、重命名、删除、Git 状态、全库索引搜索、文件系统监听列为后续增量。

## 接入现有所有者

1. 新增具名 `WorkspaceEntry`、`DirectoryListing` 和 `WorkspaceTree` 状态。
   纯状态转换拥有展开、选择、目录结果和可见行；GPUI 只消费状态。
2. Host 根据会话归属解析工作区；UI 发送会话身份和相对目录，不自行指定根目录。
   现有 `crates/pero-host/src/agents.rs` 的 ContextSources 使用 `self.workspace`；
   新列表接口必须核对历史会话归属，不能直接借用当前活动 Agent 的根目录。
3. 在 runtime 的文件边界执行单层目录 I/O，返回类型化条目与截断信息。
   路径与目录范围在边界检查一次；UI 不直接读本机盘，不复用会产生上下文快照的目录搜索。
4. 文件打开复用 `FileCommand::Open` → `FileDocuments::open` → `ContentReader`，
   以及已有 workspace pane 导航；目录树不另造 JSON 阅读器、版本系统或窗口布局管理器。
   现有 `FileDocuments::open` 整文件读取 UTF-8 文本，不能据此声称支持大文件分页或任意二进制预览。
5. 首期在面板打开、手动刷新和当前会话一轮执行结束时重新列出已展开目录。
   按会话/工作区归属接收结果，切会话保留各自状态；不靠解析 shell 文本推断文件变化。
   外部进程修改通过手动刷新可见，实时监听需要后续明确实现。
6. UI 浏览走 Host 的应用请求，不发起 LLM 请求，不新增 ACP 工具。
   AI 仍使用 harness 的 `list_directory/read_file/write_file`；引用文件到输入框时才走现有 ContextSources。

## 实施与验收顺序

先完成目录领域/Host 接口及值测试，再接右侧 Files 与现有 Reader，最后验证真实 Native/Wasm。
测试覆盖目录排序/展开、工作区切换、局部读取失败、文件消失、截断和重启恢复；
用真实分子 workspace 打开 request/result，并在修改实时文件后确认旧 artifact 仍保持原版本。
UI 验收包含明暗主题、窄面板、长文件名、键盘与 JSON 原文复制。
临时 workspace 删除后应仍能打开已交付 result 快照。调研和设计不算这些验收已完成。
