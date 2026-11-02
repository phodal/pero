---
kind: verification_report
date: 2026-11-02
---

# Paper Agent TeX 与 PDF 预览验证

范围：macOS arm64 开发环境，源码 `e517abd0`；`3a38561f` 提交阶段技能及
payload，`e517abd0` 提交 App 内接入设计。此次按用户要求核查生成脚本，并实际
编译一个明确标注的合成文档，再通过原生 UI 导入实际 Paper Agent 阅读器。
没有调用写作模型、研究实验或生产服务，也没有提交二进制或安装包。

## 结论

| 检查 | 实际结果 | 范围 |
| --- | --- | --- |
| Paper 自带 TeX 生成脚本 | 尚无 | 现有 tools/research.py 是研究资源工作流；新写作技能不是可执行生成器 |
| Paper 自带构建接口 | 尚无 | paper-build 中只有指引；app.json 未声明作者稿件编译路由 |
| Codex 内置编译器 | 成功 | 当前会话的宿主工具对测试项目返回 kind=success，不是 Pero 的工具接线 |
| 独立 Tectonic 编译 | 成功，退出 0 | 0.17.0 官方 macOS arm64 二进制，产生 PDF、日志和 SyncTeX |
| 缓存离线重编译 | 成功，退出 0 | --only-cached，同一测试源文件，未要求新的网络资源 |
| 现有 Paper PDF 预览 | 成功 | 原生 UI 导入上述 PDF，实际 EmbedPDF/PDFium 显示完整第 1/1 页 |
| 作者稿件编辑→构建→自动预览 | 尚未接通 | 仍需 App 稿件、构建适配、诊断与预览版本关联 |

这证明编译器候选和现有阅读器能够承接测试材料，不能描述成 Paper 已具有论文
自动生成或作者稿件构建能力。设计见
[稿件写作与构建预览](../design-docs/paper-manuscript-authoring.md)。

## 测试源与编译产物

测试源由本次验证显式撰写，包含标题、三节文字、公式和两行表格，正文注明不是
研究结果，也不是 Paper Agent 生成。算式使用合成计数 86/89≈96.63%，基线
80/89；没有引入真实科研结果或引用。

- 源文件 SHA-256：`0d571feee91405c05dbfbcefed564997318d4ee03b8c62126935963a3ef09812`。
- 首次编译 PDF：1 页，16,549 bytes，SHA-256
  `3c7ded04b9082e1362fd967c18aa617fb08d321c7abbf8abaee692eccf3d8bd2`。
- 首次编译取得需要的资源并生成格式，单次观察约 174 秒；缓存离线重编译的
  单次观察不足 1 秒。这不是跨模板性能基准或延迟承诺。

Tectonic 可执行文件只放在忽略的验证目录，没有添加到全局 PATH 或 App 包。
使用 [官方发布](https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0)
的 `tectonic-0.17.0-aarch64-apple-darwin.tar.gz`，归档 SHA-256 核对为
`a3f1cac7c5678f01661a92212f58480ae3b0634115d880dbc59e2953ded45667`。
初次使用需要的资源不全包含在单个可执行文件内，正式 App 环境须单独处理准备
和缓存；不能从这次成功推出所有模板都能离线构建。

## 预览与字节核对

使用独立 Desktop profile 启动现有开发壳，重新构建 Paper 前端，经实际
“Add papers → PDF → Import PDF”选择编译产物。导入后关闭附带的复制审阅框，
进入现有阅读器；此次预览不通过伪造外部论文或替换后端下载响应实现。

原生 CUA 观察确认 PDF reader 为第 1/1 页，缩放 113%；截图中标题、公式的
分式与 96.63%、表格、完整边界说明均可读，无裁切。另用 Poppler 渲染唯一
页面并人工查看，提取文本确认保留相关数字和两种方法名。

隔离 App 数据目录中实际保存的 PDF SHA-256 与首次编译产物一致。这条路径
验证的是已有本地 PDF 导入/阅读功能，没有验证 TeX 编辑器、自动重编译、旧
预览提示、编译错误恢复、审阅模型视觉能力或签名安装包。

## 可检查记录

完整证据保存在忽略的 `test-results/paper-authoring-verification/`：

- `tex-smoke/main.tex`、`tex-smoke/build/main.pdf`、日志和 SyncTeX。
- `codex-compiler.json`：实际项目创建与宿主编译工具回执。
- `tooling/release.json`：独立编译器来源、版本和哈希。
- `compile-result.json`、`compile.stdout`、`compile.stderr`。
- `compile-cached-result.json`：缓存离线编译命令与输出。
- `preview-result.json`：原生 UI 观察和 App 保存文件的字节核对。
- `rendered-page.png`、`rendered-text.txt`：实际编译 PDF 的页面及文字。
- `desktop-profile/`：隔离开发配置与导入结果；`desktop.log` 为启动日志。

`node --test scripts/build/workbench-payload.test.mjs` 4 项通过。它们验证技能与
参考资料的安装资源、staged CLI 和链接，不能替代上述编译/预览实测，也不能
证明尚未实现的稿件功能可用。
