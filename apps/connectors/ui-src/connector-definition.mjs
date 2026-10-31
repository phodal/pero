// Defaults only; the native service validates each saved definition.
export function seedDefinition(entry) {
  if (!entry) return { transport: 'http', url: '', tools: [], callTimeoutMs: 30000 };
  entry = structuredClone(entry);
  if (entry.transport === 'stdio') {
    return { transport: 'stdio', command: '', sha256: '', callTimeoutMs: 30000, ...structuredClone(entry.stdioTemplate ?? {}),
      ...(entry.providerId === 'opc-ua' ? { env: { OPCUA_SERVER_URL: 'opc.tcp://127.0.0.1:4840' } } : {}),
      ...(entry.providerId === 'mlflow' ? { env: { MLFLOW_TRACKING_URI: 'http://127.0.0.1:5000', MLFLOW_MCP_TOOLS: 'traces' } } : {}),
      ...(entry.providerId === 'galaxy' ? { env: { GALAXY_URL: 'https://usegalaxy.org', GALAXY_API_KEY: { secretRef: 'galaxy.api-key' } } } : {}),
      ...(entry.providerId === 'jupyter' ? { env: { JUPYTER_URL: 'http://127.0.0.1:8888', JUPYTER_TOKEN: { secretRef: 'jupyter.token' }, DOCUMENT_ID: '', START_NEW_CODE_SANDBOX: 'false' } } : {}),
      ...(entry.providerId === 'zotero' ? { env: { ZOTERO_LOCAL: 'true', ZOTERO_MCP_TOOLSETS: 'none' } } : {}),
      ...(entry.providerId === 'biocontext' ? { env: { MCP_ENVIRONMENT: 'DEVELOPMENT' } } : {}),
      ...(entry.providerId === 'fmu-runtime' ? { env: { POINT_FMU_MODEL_ROOT: '', POINT_FMU_WORK_ROOT: '', POINT_FMU_PYTHON: '' } } : {}),
      ...(entry.providerId === 'elabftw' ? { env: { POINT_ELABFTW_API_BASE_URL: '', POINT_ELABFTW_SECRET_REF: 'elabftw.api-key', POINT_ELABFTW_API_KEY: { secretRef: 'elabftw.api-key' } } } : {}),
      tools: entry.defaultTools ?? (entry.operations ?? []).map(operation => operation.tool) };
  }
  if (entry.transport === 'gmail') {
    return { transport: 'gmail', url: 'https://gmail.googleapis.com/gmail/v1/users/me/', tools: entry.operations.map(operation => operation.tool),
      appSecret: { secretRef: 'gmail.client-secret' }, callTimeoutMs: 30000,
      oauth: { issuer: 'https://accounts.google.com', clientId: '', redirectUri: 'http://127.0.0.1:34567/callback', scopes: entry.auth.recommendedScopes, persist: true } };
  }
  if (entry.transport === 'microsoft365') {
    return { transport: 'microsoft365', url: 'https://graph.microsoft.com/v1.0/', tools: entry.operations.map(operation => operation.tool),
      oauth: { issuer: 'https://login.microsoftonline.com/organizations/v2.0', clientId: '', redirectUri: 'http://127.0.0.1:34567/callback', scopes: entry.auth.recommendedScopes, persist: true } };
  }
  if (entry.transport === 'gitlab') {
    return { transport: 'gitlab', url: 'https://gitlab.com/api/v4/', tools: entry.operations.map(operation => operation.tool),
      headers: { 'PRIVATE-TOKEN': { secretRef: 'gitlab.token' } }, callTimeoutMs: 30000 };
  }
  if (entry.transport === 'github') {
    return { transport: 'github', url: 'https://api.github.com/', tools: entry.operations.map(operation => operation.tool),
      headers: { Authorization: { secretRef: 'github.token' } }, callTimeoutMs: 30000 };
  }
  if (entry.transport === 'linear') {
    return { transport: 'linear', url: 'https://api.linear.app/graphql', tools: entry.operations.map(operation => operation.tool),
      headers: { Authorization: { secretRef: 'linear.token' } }, callTimeoutMs: 30000 };
  }
  const base = { transport: 'http', url: entry.endpoint ?? '', tools: entry.defaultTools ?? (entry.operations ?? []).map(operation => operation.tool), callTimeoutMs: 30000 };
  if (entry.providerId === 'wandb') return { ...base, headers: { Authorization: { secretRef: 'wandb.token' } } };
  if (entry.providerId === 'autodesk-fusion') return { ...base, allowLoopbackHttp: true };
  if (entry.providerId === 'foxglove') return { ...base, allowLoopbackHttp: true, headers: { Authorization: { secretRef: 'foxglove.token' } } };
  if (entry.providerId === 'highbyte') return { ...base, headers: { Authorization: { secretRef: 'highbyte.token' } } };
  if (entry.providerId === 'seqera') return { ...base, headers: { Authorization: { secretRef: 'seqera.token' } } };
  if (entry.providerId === 'labkey') return { ...base, headers: { apikey: { secretRef: 'labkey.api-key' } } };
  return entry.auth?.mode === 'user-oauth'
    ? { ...base, oauth: { issuer: entry.oauthIssuer ?? '', ...(entry.auth.registration === 'dcr' ? { registration: 'dcr' } : { clientId: '' }), redirectUri: 'http://127.0.0.1:34567/callback', scopes: entry.auth.recommendedScopes ?? [], persist: true } } : base;
}

