// Guides describe existing Pero Host capabilities; Try it composes a draft.
export const CAPABILITY_GUIDES = Object.freeze([
  { id: 'computer-use', title: '操作电脑', badge: '本机能力', tone: 'computer',
    summary: '查看已授权的桌面，执行获准的点击与输入。',
    lead: '可用范围由当前平台后端与系统授权决定。',
    can: ['检查桌面后端与授权', '查看画面、点击、输入与滚动', '截图核对操作结果'],
    bounds: ['工具使用沿用当前 Agent 会话的审批策略', 'Wayland 的截图范围不限制输入落点；启用输入前需核对全局输入授权'],
    examples: [{ id: 'inspect', label: '检查桌面能力', prompt: '请检查当前 Computer Use 后端、授权状态和可操作范围。只检查，不点击、输入或申请新的系统权限。' }] },
  { id: 'app-use', title: 'App Use', badge: '本机能力', tone: 'app',
    summary: '读取与操作工作台中已打开的 App 面板。',
    lead: '共享当前 App 的状态与操作入口，会话和授权由 Host 管理。',
    can: ['读取面板暴露的状态与动作', '操作活动面板，等待并核对结果', '截图面板或指定区域'],
    bounds: ['隐藏面板只读；截图与操作要求面板可见且活动', '工具使用沿用当前 Agent 会话的审批策略'],
    examples: [{ id: 'inspect', label: '检查当前面板', prompt: '/app-use 检查当前打开的 App 面板，描述内容和可用动作。只读取，不修改配置、凭据或工具权限。' }] },
]);
const english = [
  { title: 'Computer Use', badge: 'Host capability', summary: 'Inspect an authorized desktop and perform permitted clicks and input.',
    lead: 'Available operations depend on the platform backend and system permission.',
    can: ['Inspect the desktop backend and permissions', 'Observe, click, type and scroll', 'Capture evidence to check a result'],
    bounds: ['Tools follow the current Agent conversation permission policy', 'Wayland capture scope does not constrain input targets; check global input permission before enabling input'],
    examples: [{ id: 'inspect', label: 'Inspect desktop capabilities', prompt: 'Inspect the current Computer Use backend, permission state and available scope. Only inspect; do not click, type or request new system permission.' }] },
  { title: 'App Use', badge: 'Host capability', summary: 'Read and operate App panels open in the workbench.',
    lead: 'The Host owns the conversation and permission for exposed App state and actions.',
    can: ['Read exposed panel state and actions', 'Operate an active panel, wait and verify', 'Capture a panel or region'],
    bounds: ['Hidden panels are read-only; screenshots and actions require an active visible panel', 'Tools follow the current Agent conversation permission policy'],
    examples: [{ id: 'inspect', label: 'Inspect the current panel', prompt: '/app-use Inspect the App panel currently open. Describe its content and available actions. Only read; do not change configuration, credentials or tool permissions.' }] },
];
export const capabilityGuides = (locale = 'zh') => CAPABILITY_GUIDES.map((guide, i) => locale === 'zh' ? guide : { ...guide, ...english[i] });
export function visibleCapabilityGuides(query, category, locale = 'zh') {
  const q = String(query ?? '').trim().toLocaleLowerCase();
  if (category !== 'all' && !q) return [];
  return capabilityGuides(locale).filter(guide => !q || [guide.id, guide.title, guide.summary, guide.badge, guide.lead].join('\n').toLocaleLowerCase().includes(q));
}
