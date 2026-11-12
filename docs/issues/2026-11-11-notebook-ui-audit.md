---
kind: issue
status: resolved
date: 2026-11-11
updated: 2026-11-12
---

# Notebook UI hides everyday actions and overexposes setup details

Reopened on 2026-11-12 after user feedback and an actual Native walkthrough.
The historical verification below remains valid only for its stated behavior
and platform scope; it does not establish current Notebook UX acceptance.
See the current audit at the end of this record.

The current browser audit at `b1b95293` found nine related usability problems:
invisible draft persistence status, clipped narrow title/status, oversized Insert
menus, hidden view navigation, premature input-table validation, technical evidence
entry, procedure setup preceding steps, mixed notebook-library/property ownership,
and tool emphasis disconnected from everyday work.

The changes keep the existing document, draft, revision, evidence and Host owners.
Shared SDK controls remain the interaction owners. Draft storage and explicit
revisions must remain distinct; existing scientific snapshots must remain fixed.

## Repair and migration

- Replace the clipped status and bottom-only save icon with visible persistence
  feedback and a named revision action. Expose core view tabs and current view.
- Preserve author popup sizing while the shared Popover clamps to the viewport;
  group Notebook insertion by task and retain mounted dialog state.
- Reflow titles and status at narrow widths, retaining long editable titles.
- Show neutral incomplete input drafts, reserve errors for invalid supplied values,
  and distinguish input tables from catalog registration.
- Put procedure steps before optional setup; keep meaningful existing data visible.
- Search notebooks in their navigation; separate current-entry properties and
  provenance from the notebook library.
- Select real fixed sources from saved notebooks, retaining file import and manual
  reference entry. Do not introduce cross-App permissions or invented evidence.

## Verification

Implementation: `2dbb72f8`, `290ee078`, `0399c488`, `2f7c30b4`, `7e2a2151`.

- `npm --prefix apps/notebook run typecheck`, Notebook build, SDK typecheck,
  and root `npm run check`: passed.
- All Notebook editor tests: **109/109 passed**, with the Python dependencies
  declared in `apps/notebook/app.json` installed in an isolated temporary venv.
- Shared Popover tests: **8/8 passed**. Notebook reference-control tests: **4/4 passed**.
- Updated regression selectors for the multiline title, visible tabs, disclosed
  step insertion and Properties. Corrected the stale Ctrl+Shift+S expectation:
  the existing command owner deliberately leaves this key unhandled; its code
  is unchanged from `b1b95293`.

The real built Notebook frontend and Python backend ran with isolated temporary
SQLite data. CUA browser checks covered:

1. A long Chinese title at 440 × 900 wraps completely; title, entry ID, status
   and Save revision remain readable. Desktop was checked at 1280 × 900.
2. Draft storage feedback is visible; Save revision produces a new revision and
   disables after success; reload retains table cells, evidence and procedure text.
3. Insert and More blocks stay at 280px width (expanded menu 560px high), rather
   than filling most of the viewport. Core tabs remain directly accessible.
4. An empty input table has neutral guidance. Visiting and leaving an empty
   required cell shows its error; valid input removes it. Registration gates
   still use all domain validation issues.
5. Saved-evidence selection previews a real saved revision and requires Attach.
   API comparison after revision 4 confirmed exact source/snapshot equality with
   the source notebook's revision 1, which remained unchanged. The component
   test covers both Paper snapshots and Control receipts, excluding unpinned ones.
6. New procedures expose Add step before introduction, parameters and materials.
   Optional formatting and image/table tools remain available through disclosure.
7. Sidebar search filters entries while retaining the current editor. Properties
   contains current-entry labels and disclosed provenance, without another library.
8. English/light and Chinese/dark rendering were visually inspected. The empty
   body prompt and direct Templates action were checked during initial editing.

Screenshots (local artifacts, not repository binaries):
`/Users/phodal/.codex/visualizations/2026/11/11/01a1ca08-09d0-7da3-a2fa-adeedd24cf8b/notebook-fixes/`:
`notebook-light.png`, `notebook-dark-zh.png`, `narrow-dark-zh.png`,
`insert-menu.png`, `saved-snapshot-picker.png`, `procedure-steps.png`,
`properties.png`. The first `narrow-title.png` precedes the final sidebar-height
adjustment. The original audit is in the adjacent `notebook-audit` directory;
these are workflow verification shots, not identical-data pixel comparisons.