// Connection settings that need a form before executable discovery can finish setup.
/** @type {Record<string, { key: string, zh: string, en: string, kind: string }[]>} */
export const researchFields = {
  'science-pubmed': [{ key: 'NCBI_EMAIL', zh: 'NCBI 联系邮箱', en: 'NCBI contact email', kind: 'email' }],
  mlflow: [{ key: 'MLFLOW_TRACKING_URI', zh: 'Tracking 服务地址', en: 'Tracking server URL', kind: 'url' }],
  galaxy: [{ key: 'GALAXY_URL', zh: 'Galaxy 服务地址', en: 'Galaxy server URL', kind: 'url' }],
  jupyter: [
    { key: 'JUPYTER_URL', zh: 'Jupyter 服务地址', en: 'Jupyter server URL', kind: 'url' },
    { key: 'DOCUMENT_ID', zh: '已有 Notebook 相对路径', en: 'Existing notebook relative path', kind: 'notebook' },
  ],
};
/** OS credential storage references a definition binds through `{ secretRef }`, in first-seen order. */
export function secretReferences(definition) {
  const found = new Set();
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.secretRef === 'string' && value.secretRef.trim()) found.add(value.secretRef.trim());
    for (const child of Object.values(value)) visit(child);
  };
  visit(definition);
  return [...found];
}
export function validateResearchSettings(providerId, definition, locale = 'zh') {
  for (const field of researchFields[providerId] ?? []) {
    const value = definition?.env?.[field.key];
    let valid = typeof value === 'string' && value.trim() === value && value.length > 0;
    if (valid && field.kind === 'url') {
      try { const url = new URL(value); valid = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; } catch { valid = false; }
    }
    if (valid && field.kind === 'notebook') valid = !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..') && value.endsWith('.ipynb');
    if (valid && field.kind === 'email') valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
    if (!valid) return { field: field.key, message: locale === 'zh'
      ? field.kind === 'url' ? `请填写有效的${field.zh}，不要在地址中放入凭据、查询参数或片段。` : field.kind === 'email' ? '请填写有效的 NCBI 联系邮箱。' : '请填写已有 .ipynb 文件的相对路径，不含 ..。'
      : field.kind === 'url' ? `Enter a valid ${field.en} without credentials, query parameters, or fragments.` : field.kind === 'email' ? 'Enter a valid NCBI contact email.' : 'Enter the relative path of an existing .ipynb file without .. segments.' };
  }
  return null;
}
// Rechecking an executable must not discard a form filled while discovery ran.
export function mergeResearchDiscovery(current, discovered) {
  if (discovered?.env?.POINT_SCIENCE_ROOT) return { ...discovered, ...(Array.isArray(current.tools) ? { tools: current.tools } : {}), env: { ...discovered.env, ...(current.env?.NCBI_EMAIL ? { NCBI_EMAIL: current.env.NCBI_EMAIL } : {}), ...(current.env?.NCBI_API_KEY ? { NCBI_API_KEY: current.env.NCBI_API_KEY } : {}) } };
  return { ...discovered, ...current, ...(discovered.command ? { command: discovered.command, sha256: discovered.sha256 } : {}), env: { ...discovered.env, ...current.env } };
}
