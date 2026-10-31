/** The supported Point contract, converted once at the packaging boundary. */
export function pointAppManifest(app) {
  if (!app || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(app.name) || !app.version || !app.displayName)
    throw new Error('Invalid Point App identity');
  if (app.name.length > 64 || typeof app.version !== 'string' || app.version.length > 64 || typeof app.displayName !== 'string' || app.displayName.length > 200)
    throw new Error('Invalid Point App metadata');
  const panels = app.contributes?.panelTabs;
  if (!Array.isArray(panels) || panels.length !== 1)
    throw new Error('Point compatibility currently requires one panel');
  for (const key of Object.keys(app.contributes))
    if (key !== 'panelTabs') throw new Error(`Unsupported Point contribution: ${key}`);
  const panel = panels[0];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(panel.id) || !panel.title || !safeEntry(panel.entry) || !panel.entry.endsWith('.mjs'))
    throw new Error('Point panel needs a stable id, title and relative .mjs entry');
  const permissions = app.permissions ?? {};
  for (const [key, value] of Object.entries(permissions)) {
    if (!['api', 'events', 'host'].includes(key) || !Array.isArray(value))
      throw new Error(`Unsupported Point permission: ${key}`);
  }
  if (permissions.host?.length || permissions.events?.length)
    throw new Error('Point Host capabilities and events are not available in this adapter');
  const prefix = `/apps/${app.name}/api`;
  for (const path of permissions.api ?? []) {
    if (typeof path !== 'string' || !(path === prefix || path.startsWith(prefix + '/')) || !safeEntry(path.slice(1)))
      throw new Error(`Unsupported Point API permission: ${path}`);
  }
  if ((permissions.api?.length ?? 0) && !app.backend) throw new Error('Point API permission requires a backend');
  if (app.backend) {
    const backend = app.backend;
    if (backend.type !== 'python' || !safeEntry(backend.entryPoint) || !backend.entryPoint.endsWith('.py') || backend.port !== 'auto' || backend.healthCheck !== '/health')
      throw new Error('Point backend requires stdlib Python HTTPServer, automatic port and /health');
    if (!Number.isSafeInteger(backend.maxBodyBytes) || backend.maxBodyBytes < 1 || backend.maxBodyBytes > 16 * 1024 * 1024)
      throw new Error('Point backend body limit must be between 1 byte and 16 MiB');
    for (const key of Object.keys(backend))
      if (!['type', 'entryPoint', 'port', 'healthCheck', 'maxBodyBytes'].includes(key)) throw new Error(`Unsupported Point backend field: ${key}`);
  }
  return {
    schemaVersion: 1, name: app.name, version: app.version,
    displayName: app.displayName, description: app.description ?? '',
    permissions: { host: [] },
    contributes: { panels: [{ id: panel.id, title: panel.title, entry: 'dist/index.html' }] },
    ...(app.backend ? { backend: { type: 'python', entry: 'point-backend.py' } } : {}),
  };
}
export function safeEntry(path) {
  return typeof path === 'string' && path.length > 0 && path.split('/').every(part => part && part !== '.' && part !== '..') && !/[\\:\x00?#]/.test(path);
}
