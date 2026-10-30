# Chromium Rust 与 Servo 开源生态

## 哪些项目值得看 社区规模如何

### Takeaway
要分开看 CEF 引擎、Rust bindings 和 GPUI 集成。CEF 有成熟产品采用；目前活跃 Rust 接入口是 `tauri-apps/cef-rs`，但它的社区远小于 CEF/Chromium。Servo 关注度高且活跃，不能由此推导任意网页兼容已成熟。

### Cited Findings
2026-10-30 实时 GitHub API 快照；下表数字是累计关注度，不是用户量，UTC 日期。三个主项目均未归档。原始字段见同目录 `chromium-metrics.json`。

| 项目与层次 | Stars / Forks | License | 最近 push | 当前发行 |
|---|---:|---|---|---|
| [chromiumembedded/cef](https://github.com/chromiumembedded/cef)：C++嵌入引擎 | 4,854 / 681 | BSD 3 条款，API自动识别为Other | 10-23 | GitHub无release/tag；官方binary stable 156.0.14，10-24 |
| [tauri-apps/cef-rs](https://github.com/tauri-apps/cef-rs)：Rust bindings | 489 / 80 | Apache-2.0 | 10-25 | cef-v156.2.0+156.0.14，10-25，非prerelease |
| [servo/servo](https://github.com/servo/servo)：Rust web engine | 38,270 / 3,861 | MPL-2.0 | 10-30 | v0.7.0，10-05，非prerelease；v0.6.0 LTS |

- cef-rs canonical 名称由 connector 与 `gh api` 双重核实，仍为 `tauri-apps/cef-rs`，默认分支为 `dev`。CEF正式构建渠道是自动构建站，已查四个桌面架构的stable包；无GitHub Release不代表停止发行。[CEF发布站](https://cef-builds.spotifycdn.com/index.html)
- `servo/servoshell` 独立仓库API为404；当前代码位于 `servo/servo/ports/servoshell`，应视作同项目的参考浏览器，不能重复计算社区。官方将其称作测试浏览器。[Servo使用说明](https://book.servo.org/trying/getting-servoshell.html)

### Inferences
- 对 Pero 的实际候选排序仍是“现有 Wry/Kit 合成 → 有需求时 cef-rs OSR → Servo 实验”。Servo 星数大体现历史关注和Rust引擎研究价值，cef-rs小社区体现需要自行承担的Rust接线维护量，二者不能用星数互相替代。

### Gaps
- 未取得历史星标快照，因此不报告近30天增长、增长率或活跃用户。push含分支/标签更新，不能直接当开发者产出；本次另记录默认分支最新commit作活动证据。

## 是否有实际采用与应避免的旧项目

### Takeaway
可验证采用比累计星数更有决策价值，但必须归属到正确层次：OBS使用CEF不证明它使用Rust bindings；Tauri CEF runtime仍是alpha。

### Cited Findings
- OBS官方 `obs-browser` 明确使用CEF，并包含于Windows、macOS及若干Linux官方包，这是引擎实际采用证据。[OBS Browser源码](https://github.com/obsproject/obs-browser)
- Tauri官方 `tauri-runtime-cef` 随3.0 alpha提供，API可能变化；是Rust生态集成证据，不能说已有稳定版产品普及。[Tauri官方CEF文档](https://v3.tauri.app/develop/cef/)
- Servo官方展示 Slint Servo、Servo GTK、Servo Qt、Verso 等嵌入项目；其LTS文档仍提示没有1.0，生产使用需按内容范围评估，LTS仅best effort。[Made With Servo](https://servo.org/made-with/)、[Servo LTS边界](https://book.servo.org/embedding/lts-release.html)
- 同名旧项目必须排除：`Julusian/rust-cef` 42★/14 forks，已归档，最后push 2019-07；`dylanede/cef-rs` 62★/9 forks，最后2017-10；`hytopiagg/cef-ui` 31★/5 forks，最后2024-09。均无证据优于当前tauri-apps维护路径。[旧rust-cef](https://github.com/Julusian/rust-cef)

### Inferences
- CEF成熟度主要来自引擎与C++生态；Rust bindings、GPUI纹理输入桥接的维护风险应另计，不引用Adobe/Spotify旧传闻给cef-rs背书。

### Gaps
- 没有找到可信的cef-rs生产安装量或GPUI直接采用规模，不能把官方示例等同量产。

## Ultralight 是否应列入开源排名

### Takeaway
不应。核心SDK是商业专有软件；WebKit开源部分、样例或第三方Rust binding开源，不代表Ultralight引擎整体开源。

### Cited Findings
- 官方协议明确SDK不含库源码，限制修改/反编译，同时单独保留其包含的开源组件权利。应作为商业引擎独立比较。[Ultralight SDK协议](https://ultralig.ht/terms)

### Inferences
- 对“只选择可自行维护的开源引擎”的需求，应将它排除，而不是把Rust wrapper星数加入CEF/Servo同类榜单。

### Gaps
- 未逐一统计第三方Ultralight bindings，因为它们不改变核心开放性判断。
