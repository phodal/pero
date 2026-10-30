# Chromium CEF Servo 与 Ultralight 替代路径

## CEF 能否改善 GPUI 的网页兼容与合成

### Takeaway
CEF 是需要统一 Chromium 内核时最值得保留的备选，但不是现有 Wry 集成的小改动。若现有 Kit 的合成模式足够，优先验证它；只有兼容性或可控纹理管线成为明确需求，才做 CEF 验证。

### Cited Findings
- `tauri-apps/cef-rs` 是当前可用的 Rust bindings，官方列出 Windows/macOS/Linux 的 x86_64 与 ARM64；构建要下载/管理 CEF 二进制，macOS 有额外 bundle/helper 装配。不能把 bindings 的平台支持视作 Pero GPUI 接入已完成。[cef-rs 官方仓库](https://github.com/tauri-apps/cef-rs)
- 当前 CEF `OnPaint` 给出 BGRA 像素缓冲；`OnAcceleratedPaint` 已提供 Windows D3D 共享 handle、macOS IOSurface、Linux 多平面 fd。官方明确资源在回调结束后归还池，要求回调内重新打开并复制到应用拥有的纹理。因此“GPU 加速”不能写成端到端零拷贝。[CEF 当前 RenderHandler 头文件](https://github.com/chromiumembedded/cef/blob/master/include/cef_render_handler.h)
- cef-rs 已有 winit/wgpu OSR 示例与 D3D11/IOSurface/DMA-BUF importer；其安全契约要求回调内使用、同一物理 GPU，Vulkan 还要同一驱动，且等待 GPU 拷贝完成。这是可参考的纹理接入代码，不是 GPUI 组件。[共享纹理导入源码](https://raw.githubusercontent.com/tauri-apps/cef-rs/master/cef/src/osr_texture_import/shared_texture_handle.rs)
- CEF 的窗口无关模式由宿主传递输入、焦点、尺寸与关闭信号；完整集成仍要桥接 IME、弹出层、无障碍、光标、拖放、权限、会话和多进程生命周期。旧 general_usage 内仍有“不支持 accelerated compositing”的陈述，与当前头文件冲突，渲染能力应以当前 API 为准。[CEF 使用说明](https://chromiumembedded.github.io/cef/general_usage)

### Inferences
- Pero 若只换 windowed CEF 子窗口，主要收益是 Chromium 兼容；它不会自动获得 GPUI 内任意遮挡。要实现统一裁剪和层叠，应采用 OSR 并接到实际 GPUI renderer，另做输入和无障碍桥接。
- 保留 Electron 能继续复用现有 Chromium/桌面装配；同时加入 CEF 会增加第二套浏览器运行时。若最终目标是删除 Electron，CEF 才具有完整的替代意义；包体、内存改善必须实测，不能仅由“用 Rust”推出。

### Gaps
- 未找到可据以承诺 Pero 所用 GPUI 分支生产可用的 CEF 即插即用组件；未构建或测量其包体、CPU、延迟。

## Tauri 与 Servo 当前是否已经改变选择

### Takeaway
Tauri 已有 CEF 路径，但仍属于 3.0 alpha，不能再笼统说 Tauri 永远只使用系统内核。Servo 的 Rust WebView API 已可嵌入，但当前更适合受控页面实验。

### Cited Findings
- 官方 `tauri-runtime-cef` 页面明确：该 runtime 新增于 Tauri 3.0 alpha，Tauri 2.0 不支持，API 稳定前可能变化。优点是跨桌面统一 Chromium 与 CDP；代价是分发多出数百 MB、更多内存、首次下载约 1GB。它解决 Tauri 的 runtime 装配，不提供 GPUI 控件。[Tauri CEF 官方文档](https://v3.tauri.app/develop/cef/)
- Servo 当前提供 WebView API，官方 embedding 文档仍说明内容稀少且在建设；默认媒体依赖 GStreamer。2026-10 发布的 0.6.0 才默认启用 CSS Grid，并持续修复真实网站兼容。[Servo embedding](https://book.servo.org/embedding/overview.html)、[Servo 2026-10 更新](https://servo.org/blog/2026/10/09/august-in-servo/)

### Inferences
- Servo 值得作为 Rust 原生、受控 HTML 的长期实验，但不应仅凭“纯 Rust”承担 Pero 任意网页、登录与科研 Web App 的兼容承诺。

### Gaps
- 未对 Pero 的具体网页与 App 跑 Servo 兼容矩阵；不对稳定性和安全维护能力给等级保证。

## Ultralight 是否是轻量的更优替代

### Takeaway
不推荐作为 Pero 通用 WebView。它适合自行控制功能范围的游戏/嵌入式 UI，现有科研 Web 与 Wasm 路径会遇到确定的功能缺口。

### Cited Findings
- Ultralight 2.0 是自定义 WebKit 分支，官方明确 WebAssembly、WebGL、WebGPU、WebRTC、Service Worker 不可用，页面也不暴露给屏幕阅读器。[Ultralight 官方功能表](https://ultralig.ht/docs/2.0/supported-web-features)
- 官网实时价格与搜索缓存已不一致；实时页为按 title 的商业授权，Free SDK 有 60fps 上限且无 JS JIT/媒体，完整 SDK 与源码访问有不同授权条件。不要沿用缓存中的旧价格和营收门槛。[Ultralight 实时价格与条件](https://ultralig.ht/pricing)

### Inferences
- 即使 GPU 自绘集成有吸引力，Wasm/WebGL 与无障碍缺口也使它无法无条件承接 Pero 当前 Web 内容；没必要为此新增商业 SDK 集成成本。

### Gaps
- 未下载 SDK 或检查第三方 Rust bindings 的实际维护质量。
