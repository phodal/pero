# Skills 市场验证

关联 [上游 #156](https://github.com/phodal/pero/issues/156)。本记录区分最新上游移植检查与此前产品验收，不将静态目录或回环模型当作科研认证。

## 交付与目录核对

[JSON 明细](../design-docs/research-skills-catalog.json)和[中文分类索引](../design-docs/research-skills-catalog.md)包含 32 个固定快照、1,985 个候选路径、1,766 个保留条目；124 个重复路径合并、95 个通用条目排除。保留科研 1,668、科研辅助 88、内部依赖 10；13 个中文分类。已知候选读取失败、未分类和未解析子模块均为 0，不能取得源码的网盘/外部页面单列参考。

许可证证据分别为 skill 声明 491、目录证据 303、只有仓库证据 966、未知 6。仅 skill/目录级明确证据进入直接安装路径。相同正文但资源不同的包独立保留，来源提交、路径、正文 SHA-256 与资源指纹均可追溯。

输入章节 146、输出 405、示例 519；含依赖依据的条目 464。缺少提取章节表示没有匹配到明确声明，不表示没有依赖或输入输出。采集及离线对账见[采集说明](../../scripts/research-skills/README.md)。目录条目保留 `runtime=not_run`，不批量标记为兼容通过。

## 最新上游移植检查（2026-11-09）

基线 `phodal/pero@f0b8065eb300d4be0e5c5f89655d9fe3350fd995`，Windows，独立 worktree；保留上游 Paper 研究、MCP settings 和 Windows 改动。未纳入原工作区的无关修改或运行二进制。

| 检查 | 结果 |
| --- | --- |
| Python 目录规则 | 7 项通过；离线数量、来源和中文索引对账通过 |
| Skills App 搜索、筛选、分页、身份及版本匹配 | 5 项通过；App TypeScript 检查通过 |
| 工程类型、主题/token、双语、契约、图标生成检查 | `npm run check` 通过 |
| Rust 市场领域、上下文、取消/关闭 | 4 项通过 |
| Go plugins / skills | 两个完整包 `go test -race` 通过 |
| Host / Harness / 工作台 Wasm / Web / Desktop / Skills App 构建 | 通过 |
| 去除无用阅读器的 builder 回归 | 1 项通过 |
| 工作台 App presentation 单测 | 1 项通过 |
| 真实 Host → Git → Harness → 回环 provider | 固定安装、摘要、调用、版本更新/回退、旧会话与重启通过 |
| 真实 Host 并行获取 | 8 项通过，包含同 ID 拒绝、取消隔离、状态合并和关闭时终止获取 |
| 真实 Electron 目录、并行安装、聊天交接 | 分别 4 组、7 项、6 项通过；真实 Harness 向回环 provider 发送 1 次含实际技能正文的请求 |

提交前同时运行确定性安全扫描与人工数据流审查。目录扫描的两条连接串命中是原始公开示例 `user:pass@host` 及 `${POSTGRES_USER}:${POSTGRES_PASSWORD}`；`ABC1234XYZ` 是原文的 Zotero 示例占位值，均非凭据。扫描器还报告基线既有的 ignore 覆盖及仅含 `install-links=true` 的 `.npmrc`，不属于本次引入的泄漏。未发现实际 key、私钥或可利用的新增权限/路径问题。目录 8.8 MB 和四张截图已有用户提交授权。

## Windows 产品验收

用户确认设计后，已在真实 Electron 和 Host 验收；三项界面测试又在上述最新基线上全部复验。测试使用一次性 profile，公共目录或本地 Git fixture，明确只装配 Skills App。目录、抽屉和聊天截图来自本次复验；日常重启截图保留此前正常入口的观察证据。截图不代表跨平台验收。

本次并发界面测试最初因隔离构建目录使用 Windows junction，Go 无法解析测试 profile 路径而失败；同一来源改用实体测试目录后安装及聊天场景均通过，没有为测试环境改动产品路径边界。

- `tests/e2e/skills-market.mjs`：4 组通过，完整 1,766 条目录、搜索/分类/分页、详情键盘交互、刷新失败保留内容/恢复、版本管理与重启持久化。
- `tests/e2e/skills-market-install.mjs`：7 项通过，第一项获取等待期间第二项安装完成，取消互不影响，重试、启用与安装记录跨重启保持。
- `tests/e2e/skills-market-chat.mjs`：6 项通过，真实安装后“去使用”打开普通草稿并解析实际正文，技能引用可移除；不自动发送或全局启用；聊天手动选择已安装技能后正文到达真实 Harness 的回环模型请求。
- `tests/runtime/skills-market.mjs` 与 `skills-market-concurrent.mjs`：真实 Host → 本地 Git → Go Harness → 回环 provider 验证固定安装、摘要、显式调用、更新/回退、旧会话保持、停用移除、重启、取消与关闭。
- 显式联网获取固定版本 Humanizer、知识蒸馏和五个 AER skill，并核对真实正文与引用资源。没有调用付费模型，不把公共获取成功标为科学方法验证。
- 日常 profile 正常重启：排除未使用阅读器后，受管 Skills bundle 与源码构建摘要一致，原有 3 项安装记录及 state 摘要保持，实际观察到新列表和详情抽屉。

上述观察来自公开目录、fixture 会话和日常市场 UI，记录中没有凭据或私密聊天。验收截图不放入仓库。

## 复现

```sh
python -m pip install PyYAML==6.0.3
python -m unittest discover -s scripts/research-skills -p 'test_*.py'
python scripts/research-skills/verify.py
npm ci --prefix apps/skills --ignore-scripts
npm --prefix apps/skills run check
npm --prefix apps/skills test
npm run check
node scripts/cargo.mjs test -p pero-runtime --lib skill_market
go -C harness/go test -race ./plugins ./skills
npm run build:host
npm run build:harness
node scripts/build/apps.mjs --app skills
node --test --test-name-pattern='Skills builds' scripts/build/apps.test.mjs
node tests/runtime/skills-market.mjs
node tests/runtime/skills-market-concurrent.mjs
# 先构建工作台 Wasm、web 与 Desktop；下列使用真实 Electron。
node tests/e2e/skills-market.mjs
node tests/e2e/skills-market-install.mjs
node tests/e2e/skills-market-chat.mjs
```

机器回执写入被忽略的 `test-results/skills-market/`；公共来源获取需显式设置 `PERO_SKILLS_MARKET_PUBLIC=1`，其他默认测试只使用本地 Git 和回环网络。上述市场专项命令已在本地执行。新增 CI 工作流因当前提交账号令牌缺少 `workflow` scope 被 GitHub 拒绝，已保留本地补丁而未纳入 PR；不能将这些专项场景宣称为自动 CI 覆盖。

## 2026-11-10 按 #156 原文复核

对照 [issue #156](https://github.com/phodal/pero/issues/156) 的十二条验收，不把签名安装包或科研结论认证加进关闭条件。原文「Out of Scope」已排除科研结论认证和全平台一次性认证。签名包不是验收条目。

在 `71e7c7d78cfda0f97d5c10716831a5f898a7047b` 上重新执行：

- `python3 scripts/research-skills/verify.py`：32 / 1985 / 1766 / 124 / 95，待审、不可读、未解析子模块均为 0。按 Host 许可规则可直接安装 667 条。
- Python catalog 8 项、Skills catalog 5 项、`pero-runtime` skill market 7 项通过。
- `PERO_SKILLS_MARKET_PUBLIC=1 node tests/runtime/skills-market.mjs`：通过。公开来源 `blader/humanizer/SKILL.md` 提交 `0ef9fe5bc3572734fd3ae6c448fe00a30cd5dcf0`，正文 SHA-256 `0612f1dfb1672b0ea9b97e139bf1f06cabe98d8b27424fe8ff01e1fb4cc99cad`。模型是回环脚本，不是真实模型。
- Electron 工作台（GPUI Wasm，非独立 Native 壳、非签名包）跑到浅色目录、键盘详情、目录文件被移走后的刷新失败仍保留列表，以及已安装浅色详情。深色/窄窗切换停在打开设置：设置按钮的命中点不是画布，未改侧栏。

目录刷新曾在文件已被移走后继续返回第一次缓存，界面不显示失败。Host 现在按文件标识重新读取；文件不存在时返回 “Skill catalog is unavailable”，已显示的列表仍由 App 保留。

## 仍阻塞关闭的原文条目

- 第 11 条的深色、窄窗现场截图还没有在当前头上完成。浅色目录、键盘详情、刷新失败保留和已安装详情已在本次 Electron 工作台观察到。
- 第 12 条的显式 opt-in 真实模型没有跑。本机 `node_modules/.bin/codex login status` 为 Not logged in，开发 `.env` 和环境变量都没有 `DEEPSEEK_API_KEY`。不能把回环模型写成真实模型。下一步只能由操作者在本机执行 `node_modules/.bin/codex login`，或把已有的 `DEEPSEEK_API_KEY` 写入开发 `.env`（不要贴到对话里），然后再跑一次固定材料的真实调用。

目录包含不支持安装的 ZIP/动态执行条目。未知或仅仓库级许可不会强行安装。静态技能不自动安装第三方依赖。旧会话已加载的正文不能通过停用/移除抹除。#156 在第 11 条剩余截图和第 12 条真实模型完成前保持开放。
