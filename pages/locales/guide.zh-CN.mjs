export default {
  overview: {
    title: 'Pero 文档',
    label: '概览',
    description: '在桌面工作台里阅读论文、检视数据、运行科研 App，并沿着记录回查证据。第一次用 Pero，可以先导入一篇 PDF。',
    sections: [
      {
        id: 'where-to-run',
        title: '选择运行方式',
        body: `
          <p><strong>Electron 桌面版</strong>适合从自己的论文和数据开始。阅读原文、保存标注和检视数据均可在本机完成；需要 Agent 时再配置模型服务。</p>
          <p><a href="../#distributed">官网交互演示</a>可直接在浏览器里体验任务分配与结果复核。演示使用预设数据和模拟角色；跟随本文档的研究步骤请使用桌面工作台。</p>`,
      },
    ],
  },
  install: {
    title: '安装与启动',
    label: '安装与启动',
    description: '选择适合操作系统的 Electron 开发预览版，或按开发指南从源码启动。',
    sections: [
      {
        id: 'download',
        title: '下载桌面版',
        body: `
          <p>打开 <a href="https://github.com/phodal/pero/releases">GitHub Releases</a>，查看所选版本的说明和下载文件。下面的包名对应 <a href="https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261112">2026-11-12 Electron 开发预览版</a>。</p>
          <ul>
            <li><strong>macOS Apple Silicon</strong>。打开 <code>Pero-macos-arm64.dmg</code>，将 <code>Pero.app</code> 拖入「应用程序」，然后从那里打开。</li>
            <li><strong>Windows x64</strong>。完整解压 <code>Pero-windows-x64.zip</code>，打开解压目录中的 <code>Pero.exe</code>。</li>
            <li><strong>Linux x64</strong>。解压 <code>Pero-linux-x64.tar.gz</code>，在解压后的程序目录运行 <code>./pero</code>。系统需提供 Electron 所需的桌面库。</li>
          </ul>
          <p>macOS 包使用 ad-hoc 签名，尚未经公证。Windows 和 Linux 包未签名。下载后可用同一版本的 <code>SHA256SUMS</code> 核对文件摘要。如遇系统启动限制，请查看发布说明。</p>
          <p>同一版本还提供 macOS Apple Silicon 的 <strong>Pero Native</strong>，使用独立配置。文档里的首次体验以 Electron 工作台为准。源码文档中的功能可能晚于你下载的版本，具体以该版本的说明为准。</p>`,
      },
      {
        id: 'prepare-environment',
        title: '准备 App 环境',
        body: `
          <ol>
            <li>打开 Pero，在侧栏选择<strong>论文</strong>。遇到环境提示时，选择<strong>准备环境</strong>。</li>
            <li>等待<strong>环境已就绪</strong>。首次准备可能需要联网下载 uv、CPython 3.12 和 App 的固定依赖。失败时先查看错误详情，再重试。</li>
            <li>准备完成后，继续<a href="{{paper}}">阅读并标注第一篇论文</a>。导入和阅读本地 PDF 无需模型账号或 API Key。</li>
          </ol>
          <p>已准备好的虚拟环境和离线使用见 <a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#python-environments-and-advanced-overrides">Python 环境设置</a>。</p>`,
      },
      {
        id: 'from-source',
        title: '从源码启动',
        body: `
          <p>先按<a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#desktop-from-source">开发指南</a>准备 Node.js、Go、Rust（含 Wasm 目标）、Electron 和固定版本的 GPUI Kit，再在仓库根目录执行下面的命令。</p>
          <pre><code>npm run dev:paper</code></pre>
          <p>这个命令构建并启动独立开发配置中的 Paper。打开完整工作台用 <code>npm run dev</code>。本地阅读和 App 计算无需启动独立的 Go 控制面或 PostgreSQL。</p>`,
      },
    ],
  },
  paper: {
    title: '阅读第一篇论文',
    label: '阅读第一篇论文',
    description: '导入 PDF，保存一处原文标注。需要进一步分析时，再发送问题并逐条回查回答中的引用。',
    sections: [
      {
        id: 'import-and-highlight',
        title: '导入并保存标注',
        body: `
          <p>准备一份能选中文字的 PDF。首次打开请先完成<a href="{{install}}#prepare-environment">环境准备</a>。</p>
          <ol>
            <li>打开侧栏的<strong>论文</strong>，选择<strong>添加论文 → PDF → 导入 PDF</strong>，或把文件拖进 Paper 窗口。</li>
            <li>在阅读器选中一句原文，点击<strong>高亮</strong>。通过 PDF 的右键菜单打开<strong>标注</strong>，检查刚保存的位置和选文。</li>
            <li>返回文库再打开这篇论文，确认标注仍能回到原页。Paper 将标注单独保存，保留导入时的原始 PDF。</li>
          </ol>
          <p>这一步无需模型。选文与全文检索依赖 PDF 的文字层。若无法选中文本，可用 PDF 菜单的<strong>截取图片</strong>保留需要核对的图表位置。</p>`,
      },
      {
        id: 'ask-agent',
        title: '用选段向 Agent 提问',
        body: `
          <ol>
            <li>使用内置 Agent 时，在<strong>设置 → 内置 Agent</strong>配置 API 地址、模型和 Key。外部 Agent 使用各自的登录方式。检索 PDF 全文需要支持 HTTP MCP 的 Agent。参见 <a href="https://github.com/phodal/pero/blob/master/desktop/README.md#agents-and-conversations">Agent 配置说明</a>。</li>
            <li>在阅读器点击<strong>询问 AI</strong>，或选中文字后点击<strong>讨论选段</strong>。检查草稿和附带的选段，再主动发送。模型服务可能收到问题和选定的原文。</li>
          </ol>
          <blockquote><p>作者怎么描述这项方法的适用条件？请给出原文引用，并列出还需要核对的限制。</p></blockquote>`,
      },
      {
        id: 'check-citations',
        title: '回查引用和原文',
        body: `
          <ol>
            <li>报告保存后，在阅读器工具栏点击时钟图标<strong>研究记录</strong>，打开报告。</li>
            <li>点击一条引用，查看原文位置和上下文。有多个匹配时，选择与该条主张相关的位置。</li>
            <li>对照主张、原文和报告里尚待核对的问题。点击<strong>从此处追问</strong>可以准备下一轮问题，再由你发送。</li>
          </ol>
          <p>引用定位可帮助核对原文。主张是否得到支持、方法能否复用，仍需研究者判断。</p>`,
      },
      {
        id: 'troubleshoot',
        title: '常见卡点',
        body: `
          <ul>
            <li><strong>Agent 启动或登录失败。</strong>检查所选 Agent、凭据和会话里的错误。完成登录后，检查并重发问题。</li>
            <li><strong>全文检索没有命中。</strong>换成论文使用的术语，缩小问题范围，或在原文中选定片段。空检索结果只表示本次没有匹配。</li>
            <li><strong>研究停在报告提交前。</strong>打开保留的研究记录，查看已有发现和待核对项，再选择<strong>继续研究</strong>。</li>
          </ul>
          <p>更多阅读与检索方式见 <a href="https://github.com/phodal/pero/blob/master/apps/paper-agent/README.md#pdf-reading">Paper 使用说明</a>。</p>`,
      },
    ],
  },
  workflows: {
    title: '科研工作流',
    label: '科研工作流',
    description: '检视一个数据版本、复核一个已发表的数值，或用研究项目整理材料。以下功能以相应源码版本和验证记录为准。',
    sections: [
      {
        id: 'inspect-data',
        title: '检视一个数据版本',
        body: `
          <ol>
            <li>将<a href="https://raw.githubusercontent.com/phodal/pero/master/docs/examples/first-dataset.json">六条合成记录</a>保存为 <code>first-dataset.json</code>。在<strong>数据</strong>中选择<strong>导入数据</strong>，选择文件并确认导入。</li>
            <li>打开该数据集并选择<strong>查看数据</strong>，确认有 6 条记录和 3 个字段。在来源信息中核对所选版本和 SHA-256。</li>
            <li>需要记录筛选或图表设置时，保存视图。更新数据时，用已有条目的<strong>添加版本</strong>追加文件。在资料库再次导入同名文件会创建新条目。</li>
          </ol>
          <p>表格检视可以在本机完成，无需模型。支持 UTF-8 CSV、TSV、JSON 和 JSONL，导入上限为 10 MiB。详见 <a href="https://github.com/phodal/pero/blob/master/apps/data/README.md#inspection-and-saved-views">Data 版本、来源与检查规则</a>。</p>`,
      },
      {
        id: 'recheck-a-result',
        title: '复核 Fisher 论文中的一个数值',
        body: `
          <ol>
            <li>在 Paper 导入<a href="https://lgross.utk.edu/Math589Fall2020/RAFisher1936measurementsFlowerTaxa.pdf">项目复核使用的 Fisher（1936）原始 PDF</a>。匹配该文件后，工具栏会提供 Fisher Table III 的结果选择入口。</li>
            <li>查看原表、100 条输入测量值、计算方法和比较规则。冻结协议后，显式确认并运行一次。对照原文中的 <strong>19.1434 cm²</strong>、计算值、差值和独立数值检查。</li>
            <li>导出证据 ZIP 并解压，在解压目录运行下方命令。独立检查只使用 Python 标准库，无需联网或调用模型。</li>
          </ol>
          <pre><code>python -I -S verify.py</code></pre>
          <p>记录中的 <code>REPRODUCED</code> 对应该表的单个数值。整篇论文仍为 <code>NOT_ASSESSED</code>（未评估）。查看 <a href="https://github.com/phodal/pero/blob/master/docs/fitness/paper-fisher-reproduction.md#issue-77-closure-review--2026-11-11">Fisher 案例的输入与验收记录</a>。</p>`,
      },
      {
        id: 'organize-a-project',
        title: '把材料关联到研究项目',
        body: `
          <p>选择<strong>新建研究项目</strong>，填入项目名称和研究目标，可以按需关联本地目录。打开<strong>资料与实验 → 关联已有记录</strong>，选择已启用的 App，再关联保存的论文、研究记录或实验。</p>
          <p>项目保存指向原记录的引用。之后从项目打开材料时，仍由对应 App 展示。若原记录版本有变化，可查看原记录后更新关联。详见<a href="https://github.com/phodal/pero/blob/master/docs/fitness/research-projects.md">研究项目的功能与验证</a>。</p>`,
      },
      {
        id: 'remote-compute',
        title: '准备一次远程计算',
        body: `
          <p>有已授权的 SSH 或 Slurm 环境时，可在<strong>科学计算</strong>中选择连接，探测后准备内置的 CPU 中点求积方法。检查目标、固定参数和所需资源后，再显式批准提交。</p>
          <p>用原尝试查看状态与日志，收集已保存的产物。当前验证覆盖实际 SSH 回环和 Slurm 测试替身。真实 Slurm 站点和其他科研方法需分别验收。入口和限制见 <a href="https://github.com/phodal/pero/blob/master/apps/compute/README.md">Compute 使用说明</a>和<a href="https://github.com/phodal/pero/blob/master/docs/fitness/remote-compute.md">验证记录</a>。</p>`,
      },
    ],
  },
  reference: {
    title: '概念与参考',
    label: '概念与参考',
    description: '了解数据和执行由谁管理，以及怎样核对功能在什么版本、平台和条件下通过了验证。',
    sections: [
      {
        id: 'concepts',
        title: '工作台中的对象',
        body: `
          <dl>
            <dt>研究项目</dt><dd>保存研究目标和 App 记录引用，可按需关联本地目录。</dd>
            <dt>App</dt><dd>提供一个领域的界面、方法与数据，例如 Paper 保存论文与研究报告，Data 保存数据版本。</dd>
            <dt>Host 与 Agent 会话</dt><dd>Host 管理本机 App、凭据以及 Agent 的会话、审批和取消。使用工具前，可在对话里查看待审批的请求。</dd>
            <dt>控制面与 Worker</dt><dd>可选控制面协调共享任务，独立 Worker 在所配置的执行环境中处理任务。相关服务需要单独部署和授权。</dd>
          </dl>
          <p>完整的职责与接入状态见<a href="https://github.com/phodal/pero/blob/master/docs/ARCHITECTURE.md">架构文档</a>和 <a href="https://github.com/phodal/pero/blob/master/apps/README.md">App 开发说明</a>。</p>`,
      },
      {
        id: 'data-and-cost',
        title: '数据、权限与费用',
        body: `
          <ul>
            <li>App 领域数据保存在运行它的机器上。调用模型、文献检索、MCP 连接器或共享任务服务时，相应外部服务可能收到选定的数据。</li>
            <li>本地插件和 App 后端运行受信任的代码。打开敏感材料前，检查安装来源、会话权限和提交的内容。</li>
            <li>模型和远程算力由各自的提供方计费。费用以提供方记录为准，研究操作次数或运行时间限制只约束工作流。</li>
          </ul>`,
      },
      {
        id: 'verification-and-help',
        title: '验证范围与问题反馈',
        body: `
          <p><a href="https://github.com/phodal/pero/blob/master/docs/fitness/README.md#acceptance-levels">质量门禁</a>记录各项功能的源码检查、真实桌面、外部服务和发布包验证。复核科学结果时，还需检查来源、运行输入、比较规则和独立验收。计划中的跨团队同步与共享研究记忆见<a href="https://github.com/phodal/pero/blob/master/ROADMAP.md">路线图</a>。</p>
          <p>反馈问题时，请在 <a href="https://github.com/phodal/pero/issues">GitHub Issues</a> 附上版本或源码提交、平台、Electron 或 Native、复现步骤和可分享的错误信息。代码贡献从<a href="https://github.com/phodal/pero/blob/master/CONTRIBUTING.md">贡献指南</a>开始。</p>`,
      },
    ],
  },
};
