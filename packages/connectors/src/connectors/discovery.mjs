// Local discovery for directory entries whose runtime the user installs
// themselves (MATLAB, Simulink, Ansys). A stdio definition has to name an
// absolute, symlink-free executable and pin its SHA-256; asking an engineer to
// type both is the wrong way round. The trusted host looks in the places these
// tools actually land, hashes what it finds and hands back a definition that is
// ready to save — saving still goes through `put` and its approval.
//
// Generic discovery only reads fixed locations and hashes files. The Feishu
// adapter also runs its pinned native CLI's fixed read-only identity check.
// Neither path installs software or changes authorization/configuration.

import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';
import { discoverFeishuWorkspace } from './feishu-workspace/discovery.mjs';
import { discoverScience } from './science/discovery.mjs';
import { scienceSpecs } from './science/specs.mjs';

const MAX_CANDIDATES = 8;
// Solver licensing and install roots a vendor server may need; Point starts
// every stdio process with an empty environment, so these are passed through
// by name only when the host itself has them.
const PASSTHROUGH_ENV = /^(AWP_ROOT\d+|ANSYSLMD_LICENSE_FILE|ANSYSLI_SERVERS|ANSYS\d+_DIR|MLM_LICENSE_FILE|LM_LICENSE_FILE)$/;

