// Managed installation of the vendor MCP servers engineering connectors run.
// A directory entry declares exactly one way to obtain its server; the page
// can only name the provider, never a command, package or URL. Point turns
// that declaration into one shell line the Host runs as a background job
// (install-jobs.mjs) the user can watch and cancel from the connector dialog.
// Everything lands under one Pero-owned root,
// whose bin/ directory discovery searches first, so an install never touches
// the user's own Python or PATH.

import { stat } from 'node:fs/promises';
import { homedir as osHomedir } from 'node:os';
import { join } from 'node:path';
import { executableSearchPaths } from './discovery.mjs';

const fail = (code, detail) => Object.assign(new Error(detail ?? code), { code, detail });

export const managedBin = root => join(root, 'bin');
/**
 * Managed installs are user-level, shared by every Desktop profile and build,
 * so they live under ~/.point. An isolated runtime (smoke runs) keeps its own.
 */
export const engineeringRoot = ({ isolatedRuntime = null, homedir = osHomedir() } = {}) =>
  isolatedRuntime ? join(isolatedRuntime, 'engineering-tools') : join(homedir, '.pero', 'engineering-tools');
/** Point's global connector state (install records today), beside the managed installs. */
export const connectorStateFile = ({ isolatedRuntime = null, homedir = osHomedir() } = {}) =>
  isolatedRuntime ? join(isolatedRuntime, 'connector.json') : join(homedir, '.pero', 'connector.json');
/** POSIX single-quoting, so a root such as "Application Support" stays one word. */
export const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

async function isFile(path) { try { return (await stat(path)).isFile(); } catch { return false; } }
async function findTool(names, dirs) {
  for (const dir of dirs) for (const name of names) if (await isFile(join(dir, name))) return join(dir, name);
  return null;
}

/**
 * What installing this entry would do on this machine, found without running
 * anything: `null` when the entry declares no managed install.
 */
export async function installPlan(provider, { root, env = process.env, homedir = osHomedir(), arch = process.arch, searchDirs = executableSearchPaths({ env, homedir }) } = {}) {
  const spec = provider?.install;
  if (!spec || !root) return null;
  const bin = managedBin(root);
  if (spec.kind === 'uv-tool') {
    const uv = await findTool(['uv'], searchDirs);
    if (uv) return { kind: 'uv-tool', tool: uv, package: spec.package, bin, summary: `uv tool install ${spec.package}` };
    // Only a versioned name proves 3.12+ without running the interpreter.
    const python = await findTool(['python3.14', 'python3.13', 'python3.12'], searchDirs);
    if (python) return { kind: 'venv', tool: python, package: spec.package, bin, summary: `${python.split('/').pop()} -m venv 并 pip install ${spec.package}` };
    return { kind: 'unavailable', reason: 'MCP_INSTALL_NO_PYTHON', package: spec.package };
  }
  if (spec.kind === 'github-release') {
    const asset = spec.asset.replace('{arch}', arch === 'arm64' ? 'arm64' : 'x64');
    return { kind: 'github-release', repo: spec.repo, asset, bin, summary: `从 github.com/${spec.repo} 最新发布下载 ${asset} 并校验 sha256` };
  }
  return null;
}

/** The latest release's download URL and published digest for a github-release plan. */
export async function resolveRelease(plan, { fetchImpl = fetch } = {}) {
  const release = await fetchImpl(`https://api.github.com/repos/${plan.repo}/releases/latest`, { headers: { accept: 'application/vnd.github+json' } });
  if (!release.ok) throw fail('MCP_INSTALL_FAILED', `GitHub API ${release.status}`);
  const body = await release.json();
  const asset = body.assets?.find(item => item.name === plan.asset);
  if (!asset?.browser_download_url?.startsWith('https://github.com/')) throw fail('MCP_INSTALL_FAILED', `最新发布中没有 ${plan.asset}`);
  const sha256 = /^sha256:([a-f0-9]{64})$/.exec(asset.digest ?? '')?.[1];
  // An unverifiable binary is not installed at all, rather than installed on trust.
  if (!sha256) throw fail('MCP_INSTALL_UNVERIFIED', `${plan.asset} 没有 GitHub 提供的 sha256 摘要`);
  return { url: asset.browser_download_url, sha256, version: body.tag_name ?? null };
}

/** The one shell line that performs a plan, for Point's terminal. */
export function installCommand(plan, { root, release } = {}) {
  const q = shellQuote, bin = plan.bin;
  if (plan.kind === 'uv-tool') {
    return `mkdir -p ${q(bin)} && UV_TOOL_DIR=${q(join(root, 'uv-tools'))} UV_TOOL_BIN_DIR=${q(bin)} UV_PYTHON_INSTALL_DIR=${q(join(root, 'python'))} UV_NO_MODIFY_PATH=1 ${q(plan.tool)} tool install --force --python '>=3.12' ${q(plan.package)}`;
  }
  if (plan.kind === 'venv') {
    const venv = join(root, 'venvs', plan.package);
    return `mkdir -p ${q(bin)} && ${q(plan.tool)} -m venv --clear ${q(venv)} && ${q(join(venv, 'bin', 'python'))} -m pip install --upgrade ${q(plan.package)} && ln -sf ${q(join(venv, 'bin', plan.package))} ${q(join(bin, plan.package))}`;
  }
  if (plan.kind === 'github-release') {
    if (!release) throw fail('MCP_ARGUMENT');
    const target = join(bin, plan.asset), partial = `${target}.partial`;
    // Verified before it becomes executable or reaches its discoverable name.
    return `mkdir -p ${q(bin)} && curl -fL --progress-bar -o ${q(partial)} ${q(release.url)} && printf '%s  %s\\n' ${q(release.sha256)} ${q(partial)} | shasum -a 256 -c - && chmod 755 ${q(partial)} && mv -f ${q(partial)} ${q(target)}`;
  }
  throw fail(plan.reason ?? 'MCP_ARGUMENT');
}
