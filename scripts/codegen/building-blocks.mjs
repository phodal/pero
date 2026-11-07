import { Graphic, ink, muted, border, soft, wash } from './research-graphics.mjs';

// ADR 0007/0008/0014/0025/0027: local App/plugin/session wiring is implemented.
// This is not marketplace, remote App deployment or complete Task/Run acceptance.
const locales = {
  en: {
    title: 'Domain Apps, composed for people and agents.',
    description: 'A domain defines methods, inputs, outputs and checks. Its App owns UI, data and an optional backend, reused in a standalone Product or the Workbench. Implemented local App Agent Plugin declarations and dependency packages supply instructions, Skills and MCP to Host-owned ACP sessions. Declared App data routes remain scoped and approved. App SDK and Host own lifecycle, processes, credentials and sessions; each Product has its own Host and data. App-to-Task/Run and remote deployment integration remain planned. Solid lines mean implementation foundations, not acceptance on every platform.',
    domain: 'DOMAIN', definition: 'Methods · Inputs · Outputs · Checks',
    app: 'App', appDetails: ['Domain UI · Data · Optional backend', 'Paper · Virtual Cell · Control Lab'],
    plugin: 'App Agent Plugins', pluginDetails: ['Instructions · Skills · MCP dependencies', 'Local packages, scoped to the session'],
    bridge: ['Declared', 'App tools'],
    product: 'Standalone product / Workbench', productNote: 'Reuse the same App',
    session: 'Host-owned Agent sessions', sessionNote: 'Frozen capabilities · Approvals · Call limits',
    platform: 'Shared foundation', platformItems: 'App SDK · Host runtime · ACP',
    platformNote: 'Lifecycle, backend processes and credentials stay with Host.',
    isolation: 'Shared implementation; product-specific Host and data.',
    planned: 'Next integration', plannedItems: 'App → Task / Run · Remote App deployment',
    legend: 'Solid: implementation foundation   ·   Dashed: planned integration',
  },
  'zh-CN': {
    title: '领域 App，为研究者与 Agent 组合能力。',
    description: '领域定义方法、输入、输出与检查规则。App 拥有界面、数据与可选后端，可复用于独立 Product 和工作台。已有本地 App Agent Plugin 声明与依赖包，为 Host 拥有的 ACP 会话提供指引、Skills 和 MCP；声明的 App 数据路由仍受范围和审批约束。App SDK 与 Host 负责生命周期、进程、凭据与会话，各 Product 保持自己的 Host 和数据。App 到 Task/Run、远程部署仍待集成。实线只表示实现基础，不表示所有平台均已验收。',
    domain: '领域', definition: '方法 · 输入 · 输出 · 检查规则',
    app: 'App', appDetails: ['领域界面 · 数据 · 可选后端', 'Paper · Virtual Cell · Control Lab'],
    plugin: 'App Agent Plugins', pluginDetails: ['指引 · Skills · MCP 依赖', '本地能力包，限定于当前会话'],
    bridge: ['声明的', 'App 工具'],
    product: '独立产品 / 工作台', productNote: '复用同一个 App',
    session: 'Host 管理的 Agent 会话', sessionNote: '冻结能力 · 审批 · 调用限额',
    platform: '共享基础', platformItems: 'App SDK · Host runtime · ACP',
    platformNote: '生命周期、后端进程与凭据由 Host 持有。',
    isolation: '复用实现；各产品拥有自己的 Host 和数据。',
    planned: '后续接线', plannedItems: 'App → Task / Run · 远程 App 部署',
    legend: '实线：已有实现基础   ·   虚线：规划或待接通的关系',
  },
};
for (const [lang, copy] of Object.entries(locales)) {
  const g = new Graphic(1600, 940, lang, `Pero — ${copy.title}`, copy.description);
  g.text(64, 59, copy.title, 36, ink, 700);
  g.rect(64, 96, 1472, 65, { fill: wash, stroke: 'none', radius: 12 });
  g.text(90, 139, copy.domain, 23, ink, 600);
  g.text(288, 139, copy.definition, 26, ink, 500);
  g.halo(422, 289, 217, 97, true);
  g.halo(1178, 289, 217, 97);
  g.illustration('app', 422, 279, 1.52);
  g.illustration('database', 575, 316, .56);
  g.illustration('plugin', 1178, 279, 1.52);
  g.text(422, 432, copy.app, 32, ink, 700, 'middle');
  g.text(1178, 432, copy.plugin, 32, ink, 700, 'middle');
  g.lines(422, 476, copy.appDetails, 24);
  g.lines(1178, 476, copy.pluginDetails, 24);
  g.path('M 673 285 H 927', { arrow: true });
  g.lines(800, 232, copy.bridge, 22, muted, 'middle', 30);
  g.path('M 422 528 V 566', { arrow: true });
  g.path('M 1178 528 V 566', { arrow: true });
  [[174, 422, copy.product, copy.productNote], [930, 1178, copy.session, copy.sessionNote]].forEach(([x, center, title, detail]) => {
    g.rect(x, 580, 496, 94, { stroke: border, radius: 10 });
    g.text(center, 619, title, 26, ink, 600, 'middle');
    g.text(center, 654, detail, 22, muted, 400, 'middle');
  });
  g.path('M 422 674 V 709 M 1178 674 V 709', { color: border });
  g.rect(64, 710, 1472, 111, { fill: soft, stroke: 'none', radius: 14 });
  g.illustration('server', 118, 766, .5);
  g.text(174, 751, copy.platform, 26, ink, 600);
  g.text(174, 792, copy.platformItems, 24);
  g.text(1497, 751, copy.platformNote, 24, muted, 400, 'end');
  g.text(1497, 792, copy.isolation, 22, muted, 400, 'end');
  g.rect(64, 845, 1472, 49, { stroke: border, dashed: true, radius: 8 });
  g.text(87, 879, copy.planned, 23, muted, 600);
  g.text(385, 879, copy.plannedItems, 23, muted);
  g.text(64, 927, copy.legend, 20, muted);
  g.save(`openpero-building-blocks${lang === 'en' ? '' : '.zh-CN'}.svg`);
}
