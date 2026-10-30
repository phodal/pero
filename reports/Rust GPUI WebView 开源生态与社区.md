# 优先采用 Wry 与 GPUI Kit 生态

**从开源生态看，Wry 是 Rust 系统 WebView 的稳妥基础，GPUI Kit 是 Pero 最直接的集成入口；GPUI Fast 值得验证，但尚属实验后端。** CEF 有成熟的嵌入生态，Rust bindings 与 GPUI 组件的社区则小得多。下面列出 2026-10-30 的 GitHub API 快照，补充前一份[技术评估](</Users/phodal/workspaces/pero/reports/Rust GPUI 原生 WebView 方案评估.md>)；本次没有编译或运行候选项目。

表内日期均为 2026 年 UTC。Stars/forks 是整个仓库的累计数字；最近 push 可能包含分支和标签更新，不能直接当作开发产出。未收集历史快照，因此不判断增长率、用户量或市场份额。

| 项目 | Stars / forks | 最近 push | 当前发行 | 对 GPUI 的直接适配程度 |
| --- | ---: | --- | --- | --- |
| [GPUI Kit](https://github.com/longbridge/gpui-kit) | 18,784 / 1,168 | 10-29 | v0.8.1，10-26 | **最高**；Pero 已用，包含 `gpui-webview` |
| [GPUI Fast](https://github.com/longbridge/gpui-fast) | 309 / 38 | 10-26 | v0.1.12，10-26 | Kit 可选 backend，提供 native composition |
| [Wry](https://github.com/tauri-apps/wry) | 5,032 / 584 | 10-28 | 0.57.1，10-23 | 跨平台系统 WebView 基础库，需 GPUI 适配 |
| [CEF](https://github.com/chromiumembedded/cef) | 4,854 / 681 | 10-23 | binary stable 156.0.14，10-24 | C++ Chromium 嵌入框架，需 bindings 与适配 |
| [cef-rs](https://github.com/tauri-apps/cef-rs) | 489 / 80 | 10-25 | cef-v156.2.0+156.0.14，10-25 | 活跃 Rust bindings，尚非 GPUI 控件 |
| [Servo](https://github.com/servo/servo) | 38,270 / 3,861 | 10-30 | v0.7.0，10-05 | Rust 引擎，有 embedding API，需自行适配 |

上述版本来自 GitHub Release，唯 CEF 来自[官方 binary stable 渠道](https://cef-builds.spotifycdn.com/index.html)。没有 GitHub Release 不等于停止发行；Release 对象、Git tag、包注册表版本也不能混用。GPUI Fast 的 Release 虽未标 prerelease，README 仍明确称 experimental，版本元数据不能替代成熟度判断。

**Kit 的社区规模支持继续利用现有生态，但不能折算成 WebView 或 Fast 的生产采用量。** 原 `longbridge/gpui-component` 已重命名为同一个 Kit 仓库，不是另一个竞争方案；Fast 则是独立仓库中的 GPUI 实验性 fork。Kit 的 WebView 合成仍有 macOS/Linux 与 Windows 的能力差异，Linux 路径仍限 X11/XWayland。([Kit 说明](https://github.com/longbridge/gpui-kit#readme)、[Fast 说明](https://github.com/longbridge/gpui-fast#readme)、[平台矩阵](https://gpui-kit.com/docs/webview/#platform-support))

Wry 更有价值的信号是实际采用和近期修复。[Tauri](https://github.com/tauri-apps/tauri) 有 112,320 stars，[Dioxus](https://github.com/DioxusLabs/dioxus) 有 39,538 stars，两者 desktop/runtime 的 Cargo 均明确依赖 Wry；Wry 默认分支 10-28 仍在修复 Windows child WebView 释放问题。这说明基础库有持续维护与真实消费者，但两套上层框架的规模不能作为 GPUI adapter 的成熟度证据。([Tauri 依赖](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-runtime-wry/Cargo.toml)、[Dioxus 依赖](https://github.com/DioxusLabs/dioxus/blob/main/packages/desktop/Cargo.toml)、[Wry 修复](https://github.com/tauri-apps/wry/commit/5006b49b3a643b5544263ff9863b797a810d549b))

确实已有直接面向 GPUI 的 CEF 组件，但目前都很早期：

| 项目 | Stars / forks | 最近 push / Release | 实际边界 |
| --- | ---: | --- | --- |
| [bokuweb/gpui-cef](https://github.com/bokuweb/gpui-cef) | 3 / 0 | 10-26 / v0.1.1，09-26 | macOS CEF offscreen，默认 CPU image copy；Windows 仍用 Wry/WebView2 child |
| [longbridge/wef](https://github.com/longbridge/wef) | 44 / 5 | 01-01 / 无 GitHub Release | CEF offscreen 实验；README 说明结果未达预期，作者当时继续使用 Wry |
| [uxsoft/gpui-web](https://github.com/uxsoft/gpui-web) | 0 / 0 | 10-27 / 无 GitHub Release | CEF154 组件，各平台 presenter 不同；依赖旧 GPUI snapshot，Chromium 无 sandbox |

这些项目的近期更新说明低 star 不等于无人维护；但尚不足以承诺 Pero 可直接替换。`gpui-cef` 最值得作为 Chromium 验证起点，且 main 的 0.2.0 manifest 不应当作已发布的 v0.1.1 能力。`uxsoft/gpui-web` 的版本约束与无 sandbox 是明确限制，不宜进入通用外部网页路径。([gpui-cef README](https://github.com/bokuweb/gpui-cef#readme)、[gpui-web README](https://github.com/uxsoft/gpui-web#readme))

CEF 的成熟采用可以由 [OBS Browser](https://github.com/obsproject/obs-browser) 验证，不能据此推导 OBS 使用 Rust bindings。Tauri 的 CEF runtime 仍随 3.0 alpha 提供。Servo 虽受关注、仍在更新，官方 LTS 说明也保留了未到 1.0、生产适用性需按内容评估的边界。([Tauri CEF](https://v3.tauri.app/develop/cef/)、[Servo LTS](https://book.servo.org/embedding/lts-release.html))

另有几个容易混淆的候选：[webview/webview](https://github.com/webview/webview) 有 14,328 stars / 1,095 forks，但本体是 C/C++；历史 Rust binding [Boscop/web-view](https://github.com/Boscop/web-view) 默认分支最近已见 commit 停在 2023 年，不建议新选。旧 [Julusian/rust-cef](https://github.com/Julusian/rust-cef) 已归档，应与当前 tauri-apps 项目区分。Ultralight 核心 SDK 是商业专有软件，开源 bindings 不改变这一点，不能列入开源引擎候选。([Ultralight 协议](https://ultralig.ht/terms))

**对 Pero 的选择顺序仍然是：现有 Kit/Wry → 受控验证 Fast 合成 → 明确需要统一 Chromium 时验证 cef-rs/gpui-cef。** 社区调查加强了保留现有基础栈的理由，也表明 CEF 的引擎成熟度与 GPUI 接线成熟度必须分别判断。详细 API 快照与源码证据保存在[研究笔记](</Users/phodal/workspaces/pero/research_notes/Rust GPUI WebView 开源生态与社区/gpui-ecosystem.md>)及同目录指标 JSON。
