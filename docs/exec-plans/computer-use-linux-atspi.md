---
kind: execution_plan
status: proposed
date: 2026-10-30
baseline: 0847ddc
---

# Linux AT-SPI 语义驱动交接

先读 [交接总表](computer-use-platform-handoff.md)。当前 Linux 是 X11 截图和显式
前台 XTest 输入，已在 Xvfb/Tk 证明效果；没有 accessibility 观察和后台元素输入。
这项工作的首个范围是 X11 会话上的 AT-SPI 观察与元素调用。

## 环境与落点

准备 GNU Linux、可用 X11/会话 D-Bus/AT-SPI bus，以及至少一个自有 GTK 应用。
记录发行版、工具包、a11y bridge 和应用启动条件。Xvfb/Tk 那一条是像素基线，
新的 GTK/AT-SPI 用例要单独报告，不能只把原用例换一个能力名称。

主范围在 [computer-linux](../../use/computer/crates/computer-linux/src/desktop.rs)，
建议新增 `accessibility/`，保持 Point-free；端口与 snapshot 见
[DesktopDriver](../../use/computer/crates/computer-runtime/src/driver.rs)。
后端自己的 snapshot 可保存 D-Bus 代理/对象引用及捕获几何；这些不能进入模型请求。

参考 Cua 固定 revision 的
[platform-linux](https://github.com/trycua/cua/tree/cbe3991f268c7e155bd028fbc9b449b40146cfe9/libs/cua-driver/rust/crates/platform-linux)，
先核对现有 a11y/window 关联与动作代码；参考不是已经获得 GTK/Qt 兼容性的证据。

## 分阶段实现

1. **观察与身份**：发现同一用户会话中的应用/窗口，关联 X11 window 与 a11y 根，
   验证 PID/进程关系、窗口关系和几何，不能只按同名标题拼接。
   给节点分配观察内唯一 ControlId，保留解析回原生对象所需的 snapshot。
2. **控件事实**：读取角色、标签、enabled、secure、可调用等事实，映射成公共元素。
   需要新增 editable/scrollable 等事实时走 C5；不要伪装成 `AXTextField` 或 `Edit`
   来触发现有核心的角色字符串判断。
3. **元素点击**：仅给实际能调用相应 Action 的控件声明 Click。
   验证不改变前台/真指针；按钮、复选/选择和展开动作语义有差异，不统一伪装成 invoke。
4. **文本/按键**：现有前台 XTest 字符映射限制保留。AT-SPI 文本支持另开小步，
   证明 caret、selection、Unicode 和后台行为后才广告对应组合。
5. **工具包覆盖**：GTK 后扩 Qt 与启用了可用 a11y bridge 的 Chromium/Electron，
   每一行记录版本和真实成功/拒绝结果。

[EditableText](https://gnome.pages.gitlab.gnome.org/at-spi2-core/libatspi/iface.EditableText.html)
的 insert-text 和 set-text-contents 是不同操作，字符 offset 也不是 UTF-8 字节 offset。
不能用全量替换实现 v1 `type_text`；set-value 先过 C1。

## 能力与错误语义

AT-SPI bus 不可用、provider 缺失、远程对象消失、树预算截断均有明确诊断。
X11 像素链路可独立存在：只广告确实初始化且可执行的观察/动作，元素寻址失败
不能静默改点像素。provider 变化后刷新能力或重启换 runtime ID，不保留失效引用。

安全控件不读值、不广告输入；完整树无法确认时不能声称已完成敏感信息检查。
现有 X11 无 AX 的像素行为与新的 a11y 路线分别说明，不能把新增观察能力写成
对所有 X11 应用都已具备安全字段检测。

仍遵循每次尝试消费观察的 v1 规则。局部展开与观察复用由 C3 决定，禁止仅合并
两棵局部先序索引导致同一个 element ID 指向不同原生对象。
应用 allowlist 先过 C2；WM_CLASS/标题不能直接升级为可信授权身份。

## 验收与交付

先保持像素基线：

```sh
node scripts/build/computer.mjs --test
xvfb-run -a node tests/build/computer-source.mjs --linux-only --x11
```

另建 `tests/e2e/computer-linux-atspi.mjs` 和 GTK fixture，定义实际 session-bus
启动命令与 readiness 信号；bus 未就绪应给出明确测试前置条件，不假通过。

最小验收矩阵包含：两个同名窗口/应用、按钮单次调用、可写/只读/禁用/安全控件、
树截断与 provider 消失、后台 guard/真光标保持、陈旧引用和 stop/restart。
文本阶段检查选区替换、Unicode/emoji、清空与插入的区别；读回独立应用状态。
每次声明支持一种新地址/投递组合，都增加共享 catalogue 的成功与预期拒绝案例。

如果采用 Cua SDK，先读 [接入评估](../design-docs/computer-use-cua-adapter.md)：
固定版本的 SDK 对 musl 不注册 Linux desktop backend，需要显式 GNU lane；
现有 X11/musl 与 Point-free 检查保留。只引入经评审的公共原生依赖，记录来源/许可，
Host 会话与授权继续归 Pero。

这条 lane 不宣告原生 Wayland 已可控；其捕获、输入授权和桌面目标见
[Wayland 计划](computer-use-linux-wayland.md)。Linux 两个模块合并时统一 snapshot
与 profile 的组合，不增加第二份公开契约或授权状态机。
