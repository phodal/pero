import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { researchExecutablePaths, researchPreflight, researchTarget } from './preflight.mjs';

const root = resolve(import.meta.dirname, '../../..');

test('provider/model selection is explicit and rejects credential-bearing URLs', () => {
  for (const env of [{}, { DEEPSEEK_MODEL: '' }, { DEEPSEEK_MODEL: '  ' }])
    assert.throws(() => researchTarget(env), /DEEPSEEK_MODEL explicitly/);
  for (const url of ['not-a-url', 'http://example.com', 'https://user:private@example.com',
    'https://example.com?key=private', 'https://example.com#private']) {
    assert.throws(() => researchTarget({ DEEPSEEK_MODEL: 'chosen-model', DEEPSEEK_BASE_URL: url }));
  }
  const target = researchTarget({ DEEPSEEK_MODEL: 'chosen-model', DEEPSEEK_BASE_URL: 'https://example.com/v1' });
  assert.equal(target.model, 'chosen-model');
  assert.equal(target.provider.href, 'https://example.com/v1');
  assert.equal(researchTarget({ DEEPSEEK_MODEL: 'chosen-model' }).provider.origin, 'https://api.deepseek.com');
});

test('CLI preflight runs without opt-in/dependencies and never exposes the credential or claims acceptance', () => {
  const sentinel = 'credential-sentinel-must-not-appear';
  let output;
  try {
    output = execFileSync(process.execPath, ['tests/runtime/paper-program-live.mjs', '--preflight'], {
      cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, DEEPSEEK_API_KEY: sentinel,
        DEEPSEEK_BASE_URL: `https://user:${sentinel}@example.com`, PERO_RESEARCH_HOST: '/missing-host',
        PERO_RESEARCH_AGENT: '/missing-agent', DEEPSEEK_MODEL: 'chosen-model' },
      timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    assert.equal(error.status, 1); output = error.stdout;
  }
  assert(!output.includes(sentinel));
  const report = JSON.parse(output);
  assert.equal(report.mode, 'offline-preflight');
  assert.equal(report.localPrerequisitesReady, false);
  assert.equal(report.providerRequests, 0);
  assert.equal(report.scientificAcceptance, 'not_run');
  assert.equal(report.providerConnectivity, 'not_checked');
  for (const name of ['liveOptIn', 'providerTarget', 'hostBinary', 'harnessBinary'])
    assert.equal(report.checks.find(check => check.name === name).ready, false);
  assert.equal(report.checks.find(check => check.name === 'providerCredential').ready, true);
});


test('executable overrides share repository-relative resolution and directories are not executables', () => {
  const env = { PATH: process.env.PATH, PERO_RESEARCH_HOST: '.', PERO_RESEARCH_AGENT: 'tests',
    PERO_RESEARCH_PYTHON: 'python-env/bin/python' };
  assert.deepEqual(researchExecutablePaths(root, env), {
    host: root, agent: resolve(root, 'tests'), python: resolve(root, 'python-env/bin/python'),
  });
  const result = researchPreflight(root, env);
  for (const name of ['hostBinary', 'harnessBinary', 'pythonPdfDependencies'])
    assert.equal(result.checks.find(check => check.name === name).ready, false);
  const defaults = researchExecutablePaths(root, {}, 'win32');
  assert.equal(defaults.host, resolve(root, 'target/research-validation/debug/pero-host.exe'));
  assert.equal(defaults.agent, resolve(root, 'target/debug/pero-agent-acp.exe'));
  assert.equal(defaults.python, null);
  assert.equal(researchExecutablePaths(root, { PERO_RESEARCH_HOST: process.execPath }).host, process.execPath);
});
