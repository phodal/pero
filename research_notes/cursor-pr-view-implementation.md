# Cursor Agents 的 PR View 实现分析

调研日期：2026-11-07。对象：本机 `/Applications/Cursor.app`，版本 **3.29.9**，
commit `306d153d51d714882ab7b1bc49649cab624e8a30`，构建日期
`2026-11-05T02:42:01.412Z`。本文是安装包静态代码分析，结合用户提供的
Cursor Agents 截图；没有修改 Cursor、访问账户凭据或调用其远端 API。

## 结论

截图右侧是 Cursor Agents（内部命名 Glass）的内置 `Pr` 内容标签页。
它以结构化 PR 身份和数据驱动专用 React 组件，与 File、Changes、Canvas、
Browser 等内容类型共享标签系统。这个入口不需要模型生成特殊 HTML 或附件。

需要区分三个行为：

1. 消息中的 PR URL 被识别为带状态图标、短标签和悬浮详情的链接。
2. 点击链接，经打开偏好和仓库路由策略，打开或激活右侧 PR 标签页。
3. Agent 关联仓库/分支的 PR 状态变化，也能自动生成 PR 标签；不要求消息里
   先出现链接。自动标签生成和是否激活是不同步骤。

截图不能单独证明当前 PR #164 是经点击、自动关联还是历史恢复进入右侧。
代码中可以分别确认这些机制。

## 1. URL 解析与消息呈现

`pull-request-identity.ts` 的 `jk` 通过 `new URL()` 解析输入，返回：

```ts
// 根据打包代码还原的概念形状，非原始 TypeScript 声明。
type PullRequestIdentity = {
  provider: "github" | "origin";
  owner: string;
  repo: string;
  prNumber: string;
  canonicalUrl: string;
};
```

GitHub 识别主机为 `github.com` / `www.github.com`，路径前四段为
`owner/repo/pull/number`，PR 编号必须是规范的正整数字符串。
它还识别 Graphite、Cursor Review 和配置的 Origin 身份地址，并转成统一身份。
GitHub canonical URL 将 owner/repo 转为小写，并丢弃 query、hash 和 PR 子页面路径。

`pull-request-link-content.tsx` 的 `i$k` 生成链接呈现信息；原文字是 URL、
编号或 `#编号` 时，可压缩为 `#编号`，自定义说明文字可以保留。
消息链接呈现函数 `QFn` 使用该身份选择 PR 图标和 hover card。
`GHl` 从 lifecycle store 读取状态，再通过 `e8n` 选择状态图标；尚无状态时
回退到 provider 图标。因此 merged 图标来自 PR 状态，并非识别回复中的“已合并”文字。

## 2. 点击路由及偏好

`pr-link-routing-policy.js` 的 `m9C` 是独立路由决策：

| 条件 | 结果 |
| --- | --- |
| 明确要求 external | 不拦截 |
| URL 不是受支持的 PR 身份 | 不拦截 |
| 仓库匹配当前 Agent 的 PR 记录 | 拦截到 PR 视图 |
| 仓库匹配已连接仓库目录 | 拦截到 PR 视图 |
| 来自 Cursor Review 地址 | 拦截 |
| 来自受支持 Cursor Portal PR，仓库目录仍不完整 | 允许拦截 |
| 仓库目录仍不完整，尚未匹配 | 本次不拦截，请求预热目录 |
| 完整目录仍不匹配 | 不拦截；GitHub 仓库可触发补充查找 |

普通链接的 `h2c` 路由先解析 canonical URL，查询上述决策，并可预取元数据
和 commits。`glass-pull-request-open.js` 的 `SJv` 再读取用户 surface 偏好：
`Inside Cursor` 或 `Default Browser`，中键和 macOS Cmd / 其他平台 Ctrl
会反转打开目标。

这不是所有入口唯一的硬门槛：主聊天面板的 `PB2` / `NB2` 也有直接解析 PR、
按打开偏好调用 `showPullRequestTab` 的专用入口。应按具体入口解释行为，
不能把普通 opener 的仓库匹配条件概括成全局禁令。

`I9C` 负责显示 Editor Panel，查找或创建 `kind: Pr` 标签。标签身份由 PR URL
和可选 `ownerAgentId` 构成，已有标签会被激活并更新信息。
`temporary-tabs.js` 及 `glass_temporary_pr_tabs` 特性开关支持临时预览标签替换、
双击固定和用户移动后固定。

## 3. 自动关联 PR，不依赖扫描回复

分支元数据实现调用 `batchGetPullRequestForBranch`，以 `repoUrl + branchName`
查询 PR URL。特定无结果/错误路径还存在 `gh pr list --head ... --state all`
回退；部分错误回退由 `glass_branch_pr_gh_fallback_legacy` 控制。

Agent 的 `createPullRequestStateTracker` 将已解析 PR URL、元数据和文件数据合成
`pullRequestState`。`glass-pr-tab-lifecycle-manager.js` 订阅当前 Agent、项目
子 Agent、manager PR 列表、分支元数据和 PR lifecycle，生成 descriptors，
再由 `_reconcile` 创建或更新 PR 标签。

自动创建使用 `activate: false`；另一个
`_maybeStealAutomaticChangesDefaultToPrTab` 仅在仍保留自动默认选择、当前是
Changes 或空选中等条件下将默认视图转为 PR。用户选择的其他内容不会被这条
默认切换逻辑直接覆盖。关闭的 PR 有 dismissed 记录，显式重新打开可恢复。

