import React from 'react';
import { Icon as SharedIcon, type ShellIconName, type UiIconName } from './ui';
import type { DirectoryEntry } from './connector-types.ts';

const pointColor = (token: string, fallback: string): string => { try { const v = getComputedStyle(document.body ?? document.documentElement).getPropertyValue(`--pero-${token}`).trim(); return v || fallback; } catch { return fallback; } }; // design tokens v3: concrete colour for canvas/SVG attributes, literal is the token's default
export const PROVIDER_SUMMARIES: Record<string, string> = {
  gitlab: '仓库、Issue、Merge Request 与 CI 上下文的只读访问',
  github: '仓库、Issue 与 Pull Request 的只读访问',
  linear: '团队与 Issue 的只读访问',
  'microsoft-365': '邮件、日历与文件的只读访问',
  'remote-oauth': '通过 OAuth 添加远程 MCP 服务',
  'remote-token': '使用密钥连接远程 MCP 服务',
  'local-process': '从本地命令启动 stdio MCP 服务',
  'point-builtin': 'Pero 自带的本地工具与能力',
};
export const PROVIDER_SUMMARIES_EN: Record<string, string> = {
  gitlab: 'Read-only repository, issue, merge request, and CI context',
  github: 'Read-only repository, issue, and pull request access',
  linear: 'Read-only team and issue access',
  'microsoft-365': 'Read-only mail, calendar, and file access',
  'remote-oauth': 'Add a remote MCP service with OAuth',
  'remote-token': 'Connect to a remote MCP service with a token',
  'local-process': 'Start a stdio MCP service from a local command',
  'point-builtin': 'Local tools and capabilities included with Pero',
  'ansys-aedt': 'Discover and start AEDT; manage projects, designs, analyses, and results for HFSS, Maxwell, and Icepak',
  'ansys-fluent': 'Connect to Fluent, inspect settings, validate and execute code, and generate simulation reports',
  'ansys-mapdl': 'Connect to local or remote MAPDL for batch commands, plotting, and result files',
  'ansys-mechanical': 'Start or connect to Mechanical for solving, postprocessing, screenshots, and result exports',
  matlab: 'Manage MATLAB sessions, execute code and tests, and analyze results',
  simulink: 'Read, edit, inspect, and test Simulink, Simscape, and Stateflow models',
};
export const AUTH_MODE_TEXT_EN: Record<string, string> = {
  none: 'No authentication', 'user-oauth': 'OAuth sign-in', 'user-qr': 'QR authorization',
  'shared-token': 'Configured token', 'service-identity': 'Service identity',
};
const BRAND_GLYPHS: Record<string, { path: string; color?: string }> = {
  github: { path: 'M12 .3A12 12 0 0 0 8.2 23.7c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3Z' },
  gitlab: { path: 'm23.6 9.6-3.3-8.6a.9.9 0 0 0-1.6.1l-2.2 6.7h-9L5.3 1.1A.9.9 0 0 0 3.7 1L.4 9.5a6.1 6.1 0 0 0 2 7.1l9 6.8a1 1 0 0 0 1.2 0l9-6.8a6.1 6.1 0 0 0 2-7Z', color: pointColor('domain-dsh-go-web-color-text-2', '#FC6D26') },
  linear: { path: 'M2.9 4.2A12 12 0 1 1 19.8 21.1L2.9 4.2Zm-1.1 1.4 16.6 16.6c-.5.3-1.1.6-1.7.8L1 7.3c.2-.6.5-1.1.8-1.7ZM.3 9.2l14.5 14.5c-.7.2-1.4.3-2.2.3L0 11.4c0-.8.1-1.5.3-2.2ZM.2 14l9.8 9.8A12 12 0 0 1 .2 14Z', color: pointColor('domain-dsh-go-web-color-text-1', '#5E6AD2') },
  notion: { path: 'M4.5 4.2c.7.6 1 .6 2.4.5l13.2-.8c.3 0 0-.3 0-.3L17.9 2c-.4-.3-1-.7-2.1-.6L3 2.3c-.5 0-.6.3-.4.5l1.9 1.4Zm.8 3.1v13.9c0 .7.4 1 1.2 1l14.5-.9c.8 0 .9-.6.9-1.1V6.4c0-.6-.2-1-.7-.9L6 6.4c-.6 0-.7.3-.7.9Zm14.3.7c.1.4 0 .9-.4.9l-.7.2v10.2c-.6.3-1.2.5-1.7.5-.7 0-.9-.2-1.5-.9l-4.5-7.2v7l1.4.3s0 .8-1.2.8l-3.2.2c-.1-.2 0-.7.3-.8l.9-.2V9.9l-1.2-.1c-.1-.4.1-1 .8-1.1l3.5-.2 4.7 7.2V9.3l-1.2-.1c-.1-.6.3-.9.8-1l3.2-.2ZM1.9 1 15.2 0c1.7-.1 2.1 0 3.1.8l4.3 3c.7.5.9.6.9 1.2v16.3c0 1-.4 1.7-1.7 1.8l-15.4.9c-1 0-1.5-.1-2-.8l-3.1-4c-.6-.7-.8-1.3-.8-2V2.7c0-.9.4-1.6 1.4-1.7Z' },
  vercel: { path: 'm12 1.6 12 20.8H0Z' },
};
const namedDomainIcons: Record<string, { family?: 'shell'; name: UiIconName | ShellIconName }> = {
  cad: { name: 'cube' },
  signal: { name: 'activity' },
  replay: { family: 'shell', name: 'replay' },
  evidence: { name: 'document' },
  target: { name: 'target' },
  simulation: { name: 'simulation' },
  notebook: { name: 'notebook' },
  gateway: { name: 'gateway' },
  test: { name: 'test' },
  manufacturing: { name: 'manufacturing' },
  circuit: { name: 'circuit' },
  workflow: { name: 'nodes' },
  protein: { name: 'protein' },
  bom: { name: 'table' },
  instrument: { name: 'activity' },
  robot: { family: 'shell', name: 'agent' },
};
function namedConnectorIcon(entry: DirectoryEntry) {
  const domain = namedDomainIcons[entry.iconId ?? ''];
  if (domain) return domain;
  if (entry.transport === 'stdio') return { family: 'shell' as const, name: 'ssh' as const };
  if (entry.transport === 'builtin') return { family: 'shell' as const, name: 'computer' as const };
  return { name: 'connector' as const };
}
// Official marks from Wikimedia Commons or the vendors; see assets/connectors/SOURCES.md.
// Bundled as data URIs so the catalog works offline and fits the workbench CSP.
export function GuideArt({ tone }: { tone: string }) {
  return <span className="point-connectors-guide-art" data-tone={tone} aria-hidden="true">
    <span className="point-connectors-guide-art-bar" />
    <span className="point-connectors-guide-art-line" />
    <span className="point-connectors-guide-art-line" data-short="true" />
  </span>;
}
export function ProviderIcon({ entry }: { entry: DirectoryEntry }) {
  const brand = entry.brand ? BRAND_GLYPHS[entry.brand] : undefined;
  if (brand) return <SharedIcon size={18} stroke="none" style={brand.color ? { color: brand.color } : undefined} glyph={{ viewBox: '0 0 24 24', children: <path d={brand.path} fill="currentColor" /> }} />;
  return <span className="connector-provider-initial" aria-hidden="true">{entry.displayName.slice(0, 1)}</span>;
}

export const IMPORT_EXAMPLES: Record<string, string> = {
  stdio: JSON.stringify({ servers: { matlab: { type: 'stdio', command: '/usr/local/bin/matlab-mcp-server', args: [] } } }, null, 2),
  http: JSON.stringify({ mcpServers: { 'my-service': { type: 'http', url: 'https://mcp.example.com/mcp', headers: { 'X-Workspace': 'demo' } } } }, null, 2),
  oauth: JSON.stringify({ mcpServers: { 'my-service': { type: 'http', url: 'https://mcp.example.com/mcp',
    oauth: { issuer: 'https://auth.example.com', registration: 'dcr', redirectUri: 'http://127.0.0.1:34567/callback', scopes: [], persist: true } } } }, null, 2),
};
