import { AppParameterSchema } from '../app-sdk/src/app-use.ts';

/** The supported Point contract, converted once at the packaging boundary. */
export function pointAppManifest(app) {
  if (!app || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.name) || !app.version || !app.displayName)
    throw new Error('Invalid Point App identity');
  if (app.name.length > 64 || typeof app.version !== 'string' || app.version.length > 64 || typeof app.displayName !== 'string' || app.displayName.length > 200)
    throw new Error('Invalid Point App metadata');
  const panels = app.contributes?.panelTabs;
  if (!Array.isArray(panels) || panels.length < 1 || panels.length > 8)
    throw new Error('Point Apps require one to eight panels');
  for (const key of Object.keys(app.contributes))
    if (!['panelTabs', 'agentTools', 'examples'].includes(key)) throw new Error(`Unsupported Point contribution: ${key}`);
  for (const panel of panels) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(panel.id) || !panel.title || !safeEntry(panel.entry) || !panel.entry.endsWith('.mjs'))
    throw new Error('Point panel needs a stable id, title and relative .mjs entry');
  }
  if (new Set(panels.map(panel => panel.id)).size !== panels.length) throw new Error('Duplicate Point panel identity');
  const permissions = app.permissions ?? {};
  for (const [key, value] of Object.entries(permissions)) {
    if (!(key === 'storage' && typeof value === 'boolean') && (!['api', 'events', 'host'].includes(key) || !Array.isArray(value)))
      throw new Error(`Unsupported Point permission: ${key}`);
  }
  if (permissions.host?.length || permissions.events?.length)
    throw new Error('Point Host capabilities and events are not available in this adapter');
  const prefix = `/apps/${app.name}/api`;
  for (const path of permissions.api ?? []) {
    if (typeof path !== 'string' || !(path === '/api/projects' || path.startsWith('/api/projects/') || path === prefix || path.startsWith(prefix + '/') || path === `/api/apps/${app.name}/config` && permissions.storage) || !safeEntry(path.slice(1)))
      throw new Error(`Unsupported Point API permission: ${path}`);
  }
  if ((permissions.api ?? []).some(path => path.startsWith(prefix)) && !app.backend) throw new Error('Point API permission requires a backend');
  if (app.backend) {
    const backend = app.backend;
    if (!['python', 'node'].includes(backend.type) || !safeEntry(backend.entryPoint) || !(backend.type === 'python' ? backend.entryPoint.endsWith('.py') : /\.(mjs|cjs|js)$/.test(backend.entryPoint)) || backend.port !== 'auto' || backend.healthCheck !== '/health')
      throw new Error('Point backend requires Python/Node, automatic port and /health');
    const limit = backend.maxBodyBytes ?? 1048576;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 128 * 1024 * 1024)
      throw new Error('Point backend body limit must be between 1 byte and 128 MiB');
    for (const key of Object.keys(backend))
      if (!['type', 'entryPoint', 'port', 'healthCheck', 'maxBodyBytes'].includes(key)) throw new Error(`Unsupported Point backend field: ${key}`);
  }
  const examples = app.contributes.examples ?? [];
  if (!Array.isArray(examples) || examples.length > 32) throw new Error('Invalid Point examples');
  for (const example of examples) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(example.id) || !panels.some(panel => panel.id === example.panelId) || !safeEntry(example.entry) || !/^[a-f0-9]{64}$/.test(example.sha256)) throw new Error('Invalid Point example identity, entry or digest');
  }
  const tools = app.contributes.agentTools ?? [];
  if (!Array.isArray(tools) || tools.length > 10 || tools.length && !app.backend) throw new Error('Point agent tools require a backend and at most 10 routes');
  const names = new Set();
  for (const tool of tools) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(tool.name) || names.has(tool.name) || !tool.description || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(tool.method) || typeof tool.route !== 'string' || !tool.route.startsWith(prefix + '/') || !safeEntry(tool.route.slice(1)) || !tool.parameters || typeof tool.parameters !== 'object' || Array.isArray(tool.parameters) || !(permissions.api ?? []).some(path => tool.route === path || tool.route.startsWith(path + '/')))
      throw new Error('Invalid Point agent tool route or permission');
    AppParameterSchema.parse(tool.parameters);
    names.add(tool.name);
  }
  return {
    schemaVersion: 1, name: app.name, version: app.version,
    displayName: app.displayName, description: app.description ?? '',
    permissions: { host: [] },
    contributes: { panels: panels.map((panel, index) => ({ id: panel.id, title: panel.title, entry: index === 0 ? 'dist/index.html' : `dist/${panel.id}.html` })) },
    ...(app.backend ? { backend: { type: app.backend.type, entry: app.backend.type === 'python' ? 'point-backend.py' : 'point-backend.mjs' } } : {}),
  };
}
export function safeEntry(path) {
  return typeof path === 'string' && path.length > 0 && path.split('/').every(part => part && part !== '.' && part !== '..') && !/[\\:\x00?#]/.test(path);
}
