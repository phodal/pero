import paper from './guide-paper.zh-CN.mjs';
import research from './guide-research.zh-CN.mjs';
import runtime from './guide-runtime.zh-CN.mjs';

export default {
  overview: {
    title: 'Pero 文档',
    label: '概览',
    description: '在同一个桌面工作台阅读论文、检查数据、记录研究过程，并回到原文和运行记录复核结果。',
    sections: [
      {
        id: 'where-to-run',
        title: '选择运行方式',
        body: `
          <p>跟做文档里的教程请使用 <strong>Electron 桌面工作台</strong>。阅读 PDF、标注、查看本地数据和保存笔记可在本机完成。需要让 Agent 分析时，再配置模型服务。需要在另一台机器上运行方法时，再配置计算连接。</p>
          <p><a href="../#distributed">官网交互演示</a>可以在浏览器里体验任务分配与结果复核。演示使用预设数据和模拟角色。<a href="https://openpero.com/workbench/">浏览器工作台预览</a>可查看工作台界面，运行本地 Agent 和领域 App 需要桌面宿主。</p>`,
      },
      {
        id: 'continue-your-research',
        title: '按研究任务继续',
        body: `
          <ul>
            <li>用<a href="{{data}}">六条合成记录</a>练习导入、筛选、保存视图和核对版本。</li>
            <li>在<a href="{{notebook}}">研究笔记</a>里保存一个修订，把观察和来源留在一起，再重新打开或导出。</li>
            <li>在<a href="{{projects}}">研究项目</a>里写下目标，关联已有论文、研究记录和实验。</li>
            <li><a href="{{compute}}">准备计算环境</a>，确认依赖与运行位置，再查看作业状态、日志和产物。</li>
            <li>按<a href="{{reference}}#read-a-result">证据复核步骤</a>查看来源、运行记录、独立验证和研究者结论。</li>
          </ul>`,
      },
    ],
  },
  install: {
    title: '安装与启动',
    label: '安装与启动',
    description: '选择对应系统的桌面包，校验下载，准备第一个 App 的环境。需要开发分支功能时，可以从源码启动。',
    sections: [
      {
        id: 'download',
        title: '选择版本和桌面包',
        body: `
          <p>在 <a href="https://github.com/phodal/pero/releases">GitHub Releases</a> 打开你要安装的开发预览版。以下文件名对应 <a href="https://github.com/phodal/pero/releases/tag/v0.1.0-dev.20261112">2026-11-12 开发预览版</a>。文档中标记为源码的功能可能晚于安装包，核对时以你的版本和对应发布说明为准。</p>
          <table>
            <thead><tr><th scope="col">平台</th><th scope="col">Electron 工作台</th><th scope="col">启动方式</th></tr></thead>
            <tbody>
              <tr><th scope="row">macOS Apple Silicon</th><td><code>Pero-macos-arm64.dmg</code></td><td>打开 DMG，把 <code>Pero.app</code> 拖到「应用程序」，从那里启动。</td></tr>
              <tr><th scope="row">Windows x64</th><td><code>Pero-windows-x64.zip</code></td><td>完整解压到同一个目录，再打开 <code>Pero.exe</code>。</td></tr>
              <tr><th scope="row">Linux x64</th><td><code>Pero-linux-x64.tar.gz</code></td><td>解压后，在应用目录运行 <code>./pero</code>。需要系统提供 Electron 桌面库。</td></tr>
            </tbody>
          </table>
          <p>同一版本还提供独立的 macOS Apple Silicon Native 包。Electron 和 Native 使用各自的配置。本文的首次启动路径以 Electron 为例。macOS 开发包采用 ad-hoc 签名且未经公证，Windows 和 Linux 开发包未签名。系统阻止启动时先核对发布说明和下载来源。</p>`,
      },
      {
        id: 'verify-download',
        title: '校验下载文件',
        body: `
          <p>从同一个发布条目下载 <code>SHA256SUMS</code>。在下载目录按系统运行一条命令，把输出的完整摘要与校验文件中<strong>同名归档</strong>的那行对照。</p>
          <pre><code># macOS
shasum -a 256 Pero-macos-arm64.dmg

# Windows PowerShell
Get-FileHash .\\Pero-windows-x64.zip -Algorithm SHA256

# Linux
sha256sum Pero-linux-x64.tar.gz</code></pre>
          <p>摘要一致时继续解包或安装。摘要不一致时重新从发布条目下载并校验。发布条目里的构建信息可用于核对源码提交和目标平台。</p>`,
      },
      {
        id: 'prepare-environment',
        title: '首次启动并准备 App 环境',
        body: `
          <ol>
            <li>打开 Electron 工作台。在侧栏选择<strong>论文</strong>。如果界面提示缺少运行环境，点击<strong>准备环境</strong>。</li>
            <li>首次准备可能需要联网获取 uv、CPython 3.12 和 App 声明的固定依赖。等待界面显示环境就绪。新配置的默认环境目录为 <code>~/.pero/environment/pero-python312</code>，已有配置继续使用已选环境。</li>
            <li>打开一份可选中文字的 PDF 并保存一处高亮，验证阅读器和保存流程。按<a href="{{paper}}#import-and-highlight">第一篇论文教程</a>操作即可。导入和阅读本地 PDF 无需模型账号、Task Center 登录或 PostgreSQL。</li>
          </ol>
          <p>需要预装依赖供离线使用时，按<a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#python-environments-and-advanced-overrides">预置环境说明</a>设置绝对 venv 目录。准备、检查和绑定环境的区别见<a href="{{compute}}">计算环境</a>。</p>`,
      },
      {
        id: 'startup-troubleshooting',
        title: '定位启动或准备失败',
        body: `
          <dl>
            <dt>应用窗口打不开</dt><dd>检查下载摘要、CPU 架构和解压是否完整。Linux 如果报告缺少共享库，先检查报错中的库名和对应发行版运行依赖。</dd>
            <dt>工作台能打开，App 报缺少环境</dt><dd>从 App 提示显式准备环境。失败时打开详情，区分下载失败、已有环境无效和 App 启动失败。看到就绪后再打开 App。</dd>
            <dt>预期的 App、资料或设置没有出现</dt><dd>确认打开的是原来的 Electron、Native 或开发预览配置，并核对当前发布版本是否包含该功能。各 App 的领域数据位置见<a href="{{reference}}#data-and-cost">数据与配置</a>。</dd>
            <dt>准备成功后仍启动失败</dt><dd>较新的源码构建可在 Host 设置文件旁查看 <code>app-startup.jsonl</code>，用界面的请求 ID 对照启动阶段、错误码和退出状态。报告问题时附上可分享的对应记录。</dd>
          </dl>`,
      },
      {
        id: 'from-source',
        title: '从源码启动',
        body: `
          <p>先核对<a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#desktop-from-source">开发指南</a>中的系统依赖。当前源码需要 Node.js 22.18+、Go 1.27.3、Rust stable、<code>nightly-2026-10-28</code> 的 Wasm 目标，以及固定的 GPUI Kit。以下命令用于 POSIX shell，假设当前位于干净的 Pero 仓库根目录，且上一级没有 <code>gpui-kit</code> 目录。</p>
          <pre><code>npm ci
node node_modules/electron/install.js
rustup toolchain install stable --profile minimal
rustup toolchain install nightly-2026-10-28 --profile minimal --target wasm32-unknown-unknown
git -c core.autocrlf=false clone https://github.com/longbridge/gpui-kit.git ../gpui-kit
git -C ../gpui-kit checkout --detach 7591a35eced761e3613c01e71ff04c10129dae1a
export PERO_GPUI_KIT_PATH="$(cd ../gpui-kit &amp;&amp; pwd)"
npm run dev</code></pre>
          <p>首次构建可能下载 Rust 依赖、字体、Wasm 工具和 App 依赖。成功时会打开 Electron 工作台。只想试 Paper 可运行 <code>npm run dev:paper</code>，它使用独立配置。构建过且无需重建时，可用 <code>npm start</code> 打开现有工作台产物。</p>`,
      },
    ],
  },
  paper,
  ...research,
  ...runtime,
  reference: {
    title: '概念、证据与故障排查',
    label: '概念与参考',
    description: '知道记录保存在哪里、一次运行能证明什么，以及故障发生时该看哪一层。',
    sections: [
      {
        id: 'concepts',
        title: '工作台里的对象和记录',
        body: `
          <table>
            <thead><tr><th scope="col">对象</th><th scope="col">保存什么</th><th scope="col">到哪里查看</th></tr></thead>
            <tbody>
              <tr><th scope="row">研究项目</th><td>目标、可选本地目录，以及指向 App 记录的关联。每个 App 保存自己的领域数据。</td><td><a href="{{projects}}">项目概览与资料关联</a></td></tr>
              <tr><th scope="row">科研 App</th><td>论文快照、数据集文件版本、笔记修订或实验尝试，具体由 App 决定。</td><td><a href="{{workflows}}">各 App 工作流和原记录</a></td></tr>
              <tr><th scope="row">Agent 会话</th><td>对话、工具和审批记录。会话由本机 Host 管理，启动时选定 Agent 和工作区。</td><td><a href="{{agents}}">对话历史和工具记录</a></td></tr>
              <tr><th scope="row">计算尝试</th><td>方法、输入、运行环境及该次尝试的状态、日志或产物。具体字段取决于工作流。</td><td><a href="{{compute}}">计算记录</a>或实验所属 App</td></tr>
              <tr><th scope="row">共享任务与 Worker</th><td>可选控制面协调协作任务，已登记的 Worker 在其环境执行。该部署用于共享任务。</td><td><a href="https://github.com/phodal/pero/blob/master/desktop/README.md#remote-tasks">Desktop 远程任务接入</a></td></tr>
            </tbody>
          </table>
          <p>例如，在 Project 里关联 Paper 报告后，打开关联会回到 Paper 的原记录。希望固定当时看到的数据时，要记下 Data 的具体文件版本，或保存带引用的 Notebook 修订。</p>`,
      },
      {
        id: 'read-a-result',
        title: '从结论回查来源和验证',
        body: `
          <ol>
            <li><strong>定位来源。</strong>论文主张回到引用段落，检查上下文和单位。数据回到明确的文件版本，查看来源和 SHA-256。</li>
            <li><strong>找本次运行。</strong>对照输入、方法版本、参数和环境，打开同一次尝试的日志与产物。重新运行时记录新的尝试，保留旧结果以便比较。</li>
            <li><strong>读验证结果。</strong>确认检查针对哪个输出、用什么预先定义的规则、哪部分由独立过程复算。执行正常只能证明运行完成。验证未执行、验证不匹配和已通过验证需要分别理解。</li>
            <li><strong>写明结论范围。</strong>例如，<a href="{{workflows}}#recheck-a-result">Fisher 案例</a>复核的是 Table III 的一个数值。<code>REPRODUCED</code> 是该数值的判定，整篇论文仍为 <code>NOT_ASSESSED</code>。</li>
          </ol>
          <p>例如，Fisher（1936）的复核记录应写明 Table III 的具体条目、100 条核对过的输入、预期值 19.1434 cm² 和容差 0.00005 cm²。独立检查结果见导出的验证报告。</p>`,
      },
      {
        id: 'data-and-cost',
        title: '本地数据、权限与费用',
        body: `
          <ul>
            <li><strong>配置和数据。</strong>默认 Electron 工作台把 Host 设置保存在 <code>~/.pero/config/runtime-settings.json</code>，把 App 记录保存在 <code>~/.pero/app-data/</code>。会话历史保存在 Electron 用户数据里的 <code>sessions.jsonl</code>。独立产品、Native、开发和隔离配置的位置应按各自说明确认。</li>
            <li><strong>外部请求。</strong>直接阅读本地文件和运行本地方法可以在本机完成。使用模型、文献搜索、MCP 或共享任务服务时，所选问题、上下文或工具参数可能发给相应服务。发送前可以检查草稿及附件，执行前查看实际请求和会话权限。</li>
            <li><strong>费用。</strong>模型和远程算力以供应方的用量记录计费。工作流的步骤或时长限制约束本次运行的行为。界面只在收到用量数据时展示对应数据。</li>
          </ul>
          <p>交换研究记录时优先使用 App 的导出入口。版本对照、Notebook 修订和运行证据都有自己的导出范围，详见相应用法。</p>`,
      },
      {
        id: 'verification-and-help',
        title: '读懂验证记录并排查故障',
        body: `
          <p><strong>先定位故障发生在哪一层。</strong>桌面或 App 无法启动，从<a href="{{install}}#startup-troubleshooting">安装排错</a>开始。模型无法回复，看<a href="{{agents}}">登录、凭据和会话设置</a>。任务已提交但没有结果，检查<a href="{{compute}}">连接、尝试状态、日志和产物</a>。结果有疑问，从<a href="#read-a-result">来源与验证</a>回查。</p>
          <p><a href="https://github.com/phodal/pero/blob/master/docs/fitness/README.md#acceptance-levels">验收分级</a>以证据覆盖的条件为准。L0 是源码检查，L1 是实际桌面配测试 Agent，L2 涉及真实提供方、环境或外部服务，L3 是签名发布包在目标系统上的安装、升级和运行。查看记录时同时核对版本、系统、样例与未覆盖范围。</p>
          <p>向 <a href="https://github.com/phodal/pero/issues">GitHub Issues</a> 提交问题时，附上版本或提交 SHA、操作系统和架构、Electron 或 Native、可复现步骤、预期与实际结果，以及可公开的错误和请求 ID。</p>`,
      },
      {
        id: 'developer-reference',
        title: '开发与部署入口',
        body: `
          <dl>
            <dt>构建桌面与贡献代码</dt><dd>按<a href="{{install}}#from-source">源码安装</a>启动，按<a href="https://github.com/phodal/pero/blob/master/CONTRIBUTING.md">贡献指南</a>选择对应验证。完整命令和依赖见<a href="https://github.com/phodal/pero/blob/master/DEVELOPMENT.md#verification">开发验证</a>。</dd>
            <dt>开发 App</dt><dd>在 <code>apps/</code> 中选一个已有 App 作参照。App 的清单、Web 面板、后端、环境和声明式权限见<a href="https://github.com/phodal/pero/blob/master/apps/README.md">App 开发契约</a>。</dd>
            <dt>部署共享任务</dt><dd>服务端配置、PostgreSQL 和项目授权见<a href="https://github.com/phodal/pero/blob/master/server/README.md">控制面文档</a>。执行机见<a href="https://github.com/phodal/pero/blob/master/crates/pero-worker/README.md">Worker 文档</a>。</dd>
            <dt>查运行边界和计划</dt><dd>看<a href="https://github.com/phodal/pero/blob/master/docs/ARCHITECTURE.md">架构</a>、<a href="https://github.com/phodal/pero/blob/master/docs/adr/README.md">决策记录</a>和<a href="https://github.com/phodal/pero/blob/master/ROADMAP.md">路线图</a>。</dd>
          </dl>`,
      },
    ],
  },
};
