# 优先启用 GPUI 原生 WebView 合成

**有更好的方案；对 Pero，首选是验证现有 GPUI Kit 的 `gpui-fast` 合成路径。** 项目固定的 Kit 源码已经包含这项能力，但当前依赖没有启用。它保留 `gpui-webview + lb-wry` 和系统浏览器内核，直接改善 GPUI 浮层与网页的层叠、裁剪。CEF 则适用于必须统一 Chromium 行为的需求，迁移范围明显更大。此次结论来自 2026-10-30 的源码与官方文档核查，没有编译或运行新方案，也没有测量性能、包体和内存。

判断“更好”需要分清层次：WebKit/Chromium 是引擎；WKWebView、WebView2、WebKitGTK 是系统嵌入接口，CEF 是 Chromium 嵌入框架；Wry 与 GPUI WebView 负责跨平台和 GPUI 适配，backend 决定合成。**换 Wry wrapper 通常不会改变引擎或解决遮挡。** Pero native 依赖 `gpui-webview 0.8.1`、`lb-wry 0.53.3`，构建脚本指向固定的 Kit checkout；当前使用原生子视图，覆盖层出现时隐藏整个网页，与 Electron 发行壳的 WebContentsView、受管 App iframe 是不同路径。([依赖](/Users/phodal/workspaces/pero/crates/pero-ui/Cargo.toml:40)、[构建接线](/Users/phodal/workspaces/pero/scripts/lib/cargo.mjs:8)、[显示策略](/Users/phodal/workspaces/pero/crates/pero-ui/src/web_documents.rs:221))

| 方案 | 主要收益 | 关键限制 | 对 Pero 的判断 |
| --- | --- | --- | --- |
| 现有 Kit/Wry，启用 `gpui-fast` | 保留系统引擎，改善浮层与裁剪 | Kit 仍标为实验性；平台能力不齐 | **优先做 native 验证** |
| 直接 WKWebView/WebView2/WebKitGTK | 更细的平台能力控制 | 自行维护平台与 GPUI 接口 | 有具体缺口再补 |
| CEF + GPUI OSR | 统一 Chromium，可接纹理管线 | 渲染、输入与多进程装配工作大 | Chromium 成为硬需求时考虑 |
| 保留 Electron | 延续已有 Chromium 与 Desktop 装配 | 继续承担现有壳与包体 | 近期发行基线 |
| Servo | Rust 引擎，可嵌入 | 网页兼容与 embedding 仍在完善 | 受控页面实验 |
| Ultralight | 面向自绘 UI 的嵌入方式 | 缺 Wasm、WebGL、WebGPU、屏幕阅读器 | 排除通用内容承载 |