Scope: browser frontend and isolated backend only. Packaged Pero Electron,
Native embedding, actual Host project association and cross-App opening were not
retested. Saved snapshot selection is explicitly scoped to Notebook revisions;
JSON import remains available for external reports. No scientific acceptance is
implied. One console exception during iframe theme verification was traced to the
browser's injected Electron preload, not a Notebook source script.

## CI follow-up: migrated navigation and nested dialogs

Runs [43003026881](https://github.com/phodal/pero/actions/runs/43003026881)
and [43007150844](https://github.com/phodal/pero/actions/runs/43007150844)
failed at the same two assertions: the shortcut test assumed Ctrl+Shift+S was
unhandled by every editor, and the browser test searched for View in the old
command row. On Linux, Tiptap legitimately handles Mod+Shift+S as strikethrough.
The test must verify the native edit and absence of a Notebook export, on both
Mac and Linux. Navigation now exposes five tabs and retains View in the workspace
navigation row; the browser contract must check that actual arrangement.
Later in the journey, the Properties label fields have native datalists and
therefore combobox semantics, not a fixed textbox role. Select them by their
associated labels while preserving save, reload and exact metadata assertions.

Continuing the full browser journey then exposed a real nested-dialog defect:
Insert → source excerpt → Source attachment rendered the Select list in the
outer Popover, behind the native modal. The shared popup-container resolver
preferred an ancestor popup marker even when a closer open dialog owned the
trigger. Preserve explicit containers and popup containers inside dialogs, but
keep a dialog's controls above an enclosing menu. The affected real consumer is
the source-excerpt composer; its existing pointer-selection and retained-source
checks are the browser regression path. Test-alignment commit: `ff19e977`.

Verification on base `68c62816` plus this repair, macOS, Node 26.8.1,
Python 3.12.11 and real Chromium with isolated SQLite:

- `NOTEBOOK_REAL_OCR=1 npm run test:notebook`: 269 core and 110 editor tests
  passed; Python ran 151 tests, 150 passed and the Linux-only virtual-address
  limit case skipped. Real image/PDF OCR and limited-parser OCR passed.
- `npm --prefix apps/notebook run test:browser`: 7/7 passed, including all 15
  follow-on scenarios in the workbook journey. No forced clicks or skipped
  assertions. Source attachment selection uses a real pointer click, then
  checks exact text/hash, published revisions and retained download bytes.
- Shared Select, Popover and Dialog: 22/22 passed. The existing portal table
  now covers a dialog inside a popup and a popup inside a dialog; explicit
  container, Escape and focus behavior remain covered.
- Packaged parser/citation tests: 2/2; installed App/Canvas owner tests: 21/21.
- Notebook build, Notebook typecheck and SDK typecheck passed.

Local logs: `/Users/phodal/workspaces/pero-notebook-ci-430030/test-results/ci-notebook/`
(`notebook-tests.log`, `fixed-browser.log`, `popup-tests.log`,
`packaged-parser-tests.log`, `owner-tests.log`, `build.log`, `typecheck.log`,
`sdk-typecheck.log`). Browser artifacts remain in the sibling `notebook/`
directory. Visually inspected `copied-notebook.png`,
`source-excerpt-picker-light.png`, `source-excerpt-light.png`, and
`source-excerpt-retained-narrow-dark.png`; the picker is visible above the modal
and the saved/retained excerpt is readable in both themes. The failure screenshot
is retained as `ci-notebook/baseline-source-excerpt.png`.

The shortcut cases explicitly set Mac/Linux navigator platforms within the test;
this is not a Linux OS run. Latest Linux CI must run after integration. No
Electron, Native, paid model or scientific acceptance was performed here.

## Follow-up: reduce persistent controls

User feedback: the interface remains cluttered and exposes too many operations.
The first repair fixed individual access/layout defects but did not sufficiently
reduce visual density. A fresh browser capture at 440px found 31 visible editor
chrome controls and the title beginning at y=458px. Normal procedure steps expose
structural editing controls alongside execution. Evidence and table metadata
precede their main content.

Continue with progressive disclosure: keep insertion/save/content access direct;
make formatting, library administration and step settings explicit optional tools;
move table configuration after its data; consolidate evidence provenance and move
snapshot replacement into block actions. Preserve all data, warnings, keyboard
commands and active step properties. Table view selection and active filters stay
directly accessible; schema and new-column configuration sit below the data.

Verification on the archive integration branch, macOS with the declared Python
dependencies: Notebook typecheck/build, 110 editor tests and all 7 browser suites
passed. Existing browser journeys now open Format, File → Properties, reference
Block actions and Step settings through their visible controls; persistence, exact
snapshots, printing, procedure kinds and nested dialogs retain their assertions.
Visually inspected the current light desktop, narrow dark document and dark
Properties dialog in `test-results/notebook/{copied-notebook.png,
copied-notebook-narrow-dark.png,notebook-home-narrow-dark.png}`. Packaged Electron
and Native embedding were not retested.

## 2026-11-12：Native 全主视图复审，重新打开

### 结论与版本

当前问题不是单纯“旧包没有刷新”：运行包确实落后于源码，但当前源码仍默认隐藏格式工具，
并保留以说明、配置表单和多层 Tab 为主的工作区结构。此前将“减少控件”落实为隐藏常用操作，
没有完成以科研记录为中心的信息架构调整。功能测试通过不等于设计问题已经解决。

- 审查工作树：`master`，`360e7f0ea`，开始时工作树干净。
- 远端核对并 fetch：`origin/master=d965402d1`；新增提交为 CI 工作流整合。
  `git diff HEAD..origin/master -- apps/notebook packages/notebook packages/app-sdk` 为空。
  因而本地 Notebook 源码与本次核对时远端主分支一致。
- 实际运行：`Pero Native Preview`，进程来自本仓库 `target/debug/Pero Native.app`；
  Notebook 后端路径为 `/Users/phodal/.pero/native-preview/apps/notebook/backend/server.py`。
- Native 安装目录与仓库 `apps/notebook/dist` 的 JS/CSS/HTML 等文件 SHA-256 一致；
  核心产物时间为 2026-11-11 20:49。`index.js` SHA-256：
  `72162e48e7cb60b31e06a25018cab12391f5b4a0a2c7a1526804fea6cbc9fc79`。
- `source-evidence.json` 有 40 条源码记录，其中 11 个 MyST/ipynb 相关文件与当前源码哈希不同。
  这是构建过期的直接证据；该清单并不覆盖全部 UI 文件，不能用它推断精确构建 commit。
- 当前 `editor.tsx` 的 `EditorToolbar` 明确 `useState(false)`；`7572548cc` 引入格式按需展开。
  运行时可展开/隐藏格式工具；开始时笔记视图的格式工具已经展开，不将该状态当作首次打开的默认状态。
- 此次只审查、记录并恢复初始实验步骤视图，没有修改用户笔记、保存修订、重建或替换安装包。

### 证据与路径

证据目录：`/Users/phodal/.codex/visualizations/2026/11/12/01a1cd4f-915b-75e2-9e9f-8f012740e63d/notebook-audit/`。
截图来自本次 CUA 获取的真实 Native 窗口，保存同一份截图字节并逐张检查。
用户附件作为补充证据：其中未保存修订警告可见，本次选中的已保存条目没有该警告。

| 步骤 | 截图 | 观察结果 |
| --- | --- | --- |
| 1 | `01-current.png` | 实验步骤空态：说明、添加流程、居中空态分散，正文工作区缺乏结构 |
| 2 | `02-note.png` | 笔记与展开格式：标题可见，但文档操作、插入、AI、格式混为长工具行 |
| 3 | `03-format-toggle.png` | 关闭格式后常用编辑工具完全消失；展开状态没有明显持续选中反馈 |
| 4 | `04-related.png` | 相关条目：限制说明先于对象，添加命名引用与空态下一步相互分离 |
| 5 | `05-metadata.png` | 元数据：三类简单属性占整页，项目/作者输入横贯内容区 |
| 6 | `06-review.png` | 评论：身份说明、姓名输入、刷新/导出先于评论，空态仍保留筛选和批量入口 |
| 7 | `07-tasks.png` | 本地任务：重复解释不会通知或执行，空态仍显示批量操作 |
| 8 | `08-review-workflow.png` | 人工复核：自我复核和流程配置混合，重复边界说明压过复核内容 |
| 9 | `09-history.png` | 只有 r1 仍展示 r1 对 r1 比较；原始 ISO 时间和内部版本信息占据选择器 |
| 10 | `10-insert.png` | 插入菜单已分组、可操作；科研类型仍偏模型命名，缺少任务上下文 |
| 11 | `11-more-format.png` | 更多格式可打开且 Escape 可关闭；常用格式与低频动作的分组仍待重整 |

### 问题清单

P1：妨碍日常主路径或明显违反设计原则，优先调整。
P2：信息呈现、可发现性、一致性或可访问性问题，随结构调整落实。
“源码”表示已核对实现，但本次未在真实有数据状态下验收，不冒充现场复现。

| ID | 优先级 | 问题、影响与证据 | 调整方向 / 对应原则 |
| --- | --- | --- | --- |
| NB-01 | P1 | **格式默认隐藏**。当前源码 `EditorToolbar` 初始化为 false；常用写作操作必须先发现“格式”。步骤 2–3 证明工具可整体隐藏 | 笔记编辑时直接展示紧凑的常用格式；低频格式才进入更多菜单。遵守“主任务与常用操作直接可见” |
| NB-02 | P1 | **格式没有融入编辑上下文**。步骤 2、11：撤销、插入、模板、格式开关、AI 与文字工具拼成一条长行；非笔记页仍有“格式”触发器但工具被 CSS 隐藏 | 按当前编辑对象提供工具；文档动作与文字格式分组；检查步骤富文本、表格选区的工具归属 |
| NB-03 | P2 | **格式开关形态不明确**。下箭头看起来是菜单，实际展开同级工具；开启后缺少清楚持续状态。当前样式还同时使用 `display:contents` 与 wrapper flex 属性，布局意图不清晰（源码） | 去掉常用格式开关；保留真正菜单的菜单语义，明确次级工具的展开状态 |
| NB-04 | P1 | **全局操作、文档动作、编辑工具、业务视图层级堆叠**。所有截图都有三层 App 顶栏，审阅再增加一层 Tab；空白多但真正工作空间没有形成重点 | 重组文档头、上下文工具栏和辅助工作区，不用继续隐藏主路径来减密度 |
| NB-05 | P1 | **离开笔记页后当前对象身份消失**。步骤 1、4–9 顶部只剩“修订 1”；完整标题与条目编号仅在 Notes 中呈现 | 所有工作区保留精简的当前笔记标题和版本上下文；不是重复 App 名 |
| NB-06 | P1 | **五个同级 Tab 混合主工作与附属信息**。正文、步骤、关系索引、属性、审阅被安排为等价整页；用户离开内容才能检查属性/讨论 | 正文与步骤作为主要工作区；属性、引用、讨论按任务作为可访问的辅助面板。保留有理由的全页视图 |
| NB-07 | P2 | **左侧笔记列表难以区分条目**。本次六条“未命名笔记”大多只显示“修订 1”，无日期、内容摘要或编号；每行菜单常驻占位 | 标题优先，辅以可区分的时间/摘要/编号；当前项与行操作层级清晰 |
| NB-08 | P1 | **实验步骤空态像说明页**。步骤 1 的说明、添加流程、暂无流程及第二段说明散落；没有围绕“开始写第一步”组织 | 紧凑空态与创建动作放在一起；明确流程/步骤对象关系，提供直接编辑入口 |
| NB-09 | P1 | **步骤编辑与执行阶段没有清楚组织**。源码 `ProcedureFields` 同时呈现完成勾选、编辑器和步骤设置；流程切换靠 Select，材料/参数在步骤之后。当前无流程，未实测有数据状态 | 按编写/执行阶段安排重点；执行前决策所需材料、参数必须直接可查。保留现有领域状态，不另建执行器 |
| NB-10 | P1 | **相关条目以模型边界说明代替关系工作区**。步骤 4 第一行讲固定身份不是验证，主要动作却叫“添加命名引用” | 以来源/实验/附件等对象呈现标题、类型、版本、验证状态和打开动作；边界说明贴近相关状态 |
| NB-11 | P2 | **关系索引没有帮助建立第一条关联**。空态要求去笔记插入，添加入口位于远处；源码有数据列表直接拼接 app/kind/id/version | 空态提供明确的选择或插入动作；可读标题优先，技术身份进入详情，来源与核验状态仍可见 |
| NB-12 | P1 | **元数据作为整页表单过重**。步骤 5 只有项目标签、作者标签、标签却占整页；横贯宽度的输入破坏字段密度 | 收到紧凑属性区域；按信息分组并约束输入宽度，保留字段标签 |
| NB-13 | P1 | **属性存在双入口与不同提交方式**。源码 `MetadataView` 直接改草稿；文件→属性的 `NotebookHome` 又编辑同一项目/作者，需“应用标签” | 同一属性有一个清楚的编辑模型；统一保存反馈，不让两份表单承担相同职责 |
| NB-14 | P1 | **项目标签与真实项目关联被拆散**。元数据先解释不会关联 Host；真正关联在文件→属性的 Disclosure 内（源码） | 显式区分“所属研究项目”和普通标签，把关联入口放在属性上下文；不伪装已关联 |
| NB-15 | P1 | **审阅先要求读限制说明、配置身份，再进入内容**。步骤 6–9 长说明、姓名、帮助、刷新、导出常驻页面顶部 | 以评论/待办/审阅对象为主体；本地范围用简短状态表达，身份修改与导出降为次要操作。必要边界仍可查 |
| NB-16 | P1 | **审阅与正文分离**。步骤 6 评论占整页、正文不可见；源码提供跳转定位，但不等于并置审阅 | 在阅读上下文提供评论和定位；需要比较或流程管理时再使用完整工作区 |
| NB-17 | P1 | **空态仍展示后续阶段工具**。评论无记录仍显示“批量操作/全部线程”；任务、复核也显示批量入口；人工复核同时展示流程配置与空记录 | 空态聚焦创建；有条目或选择后才显示相应批量工具。遵守“任务阶段决定呈现” |
| NB-18 | P1 | **人工复核的层级不清**。步骤 8 将本地自我复核、复核流程和审阅记录堆在同一页，以三段说明解释能力限制 | 将当前修订、复核状态、下一步操作组成明确工作流；流程配置属于次要管理。保持本地记录与独立批准的真实边界 |
| NB-19 | P1 | **草稿已保存与审阅旧修订靠长警告解释**。用户附件同时出现“草稿已保存在本地”和“存在未保存更改…请先保存”，读起来冲突 | 明确显示“草稿已保存 · 尚未生成新修订”和“当前审阅 r1”；旁边提供保存新修订动作，保留审阅版本约束 |
| NB-20 | P2 | **历史默认做无意义比较**。步骤 9 只有一个修订却允许 r1/r1，并显示“两个文档完全相同” | 只有一个修订时展示版本详情；有可比版本后默认选择前后版本 |
| NB-21 | P2 | **历史时间与比较信息面向内部实现**。步骤 9 原始带微秒 ISO 时间、稳定 ID、100 项/280 字符等先于内容；源码差异采用路径文本 `CodeCompare` | 版本用本地化时间、作者与变更摘要；正文/表格/属性采用对象化比较；截断影响仍明确，原始详情按需可查 |
| NB-22 | P2 | **插入命名要求用户理解技术分类**。步骤 10 同列电子表格/输入表、App 画布/证据/实验引用/研究发现，缺少当前任务的选择线索 | 保留已经有效的分组菜单；用简短用途或上下文入口帮助区分类型，不再把说明堆回编辑区 |
| NB-23 | P2 | **用文字和边框承担全部层级**。步骤 1、4–9 大白板、细框与说明段落占主导，普通操作和辅助文本接近；同样字体密度用于属性、活动和正文 | 用共享表面、间距、排版和语义色区分内容/辅助/动作；避免再套多层卡片。Native 蓝色主题本身不能直接判为违规 |
| NB-24 | P2 | **共享组件被页面私有皮肤覆盖**。`styles.css:73–90` 等直接改 SDK button/select/icon 的边框、背景、禁用、字号与图标大小 | 采用 SDK 现有 variants；确有缺口在库中扩展。迁移时记录消费者并检查所有状态，不能只删 CSS |
| NB-25 | P1 | **Native 可访问性存在待定位风险**。CUA AX 树只暴露宿主导航，切换 Web 内容后无变化；本次必须用坐标操作 | 排查 Native WebView 辅助技术桥接，并用 VoiceOver/真实键盘验证；本次观察不等于已证明屏幕阅读器完全不可用 |
| NB-26 | P1 | **构建和验收状态不透明**。源码、dist、Native 安装包不同步，旧记录 status=resolved 容易被当成全部完成 | 验收记录绑定源码、构建指纹、平台和场景；在帮助/诊断中可查版本，不把技术指纹塞进写作主界面 |

### 保留已有优点，避免再次误改

- 草稿持久化与不可变修订已有明确领域区别；修复文案与操作呈现，不能合并两种语义。
- 固定证据、来源版本和未验证状态必须保留；把长说明改成局部状态不等于删掉证据限制。
- 插入菜单已有分组；共享 Tab、按钮、输入、Disclosure 已可复用，不需要重造控件体系。
- 不以隐藏所有操作、机械移入更多菜单、给每块加卡片来替代信息架构调整。

### 实施顺序与验收标准

1. **先固定工作区骨架**：当前对象头、常用格式与上下文工具、正文/步骤主工作区、辅助面板归属。
2. **再调整四个附属页面**：步骤以编写/执行组织；关联以对象组织；属性统一入口；审阅围绕当前修订与内容。
3. **再处理状态与视觉**：空态动作、草稿/修订文案、历史默认、时间格式、列表密度和共享组件迁移。
4. **实际验收**：同步构建后在 Native 与 Electron 分别走新建→写作格式→步骤→关联→属性→保存→评论/复核→历史；
   检查明暗主题、窄窗、大字号、键盘与 VoiceOver，以及失败后保留数据和恢复路径。

最低通过条件：新笔记无需先打开“格式”就能使用常见格式；各主视图可识别当前笔记；
无记录时不堆批量/比较工具；项目属性无重复编辑模型；审阅清楚显示所针对修订；
关键约束保持可见但不支配主工作区；截图、运行包和源码证据对应。

### 本次边界与后续覆盖

本次覆盖真实 Native 浅色窗口的五个主视图、四个审阅子页、格式与插入菜单；
对步骤有数据、属性重复入口等明确标注源码证据。没有建立任何科学或业务复核结论。
没有修改用户数据来制造示例，也未运行与文档审查无关的测试套件。

不能声称穷尽所有专业块状态。以下必须在实施后的独立样例中补查：非空步骤与材料/参数，
表格公式与选区、化学/图像/附件、MyST/ipynb、App Canvas 执行及过期来源、AI 提案差异、
导入/打印/导出、加载与失败恢复、深色/窄窗/缩放、完整键盘和屏幕阅读器、Electron/签名安装包。
本次没有以旧审查截图或既有测试通过记录替代这些验收。


## 2026-11-12：修复与独立复查

用户补充约束：删掉无必要的次级标签、描述和重复微文案；用布局表达操作。
后续页面修改同样遵循这些原则。空白页只保留新建和导入，不再陈列标题、介绍、刷新和排序。

### 最终迁移

| 审计项 | 原呈现 → 当前呈现 | 保持的行为 |
| --- | --- | --- |
| NB-01–03 | 默认隐藏格式、步骤格式折叠 → 常用格式直接显示；低频格式进真正菜单 | 选区、快捷键、色彩、列表和链接编辑 |
| NB-04–06 | 多层标题/导航/命令 → 桌面一行文档头、一行上下文工具栏；只保留笔记/步骤主视图 | 标题可编辑、保存修订、历史快照、视图切换 |
| NB-07 | 同名列表只显示修订 → 日期时间；同名条目补既有领域编号 | 草稿状态、列表筛选和排序 |
| NB-08–09 | 说明式步骤页 → 动作空态；编写步骤/执行进度；执行前材料参数直接可查 | 原有完成勾选、计时、步骤内容与文档历史，无新执行状态机 |
| NB-10–11 | 独立关系说明页 → 正文旁对象列表、直接添加和跳转、来源详情按需展开 | 固定来源身份、未验证状态、块定位 |
| NB-12–14 | 重复元数据页和属性弹窗 → 同一属性编辑器；研究项目关联在属性内直接可见 | 元数据即时草稿更新；Host 仍拥有项目关联授权 |
| NB-15–18 | 审阅页先展示身份/说明/空批量 → 正文旁审阅侧栏；设置和导出在菜单；有数据才显示筛选/批量 | 本地身份、修订锚点、复核确认、流程及审计记录 |
| NB-19–21 | 草稿/修订矛盾提示、r1/r1、原始路径 diff → 明确待生成修订、单版本详情、本地化时间及对象差异表 | 保存约束、固定版本比较、截断提示、原始详情 |
| NB-22 | 仅模型名称 → 保留分组及名称，按需悬停提供简短用途；不增加常驻说明段落 | 所有原有插入类型、文件导入和模板 |
| NB-23–24 | 大白板、私有按钮皮肤 → SDK Split/控件与语义表面；删除强制按钮背景/禁用/选中皮肤 | 明暗主题、控件焦点与共享交互状态 |
| NB-25 | Native AX 只有宿主 → 合并可见 WebView 子树，转发命中与焦点并回退宿主 | 原 GPUI 树与隐藏 WebView 状态 |
| NB-26 | 无实际构建标识 → 帮助内显示 JS/CSS 内容指纹，重建并同步 Native 安装目录 | 写作主界面不显示调试信息 |

最新用户反馈要求继续减少 header，已合并标题与保存状态，把笔记/步骤切换和编辑操作合在
同一上下文工具栏。条目编号和进行中状态在属性里；辅助面板用有可访问名称的图标入口。
窄窗口按组换行，帮助与更多格式不再占单独文字行。

共享组件变化：`SplitPane hidden` 隐藏渲染与分隔条，但声明仍参与初始宽度恢复。
Notebook 使用稳定 inspector id，更新 SDK 合同和真实消费者；不另造页面级分栏控件。

### 独立 subagent 复查

实现后创建了两个 subagent：Notebook UI/交互复查、Native AX 桥接复查。
第一轮发现并修复：步骤撤销/重做入口、差异对象名称、侧栏宽度恢复、执行模式命名/编辑边界；
Native 复查发现的命中与焦点转发遗漏也已修复。第二轮均未发现新的阻塞问题。

### 运行验证

- Notebook typecheck/build、根 `npm run check`：通过。
- Notebook 编辑器测试：110/110 通过。
- Notebook 浏览器端到端：7/7 通过，实际 SQLite 后端；包含格式、步骤/材料/参数、
  引用/属性、修订/评论/复核、表格/文件/科学内容、MyST/ipynb、诊断及明暗/窄窗场景。
- 新增 SDK 隐藏侧栏宽度恢复测试：通过，覆盖关闭、打开、调整及重新挂载。
- Electron：Host 保存计算表、回读修订，并把固定修订附加到 Chat 草稿：通过。
- Native Rust build：通过。实际 Native 已观察两行顶栏、常驻格式、正文旁审阅、
  宿主与 Notebook 完整 AX 子树、点击正文后的实际编辑器焦点。
- 最终 UI 内容指纹：`2f8ca01537ce`；安装目录同步该构建，Native 帮助菜单实际显示同一指纹。
- 修复截图：`/Users/phodal/.codex/visualizations/2026/11/12/01a1cd4f-915b-75e2-9e9f-8f012740e63d/notebook-fixes/`。
  自动化场景截图：`test-results/notebook/`。

验收边界：没有运行完整 VoiceOver 朗读/导航矩阵，也没有验证签名发行安装包或真实 AI
模型执行；这些不由 AX 枚举、构建通过或本地 UI 场景替代。不声称穷尽所有专业块组合。
本次未修改用户已有笔记正文或提交任何复核结论；自动化端到端的数据变更使用隔离测试数据。

## Selected writing layout — 2026-11-12

User selected the merged image: writing-first notebook list and continuous document,
with evidence details shown only after clicking a reference. Implement against the
existing Notebook owners and SDK components. Move title and compact format tools
into the document, keep revision persistence visible, and reuse the existing source
import, proposal review, provenance and source-opening controls in the inspector.
Do not change saved evidence identities or scientific acceptance semantics.

Implemented the selected layout with a compact formatting row, continuous document,
and contextual citation inspector. Existing reference editing/import/proposal controls
remain in the inspector; its close action and Escape return focus to the citation.
Procedure undo/redo and snapshot navigation remain available after the toolbar move.

Current verification: editor tests 111/111, Notebook typecheck/build and repository
checks passed. Browser inspection covered opening/closing references, keyboard return,
switching entries, saving/reloading an actual revision, 1549 × 1013 and 440 × 900
layouts, and dark theme. No console errors were observed. Data was isolated sample
data; no user notebook was edited. The local, git-ignored `design-qa.md` records the
comparison. Captures are under
`/Users/phodal/.codex/visualizations/2026/11/12/notebook-writing-layout/`.

The selected layout was not retested in Native/Electron or a signed installer. The
full automated browser suite was not rerun; earlier platform and suite results above
remain historical and do not establish acceptance of this new composition.
