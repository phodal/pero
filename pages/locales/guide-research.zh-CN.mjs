export default {
  workflows: {
    title: '科研工作流',
    label: '科研工作流',
    description: '从一份数据、一条论文结果或一组试验记录开始，核对输入、方法与执行证据，再把需要复查的内容保存下来。',
    sections: [
      {
        id: 'inspect-data',
        title: '从数据到研究笔记',
        body: `
          <p>下载六条合成记录，在 Data 中检查字段与重复行，筛选处理组并保存视图。接着在 Notebook 中另存你的方法、计算或结论。若要交接，记下数据版本与 SHA-256，并随笔记提供原始文件或可访问的来源。</p>
          <ul><li>跟做<a href="{{data}}#sample-walkthrough">六条记录的数据检视与绘图</a>。</li><li>跟做<a href="{{notebook}}#first-revision">第一条笔记修订</a>，或保存一条<a href="{{notebook}}#attach-evidence">可回查的证据</a>。</li></ul>`,
      },
      {
        id: 'recheck-a-result',
        title: '复核 Fisher 表 III 的一个数值',
        body: `
          <p>下面复核 Fisher（1936）表 III 的萼片长度组内平方和 <strong>19.1434 cm²</strong>。输入是表 I 的 100 个观测值，setosa 和 versicolor 各 50 个。按物种分别求均值与离均差平方和，再加总两组。自由度 98 用于解释表格，这项统计量不除以 98。</p>
          <ol>
            <li>将<a href="https://lgross.utk.edu/Math589Fall2020/RAFisher1936measurementsFlowerTaxa.pdf">这份大学托管的原始 PDF</a>下载并导入 Paper。打开阅读器，点击<strong>选择 Fisher 表 III 结果</strong>，应跳到 PDF 第 4 页（印刷页 181）的原始单元格。按钮依赖原始文件的 SHA-256，重新打印或重存的 PDF 会失去匹配。</li>
            <li>展开<strong>核对输入观测值</strong>，与 PDF 第 3 页（印刷页 180）的表 I 对照。扫描中 setosa 第 32 行是 <code>5.4</code>，文字识别可能得到 <code>6.4</code>。保留页面给出的默认绝对容差 <code>0.00005</code>，核对数据、统计口径与比较规则后点击<strong>冻结方案</strong>。</li>
            <li>点击<strong>确认并运行固定算术</strong>。选中本次尝试，检查执行状态、单个结果判定、独立数值核验和原文位置。历史验收的两组平方和为 <code>6.0882</code>、<code>13.0552</code>，独立精确总和 <code>95717/5000</code>，与论文值相差 <code>0 cm²</code>。</li>
            <li>点击<strong>导出独立交接 ZIP</strong>，解压到新目录。ZIP 含原始 PDF、人工核对的 CSV、冻结方案、运行记录和独立核验器。在解压目录执行下方命令。此检查只需要 Python 标准库，无需联网或模型账号。</li>
          </ol>
          <pre><code>python -I -S verify.py</code></pre>
          <p>预期退出码为 0。核验 JSON 应有 <code>count: 100</code>，精确结果的分子和分母分别为 <code>95717</code> 与 <code>5000</code>，单项判定为 <code>REPRODUCED</code>，整篇论文状态为 <code>NOT_ASSESSED</code>。如果运行环境与冻结方案不符，查看日志后恢复环境，或核对新环境并建立新方案。若计算完成却未满足容差，先核对输入与规则。重跑沿用同一规则并保存一条新的尝试记录。</p>
          <p>完整源文件摘要、实际执行与恢复证据见 <a href="https://github.com/phodal/pero/blob/master/docs/fitness/paper-fisher-reproduction.md">Fisher 案例验证记录</a>。</p>`,
      },
      {
        id: 'organize-a-project',
        title: '让研究材料回到同一个问题',
        body: `
          <p>在<a href="{{projects}}">研究项目</a>中写下待回答的问题，关联 Paper 论文、研究记录或实验。项目中显示的是原记录的摘要；打开时回到原 App。需要在报告中引用精确输入时，继续保留论文版本、Notebook 修订或试验编号。</p>`,
      },
      {
        id: 'control-experiment',
        title: '从候选方案到独立试验',
        body: `
          <p><strong>控制实验</strong>支持用 python-control 做控制器仿真，或用 ngspice 做限定的二阶有源低通仿真。打开实验前，先确认可用性面板显示实际求解器。ngspice 需要系统安装并能从桌面进程的 PATH 找到。</p>
          <ol><li>冻结系统、输入、指标、搜索场景和验收阈值。</li><li>运行有界候选搜索，对比基线与候选曲线，记录候选方案为何被选中。</li><li>锁定候选并运行最终场景，逐项检查结果、单位、约束和失败项。从实验的<strong>导出</strong>获取 JSON，把具体试验记录<a href="{{notebook}}#attach-evidence">附进笔记</a>。</li></ol>
          <p>有限采样窗内的结果需要按冻结规则解释。实物电路、无限时间稳定性和正式验收仍需各自证据。查看 <a href="https://github.com/phodal/pero/blob/master/apps/control-lab/README.md">Control Lab 的环境要求和验证边界</a>。</p>`,
      },
      {
        id: 'remote-compute',
        title: '准备一次远程计算',
        body: `
          <p>已获授权的 SSH 或 Slurm 环境可用于尝试内置 CPU 中点求积。提交前检查连接、固定参数和资源，提交后用同一次尝试的状态、日志和已收集产物核对结果。查看<a href="{{compute}}">环境与远程计算</a>的完整流程。</p>`,
      },
    ],
  },
  data: {
    title: '检查、绘制和交接数据',
    label: 'Data 数据',
    description: '按固定文件版本查看完整输入、检查字段与异常、生成图表，并保存能回到原记录的视图。',
    sections: [
      {
        id: 'sample-walkthrough',
        title: '跟做一个六条记录的例子',
        body: `
          <p>本节实测使用 <strong>macOS Apple Silicon Electron 发布包 v0.1.0-dev.20261112</strong>。从工作台侧栏打开<strong>数据（Data）</strong>，下载<a href="{{examples}}first-dataset.json" download>示例 first-dataset.json</a>。样本是合成数据，三列分别是 <code>condition</code>、<code>replicate</code> 和 <code>signal</code>。如果页面显示环境未就绪，选择<strong>准备环境（Prepare environment）</strong>，等到出现导入按钮。首次准备可能需要联网，之后的检视、绘图和导出在本地完成。</p>
          <ol>
            <li>选择<strong>导入数据（Add data）</strong>，选中下载的 JSON，类型保留为<strong>数据集（Dataset）</strong>，再点<strong>导入（Import）</strong>。此发布包会直接打开 <strong>Table</strong>，显示 <strong>Bytes matched</strong>、6 条记录和 3 个字段。</li>
            <li>在 <strong>Table</strong> 把 <strong>No filter</strong> 改为 <code>condition</code>，选择 <strong>Equals</strong>，输入 <code>treated</code> 后点 <strong>Apply</strong>。结果保留原始第 4–6 条的行号，<code>signal</code> 分别为 <code>1.3</code>、<code>1.4</code>、<code>1.5</code>。点击第 4 条右侧的 <strong>Source</strong>，会打开只读原始文件标签并选中该条记录。再点 <strong>Data</strong> 回到筛选结果。</li>
            <li>在 <strong>View name</strong> 输入 <code>Treated only</code> 并点击 <strong>Save view</strong>。界面会提示视图和检查结果已固定到这个版本。切到 <strong>Checks</strong>，检查范围仍是完整输入的 6 条记录，缺失字段、显式空值、空字符串和重复行计数均为 0。</li>
          </ol>
          <p>要绘制两组，回到 <strong>Table</strong> 点 <strong>Clear filter</strong>。切到 <strong>Chart</strong>，选择 <strong>bar</strong> 和 <strong>Current aggregation</strong>，把 <strong>Group by</strong> 设为 <code>condition</code>、<strong>Measure</strong> 设为 <code>signal</code>、<strong>Aggregate</strong> 设为 <strong>Sum</strong>。展开 <strong>Chart data (2)</strong>，应看到 <code>control</code> 合计 <code>3.0</code>、<code>treated</code> 合计 <code>4.2</code>。换成 <strong>Count</strong> 时两组各为 <code>3</code>。图表中的分组顺序可能与原始文件不同。</p>`,
      },
      {
        id: 'input-and-checks',
        title: '先确认数据类型与检查范围',
        body: `
          <p>表格检视支持 UTF-8 CSV、TSV、JSON 和 JSONL/NDJSON。文件导入上限为 10 MiB，单次检视最多 100,000 条记录和 256 个字段。表格分页显示完整文件的检查结果；未通过解析的文件会显示原因。</p>
          <ul>
            <li>CSV 和 TSV 的值默认按文本保留，适合 <code>001</code> 这类标识符。需要用数值筛选或聚合时，打开<strong>字段</strong>对该列使用 <strong>Preview number → Apply type</strong>。先查看失败样例；带货币符号、千位分隔符或首尾空格的文本需要先处理，失败值仍保留原文。</li>
            <li>JSON 区分缺失字段、<code>null</code> 与空字符串。检查报告的缺失与转换计数按单元格统计，重复按行统计。打开问题行会暂时停用表格筛选，通过 <strong>Return to analysis</strong> 返回之前的分析。</li>
            <li>给列填写单位仅影响视图标注。例如把 <code>cm</code> 改为 <code>mm</code> 时，数值保持原样。需要换算时保留换算规则和新数据版本。</li>
          </ul>`,
      },
      {
        id: 'versions-and-exports',
        title: '固定版本、保存视图和导出',
        body: `
          <ol>
            <li>要试验版本管理，把样例另存一份 <code>first-dataset-v2.json</code>，将 <code>{"condition":"treated","replicate":4,"signal":1.6}</code> 加为数组第 7 项。在当前条目的版本选择框旁点击 <strong>Add version</strong>，导入新文件。在 <strong>Table</strong> 应看到 v2 的 7 条记录。从资料库重新执行 <strong>Add data</strong> 会创建新条目，即使文件名相同。</li>
            <li>回到 <strong>Overview → Saved views</strong> 打开 <code>Treated only</code>，应恢复 <strong>v1 — first-dataset.json</strong> 和原来的 3 条匹配记录。重启工作台后实测仍可打开同一个视图，再次检视会重新核对原始内容。</li>
            <li>视图旁的 <strong>Export reference</strong> 会下载 JSON，包含 v1 的 SHA-256、<code>condition = treated</code> 筛选和针对 6 条原始记录的完整检查报告。请把原文件或可访问的来源随引用一起交接。可用 <strong>Export records</strong> 导出当前数据子集，用 <strong>Export chart JSON</strong> 导出图表。</li>
          </ol>
          <p>报告和导出保留来源位置与处理配置。Data 里的<strong>项目引用</strong>是归类字段，访问权限由实际文件或服务管理。需要建立研究项目的材料索引时，见<a href="{{projects}}">研究项目</a>。</p>`,
      },
      {
        id: 'troubleshoot-data',
        title: '数据打不开时怎么处理',
        body: `
          <ul><li><strong>图表只有 treated。</strong>实测保留筛选时，图表只包含处理组。回到 <strong>Table</strong> 点 <strong>Clear filter</strong>，确认显示 6 行且没有勾选行，再回图表。</li><li><strong>缺失或已变化。</strong>记录仍可查。恢复与登记摘要一致的原始文件，或显式添加新版本并建立新视图。</li><li><strong>数字筛选没有预期结果。</strong>先查字段解释和转换失败，再查筛选范围。精确的数值和原始文本分别保留。</li><li><strong>模型文件没有表格。</strong>Data 记录文件来源和版本。模型权重的加载和推理需要相应执行环境与方法。</li><li><strong>归档后磁盘空间未减少。</strong>归档将条目移到<strong>已归档</strong>，仍保留版本和视图，并可恢复。</li></ul>
          <p>查看 <a href="https://github.com/phodal/pero/blob/master/apps/data/README.md#inspection-and-saved-views">Data 检视规则</a>及<a href="https://github.com/phodal/pero/blob/master/docs/fitness/data-workspace.md">工作台验证记录</a>。</p>`,
      },
    ],
  },
  notebook: {
    title: '记录方法与可复查的证据',
    label: 'Notebook 笔记',
    description: '用笔记修订保存正文、表格公式和证据引用。先完成一个小算例，再把论文引用或试验记录附到结论旁。',
    sections: [
      {
        id: 'first-revision',
        title: '创建第一条笔记修订',
        body: `
          <p>以下步骤在 Apple Silicon macOS 上，使用 <a href="https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261112">2026-11-12 Electron 预览包</a>及全新配置验证。</p>
          <ol>
            <li>在工作台侧栏打开 <strong>Notebook</strong>。此预览包已经安装并启用 Notebook。首次出现<strong>环境未就绪</strong>时，点击<strong>准备环境</strong>，等待<strong>新建笔记</strong>出现。首次准备可能需要下载 Python 和依赖。如果等待过久或安装失败，先展开<strong>安装日志</strong>查看进度或错误，再决定是否重试。</li>
            <li>选择<strong>新建笔记</strong>，填入标题 <code>表格与修订练习</code>，在正文记下输入 2 和乘数 6。新建笔记从<strong>修订 1</strong>开始。</li>
            <li>选择<strong>插入 → 电子表格</strong>。在 <code>A1</code> 输入 <code>2</code>，在 <code>B1</code> 输入 <code>=A1*6</code>。点击另一个单元格提交公式，离开 <code>B1</code> 后应看到计算值 <code>12</code>。</li>
            <li>点<strong>保存新修订</strong>，核对工具栏显示<strong>修订 2</strong>。再把 <code>A1</code> 改成 <code>3</code>，离开单元格后再次保存，核对<strong>修订 3</strong>及 <code>B1 = 18</code>。</li>
          </ol>
          <p>打开<strong>文件 → 修订历史 → 修订 2</strong>。只读视图应显示 <code>A1 = 2</code>、<code>B1 = 12</code>。查看旧修订时，侧栏仍显示当前保存的修订号。点击<strong>返回当前笔记</strong>回到修订 3。需要基于旧内容重新编辑时，再用<strong>恢复为草稿</strong>。</p>
          <p>要核对持久化，退出 Pero，重启后打开 Notebook 并选择已保存的笔记。实测仍为修订 3，<code>A1 = 3</code>、<code>B1 = 18</code>。</p>
          <p>如果保存冲突，先用<strong>导出草稿</strong>保留自己的版本，再查看已保存的最新修订后整理差异。加载最新修订会放弃当前草稿。</p>`,
      },
      {
        id: 'attach-evidence',
        title: '把结论与原始记录放在一起',
        body: `
          <ol>
            <li>在笔记写下一个具体发现，标明指标、数据范围、单位和不确定性。</li>
            <li>插入<strong>证据</strong>块。可粘贴已保存的 Paper 引用或段落链接。也可导入 Paper 报告 JSON，选择具体引用，然后附加快照。此处应保留原文摘录和对应的报告或位置标识。</li>
            <li>若要记录试验，在 Control Lab 导出证据 JSON。在 Notebook 插入<strong>实验引用</strong>，导入该 JSON，选择具体试验并附加快照。打开原 App 核对该尝试的输入、结果与检查。</li>
            <li>保存新修订。审阅时对照开发工作台中记录的笔记修订、来源版本和原文。原 App 新增结果后，历史笔记修订中的快照仍保持保存时的内容。</li>
          </ol>
          <p>笔记保存研究者选定的版本和证据，求解、来源更新与验证由原 App 持有。追问或复查时，可按<a href="{{paper}}#check-citations">原文回查</a>的方式核对关键主张。</p>`,
      },
      {
        id: 'export-and-share',
        title: '选对交付格式',
        body: `
          <ul>
            <li>完整交接选择<strong>文件 → 导出当前 JSON</strong>。实测 <code>Notebook.json</code> 中包含练习标题和原始公式 <code>=A1*6</code>。此格式保存文档与已记录的证据引用。需要交付准确的历史内容时，先打开相应修订再导出。导出当前笔记可包含尚未保存的改动。</li>
            <li>需要表名、数值和公式时，选<strong>文件 → 导出工作簿</strong>。发布包导出的 <code>Notebook.xlsx</code> 中，<code>A1 = 3</code>，<code>B1</code> 保留公式 <code>A1*6</code>，打开工作簿时会请求重新计算。需要笔记证据时用 JSON，交流正文可用 Markdown。</li>
            <li>需要 Agent 审阅时，先保存修订，再选<strong>文件 → 询问 Agent</strong>。实测打开的是引用已保存修订 3 的草稿。发送前核对草稿和引用，收到答复后回到保存版本及原证据复查。</li>
          </ul>
          <p>要检查 JSON 导出，点<strong>新建笔记</strong>旁的<strong>…</strong>，选择<strong>导入笔记 JSON</strong>。实测导出文件生成一条独立笔记，从<strong>修订 1</strong>开始，仍是 <code>A1 = 3</code>、<code>B1 = 18</code>。原笔记仍保留在修订 3。</p>
          <p>如果浮动对话挡住<strong>文件</strong>菜单底部，用对话标题栏的减号按钮<strong>收起对话</strong>，或者点击<strong>停靠对话</strong>。重新打开<strong>文件</strong>即可选<strong>导出工作簿</strong>。</p>
          <p>工作表每页上限为 200 行、50 列，支持标量公式和同一笔记内的跨工作表引用。外部工作簿链接、网络函数和动态数组溢出不在支持范围内。详情见 <a href="https://github.com/phodal/pero/blob/master/apps/notebook/README.md#data-and-format-boundaries">Notebook 格式说明</a>与<a href="https://github.com/phodal/pero/blob/master/docs/fitness/notebook.md">工作台验证记录</a>。</p>`,
      },
      {
        id: 'publication',
        title: '从已保存修订编译文稿',
        body: `
          <p>使用当前源码构建跟做 MyST 出版流程。需要已有的 MyST 文稿、可用的 Tectonic 引擎及预备好的包缓存。先保存包含文稿块的修订，在该块选<strong>将已保存修订编译为 PDF</strong>。在构建历史中检查确切修订号、编译日志和输出，再预览或下载。上面的发布包教程验证了工作簿与 JSON 导出。</p>
          <p>修改数据或生成代码后，先重新生成并更新过期图件，再保存新修订。失败记录保留诊断和输入，上一份成功 PDF 仍可在历史中打开。编译成功只说明文稿能生成 PDF，科学结论依然需要复核。可跟做<a href="https://github.com/phodal/pero/blob/master/docs/fitness/notebook-publication.md">带编译命令和预期结果的 Fisher 文稿示例</a>。</p>`,
      },
    ],
  },
  projects: {
    title: '用研究项目组织材料与对话',
    label: '研究项目',
    description: '围绕一个研究问题保存目标和 App 材料引用，把同一项目的对话、审批与产物留在可回看的记录里。',
    sections: [
      {
        id: 'create-project',
        title: '创建可继续的研究项目',
        body: `
          <ol><li>打开侧栏<strong>项目</strong>，点击<strong>新建研究项目</strong>，输入项目名称和研究目标，例如“复核 Fisher 表 III 的组内平方和并逐项记录输入”。</li><li>若还要使用项目文件、工作区任务或委派文件检查，填入本地目录的完整路径。只整理 App 里的研究材料时可以留空。</li><li>点击<strong>保存项目</strong>。重新打开该项目，应能看到同一个目标和材料区。之后用<strong>编辑目标</strong>更新研究问题。</li></ol>`,
      },
      {
        id: 'link-materials',
        title: '关联材料并回到来源',
        body: `
          <ol><li>先在 <a href="{{paper}}">Paper</a> 保存一篇论文或研究记录，或在 Control Lab、Lab 保存一项实验。</li><li>在项目右侧的<strong>概览</strong>找到<strong>资料与实验 → 关联已有记录</strong>，选择已启用的来源 App 与具体记录。也可从<strong>项目视图</strong>进入资料页。</li><li>点击关联记录确认能回到来源 App。如出现<strong>原记录已变化</strong>，先核对当前原记录再点<strong>更新关联版本</strong>。若记录不可用，项目仍保留引用，可以恢复来源或<strong>解除关联</strong>。</li></ol>
          <p>项目保存的是关联关系和观察到的版本。修改或解除关联只改变项目记录。精确交接请同时保留来源 App 的版本号、内容摘要或试验归档。</p>`,
      },
      {
        id: 'project-agent',
        title: '让 Project Agent 处理一个有界任务',
        body: `
          <p>当前源码包含 Project Agent。2026-11-12 的开发预览包发布时尚无该入口。准备<a href="{{agents}}">可用的 Agent 和工具</a>及一个本地目录，打开已保存的研究项目。点<strong>开始项目对话</strong>，在中央的主 Agent 对话中提交一个可检查的小任务。</p>
          <blockquote><p>请委派一次只读检查，列出本项目目录用于组内平方和复核的输入文件，列出各自路径和 SHA-256。保留原文件，把未核对的项目单列。</p></blockquote>
          <ol><li>若主 Agent 创建子会话，在侧栏打开它，检查任务范围和审批卡。按实际命令决定是否允许。</li><li>展开子会话的工具记录，查看实际命令、退出码与输出，检查是否只读取了预期的材料。Git 项目的委派工作保存在独立工作树中。需要合并时，先检查实际改动。</li><li>从项目 Agent 的控件选择<strong>汇总证据与结果</strong>，在主 Agent 对话中阅读依据、缺口和原始会话。在有用回复的消息操作中保存产物，再从项目的产物视图回查。</li></ol>
          <p>刷新或重启后可从项目回到原会话、历史与已保存产物。尚未完成的指令需要人工判断后继续。读取失败时先刷新，保留原会话。开发版已用脚本化模型和实际本地执行验证上述流转，真实模型结果与科学验收请单独核对。</p>
          <p>查看 <a href="https://github.com/phodal/pero/blob/master/docs/fitness/research-projects.md#merge-review-verification--2026-11-14">Project Agent 交互与重启验证</a>。</p>`,
      },
    ],
  },
};
