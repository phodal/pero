// Presentation and draft checks for the per-Agent MCP connectors.
// Host admission in McpConfiguration::replace remains the authority.

const DECISIONS = new Set(['allow', 'ask', 'deny']);
const SERVER_KEYS = new Set(['name', 'enabled', 'transport', 'tool_policy']);
const POLICY_KEYS = new Set(['default', 'tools']);

const control = value => [...value].some(char => char.charCodeAt(0) < 32);

export const EMPTY_DRAFT = { name: '', transport: 'stdio', command: '', argsText: '[]', url: '', policy: 'legacy', toolsText: '{}' };

function absoluteCommand(command) {
  return command.startsWith('/') || command.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(command);
}

export function endpoint(server) {
  if (server?.transport?.type === 'http') return server.transport.url ?? '';
  return [server?.transport?.command, ...(server?.transport?.args ?? [])].filter(Boolean).join(' ');
}

export function draftFromServer(server) {
  const http = server?.transport?.type === 'http';
  return {
    name: server?.name ?? '',
    transport: http ? 'http' : 'stdio',
    command: http ? '' : server?.transport?.command ?? '',
    argsText: JSON.stringify(server?.transport?.args ?? []),
    url: http ? server.transport.url ?? '' : '',
    policy: DECISIONS.has(server?.tool_policy?.default) ? server.tool_policy.default : 'legacy',
    toolsText: JSON.stringify(server?.tool_policy?.tools ?? {}, null, 2),
  };
}

/** @returns {string} empty when the draft can be saved as a disabled server */
export function draftIssue(draft) {
  const name = draft.name.trim();
  if (!name || name.length > 128 || control(name)) return 'name';
  if (draft.transport === 'http') {
    const url = draft.url.trim();
    let parsed;
    try { parsed = new URL(url); } catch { return 'url'; }
    if (url.length > 4096 || !['http:', 'https:'].includes(parsed.protocol) || !parsed.host
      || parsed.username || parsed.password || parsed.search || parsed.hash
      || /[\s\\]/.test(url) || control(url)) return 'url';
  } else {
    const command = draft.command.trim();
    if (!absoluteCommand(command) || command.length > 4096 || command.includes('\0')) return 'command';
    let args;
    try { args = JSON.parse(draft.argsText || '[]'); } catch { return 'args'; }
    if (!Array.isArray(args) || args.length > 128 || args.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) return 'args';
  }
  if (draft.policy !== 'legacy') {
    if (!DECISIONS.has(draft.policy)) return 'tools';
    let tools;
    try { tools = JSON.parse(draft.toolsText || '{}'); } catch { return 'tools'; }
    if (!tools || typeof tools !== 'object' || Array.isArray(tools)) return 'tools';
    const entries = Object.entries(tools);
    if (entries.length > 256 || entries.some(([key, value]) => !key.trim() || key.length > 128 || control(key) || !DECISIONS.has(value))) return 'tools';
  }
  return '';
}

export function serverFromDraft(draft) {
  const issue = draftIssue(draft);
  if (issue) throw new Error(issue);
  const name = draft.name.trim();
  const transport = draft.transport === 'http'
    ? { type: 'http', url: draft.url.trim() }
    : { type: 'stdio', command: draft.command.trim(), args: JSON.parse(draft.argsText || '[]') };
  const server = { name, enabled: false, transport };
  if (draft.policy !== 'legacy') server.tool_policy = { default: draft.policy, tools: JSON.parse(draft.toolsText || '{}') };
  return server;
}

function rejectExtra(value, allowed) {
  return !value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.has(key));
}

export function importServers(text) {
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('import'); }
  if (!Array.isArray(value)) throw new Error('import');
  return value.map(item => {
    if (rejectExtra(item, SERVER_KEYS)) throw new Error('import');
    if (item.tool_policy != null && rejectExtra(item.tool_policy, POLICY_KEYS)) throw new Error('import');
    const transport = item.transport;
    const allowed = transport?.type === 'http' ? new Set(['type', 'url']) : transport?.type === 'stdio' ? new Set(['type', 'command', 'args']) : null;
    if (!allowed || rejectExtra(transport, allowed)) throw new Error('import');
    try { return serverFromDraft(draftFromServer(item)); }
    catch { throw new Error('import'); }
  });
}

export function withServer(servers, index, server) {
  const next = servers.slice();
  const saved = { ...server, enabled: false };
  if (index == null) next.push(saved);
  else next[index] = saved;
  return next;
}

export function withoutServer(servers, index) {
  return servers.filter((_, item) => item !== index);
}

export function withEnabled(servers, index, enabled) {
  return servers.map((server, item) => item === index ? { ...server, enabled } : server);
}

export function withImported(servers, added) {
  return [...servers, ...added.map(server => ({ ...server, enabled: false }))];
}

export function runtimeOf(name, sessions) {
  let unobservable = false;
  let found = null;
  for (const session of sessions ?? []) {
    if (!session || session.closed) continue;
    if (session.observable === false) { unobservable = true; continue; }
    const server = (session.servers ?? []).find(item => item.server === name);
    if (server) found = server;
  }
  if (found) return found;
  return unobservable ? { status: 'unobservable', tools: [] } : null;
}

export function needsAttention(server, sessions) {
  if (!server.enabled) return true;
  const runtime = runtimeOf(server.name, sessions);
  return !!runtime && ['error', 'disconnected', 'closed'].includes(runtime.status);
}

export function matchingServers(servers, query) {
  const text = query.trim().toLowerCase();
  if (!text) return servers;
  return servers.filter(server => server.name.toLowerCase().includes(text) || endpoint(server).toLowerCase().includes(text));
}
