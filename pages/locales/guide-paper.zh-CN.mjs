export default {
  title: '阅读与研究论文',
  label: '论文阅读与研究',
  description: '用一篇公开 PDF 练习导入、标注和本地检索，再把具体问题交给 Agent。报告保存后，逐条回查原文、记录缺口并导出证据。',
  sections: [
    {
      id: 'release-environment',
      title: '使用 11 月 12 日预览包时先看这里',
      body: `
        <p>我们用 <a href="https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261112">v0.1.0-dev.20261112</a> 的 macOS Apple Silicon Electron 包跟做。在干净配置中，点击<strong>准备环境</strong>后，页面停在<strong>环境未就绪</strong>。Host 找不到必需插件 <code>paper-autoresearch</code>。这个插件未打进 DMG，Python 安装也还没有开始。</p>
        <p>本次验证从相同发布标签取出该插件，通过包内 Host 的 <code>plugininstall</code> 安装到隔离配置。重开原应用，点击<strong>准备环境</strong>后，依赖安装完成，论文库自动打开。<a href="https://github.com/phodal/pero/blob/v0.1.0-dev.20261112/apps/README.md#agent-plugins">发布标签的 Host 插件安装说明</a> · <a href="https://github.com/phodal/pero/tree/v0.1.0-dev.20261112/apps/paper-agent/agent-plugins/paper-autoresearch">同版本插件</a></p>`,
    },
    {
      id: 'import-and-highlight',
      title: '导入第一篇论文并保存标注',
      body: `
        <p>打开桌面工作台的<strong>论文</strong>。若首次启动提示准备环境，先完成<a href="{{install}}#prepare-environment">环境准备</a>。下面用公开预印本 <a href="https://arxiv.org/abs/2603.28052v1">Meta-Harness（arXiv:2603.28052v1）</a>演示。你也可以使用任意有权访问、能选中文字的 PDF。</p>
        <ol>
          <li>下载<a href="https://arxiv.org/pdf/2603.28052v1">固定版本的示例 PDF</a>。在文库选择<strong>添加论文 → PDF → 导入 PDF</strong>，或者把文件拖入 Paper 窗口。导入后会打开保存的 PDF。重复导入字节相同的文件会重新打开原记录。</li>
          <li>在第一页摘要中找到 <code>agentic proposer</code> 所在句，选中同一页的文字。需要时填写<strong>备注（可选）</strong>，例如「作者让候选生成器访问哪些历史信息？」再点<strong>高亮</strong>。</li>
          <li>在 PDF 区域右键打开<strong>标注</strong>，检查引文、页码和备注。回到文库重新打开论文，再点标注的页码。应跳回保存的原页和区域。</li>
        </ol>
        <p><strong>预期结果。</strong>将文件存为 <code>Meta-Harness-v1.pdf</code> 时，文库显示 <code>Meta-Harness-v1</code>。阅读器页码为 <strong>1 / 26</strong>，标注栏有一条指向第 1 页的记录。重新打开再点它，应回到摘要中的高亮区域，保留已填写的备注。这个过程无需模型账号或 API Key。</p>`,
    },
    {
      id: 'reading-and-notes',
      title: '阅读版本、截取图表和整理标注',
      body: `
        <ul>
          <li><strong>PDF</strong>用于核对作者原始分页、图表与引文。要摘录整页，在 PDF 右键菜单选<strong>本页文本</strong>。文字选择依赖原文件的文字层。</li>
          <li><strong>阅读 / Read</strong>适合浏览导入的文本或已准备的结构化全文。对支持的 arXiv 来源，可核对固定版本并批准下载官方 HTML，保留章节、公式和表格的结构。HTML 与 PDF 各自记录来源位置。</li>
          <li><strong>TeX</strong>用已批准下载的同版本源码生成阅读预览。当前编译路径需要 macOS 与 Tectonic，第一次可能需要下载依赖。预览和原始 PDF 有各自的身份与页码。<a href="https://github.com/phodal/pero/blob/master/apps/paper-agent/README.md#typeset-tex-reading">TeX 阅读与诊断</a></li>
        </ul>
        <p>遇到扫描页、公式或图表，使用<strong>截取图片</strong>在原页拖出范围，确认后保存图像标注。再到<strong>标注 → 加入矩阵</strong>填写字段，例如「样本量」或「评价指标」。矩阵中的页码可以回到原图或原文区域。图像标注记录的是位置和图像，数值和单位仍需对照表头、图注和正文。</p>`,
    },
    {
      id: 'find-sources',
      title: '找回已保存的证据，再拓展文献',
      body: `
        <h3>在自己的文库中查找</h3>
        <p>返回文库，在<strong>搜索本地原文</strong>中输入 <code>agentic proposer</code> 并提交。测试返回 1 篇论文、12 个片段。首条结果指向第 14 页的参考文献。向下找到包含摘要原文的 <strong>PDF 第 1 页</strong>结果，点击后确认阅读器回到 <strong>1 / 26</strong>。展开<strong>快照详情</strong>可核对原文和文件摘要。检索可在本地完成，无需启动 Agent。</p>
        <h3>从公开服务找新来源</h3>
        <ol>
          <li>用<strong>添加论文</strong>搜索标题、关键词，或读取已知论文 ID。所选公共文献服务会收到搜索词。</li>
          <li>核对标题、作者、日期与版本后再保存。确认正在读的是<strong>全文、摘要或第三方解读</strong>，需要判断方法、数据或指标时再打开对应的原始全文。</li>
          <li>在已有论文上点<strong>继续发现</strong>，选择<strong>相关论文、参考文献</strong>或<strong>后续引用</strong>。如需确认匹配，核对 OpenAlex 候选的标题、作者与年份。保存候选可供以后打开，相关性与引用关系只用于筛选线索。</li>
        </ol>
        <p>如果手上是一个包含论文、代码和数据链接的公开页面，可在<strong>添加论文 → 链接导入</strong>检查 HTTPS 链接，先保存引用。下载由你另行选择和确认。<a href="https://github.com/phodal/pero/blob/master/apps/paper-agent/README.md#import-a-research-url">链接导入与资源边界</a></p>`,
    },
    {
      id: 'ask-agent',
      title: '发送一个能回到原文的问题',
      body: `
        <ol>
          <li>按<a href="{{agents}}">Agent 配置指南</a>准备可用的模型。在内置 Agent 中填写 API 地址、模型和 Key，或完成外部 Agent 的登录。检索 PDF 全文需要支持 HTTP MCP 的 Agent。</li>
          <li>在示例论文的选文操作中点<strong>讨论选段</strong>，或者从阅读器点<strong>询问 AI</strong>。在草稿里核对问题和附带选段，移除无关内容。隐藏对话可回到全宽阅读，<kbd>Cmd</kbd>/<kbd>Ctrl</kbd>+<kbd>J</kbd> 可切换面板。</li>
          <li>若问题需要查阅选段以外的段落，在<strong>研究设置</strong>中选择 1–5 篇已保存 PDF，开启<strong>检索 PDF 全文</strong>。发送时固定问题和文件版本。提交后可以在共享会话中查看进度和审批请求。</li>
        </ol>
        <blockquote><p>在 Meta-Harness v1 中，候选生成阶段可以访问哪些历史信息？作者如何区分搜索过程中的反馈与保留评估？分别给出可回查的原文引用，并标出当前证据无法回答的部分。</p></blockquote>
        <p>这个提问应产生可逐条核对的引文和局限。检查模型是否分别给出了候选历史和评估设置的来源。某部分没有命中时，用论文中的术语另问一小步。发送前确认你有权将所选文本交给提供方。</p>
        <p><strong>实测卡点。</strong>这个发布包提供的 <strong>6.2 Sol</strong> 在本次 Codex 的 ChatGPT 登录下被服务端拒绝。遇到类似提示时，从输入框旁的模型菜单换成当前账号可用的模型，再重新发送。测试切换到 <strong>5.6 Sol</strong> 后才开始读取论文。</p>`,
    },
    {
      id: 'check-citations',
      title: '回查引用、修订比较结果并导出',
      body: `
        <ol>
          <li>回到 Paper 文库，打开侧栏<strong>研究结果</strong>，选择对应问题并检查<strong>报告已保存</strong>状态。只看到聊天回复时，也到这里确认是否已有持久化报告。</li>
          <li>在报告点击引用。PDF 引文会打开研究所用的保存版本并定位原文。如果<strong>引用证据</strong>列出多个匹配，逐项打开，选择实际支持或限制主张的那一处。查看前后文、实验条件和单位。</li>
          <li>有<strong>证据矩阵</strong>时，逐格检查比较定义、值和引文。需要修订时点<strong>修改单元格</strong>并保存修改理由。原始报告保留，人工修改作为单独修订记录。</li>
          <li>用<strong>导出 Markdown</strong>交付可读报告，用<strong>导出 JSON</strong>保留结构化引用、输入版本和矩阵修订。也可以用<strong>打印 / PDF</strong>生成可阅读副本。日后重新打开已保存的报告无需再次调用模型。</li>
        </ol>
        <p><strong>预期结果。</strong>本次使用 5.6 Sol 的报告保存了 3 节、13 条证据。第一条编号引用把阅读器定位到 <strong>4 / 26</strong>，高亮第 4 页的方法段。我们重启发布包后重新打开同一报告，再导出 Markdown 和 JSON，两个文件均保留报告标题，JSON 也保留了章节、原文片段和来源。应用仍显示「结论未验证」。</p>
        <p>精确匹配确认引文能定位到已保存的来源。科学复核还要判断该原文是否支持这条主张，是否存在冲突，是否需要重算。<a href="{{workflows}}#recheck-a-result">跟做 Fisher 数值复核</a>可以完整走一遍独立验算和证据交接。</p>`,
    },
    {
      id: 'continue-research',
      title: '继续未完成的研究或提出追问',
      body: `
        <dl>
          <dt>研究尚未提交报告</dt>
          <dd>打开对应研究记录，查看<strong>已有发现</strong>与<strong>尚待核对</strong>。已保存的研究可以用<strong>继续研究</strong>从保留的证据和缺口继续。运行中的请求用原会话检查状态。</dd>
          <dt>报告已保存，需要补一项证据</dt>
          <dd>在报告点<strong>从此处追问</strong>，检查草稿再发送。例如「单独找评估部分交代保留数据的那段原文」。这是一次新提问，会检索自己的来源证据，之前的回答只提供对话背景。</dd>
          <dt>需要换论文或换一个问题范围</dt>
          <dd>准备新的研究输入。保留旧问题、版本和结论，比较两份记录的来源与缺口。导入新版 PDF 后，旧报告仍应定位到当时固定的版本。</dd>
        </dl>
        <p>示例论文已有真实 Agent 和桌面流程验收。验收记录也列出了在宽泛问题下未覆盖的部分。<a href="https://github.com/phodal/pero/blob/master/docs/fitness/paper-harness-journey.md#real-agent-acceptance">示例验收与检索范围</a></p>`,
    },
    {
      id: 'research-plans',
      title: '用自动研究组织有边界的文献调查',
      body: `
        <p><strong>自动研究</strong>适合围绕一个问题做多轮筛选和阅读。它使用配置好的内置 Pero Agent，需要可用的工作目录。</p>
        <ol>
          <li>点击<strong>新建计划</strong>，选 1–5 篇起始论文。写清研究范围和纳入、排除标准。例如只纳入报告了明确评价条件且能找到原文的工作，将只有摘要的候选单列。</li>
          <li>选择<strong>可读取的来源</strong>。从<strong>仅已保存原文</strong>开始可以限制资料范围。需要新文献时，按版本支持选择公开 PDF，或包含固定版本官方 HTML 的策略。</li>
          <li>检查轮数、检索、阅读、模型请求和时限，点<strong>保存并核对计划</strong>。核对后再点<strong>启动研究</strong>。分轮查看报告、来源和<strong>尚待解决的问题</strong>。</li>
          <li>暂停后可继续同一个 Run，已消耗的额度会保留。达到时限、额度耗尽或明确停止后，先查看保留的证据，再决定是否开新计划。</li>
        </ol>
        <p>每轮结果仍<strong>待人工复核</strong>。把已读原文、仅发现的候选、下载失败的缺口分开检查。流程额度控制操作范围，费用以模型提供方记录为准。<a href="https://github.com/phodal/pero/blob/master/docs/fitness/paper-autonomous-research.md#product-behavior">自动研究的验证范围</a></p>`,
    },
    {
      id: 'troubleshoot',
      title: '常见问题',
      body: `
        <dl>
          <dt>导入失败或 PDF 打不开</dt>
          <dd>确认下载的是有效 PDF。上传限 16 MiB，文档限 500 页。若提示缺少解析依赖，回到<a href="{{install}}#prepare-environment">环境准备</a>检查安装结果，再重新打开论文。</dd>
          <dt>看得到页面，无法选字</dt>
          <dd>用<strong>本页文本</strong>检查是否有文字层。扫描页可先用<strong>截取图片</strong>保留位置，或导入带文字层的版本。本地全文检索不对扫描件自动做 OCR。</dd>
          <dt>全文问题没有查到材料</dt>
          <dd>确认 PDF 已保存、目标版本确实含有原文，再换成方法名、表名或正文使用的词。尝试直接讨论已定位的选段。检索无命中只说明本次没返回匹配。</dd>
          <dt>研究一直等待或报告无法保存</dt>
          <dd>先在共享会话查看登录、授权或模型错误，再打开研究记录检查保存状态。引用无效时根据校验提示补核对应的来源后重试。已有未完成记录时，优先从该记录继续。</dd>
        </dl>`,
    },
  ],
};