`gpui-fast` 的价值在于更换 GPUI backend 与原生窗口合成方式。Kit 要求同时启用 `gpui-kit/gpui-fast` 和 `gpui-webview/gpui-fast`，才能在 macOS/Linux 上将 deferred GPUI overlays 放到原生网页上方。macOS 实现把同一个 WKWebView 挂到 `WindowCompositionSurface`，再调整容器和页面偏移，实现裁剪并保留完整 DOM viewport；**它不是截图上传，也不是网页离屏纹理渲染。** 合成创建失败仍会回退普通挂载，必须检查实际运行结果。([Kit 指南](https://gpui-kit.com/docs/webview/#gpui-fast-native-composition)、[固定源码](https://github.com/longbridge/gpui-kit/blob/ec89cfc36404667b7947aeb3d40b1c2859d729dd/crates/webview/src/lib.rs#L55)、[macOS 实现](https://github.com/longbridge/gpui-kit/blob/v0.8.1/crates/webview/src/composition.rs#L20-L95))

平台边界也很明确：**Kit 当前的 Windows 路径仍是 child view；Linux 仍限 X11/XWayland。** Wry 自身能在 GTK 拥有的 Wayland 容器中工作，不代表它能嵌入 GPUI 的原生 Wayland 窗口。Windows 的 WebView2 CompositionController 是另一条可行方向，但宿主要提供 visual tree 并转发鼠标、指针等输入，目前没有本次核查能证明可直接替换进 Pero 的成熟适配器。([Kit Linux 源码](https://github.com/longbridge/gpui-kit/blob/v0.8.1/crates/webview/src/linux.rs#L1-L187)、[Wry 平台说明](https://docs.rs/wry/latest/wry/)、[Microsoft 接口](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environment3?view=webview2-1.0.4258.31#CreateCoreWebView2CompositionController))

因此，启用两个 feature 只是迁移入口。需要统一共享 UI crate 使用的 GPUI 类型与 backend，并保持现有 Wasm 路径及 `gpui-pre-web` 中文输入补丁可用。合成解决层序和裁剪，焦点、快捷键、IME、弹窗及生命周期仍要分别验证。对于 macOS，直接重写 objc2/WKWebView adapter 不会带来新的页面引擎；只有发现具体平台 API 缺口时，这项维护成本才有依据。Kit 对加载、导航、消息与输入也明确要求应用自行配置和验证。([Kit 集成边界](https://gpui-kit.com/docs/webview/#loading-navigation-and-page-messages))

CEF 的主要优势是统一 Chromium 版本与网页行为。`cef-rs` 提供 Rust bindings 和 OSR 示例，但还不是现成的 GPUI 组件；若只嵌入 windowed CEF 子窗口，不能据此期待 GPUI 任意层叠。要走 OSR，需要接 GPUI renderer，并补齐输入、IME、焦点、弹出层、无障碍与浏览器进程生命周期。当前 CEF 加速回调已支持 Windows D3D、macOS IOSurface、Linux 多平面 fd；官方要求在回调中复制到应用拥有的纹理，**不能将共享 GPU 资源称为端到端零拷贝。** ([cef-rs](https://github.com/tauri-apps/cef-rs)、[CEF 渲染接口](https://github.com/chromiumembedded/cef/blob/master/include/cef_render_handler.h))

Tauri 也需要按版本判断：Tauri 2/Wry 不改变系统内核；Tauri 3.0 alpha 已提供 CEF runtime，但仍处于 alpha，官方说明分发会增加数百 MB，它解决的是 Tauri runtime 装配，没有提供 GPUI WebView 控件。Servo 已有 embedding API，但仍在完善文档与真实网站兼容；Ultralight 明确缺少 Pero 当前内容所需的 Wasm 等能力。两者都不足以成为本次推荐的替换件。([Tauri CEF](https://v3.tauri.app/develop/cef/)、[Servo embedding](https://book.servo.org/embedding/overview.html)、[Ultralight 功能表](https://ultralig.ht/docs/2.0/supported-web-features))

下一步应限定为 **native-only 的 GPUI Fast 验证**，复用当前 Web source、导航和保留状态模型。可见窗口需验证六项：菜单、tooltip、对话框覆盖网页且点击正确；分栏拖动与局部裁剪；网页和 GPUI 之间的焦点、Tab 与 Cmd-L；中文输入、选区和剪贴板；Retina 与跨屏缩放；多标签保留、关闭重开及资源释放。同时检查 native 改动没有破坏 Wasm 构建与输入行为。通过之后，再决定是否撤掉当前 covered-hide 策略。

仓库已有验收记录证明隐藏 macOS 窗口中的页面 DOM、历史、表单保留、显隐与释放；receipt 明确写着 `visual_acceptance:false`，不能作为合成和输入体验的证据。受管 App SDK 的 origin、会话、权限和 Host 接线也需单独验收。**本次推荐解决的是 native WebView 的集成质量；它不构成删除 Electron 或迁移整个 App 平台的依据。** ([现有验收边界](/Users/phodal/workspaces/pero/docs/fitness/web-documents.md:70)、[原生 receipt](/Users/phodal/workspaces/pero/crates/pero-ui/src/native_web_probe.rs:304))
