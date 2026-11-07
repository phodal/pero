import { Graphic, ink, muted, border, soft } from './research-graphics.mjs';

// Architecture/ADR/fitness sources and status boundaries: docs/GRAPHICS.md.
// Solid foundations do not claim production, all-provider or scientific acceptance.
const locales = {
  en: {
    title: 'Coordinate shared work. Keep execution with its owner.',
    description: 'Pero architecture, combining implementation foundations and explicitly planned integration. Desktop and GitHub intake exist; shared Web and mobile clients remain targets. The Go control plane owns shared task coordination. Rust Host and Worker own local permissions, credentials, sessions and execution. Local research Projects link App-owned records, not a shared scientific journal. Apps, local Agent Plugins, MCP connectors and replaceable ACP backends have implementation foundations. Shared project knowledge, journal sync and unified delivery remain planned. Local and owner-specific compute adapters exist with scope-specific acceptance; real sites and deployments have separate gates. Artifact versions exist in sessions, but independent verification and human acceptance are not yet one shared Task/Run delivery loop.',
    legend: 'Solid: implementation foundation · Dashed: planned / integration',
    clients: [['Desktop', 'Electron · Native', true], ['Web workbench', 'Shared client planned', false], ['Mobile / Editor', 'Remote access planned', false], ['GitHub intake', 'Issues · Roadmap', true]],
    contracts: 'Versioned contracts', contractsDetail: 'HTTP / ACP foundations · Unified event sync planned',
    groups: [
      ['Cloud / Control plane', 'Shared task authority', 'server', [
        ['Tasks & coordination', 'Runs · Dispatch · Leases', true],
        ['Shared project knowledge', 'Pages · Memory · Journal', false],
        ['Teams & synchronization', 'Shared policy · Replication', false],
      ]],
      ['Host / Worker', 'Local execution authority', 'laptop', [
        ['Policy & sessions', 'Credentials · ACP · Approvals', true],
        ['Execution & Harness', 'Tools · Cancel · Recover', true],
        ['Local research Projects', 'Goals · App record links', true],
      ]],
      ['Apps & capabilities', 'Domain and Agent extensions', 'app', [
        ['Agent backends', 'Built-in Harness · ACP adapters', true],
        ['Plugins & connectors', 'Local Skills · Scoped MCP', true],
        ['Apps & Products', 'UI · Data · Python backends', true],
      ]],
    ],
    run: 'Dispatch', tool: 'Tools/MCP', sync: 'Shared journal sync remains planned',
    local: 'Local workspaces', workers: 'Trusted Workers', adapters: 'Compute adapters',
    localSub: 'Host-managed execution', workerSub: 'Claim · Lease · Results', adapterSub: 'Local / containers / Slurm',
    execution: 'Execution environments', executionNote: 'Site, cluster and package acceptance remain scoped.',
    planned: 'Planned integration: App Task/Run · Unified environment lifecycle · Playbooks',
    delivery: 'Shared trusted-delivery loop · planned',
    deliverySteps: [['Artifact versions', 'Session foundation exists'], ['Independent verification', 'Separate checks and evidence'], ['Human acceptance', 'Accept · Reject · Rework']],
    feedback: 'Accepted evidence → shared project knowledge',
  },
  'zh-CN': {
    title: '协调共享工作，让执行留在所属环境。',
    description: 'Pero 架构，同时展示已有实现基础和明确的规划接线。Desktop 与 GitHub 来源导入已有基础，共享 Web 和移动客户端仍是目标。Go 控制面拥有共享任务协调，Rust Host 与 Worker 拥有本机权限、凭据、会话和执行。本地研究项目引用 App 自有记录，不等于共享科学台账。App、本地 Agent Plugin、MCP 连接器与可替换 ACP 后端已有实现基础；共享项目知识、journal 同步与统一交付仍待建设。本地与各资源所有者的算力适配已有局部验收，真实站点和部署单独验收。会话已有产物版本，但独立验证与人工接受尚未组成共享 Task/Run 的完整交付闭环。',
    legend: '实线：已有实现基础 · 虚线：规划能力或待接通关系',
    clients: [['Desktop', 'Electron · Native', true], ['Web 工作台', '共享客户端待接入', false], ['移动端 / 编辑器', '远程访问待接入', false], ['GitHub 来源导入', 'Issues · Roadmap', true]],
    contracts: '版本化契约', contractsDetail: '已有 HTTP / ACP 基础 · 统一事件同步待接通',
    groups: [
      ['Cloud / 控制面', '共享任务的权威', 'server', [
        ['任务与协调', '运行 · 分派 · 租约', true],
        ['共享项目知识', 'Pages · 记忆 · Journal', false],
        ['团队与同步', '共享策略 · Journal 复制', false],
      ]],
      ['Host / Worker', '本机执行的权威', 'laptop', [
        ['权限与会话', '凭据 · ACP · 审批', true],
        ['执行与 Harness', '工具 · 取消 · 恢复', true],
        ['本地研究项目', '研究目标 · App 记录引用', true],
      ]],
      ['App 与能力', '领域能力与 Agent 扩展', 'app', [
        ['Agent 后端', '内置 Harness · ACP 适配器', true],
        ['插件与连接器', '本地 Skills · 有界 MCP', true],
        ['App 与产品', '界面 · 数据 · Python 后端', true],
      ]],
    ],
    run: '分派', tool: '工具/MCP', sync: '共享 Journal 同步仍待接通',
    local: '本地工作区', workers: '可信 Worker', adapters: '算力适配器',
    localSub: 'Host 管理的执行', workerSub: '认领 · 租约 · 结果', adapterSub: '本地 / 容器 / Slurm',
    execution: '执行环境', executionNote: '站点、集群与安装包仍需按各自范围验收。',
    planned: '待集成：App Task/Run · 统一环境生命周期 · Playbook 编排',
    delivery: '共享可信交付闭环 · 规划中',
    deliverySteps: [['产物版本', '会话中已有实现基础'], ['独立验证', '独立检查与证据'], ['人工接受', '接受 · 拒绝 · 返工']],
    feedback: '接受的证据 → 共享项目知识',
  },
};
for (const [lang, copy] of Object.entries(locales)) {
  const g = new Graphic(1600, 1350, lang, `Pero — ${copy.title}`, copy.description);
  g.text(64, 60, copy.title, 36, ink, 700);
  g.text(64, 102, copy.legend, 22, muted);
  copy.clients.forEach(([title, subtitle, current], i) => {
    const x = 64 + 380 * i;
    g.rect(x, 138, 332, 91, { stroke: current ? ink : muted, dashed: !current, radius: 10 });
    g.text(x + 20, 174, title, 27, ink, 600);
    g.text(x + 20, 209, subtitle, 22, muted);
    g.path(`M ${x + 166} 229 V 254`, { dashed: !current });
  });
  g.path('M 230 254 H 1370 M 800 254 V 272', { dashed: true });
  g.rect(64, 273, 1472, 59, { fill: soft, stroke: 'none', radius: 10 });
  g.text(87, 312, copy.contracts, 25, ink, 600);
  g.text(1511, 312, copy.contractsDetail, 23, muted, 400, 'end');
  const xs = [64, 584, 1104];
  copy.groups.forEach(([title, subtitle, icon, cards], i) => {
    const x = xs[i], cx = x + 216;
    g.halo(cx, 418, 152, 65, i === 1);
    g.illustration(icon, cx, 410, .9, i === 1);
    g.text(cx, 515, title, 29, ink, 700, 'middle');
    g.text(cx, 552, subtitle, 22, muted, 400, 'middle');
    cards.forEach(([heading, detail, current], j) => {
      const y = 580 + j * 95;
      g.rect(x, y, 432, 78, { stroke: current ? border : muted, dashed: !current, radius: 8 });
      g.text(x + 18, y + 31, heading, 25, ink, 600);
      g.text(x + 18, y + 61, detail, 22, muted);
    });
  });
  g.path('M 506 617 H 540 V 712 H 574', { arrow: true });
  g.text(540, 598, copy.run, 18, muted, 400, 'middle');
  // ACP connects the session owner to replaceable backends, separately from tools.
  g.path('M 1060 619 H 1026', { arrow: true });
  g.path('M 1060 619 H 1094', { arrow: true });
  g.text(1060, 598, 'ACP', 18, muted, 400, 'middle');
  g.path('M 1094 713 H 1026', { arrow: true });
  g.text(1060, 693, copy.tool, 18, muted, 400, 'middle');
  g.path('M 280 858 V 874 H 800 V 859', { dashed: true });
  g.rect(340, 859, 370, 30, { fill: '#FFFFFF', stroke: 'none', radius: 0 });
  g.text(525, 881, copy.sync, 20, muted, 400, 'middle');
  g.text(64, 934, copy.execution, 28, ink, 600);
  g.text(1536, 934, copy.executionNote, 22, muted, 400, 'end');
  [[copy.local, copy.localSub], [copy.workers, copy.workerSub], [copy.adapters, copy.adapterSub]].forEach(([title, detail], i) => {
    const x = xs[i];
    g.rect(x, 960, 432, 84, { fill: soft, stroke: border });
    g.illustration(i === 0 ? 'laptop' : 'server', x + 48, 1002, .4);
    g.text(x + 96, 995, title, 25, ink, 600);
    g.text(x + 96, 1026, detail, 22, muted);
  });
  // Execution, not local project references, owns the environment handoff.
  // Route outside the project card before joining the environment bus.
  g.path('M 1016 735 H 1040 V 909 H 800 V 948', { arrow: true });
  g.path('M 280 948 H 1320');
  [280, 800, 1320].forEach(x => g.path(`M ${x} 948 V 958`, { arrow: true }));
  g.rect(64, 1068, 1472, 48, { stroke: border, dashed: true });
  g.text(800, 1101, copy.planned, 23, muted, 400, 'middle');
  g.text(64, 1175, copy.delivery, 27, ink, 600);
  copy.deliverySteps.forEach(([title, detail], i) => {
    const x = xs[i];
    g.rect(x, 1200, 432, 84, { stroke: muted, dashed: true });
    g.text(x + 20, 1235, title, 25, ink, 600);
    g.text(x + 20, 1266, detail, 22, muted);
    if (i < 2) g.path(`M ${x + 442} 1242 H ${xs[i + 1] - 10}`, { dashed: true, arrow: true });
  });
  g.path('M 800 1117 V 1141', { dashed: true, arrow: true });
  g.text(1536, 1324, copy.feedback, 22, muted, 400, 'end');
  g.save(`openpero-architecture${lang === 'en' ? '' : '.zh-CN'}.svg`);
}