/** Where uv/pipx/Homebrew/conda and a browser download put an executable. */
export function executableSearchPaths({ env = process.env, homedir = osHomedir(), extraDirs = [] } = {}) {
  const home = dir => join(homedir, dir);
  return [...new Set([
    // Point's own managed installs outrank anything else on the machine.
    ...extraDirs,
    ...String(env.PATH ?? '').split(':').filter(dir => dir.startsWith('/')),
    home('.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', home('bin'),
    home('miniconda3/bin'), home('miniforge3/bin'), home('anaconda3/bin'), home('.venv/bin'),
    home('Downloads'), home('Applications'),
  ])];
}

async function listDir(dir) { try { return await readdir(dir); } catch { return []; } }
async function fileInfo(path) { try { return await stat(path); } catch { return null; } }

async function pin(path) {
  const resolved = await realpath(path);
  const info = await fileInfo(resolved);
  if (!info?.isFile()) return null;
  return {
    path: resolved,
    sha256: createHash('sha256').update(await readFile(resolved)).digest('hex'),
    executable: (info.mode & 0o111) !== 0,
  };
}

export async function findExecutables(names, { prefix = false, dirs }) {
  const found = new Map();
  for (const dir of dirs) {
    const entries = prefix ? await listDir(dir) : names;
    for (const entry of entries) {
      if (!names.some(name => prefix ? entry.startsWith(name) && !/\.(zip|gz|tgz|dmg|txt|json|md|partial)$/i.test(entry) : entry === name)) continue;
      try {
        const candidate = await pin(join(dir, entry));
        if (candidate && !found.has(candidate.path)) found.set(candidate.path, candidate);
      } catch { /* dangling link or unreadable file: not a candidate */ }
      if (found.size >= MAX_CANDIDATES) return [...found.values()];
    }
  }
  // Runnable first; a downloaded binary without its execute bit still shows,
  // so the card can say what is missing instead of "not found".
  return [...found.values()].sort((a, b) => Number(b.executable) - Number(a.executable));
}

async function findMatlabRoots() {
  const roots = (await listDir('/Applications')).filter(name => /^MATLAB_R\d{4}[ab]\.app$/.test(name)).sort().reverse();
  const valid = [];
  for (const name of roots) if ((await fileInfo(join('/Applications', name, 'bin', 'matlab')))?.isFile()) valid.push(join('/Applications', name));
  return valid;
}

async function findSimulinkExtension(homedir) {
  const bases = [homedir, join(homedir, 'Documents'), join(homedir, 'Documents/MATLAB'), join(homedir, 'Documents/MATLAB/Add-Ons/Toolboxes'),
    join(homedir, 'Library/Application Support/MathWorks/MATLAB Add-Ons/Toolboxes'),
    join(homedir, 'Downloads'), join(homedir, 'Developer'), join(homedir, 'Projects'), join(homedir, 'src'), join(homedir, 'code')];
  const found = [];
  for (const base of bases) {
    for (const entry of await listDir(base)) {
      if (!/simulink[\s_-]*agentic[\s_-]*toolkit/i.test(entry)) continue;
      const candidate = join(base, entry, 'tools', 'tools.json');
      try {
        // Only the toolkit's own descriptor qualifies, not any tools.json.
        if ((await readFile(candidate, 'utf8')).includes('"model_overview"')) found.push(await realpath(candidate));
      } catch { /* not this one */ }
    }
  }
  return [...new Set(found)];
}

/**
 * Looks for what a directory entry's `discovery` block names and returns the
 * candidates plus a ready definition built from the first of each, or `null`
 * for a requirement nothing satisfied.
 */
export async function discoverProvider(provider, { env = process.env, homedir = osHomedir(), extraDirs = [], feishuBundles, scienceBundles, nodeExecutable } = {}) {
  const spec = provider?.discovery;
  if (!spec || provider.transport !== 'stdio') throw Object.assign(new Error('provider has no discovery'), { code: 'MCP_ARGUMENT' });
  if (scienceSpecs.some(item => item.providerId === provider.providerId)) {
    return discoverScience(provider, { nodes: await findExecutables(['node'], { dirs: executableSearchPaths({ env, homedir, extraDirs }) }), home: homedir, bundles: scienceBundles });
  }
  if (provider.providerId === 'feishu-workspace') {
    const dirs = executableSearchPaths({ env, homedir, extraDirs });
    // The desktop-supplied runtime is authoritative; do not silently replace a
    // missing bundled runtime with a different executable from PATH.
    const bundledNode = nodeExecutable ? await pin(nodeExecutable).catch(() => null) : null;
    return discoverFeishuWorkspace(provider, {
      launchers: await findExecutables(spec.executables, { dirs }),
      nodes: nodeExecutable ? (bundledNode ? [bundledNode] : []) : await findExecutables(['node'], { dirs }), home: homedir, bundles: feishuBundles,
    });
  }
  const found = {
    command: await findExecutables(spec.executables, { prefix: !!spec.prefix, dirs: executableSearchPaths({ env, homedir, extraDirs }) }),
    matlabRoot: spec.matlabRoot ? await findMatlabRoots() : [],
    extensionFile: spec.extensionFile ? await findSimulinkExtension(homedir) : [],
  };
  const environment = { HOME: homedir };
  // The first OPC UA connection targets the local simulator. A real gateway
  // requires the user to edit this address explicitly before saving.
  if (provider.providerId === 'opc-ua') environment.OPCUA_SERVER_URL = 'opc.tcp://127.0.0.1:4840';
  if (provider.providerId === 'mlflow') Object.assign(environment, { MLFLOW_TRACKING_URI: 'http://127.0.0.1:5000', MLFLOW_MCP_TOOLS: 'traces' });
  if (provider.providerId === 'galaxy') Object.assign(environment, { GALAXY_URL: 'https://usegalaxy.org', GALAXY_API_KEY: { secretRef: 'galaxy.api-key' } });
  if (provider.providerId === 'jupyter') Object.assign(environment, { JUPYTER_URL: 'http://127.0.0.1:8888', JUPYTER_TOKEN: { secretRef: 'jupyter.token' }, DOCUMENT_ID: '', START_NEW_CODE_SANDBOX: 'false' });
  if (provider.providerId === 'zotero') Object.assign(environment, { ZOTERO_LOCAL: 'true', ZOTERO_MCP_TOOLSETS: 'none' });
  if (provider.providerId === 'biocontext') environment.MCP_ENVIRONMENT = 'DEVELOPMENT';
  for (const [key, value] of Object.entries(env)) if (PASSTHROUGH_ENV.test(key) && typeof value === 'string' && value) environment[key] = value;
  return { found, definition: discoveredDefinition(provider, { command: found.command[0], matlabRoot: found.matlabRoot[0], extensionFile: found.extensionFile[0], env: environment }) };
}

/** Fills the entry's launch template with chosen discoveries. Pure, so the page can re-run it when the user picks another candidate. */
export function discoveredDefinition(provider, { command, matlabRoot, extensionFile, env } = {}) {
  const template = provider.stdioTemplate ?? {};
  const args = (template.args ?? []).map(arg => arg === '--matlab-root=' ? `--matlab-root=${matlabRoot ?? ''}`
    : arg === '--extension-file=' ? `--extension-file=${extensionFile ?? ''}` : arg);
  return {
    transport: 'stdio', command: command?.path ?? '', sha256: command?.sha256 ?? '',
    args, ...(env ? { env } : {}),
    callTimeoutMs: template.callTimeoutMs ?? 30000, ...(template.initializeTimeoutMs ? { initializeTimeoutMs: template.initializeTimeoutMs } : {}),
    tools: provider.defaultTools ?? (provider.operations ?? []).map(operation => operation.tool),
  };
}
