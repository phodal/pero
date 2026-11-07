// Offline diagnostics only. Configuration presence is neither permission nor a spending cap.
import assert from 'node:assert/strict';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

export function researchTarget(env) {
  const model = env.DEEPSEEK_MODEL?.trim();
  assert(model, 'Set DEEPSEEK_MODEL explicitly to the model approved for this run; there is no default');
  let provider;
  try { provider = new URL(env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'); }
  catch { throw Error('DEEPSEEK_BASE_URL must be a valid HTTPS URL'); }
  assert(provider.protocol === 'https:' && !provider.username && !provider.password && !provider.search && !provider.hash,
    'Use an HTTPS provider URL without credentials/query/fragment');
  return { model, provider };
}

// Overrides are paths relative to the repository, never the caller/run directory.
export function researchExecutablePaths(root, env, platform = process.platform) {
  const suffix = platform === 'win32' ? '.exe' : '';
  return {
    host: resolve(root, env.PERO_RESEARCH_HOST || `target/research-validation/debug/pero-host${suffix}`),
    agent: resolve(root, env.PERO_RESEARCH_AGENT || `target/debug/pero-agent-acp${suffix}`),
    python: env.PERO_RESEARCH_PYTHON ? resolve(root, env.PERO_RESEARCH_PYTHON) : null,
  };
}

export function researchPreflight(root, env = process.env) {
  const checks = [];
  const check = (name, inspect, remedy) => {
    try { checks.push({ name, ready: true, detail: inspect() }); }
    catch { checks.push({ name, ready: false, remedy }); }
  };
  check('liveOptIn', () => { assert.equal(env.PERO_RESEARCH_LIVE, '1'); return 'enabled'; },
    'Set PERO_RESEARCH_LIVE=1 only after provider, public-input sharing and spend are authorized.');
  check('providerCredential', () => { assert(env.DEEPSEEK_API_KEY); return 'present; value not inspected or emitted'; },
    'Configure DEEPSEEK_API_KEY in this executor through the existing secure environment mechanism.');
  check('providerTarget', () => {
    const { model, provider } = researchTarget(env); return { model, origin: provider.origin };
  }, 'Set an explicitly approved DEEPSEEK_MODEL and an HTTPS DEEPSEEK_BASE_URL without credentials, query or fragment.');
  const paths = researchExecutablePaths(root, env);
  for (const [name, path] of [['hostBinary', paths.host], ['harnessBinary', paths.agent]])
    check(name, () => { assert(statSync(path).isFile()); accessSync(path, constants.R_OK | constants.X_OK); return 'readable executable file; not launched'; },
    `Build the ${name === 'hostBinary' ? 'Host' : 'Harness'} or set its PERO_RESEARCH_${name === 'hostBinary' ? 'HOST' : 'AGENT'} path.`);
  check('esbuild', () => { createRequire(join(root, 'package.json')).resolve('esbuild'); return 'resolvable; not imported'; },
    'Install the repository-declared Node dependencies with its normal development procedure.');
  check('pythonPdfDependencies', () => {
    const declared = JSON.parse(readFileSync(join(root, 'apps/paper-agent/app.json'), 'utf8')).backend.dependencies;
    const versions = JSON.parse(execFileSync(paths.python || 'python', ['-s', '-c',
      'import importlib.metadata,json,sys; import pypdfium2,PIL.Image; print(json.dumps({r.split("==")[0]:importlib.metadata.version(r.split("==")[0]) for r in json.loads(sys.argv[1])}))',
      JSON.stringify(declared)], { encoding: 'utf8', env, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }));
    assert(declared.every(requirement => { const [name, version] = requirement.split('=='); return versions[name] === version; }));
    return versions;
  }, 'Use PERO_RESEARCH_PYTHON with the exact PDF dependencies declared in apps/paper-agent/app.json.');
  check('sourceRevision', () => execFileSync('git', ['rev-parse', 'HEAD'],
    { cwd: root, encoding: 'utf8', env, timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim(),
    'Run from a repository checkout with an identifiable HEAD.');
  return { schema: 'pero.research-quality.preflight.v1', mode: 'offline-preflight',
    localPrerequisitesReady: checks.every(check => check.ready), checks,
    authorization: 'not_verified; configuration is not permission',
    monetaryLimit: 'not_enforced_by_this_runner; request/token caps are not a monetary cap',
    providerConnectivity: 'not_checked', modelCompatibility: 'not_checked',
    scientificAcceptance: 'not_run', providerRequests: 0,
    nextStep: 'Resolve local prerequisites, verify approval and enforce any required spending limit before starting a live run. Then retain every attempt for independent human review.' };
}
