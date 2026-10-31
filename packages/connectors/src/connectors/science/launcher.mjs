import { spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scienceSpecs } from './specs.mjs';
import { pinScienceFile, scienceTreeDigest } from './runtime.mjs';

let home;
try {
  const args = process.argv.slice(2), spec = scienceSpecs.find(item => item.domain === args[1]);
  if (args.length !== 2 || args[0] !== '--domain' || !spec) throw new Error('SCIENCE_DOMAIN_INVALID');
  const root = process.env.POINT_SCIENCE_ROOT;
  if (!root || await scienceTreeDigest(root) !== process.env.POINT_SCIENCE_SOURCE_SHA256) throw new Error('SCIENCE_SOURCE_CHANGED');
  const python = spec.domain === 'ketcher' ? null : await pinScienceFile(process.env.POINT_SCIENCE_PYTHON);
  if (python && (!python.executable || python.path !== process.env.POINT_SCIENCE_PYTHON || python.sha256 !== process.env.POINT_SCIENCE_PYTHON_SHA256)) throw new Error('SCIENCE_PYTHON_CHANGED');
  home = await realpath(await mkdtemp(join(tmpdir(), 'point-science-')));
  const env = { HOME: home, PATH: '/usr/bin:/bin', TMPDIR: home };
  if (!python && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  if (spec.domain === 'literature' && process.env.OPENALEX_API_KEY) env.OPENALEX_API_KEY = process.env.OPENALEX_API_KEY;
  if (['pubmed', 'variants'].includes(spec.domain) && process.env.NCBI_API_KEY) env.NCBI_API_KEY = process.env.NCBI_API_KEY;
  if (spec.domain === 'pubmed' && process.env.NCBI_EMAIL) env.NCBI_EMAIL = process.env.NCBI_EMAIL;
  const child = spawn(python?.path ?? process.execPath, python
    ? ['-I', '-B', '-X', `pycache_prefix=${join(home, 'cache')}`, join(root, 'bio-tools/run_server.py'), `mcp_${spec.domain}`]
    : [join(root, 'ketcher-chemistry/server.js')], { cwd: home, env, stdio: ['pipe', 'inherit', 'inherit'] });
  // EOF is part of stdio ownership: retire the child even if a server ignores it.
  process.stdin.pipe(child.stdin);
  child.stdin.on('error', () => {});
  let timer;
  const stop = signal => { child.kill(signal); timer ??= setTimeout(() => child.kill('SIGKILL'), 1000); timer.unref(); };
  process.stdin.once('end', () => stop('SIGTERM'));
  const signals = ['SIGTERM', 'SIGINT', 'SIGHUP'];
  const handlers = signals.map(signal => { const handler = () => stop(signal); process.on(signal, handler); return handler; });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
  clearTimeout(timer); signals.forEach((signal, i) => process.off(signal, handlers[i]));
  process.stdin.unpipe(child.stdin); process.stdin.destroy(); process.exitCode = code;
} catch (error) { console.error(`Point Science: ${error.message}`); process.exitCode = 1; }
finally { process.stdin.destroy(); if (home) await rm(home, { recursive: true, force: true }); }
