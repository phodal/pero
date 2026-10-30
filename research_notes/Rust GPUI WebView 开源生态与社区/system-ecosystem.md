# 系统 WebView 开源生态与社区

## 哪些项目值得进入选型

### Takeaway
Wry 是本组最直接相关的 Rust 系统 WebView 基础库；Tauri 与 Dioxus 的真实采用比单看星数更有意义。但这些项目的大社区，不能证明 GPUI adapter 已解决合成、焦点和平台差异。

### Cited Findings
快照观察区间为 **2026-10-30 05:00:07–05:01:20 UTC**。指标来自 GitHub connector 的仓库、最近 10 个 Release、默认分支最近 5 个 commit API；完整字段和来源保存在同目录 `system-metrics.json`。六仓库均 `archived=false`。`双许可`指 MIT OR Apache-2.0，以 Cargo 声明纠正 GitHub API 只挑中一种许可的情况。

| 项目 | Stars / forks | 许可 | 最新正式 GitHub Release | 最近 pushed_at（UTC） | 对 GPUI 的意义 |
| --- | ---: | --- | --- | --- | --- |
| [Wry](https://github.com/tauri-apps/wry) | 5,032 / 584 | 双许可 | 0.57.1，2026-10-23 | 2026-10-28 10:57 | 当前路线的上游基础库 |
| [Tao](https://github.com/tauri-apps/tao) | 2,228 / 433 | Apache-2.0 | 0.37.2，2026-10-23 | 2026-10-28 11:31 | 窗口/event loop 库，本身不是 WebView |
| [Tauri](https://github.com/tauri-apps/tauri) | 112,320 / 4,136 | 双许可 | 主 crate 2.12.5，2026-10-21 | 2026-10-29 17:10 | 大型应用壳生态，并非 GPUI 控件 |
| [webview/webview](https://github.com/webview/webview) | 14,328 / 1,095 | MIT | API 无 Release；最高已见 tag 0.12.0 | 2026-10-22 01:30 | C/C++ 轻量封装，Rust 需额外 binding |
| [Boscop/web-view](https://github.com/Boscop/web-view) | 1,953 / 179 | MIT | API 无 Release | 2024-05-09 14:44 | 历史 Rust binding，不建议新选 |
| [Dioxus](https://github.com/DioxusLabs/dioxus) | 39,538 / 1,948 | 双许可 | 0.7.10，2026-07-30 | 2026-10-29 18:35 | 可验证的 Wry 使用者，是另一套 UI 框架 |

Dioxus 最新预发布为 `0.8.0-alpha.3`（2026-10-16）；Tauri 仓库也存在 `tauri-v3.0.0-alpha.5`（2026-10-14）。后者 GitHub `prerelease` 标志为 false，但 tag 语义仍是 alpha，不能当成正式 3.0。

### Inferences
- 社区信号上，Wry 有独立维护且得到上层采用，适合作为 Pero 系统 WebView 的持续基础；Tauri 的 11 万星不应记在 GPUI WebView adapter 头上。
- `webview/webview` 更多星并不意味着更适配 GPUI：它面向多语言 C ABI，不提供现成 GPUI 布局/合成层。

### Gaps
- 这是一次快照，未收集历史星数，不能判断增长率、市场份额或用户数量；下载量和 GitHub stars 也不是等价指标。

## 活跃度和真实采用证据

### Takeaway
Wry/Tao 有近期实质修复，Boscop 的维护信号明显弱；需要区分“仓库收到 push”与“默认分支确有代码修复”。

### Cited Findings
- Wry 默认分支 2026-10-28 合入 Windows child WebView 释放后保留 parent subclass 的修复；已检查该 commit 确实修改 `src/webview2/mod.rs`。Tao 同日有 Android event poll 修复和跨线程窗口拖动支持。commit URL、SHA、日期均在指标 JSON 中，不能仅由 pushed_at 推断。— [Wry 修复 commit](https://github.com/tauri-apps/wry/commit/5006b49b3a643b5544263ff9863b797a810d549b)、[Tao 拖动支持 commit](https://github.com/tauri-apps/tao/commit/7b412ce68a152bc23c3660fb512e4b9aaf6efdfa)
- Boscop 默认分支最新已见 commit 为 **2023-05-16**；其 README 仍说明 Windows 使用 MSHTML/EdgeHTML，并将 child-window embedding 列为贡献方向。上游 `webview/webview` 的当前 README 则是 WebView2，两者不能混成一个现代 Rust 库。— [Boscop README](https://github.com/Boscop/web-view#readme)
- Tauri 的 runtime Cargo 明确依赖 `wry 0.57.0` 和 `tao 0.37.0`；Dioxus desktop 的 Cargo 也明确依赖 Wry 与 Tao。这是当前源码采用证据，不是根据框架宣传推测。— [Tauri runtime Cargo](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-runtime-wry/Cargo.toml)、[Dioxus desktop Cargo](https://github.com/DioxusLabs/dioxus/blob/main/packages/desktop/Cargo.toml)

### Inferences
- 对 Pero，保留 Wry 并优先验证 GPUI Fast 合成路径仍是合理结论。Tauri/Dioxus 适合参考导航、生命周期与打包实践；为了获得 WebView 而整体迁移 UI 框架，收益尚无证据。
- 没有 GitHub Release 不等于没有发布：`webview/webview` 0.12.0 的 tagged commit 日期为 2024-09-11，这不是 Release 发布日；Boscop Git tag 也不能冒充 crates.io 最新版本。

### Gaps
- 未系统统计 issue 响应时间、独立维护者人数、近月贡献者和 crates.io 下载量；因此只作维护信号判断，不给伪精确的“社区成熟度分数”。
