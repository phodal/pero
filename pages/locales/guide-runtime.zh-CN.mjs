export default {
  agents: {
    title: '配置 Agent 与工具',
    label: 'Agent 与工具',
    description: '连接内置或外部 Agent，用一轮纯文本对话确认模型可用，再按任务添加工作目录、上下文和工具权限。',
    sections: [
      {
        id: 'built-in-agent',
        title: '配置内置 Pero Agent',
        body: `
          <ol>
            <li>打开 <strong>设置 → 内置 Agent</strong>。填写服务商提供的 <strong>API 地址</strong>、<strong>模型</strong>和 <strong>API Key</strong>。内置 Agent 的默认地址是 <code>https://api.deepseek.com</code>，默认模型是 <code>deepseek-chat</code>。地址使用 HTTPS，本机回环服务可用 HTTP。模型字段填写模型 ID。</li>
            <li>点击<strong>保存</strong>，确认显示<strong>已保存</strong>。桌面版使用系统凭据存储加密密钥。以后修改地址或模型时，密钥留空可保留已保存的值。需要清除时，点击<strong>移除已保存密钥</strong>再确认。</li>
            <li>打开<strong>新聊天</strong>，在输入框附近选择 <strong>Pero (DeepSeek)</strong>。新会话使用刚保存的配置。</li>
          </ol>
          <p>界面保存的配置优先于开发环境中的 <code>DEEPSEEK_*</code> 变量或 <code>.env</code>。已有会话继续使用创建时的配置。源码启动方式及配置目录见<a href="{{install}}#from-source">安装与启动</a>和 <a href="https://github.com/phodal/pero/blob/master/desktop/README.md#agents-and-conversations">桌面配置说明</a>。</p>`,
      },
      {
        id: 'external-agents',
        title: '连接外部 Agent',
        body: `
          <p>Pero 用本地 ACP 适配器连接外部 Agent。<strong>设置 → 模型与 Agent</strong>可查看适配器是否可用。各 Agent 使用自己的登录和模型配置。</p>
          <dl>
            <dt>Codex、Claude</dt><dd>Electron 开发预览包装有这两个 ACP 适配器。从源码运行时，根目录的 <code>npm ci</code> 安装项目所用的适配器。按会话提示完成各自的登录方式，再选择该 Agent 提供的模型。</dd>
            <dt>GitHub Copilot、Grok、Qoder、OpenCode</dt><dd>需要分别安装支持 ACP 的本地 CLI，并完成对应的登录或服务商配置。当前登记的可执行程序为 <code>copilot</code>、xAI 的 <code>grok-build</code> 或其安装目录中的 <code>grok</code>、<code>qodercli</code> 和 <code>opencode</code>。安装后重启 Pero 再检查选择器。</dd>
          </dl>
          <p>若提示<strong>请先在终端登录</strong>，完成该 Agent 的终端登录，回到会话点<strong>已登录，继续</strong>。其他登录方式按 Agent 显示的按钮操作。完成登录后，检查原问题并手动重发。</p>`,
      },
      {
        id: 'first-chat',
        title: '跑通第一轮对话',
        body: `
          <ol>
            <li>打开<strong>新聊天</strong>。通过输入区的文件夹按钮选择一个空的练习目录，再选已配置的 Agent。工作目录是该会话的本机执行目标，开始实际对话后如需切换目录或 Agent，请新建会话。</li>
            <li>先发送一条无需工具和附件的短消息。若界面出现登录提示，按上节处理后手动重发。</li>
          </ol>
          <blockquote><p>请只回复 PERO_SETUP_OK。这次无需调用工具、读取或修改文件。</p></blockquote>
          <p>收到约定文本即完成模型往返。<strong>已安装</strong>只说明适配器已找到，成功连接 ACP 也可能先于模型登录。模型回应后，可用<a href="{{paper}}#ask-agent">论文选段问答</a>进一步验证该 Agent 是否适用于科研任务。</p>`,
      },
      {
        id: 'workspace-and-approvals',
        title: '检查工作目录和审批范围',
        body: `
          <p>从专用目录开始。在输入框的上下文菜单选择需发送的文件，发送前检查草稿及引用。目录给本机 Agent 提供工具工作的基准，发送的内容以及后续工具读取结果可能进入所用模型服务。</p>
          <ul>
            <li>权限菜单按 Agent 能力显示。内置 Agent 提供<strong>仅可查看</strong>时，读取工作区可用，文件修改和命令会被拒绝。<strong>工作区内修改</strong>对写入要求确认，命令仍被拒绝。</li>
            <li><strong>完全权限</strong>下文件修改和命令会请求确认，<strong>自动审查</strong>会自动放行。内置 Agent 这些模式下的命令没有操作系统级沙箱。各平台及外部 Agent 可能提供不同的权限模式。</li>
            <li>出现<strong>需要你的授权</strong>时，展开相关工具，核对动作和目标。仅为当前动作授予一次权限（若 Agent 提供该选项），或拒绝并重新描述任务。可点<strong>停止</strong>请求结束活动回合，已完成的外部操作需到原系统核查。</li>
          </ul>`,
      },
      {
        id: 'mcp-connectors',
        title: '添加 MCP 工具和连接器',
        body: `
          <ol>
            <li>在工作台打开<strong>连接器</strong>，也可从应用目录打开。选择可信服务，按该项的配置表单保存并完成登录。若出现浏览器授权，核对账号与范围。凭据只填在连接器提供的专用字段，避免写进 URL、参数、配置示例或对话。</li>
            <li>点击<strong>验证连接</strong>。显示<strong>验证通过</strong>时，服务完成了工具发现，验证连接随即释放。查看<strong>工具</strong>列表，勾选本次工作需要的工具并保存。目录卡片与已启用工具的实际能力以当前连接结果为准。</li>
            <li>新建对话后使用该连接。Host 为每个会话固定当时的连接配置和工具许可。修改凭据或授权会让旧的连接器快照失效。完成变更后，在新会话用该服务文档中的只读操作验证结果。</li>
          </ol>
          <p>独立的每 Agent MCP 配置依赖适配器支持，与上面的连接器目录各自保存。全文检索等能力需要 Agent 支持相应 MCP 传输。工作台的连接器运行时面向 macOS 和 Linux，在 Windows 上会提示平台不受支持。更多见<a href="https://github.com/phodal/pero/blob/master/docs/adr/0025-connectors-app.md">连接器设计</a>与<a href="https://github.com/phodal/pero/blob/master/docs/fitness/connectors.md">平台验证记录</a>。</p>`,
      },
      {
        id: 'troubleshoot-agent',
        title: '排查登录、模型和工具问题',
        body: `
          <dl>
            <dt>Agent 显示未安装或选择器中不可选</dt><dd>检查 CLI 或适配器是否安装在桌面进程能找到的位置，重启 Pero，再选择一次。</dd>
            <dt>内置 Agent 需要 API Key，或设置保存失败</dt><dd>确认地址、模型 ID 以及密钥来自同一服务。若提示系统凭据存储不可用，先解锁系统凭据存储，重新打开 Desktop 并保存，再建会话试一次。</dd>
            <dt>连接成功但模型拒绝请求</dt><dd>用该 Agent 的登录方式处理鉴权错误。若界面提供模型选择器，选账号有权限访问的模型。先用上面的纯文本提示确认模型回复，再添加工具。</dd>
            <dt>工具不可用或调用被拒绝</dt><dd>先检查该连接的验证结果、工具是否被勾选，以及会话权限和 Agent 的传输支持。配置修改后新开会话。外部写入的结果若不明确，先核对原服务的操作记录再决定是否重复执行。</dd>
          </dl>
          <p>记录软件包版本、Agent 名称、可分享的错误消息与复现步骤。<a href="{{reference}}#verification-and-help">提交问题与核对验证范围</a>。</p>`,
      },
    ],
  },
  compute: {
    title: '执行环境与远程计算',
    label: '执行环境与计算',
    description: '检查本机软件，为 App 或单次实验准备环境，并在明确授权后向 SSH 工作站或 Slurm 提交内置计算。',
    sections: [
      {
        id: 'inspect-software',
        title: '先检查方法需要的软件',
        body: `
          <p>打开侧栏的<strong>执行环境</strong>，如果入口未出现，在<strong>应用</strong>中启用它。也可以从 Paper 的复现面板或 Control Lab 的引擎可用性入口查看对应方法。</p>
          <ol>
            <li>打开<strong>软件检查</strong>，选择要用的方法，如 Control Lab 的 python-control。手动启动检查，查看方法所需软件、当前观察到的版本和缺失项。</li>
            <li>记录方法以及检查结果。可导出带版本的观察记录。打开列表只读取已保存的信息，软件检查只观察配置所指的软件。</li>
          </ol>
          <p>版本匹配之后，还需要准备或选择环境，并在所属 App 单独运行实验。软件检查结果没有实验产物或结论。</p>`,
      },
      {
        id: 'app-environment',
        title: '安装并切换 App 服务环境',
        body: `
          <ol>
            <li>打开<strong>执行环境 → App 服务环境 → 创建环境</strong>，填写名称，选择方法，例如 Control Lab 的控制系统仿真。核对将安装的运行时和依赖，再点<strong>创建并准备</strong>。</li>
            <li>等待<strong>准备完成</strong>。安装失败时展开<strong>安装日志</strong>，根据错误检查依赖获取或本机软件，再用<strong>重试</strong>继续。首次准备可能联网安装 Python 和方法依赖。</li>
            <li>保存目标 App 中的工作，再点<strong>使用此环境 → 绑定并重启</strong>。此操作会重启 App 后端并停止该 App 正在进行的计算。看到<strong>当前使用</strong>后，到目标 App 中重新检查软件。Control 和 Circuit 共用 Control Lab 的服务环境。</li>
          </ol>
          <p>已绑定环境请通过创建新环境来变更依赖。只需阅读 Paper 时，可以直接完成<a href="{{install}}#prepare-environment">Paper 首次环境准备</a>。</p>`,
      },
      {
        id: 'locked-compute-profile',
        title: '为实验选择锁定计算环境',
        body: `
          <p>在支持的 macOS arm64 或 Linux x64 构建中，<strong>执行环境 → 计算环境</strong>可为 Control Lab 或 PC-Gym 创建独立计算环境。选择方法，创建环境，再点击<strong>准备环境</strong>。准备成功后，可查看 <code>uv.lock</code> 对应的锁文件摘要及依赖内容摘要。</p>
          <p>选择<strong>用于此方法计算</strong>后，新实验使用选定环境，App 服务继续运行。已有实验固定原环境。需要继续旧实验时选回原环境，也可在当前环境开始新实验。要重建已准备好的环境，用<strong>按同一锁重建</strong>生成独立副本。</p>
          <p>准备记录包含安装与导入检查。正式计算仍从 Control Lab 或 Paper 的实验入口发起，按该方法的审批、运行和验收步骤进行。已经准备环境的证据和平台范围见<a href="https://github.com/phodal/pero/blob/master/apps/environments/README.md#locked-scientific-computation">计算环境说明</a>及<a href="https://github.com/phodal/pero/blob/master/docs/fitness/uv-scientific-production.md">验证记录</a>。</p>`,
      },
      {
        id: 'remote-connection',
        title: '为 SSH 或 Slurm 配置连接',
        body: `
          <p><strong>版本要求。</strong>以下远程提交、观察和收集流程对应当前源码。2026-11-12 预览包中的 Compute 只能保存集群配置、查看已有回执或导入报告。需要下列功能时，请使用包含远程执行的构建。<a href="{{install}}#from-source">从源码启动</a>。</p>
          <ol>
            <li>向站点管理员确认授权的 SSH 别名、主机身份及可写工作目录。在系统 OpenSSH 中配置免交互访问和已验证的 <code>known_hosts</code> 记录。应用使用系统 SSH 配置和 Agent，表单仅保存非密钥字段。</li>
            <li>在<strong>科学计算</strong>的集群设置中点<strong>添加集群配置</strong>，填写名称、登录主机或 SSH 别名和远端绝对工作目录。选择 <strong>SSH 工作站</strong>或 <strong>Slurm / SSH</strong>。准备 Slurm 作业时分区为必填，账号按站点要求填写。工作目录需供登录节点和计算节点共同访问。</li>
            <li>保存后打开<strong>远程执行</strong>，选择该连接并点击<strong>探测连接</strong>。看到<strong>已验证连接</strong>时，核对主机、观察到的平台与 Python，以及 Slurm 的集群身份。探测反映提交端所见的软件，实际分配节点信息随作业回执查看。</li>
          </ol>
          <p>登录侧需要可非交互访问的 Python 3。Slurm 还需站点的调度命令、节点上的 Python 3，以及账号对固定资源请求的授权。<a href="https://github.com/phodal/pero/blob/master/docs/fitness/remote-compute.md#reproduction-and-operations">站点检查项</a>。</p>`,
      },
      {
        id: 'first-remote-run',
        title: '运行一次可核对的求积示例',
        body: `
          <ol>
            <li>在<strong>远程执行</strong>设<strong>每次采样数</strong>为 <code>1000</code>，<strong>重复次数</strong>为 <code>1</code>，点<strong>准备并固定输入</strong>。内置 CPU 方法计算 0 至 1 上的 4 / (1 + x²) 积分。</li>
            <li>检查<strong>已准备，等待批准</strong>状态，以及<strong>固定输入与目标</strong>中的尝试编号、远程目录和 SHA-256。使用 Slurm 时检查账号、分区、1 CPU、256 MiB、600 秒约束。准备会创建远程尝试目录。确认目标与参数后点<strong>批准并提交</strong>，此时才发起计算。</li>
            <li>在<strong>已保存执行</strong>选中这次尝试，点<strong>读取原执行状态</strong>查看日志、已记录的退出码和 Slurm 作业标识。排队表示提交已入队，分配状态需随后观察。</li>
            <li>执行结束后点<strong>收集并保存证据</strong>，再<strong>下载原始产物</strong>。成功时 <code>result.json</code> 的 <code>estimate</code> 约为 <code>3.1415927369</code>，与 π 的绝对误差约 <code>8.33e-8</code>，阈值为 <code>1e-6</code>，<code>checkPassed</code> 为 <code>true</code>。<code>scientificAcceptance</code> 保持 <code>unreviewed</code>。</li>
          </ol>
          <p>复制 <code>compute:&lt;attempt&gt;:&lt;sha256&gt;</code> 引用到研究记录，可定位这次在本机固定下来的原始字节。远端文件后续修改不会改变已收集内容。数值与回执只验证这次固定方法的执行。</p>`,
      },
      {
        id: 'remote-recovery',
        title: '恢复原执行与重收集证据',
        body: `
          <dl>
            <dt>探测失败或准备未完成</dt><dd>检查主机别名、系统 SSH 授权、工作目录权限或 Slurm 账号/分区。修正配置后再探测，准备未完成的尝试需重新准备。</dd>
            <dt>已提交但未收到回执，或状态为「需要核对」</dt><dd>刷新已保存执行，再读取原执行。保留尝试编号与远程目录，请站点人员按原作业身份及提交时间核对后再决定下一步，避免重复提交。</dd>
            <dt>已请求取消</dt><dd>继续读取原执行，等执行方确认停止。关闭 App 或退出 Pero 后，已提交的远程计算会继续，重新打开可继续观察原尝试。</dd>
            <dt>收集不完整</dt><dd>先保存已有下载和固定引用。解决远程文件缺失或访问问题再点<strong>重试收集缺失证据</strong>。每份收集文件上限为 1 MiB，过大文件仍保存在远程目录。</dd>
          </dl>
          <p>开发构建的验证覆盖真实回环 SSH 与 Slurm 测试替身。这个流程提交内置 CPU 方法。真实 Slurm 站点仍待验收。<a href="https://github.com/phodal/pero/blob/master/docs/fitness/remote-compute.md">远程执行验证记录</a>。</p>`,
      },
    ],
  },
};
