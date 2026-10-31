import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { createCliRunner, safeIdentity } from './client.mjs';

export const feishuBundleCandidates = [];
async function pin(path) {
  const resolved = await realpath(path), info = await stat(resolved);
  if (!info.isFile()) throw new Error('not a file');
  return { path: resolved, sha256: createHash('sha256').update(await readFile(resolved)).digest('hex'), executable: !!(info.mode & 0o111) };
}

/** Resolve npm's official launcher to its native binary; never run the auto-download wrapper. */
export async function discoverFeishuWorkspace(provider, { launchers, nodes, home, bundles = feishuBundleCandidates, profile = 'point-readonly' }) {
  const found = { command: nodes.filter(node => node.executable).slice(0, 1), matlabRoot: [], extensionFile: [], nativeCli: [], account: null, setupError: null };
  let bundle;
  for (const path of bundles) { try { bundle = await pin(path); break; } catch { /* not built here */ } }
  for (const launcher of launchers) {
    try {
      const root = resolve(dirname(launcher.path), '..');
      const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
      if (pkg.name !== '@larksuite/cli') continue;
      const binary = await pin(resolve(root, 'bin', process.platform === 'win32' ? 'lark-cli.exe' : 'lark-cli'));
      if (binary.executable) found.nativeCli.push(binary);
    } catch { /* not the supported npm installation */ }
  }
  const node = found.command[0], binary = found.nativeCli[0];
  if (!node || !binary || !bundle) {
    found.setupError = !node ? 'FEISHU_NODE_MISSING' : !binary ? 'FEISHU_CLI_MISSING' : 'FEISHU_BUNDLE_MISSING';
    return { found, definition: null };
  }
  try {
    // This exception to generic discovery is a fixed read-only identity check.
    // It uses the CLI's credential store and returns no credential bytes.
    found.account = safeIdentity(await createCliRunner({ binary: binary.path, sha256: binary.sha256, home, profile })(['auth', 'status', '--json', '--verify']));
    const info = await createCliRunner({ binary: binary.path, sha256: binary.sha256, home, profile })(['api', 'GET', '/open-apis/authen/v1/user_info', '--as', 'user', '--format', 'json']);
    if (info?.ok !== true || info.identity !== 'user' || info.data?.open_id !== found.account.openId || !/^[A-Za-z0-9_-]{1,128}$/.test(info.data?.tenant_key ?? '')) throw Object.assign(new Error('FEISHU_ACCOUNT_CHANGED'), { code: 'FEISHU_ACCOUNT_CHANGED' });
    found.account.tenantId = info.data.tenant_key;
  } catch (error) {
    found.setupError = /^FEISHU_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'FEISHU_AUTH_REQUIRED';
    return { found, definition: null };
  }
  return { found, definition: {
    transport: 'stdio', command: node.path, sha256: node.sha256, args: [bundle.path],
    files: [{ path: bundle.path, sha256: bundle.sha256 }, { path: binary.path, sha256: binary.sha256 }],
    env: { HOME: home, POINT_FEISHU_CLI: binary.path, POINT_FEISHU_CLI_SHA256: binary.sha256, POINT_FEISHU_PROFILE: profile,
      POINT_FEISHU_APP_ID: found.account.appId, POINT_FEISHU_OPEN_ID: found.account.openId, POINT_FEISHU_TENANT_ID: found.account.tenantId,
      POINT_FEISHU_CONNECTION_ID: 'feishu-workspace' },
    initializeTimeoutMs: 45000, callTimeoutMs: 45000,
    // Consent never silently admits newly available write tools.
    tools: ['feishu_account_get', 'feishu_documents_search', 'feishu_document_get'],
  } };
}
