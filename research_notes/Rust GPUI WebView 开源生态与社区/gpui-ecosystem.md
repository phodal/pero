# GPUI WebView 开源生态与社区

## 哪些项目最值得关注

### Takeaway
按 Pero 的直接适配度，优先关注 GPUI Kit 与其可选 GPUI Fast backend；CEF 路线确有现成组件，但目前看到的独立集成社区规模很小，尚不能视为跨平台即插即用替代。以下为 2026-10-30 05:01 UTC 的 GitHub 实时快照，stars/forks 属于整个仓库，不代表 WebView 子组件装机量，也不表示增长率或活跃贡献人数。

### Cited Findings

| 关注顺序 / 项目 | stars / forks | 最近 push UTC | 最新 GitHub release | 定位与 Pero 适配程度 |
| --- | ---: | --- | --- | --- |
| 1. [longbridge/gpui-kit](https://github.com/longbridge/gpui-kit) | 18,784 / 1,168 | 2026-10-29 | [v0.8.1，10-26](https://github.com/longbridge/gpui-kit/releases/tag/v0.8.1)，非 prerelease | Pero 已采用；`gpui-webview` 在同一仓库，最直接 |
| 2. [longbridge/gpui-fast](https://github.com/longbridge/gpui-fast) | 309 / 38 | 2026-10-26 | [v0.1.12，10-26](https://github.com/longbridge/gpui-fast/releases/tag/v0.1.12)，非 prerelease | 独立源码仓库、Zed GPUI 的实验性 fork；可作为 Kit backend，直接改善 native composition |
| 3. [bokuweb/gpui-cef](https://github.com/bokuweb/gpui-cef) | 3 / 0 | 2026-10-26 | [v0.1.1，09-26](https://github.com/bokuweb/gpui-cef/releases/tag/v0.1.1)，非 prerelease | 早期可复用组件与 browser demo；macOS CEF offscreen，Windows Wry/WebView2 child |
| 4. [longbridge/wef](https://github.com/longbridge/wef) | 44 / 5 | 2026-01-01 | 无 GitHub releases | Longbridge 的实验 CEF offscreen library；有工具链和示例，作者未用于其当前生产路径 |
| 5. [uxsoft/gpui-web](https://github.com/uxsoft/gpui-web) | 0 / 0 | 2026-10-27 | 无 GitHub releases | 很早期 CEF154 GPUI 组件；各 OS 使用不同 presenter，API 依赖固定旧 GPUI snapshot |

表格指标来源：[Kit API](https://api.github.com/repos/longbridge/gpui-kit)、[Fast API](https://api.github.com/repos/longbridge/gpui-fast)、[gpui-cef API](https://api.github.com/repos/bokuweb/gpui-cef)、[Wef API](https://api.github.com/repos/longbridge/wef)、[gpui-web API](https://api.github.com/repos/uxsoft/gpui-web)。五者均 `archived:false`；无 releases 仅指 GitHub release 对象，不等于没有 crates.io 版本或 tags。原始指标保存在同目录 `gpui-metrics.json`。

- `longbridge/gpui-component` API 返回迁移到 repository ID `814684486`，正是 `gpui-kit`；两者不可重复计数。Kit README 声称 Longbridge Pro 实际采用，但不能把产品采用整个 UI 库等同于其所有 WebView/GPUI Fast 分支完成生产验收。— [redirect](https://api.github.com/repos/longbridge/gpui-component)、[Kit README](https://github.com/longbridge/gpui-kit#readme)
- GPUI Fast 是独立仓库中的修改 fork，不是纯 WebView crate；README 自称 experimental，提供 native composition example，Kit manifest 已将它作为可选 backend。其基础来源为 Zed，而 `gpui-pre-*` 是上游 GPUI snapshot。— [Fast README](https://github.com/longbridge/gpui-fast#readme)、[Kit dependency](https://github.com/longbridge/gpui-kit/blob/main/crates/kit/Cargo.toml)、[snapshot attribution](https://github.com/longbridge/gpui-kit#license)
- 许可按源码核实：Kit、Fast、Wef、uxsoft/gpui-web 为 Apache-2.0；gpui-cef 当前 workspace manifest 为 MIT OR Apache-2.0。Kit/Wef 的 API license 为 NOASSERTION，不能据此写成闭源。— [Kit license](https://github.com/longbridge/gpui-kit/blob/main/LICENSE-APACHE)、[Fast license](https://github.com/longbridge/gpui-fast/blob/main/LICENSE-APACHE)、[Wef license](https://github.com/longbridge/wef/blob/main/LICENSE-APACHE)、[gpui-cef manifest](https://github.com/bokuweb/gpui-cef/blob/main/Cargo.toml)、[gpui-web manifest](https://github.com/uxsoft/gpui-web/blob/main/Cargo.toml)

### Inferences
- 社区证据支持继续利用 Kit 生态；独立 CEF 集成可以用于验证技术方向，但需要自己承担兼容和产品化。低 star 本身不能推断无人维护；这里几个项目最近 push 日期反而显示仍有修改。

### Gaps
- 未统计 downloads、贡献者和真实用户数；不能声称 star 增长、维护人数或企业采用广度。

## CEF 候选实际完成到什么程度

### Takeaway
最值得实读的是 `bokuweb/gpui-cef`，而 Wef 的作者反馈是重要反证；uxsoft 新方案值得跟踪，但当前 sandbox 与 GPUI 版本约束明确限制了替换价值。

### Cited Findings
- gpui-cef 的 macOS 页面可作为普通 GPUI Element 裁剪和叠加；Windows 仍为 Wry child，历史能力、title 等多项 API 不等价。默认 macOS 路径为 CPU image copy，作者说明零拷贝需要 GPUI 支持 BGRA；尚无页面与应用间拖放。当前 main manifest 已到 `0.2.0`，不等于最新 GitHub release `0.1.1` 已包含全部 main API。— [README](https://github.com/bokuweb/gpui-cef#readme)、[manifest](https://github.com/bokuweb/gpui-cef/blob/main/Cargo.toml)
- Wef README 显式称实验结果仍不够好，提到当时 CEF framework 使包体增加约 1GB，并写 Longbridge Desktop 当时继续使用 Wry。这是该项目作者的历史经验，不能推广为所有 CEF 最终包体固定增加 1GB。— [Wef README](https://github.com/longbridge/wef#readme)
- uxsoft/gpui-web README 声称供 Wisp canvas 使用，但链接的 `uxsoft/wisp-rs` 本次 API 404，无法独立确认公开采用者。其 Chromium 明确无 sandbox；依赖 `gpui-pre=0.3.8` 和 Kit0.7 示例，而 Pero 当前 snapshot 是 0.3.10/Kit0.8.1。— [README](https://github.com/uxsoft/gpui-web#readme)、[manifest](https://github.com/uxsoft/gpui-web/blob/main/Cargo.toml)
- `huacnlee/gpui-wry-example` 是 raw-window-handle child-window 实验 demo，2 stars/1 fork、最近 push 2025-08-15、无 release；不是另一个成熟浏览器组件。— [README](https://github.com/huacnlee/gpui-wry-example#readme)、[API](https://api.github.com/repos/huacnlee/gpui-wry-example)

### Inferences
- 当前建议仍是 Kit + GPUI Fast native-only spike；需要统一 Chromium 行为时再试 gpui-cef。Uxsoft 值得观察源码，现阶段不宜接入通用外部网页产品路径。

### Gaps
- 研究仅检查开源源码与项目自述，没有编译或运行这些候选；不能把 README 跨平台表视为本次验收。

## 上游与 fork 如何解读社区数字

### Takeaway
需要把上游生态与直接依赖分开：Pero 的 `lb-wry` 是 Longbridge fork，GPUI 来自 Zed 生态，但上游大仓库的 stars 不应转算为 WebView 集成成熟度。

### Cited Findings
- `longbridge/wry` 是 `tauri-apps/wry` 的 fork，0 stars/0 forks、未归档、最近 push 2026-07-30、无 GitHub release。已发布 `lb-wry0.53.3` 的 `.cargo_vcs_info` commit 为 `1a41a3c…`，该 commit 源码 package 名正是 `lb-wry`，许可证 Apache-2.0 OR MIT；Cargo 的 repository 字段仍写 upstream，单看它会错认来源。— [fork API](https://api.github.com/repos/longbridge/wry)、[published source](https://github.com/longbridge/wry/blob/1a41a3c01cebaffc559b9c038e4446a1ee1de626/Cargo.toml)
- Zed 当前 92,398 stars/11,287 forks，最近 push 2026-10-30，属于编辑器整个仓库。其 native composition PR62379 本次 API 为 `open, merged:false`，不能写成 Zed 已合并；Fast 可包含同方向的 fork 能力。— [Zed API](https://api.github.com/repos/zed-industries/zed)、[PR state](https://api.github.com/repos/zed-industries/zed/pulls/62379)

### Inferences
- 按 GitHub stars 排序检索 `gpui webview` 会混入大量以“no webview”为卖点的纯原生应用；必须读描述和实现后筛选。仓库检索原始高排名不等于相关方案排名。

### Gaps
- fork 的 0 stars 不能表示上游无人使用；Zed 的 92k stars 也不能证明某个 Kit WebView 路径成熟。