由此可以确认自动标签有真实的仓库/分支关联来源；本次没有证据证明系统通过
全量扫描所有消息中的 GitHub 字符串来登记 PR。

## 4. 专用视图及数据来源

标签注册表中 `Pr` 有以下配置：

```ts
// 省略打包变量名及加载器细节。
Pr: {
  icon: "git-pull-request",
  defaultLabel: "Pull Request",
  schema: PrTabSchema,
  renderer: lazy(PrTabContent),
  iconRenderer: PrStatusIcon,
  keepMountedAfterFirstActivation: true,
}
```

`pr-tab-content.schema.js` 保存 `prUrl`、`repoUrl`、`repoPath`、`branchName`、
`ownerAgentId`、`prTitle`、`prStatusIcon`、`preview`、`mergeConflictTarget` 和
`subview` 等属性。子视图为 `diffs / description / ci / commits / reviews`，
分别对应截图的 Changes、Description、Checks、Commits、Reviews。

`PrTabContent` 消费结构化数据，组合 header、文件 diff、Markdown 描述、检查、
提交和 review timeline；文件查看状态也有独立持久化。它并非以 GitHub 网页
iframe 作为 PR 主视图。Browser 是标签注册表里的另一种内容类型。

Glass 路径的数据所有者是 `PullRequestRepositoryService`，使用生成的
Connect RPC 客户端 `scmapi.v0.ScmService`。可见调用包括
`BatchGetPullRequests`、`GetPullRequestDiff`、`GetPullRequestChecks`、
`GetSCMPullRequestCommits`、`GetSCMPullRequestTimelineEvents`。
Diff 返回 filename/status/originalContents/modifiedContents/patch/baseSha/headSha。
review discussions 还使用 BackgroundComposer backend client。

该服务维护内存和持久缓存、请求去重，以及 pending/resolved/error 与保留旧内容的
加载状态。`glass-pr-updates-service.js` 通过 `StreamPullRequestUpdates` 接收
更新信号，视图的 realtime loop 再触发刷新；Agent lifecycle 也有轮询路径。

安装包里另有 `GithubPRService` 的 GitHub REST/GraphQL 路径，不能因搜索到它
就断言截图的 Glass PR View 直接从浏览器请求 GitHub。截图对应的主文件加载
路径已追到 `PullRequestRepositoryService -> ScmService.GetPullRequestDiff`。
远端服务内部如何调用 GitHub，以及截图会话实际采用的认证/请求路径，本次未验证。

## 5. 对 Pero 的对应启发

这里可借鉴的最小概念是：稳定的外部对象身份、统一链接打开决策，以及注册在
已有工作区导航中的专用内容视图。PR 数据状态与标签开闭分别归其所有者管理。

Pero 已有 ADR 0013 的 `WorkspaceItem` / `WorkspaceNavigation` 和 conversation
artifact 路径。若以后接入 PR，可在这些边界上增加命名的外部对象引用和内容类型，
由 Host/connector 获取数据，界面消费；无需让模型产出 PR 专属 HTML，或将在线
PR 数据复制为一份本地文件产物。本文只提出对应关系，没有实现该功能。

## 可复核证据

主要文件：
`/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.glass.main.js`

SHA-256：`59988e055f545a76aa11b38f27562b7ecdaa885d59a2e8805114d28aa76fb6a1`。
下表 offset 是 Python 解码后的零基字符偏移，非字节偏移；行号用于打开 bundle。
模块名是 bundle 内保留的来源标记，并非磁盘上另有这些源文件。

| 证据 | 行号 | 字符偏移 / 搜索锚点 |
| --- | ---: | --- |
| PR 身份解析模块 | 781 | `pull-request-identity.ts`，5241394 |
| PR 状态图标 | 3116 | `function GHl(`，18684694 |
| Markdown 链接呈现 | 14161 | `function QFn(`，22776949 |
| 仓库路由策略 | 18053 | `pr-link-routing-policy.js`，25399932 |
| 链接打开与标签创建 | 18053 | `function h2c(`，25409717；`function I9C(`，25408552 |
| PR 数据服务 | 18053 | `PullRequestRepositoryService.js`，25337197 |
| Diff RPC | 18053 | `_fetchPullRequestFilesFromBackend(t){`，25370639 |
| 内容 schema | 18108 | `pr-tab-content.schema.js`，27003714 |
| React 内容实现 | 22378 | `pr-tab-content.react.js`，33602698 |
| 标签注册 | 22407 | `[Ut.Pr]:{icon:`，33945422 |
| 自动标签管理 | 22407 | `glass-pr-tab-lifecycle-manager.js`，33979046 |
| 默认切换规则 | 22407 | `_maybeStealAutomaticChangesDefaultToPrTab(){`，34063972 |
| 分支查询 | 22888 | `batchGetPullRequestForBranch({branches:`，37857678 |

验证范围：静态阅读实际安装包和用户提供的界面证据。没有进行实时点击、网络抓包、
登录切换、特性开关实验或 PR 写操作。没有改动产品代码，没有运行仓库测试。

其他类似页面的完整注册表、文件内容投影、路由/生命周期和 Pero 对照，见
[内容视图能力分析](cursor-content-view-capabilities.md)。
