// Root launches exactly one fixed case and supplies a credential only by stdin.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { openHost, root, skillName } from '../research-import/host-harness.mjs';
import { scrubTree } from '../research-import/cleanup.mjs';
import { CampaignLedger } from './ledger.mjs';
import { providerEvaluationPlan } from './plan.mjs';
import { startFixtureProvider } from './fixture-provider.mjs';
import { assess, referenceBoundary } from './assess.mjs';
import { scenes, prompts, publicSourceTools } from './scenarios.mjs';

const [mode, scene, agentArg, planPath] = process.argv.slice(2);
assert(['--fixture', '--real'].includes(mode) && scenes[scene], 'Use --fixture|--real <known scene> /absolute/pero-agent-acp [absolute new plan JSON; real only]');
assert(agentArg?.startsWith('/'), 'Explicit absolute Go executable required');
assert.equal(process.platform, 'linux', 'Owned-descendant verification requires Linux /proc');
const real = mode === '--real', agent = resolve(agentArg);
const pythonEnvironment = process.env.PAPER_STUDY_PYTHON_ENV;
assert(pythonEnvironment && isAbsolute(pythonEnvironment), 'Set PAPER_STUDY_PYTHON_ENV to an absolute isolated Python environment directory');
const configuredPrivateRoot = process.env.PAPER_STUDY_PRIVATE_ROOT;
assert(!configuredPrivateRoot || isAbsolute(configuredPrivateRoot), 'PAPER_STUDY_PRIVATE_ROOT must be absolute');
const recordedSourceArchive = process.env.PAPER_STUDY_SOURCE_ARCHIVE;
assert(!scenes[scene].publicRecording || (recordedSourceArchive && isAbsolute(recordedSourceArchive)),
  'Set PAPER_STUDY_SOURCE_ARCHIVE to an absolute authorized archive file');
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim(), '', 'Freeze committed source before recording trajectories');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert(!real || (planPath && isAbsolute(planPath)), 'Real mode requires an absolute new plan JSON path before credential input');
assert(real || !planPath, 'Fixture mode does not consume provider plans');
const plan = real ? providerEvaluationPlan(JSON.parse(await readFile(planPath, 'utf8')), scene, sourceCommit) : null;
const evidenceRoot = resolve(root, 'test-results/paper-study-harness');
await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
async function stdinCredential() {
  assert(!process.stdin.isTTY, 'Credential must arrive via non-echo pipe');
  let value = '';
  for await (const chunk of process.stdin) { value += chunk; assert(value.length <= 4096, 'Invalid credential input'); if (value.includes('\n')) break; }
  value = value.trim(); assert(/^[\x21-\x7e]{8,4096}$/.test(value), 'Missing or invalid credential input'); return value;
}
let credential = real ? await stdinCredential() : 'local-paper-study-fixture';
const scrub = value => String(value).split(credential).join('[REDACTED]');
// Third-party originals and raw source/image sessions must never enter CI artifacts.
const privateRoot = real || scenes[scene].publicRecording
  ? configuredPrivateRoot || await mkdtemp(resolve(tmpdir(), 'pero-paper-study-private-'))
  : evidenceRoot;
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
assert.equal((await stat(privateRoot)).mode & 0o077, 0, 'Campaign artifacts require a private directory');
const directory = await mkdtemp(resolve(privateRoot, `${real ? 'real' : 'fixture'}-${scene}-`));
const audit = resolve(directory, 'http-attempts.txt'); await writeFile(audit, '', { mode: 0o600 });
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const identity = { sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  agentSHA256: await hash(agent), hostSHA256: await hash(resolve(root, 'target/debug/pero-host')),
  skillDigest: 'sha256:' + await hash(resolve(root, 'apps/paper-agent/skills', skillName, 'SKILL.md')) };
const result = { scene, ...identity, startedAt: new Date().toISOString(),
  inference: real ? `real provider ${plan.model}` : 'scripted loopback provider',
  provider: plan ? { endpoint: plan.endpoint, model: plan.model, authorizationReference: plan.authorizationReference, planDigest: plan.digest } : null, network: scenes[scene].publicRecording
    ? 'authentic public source bytes / recorded transport; NOT live product public networking'
    : 'synthetic metadata/source/PDF transport; actual production domain and parser',
  limits: { maxCampaignSessions: plan?.limits.maxSessions ?? null, localRequestCap: plan?.limits.maxRequests ?? null,
    localOutputTokenCap: plan?.limits.maxTokens ?? null, perTurnWallTimeMs: plan?.limits.perTurnWallTimeMs ?? 120000,
    existingHarnessStepGuard: 512, nativeExecutionTools: false, imageInput: scenes[scene].vision === true },
  passScope: 'Automated action/permission/persistence/Skill checks only; semantic source/visual interpretation requires separate manual assessment' };
let ledger, provider, host, thread, failure, interrupted = false;
const interruption = () => { interrupted = true; if (host && thread) host.command({ action: 'cancel', thread_id: thread }); };
process.once('SIGINT', interruption); process.once('SIGTERM', interruption);
async function prepareApp(name, source) {
  if (name === 'paper-agent') {
    await cp(scenes[scene].publicRecording ? resolve(import.meta.dirname, 'recorded-transport.py') : resolve(root, 'tests/fixtures/research-source.py'), resolve(source, 'backend/source_fixture.py'));
    await cp(resolve(import.meta.dirname, 'backend.py'), resolve(source, 'backend/study_fixture.py'));
    // AppProcess deliberately clears inherited environment. Keep this fixture-only
    // public-file selection in the private disposable package, not a new env grant.
    if (scenes[scene].publicRecording) await writeFile(resolve(source, 'backend/recorded-source-path.json'),
      JSON.stringify({ archive: recordedSourceArchive }), { mode: 0o600 });
    return { type: 'python', entry: 'backend/study_fixture.py' };
  }
  return { type: 'python', entry: 'backend/server.py' };
}
try {
  if (real) { ledger = await CampaignLedger.acquire(resolve(evidenceRoot, `provider-ledger-${plan.authorizationReference}.json`), plan, scrub); await ledger.reserve(scene, directory, result.startedAt); }
  else provider = await startFixtureProvider(scene, identity.skillDigest);
  host = await openHost({ directory, agent, endpoint: real ? plan.endpoint : provider.endpoint,
    model: real ? plan.model : 'fixture', credential, audit, useEnvironmentProxy: real, prepareApp,
    allowedPaperTools: scenes[scene].publicRecording ? publicSourceTools : undefined,
    pythonEnvironment, providerBudget: plan?.limits, imageInput: scenes[scene].vision === true });
  if (interrupted) throw new Error('Cancelled during startup');
  thread = await host.start();
  const turns = prompts(scene); result.prompts = turns; result.turns = [];
  for (const [index, prompt] of turns.entries()) {
    const startedAt = Date.now();
    await host.prompt(thread, prompt, result.limits.perTurnWallTimeMs);
    result.turns.push({ index, wallTimeMs: Date.now() - startedAt });
    if (interrupted) throw new Error('Cancelled during model turn');
    if (index === 0) result.referenceBoundary = await referenceBoundary(host, directory, { inspectOnly: scenes[scene].inspectOnly });
  }
  Object.assign(result, await assess({ host, scene, directory, digest: identity.skillDigest, credential }));
  if (result.automatedFailure) throw new Error(result.automatedFailure);
  if (provider) { result.fixtureCounts = provider.counts(); result.fixtureErrors = provider.errors; assert.deepEqual(provider.errors, []);
    if (scenes[scene].vision) assert.equal(result.fixtureCounts.imageRequests, 1, 'Require actual image_url provider payload'); }
  assert.equal(await hash(agent), identity.agentSHA256); assert.equal(await hash(resolve(root, 'target/debug/pero-host')), identity.hostSHA256);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), identity.sourceCommit, 'Source changed during run');
} catch (error) { failure = scrub(error.stack || error); }
finally {
  const cleanupErrors = [];
  async function attempt(stage, operation) {
    try { return await operation(); }
    catch (error) { cleanupErrors.push({ stage, error: scrub(error.message) }); failure ||= `Cleanup failed: ${stage}`; return undefined; }
  }
  try {
    // Capture actions/usage even when a turn fails; never publish hidden reasoning.
    if (host && !result.trajectory) await attempt('failed-run-assessment', async () => Object.assign(result,
      await assess({ host, scene, directory, digest: identity.skillDigest, credential })));
    if (provider) { result.fixtureCounts = provider.counts(); result.fixtureErrors = provider.errors; }
    if (host) {
      result.hostExit = await attempt('host-close', () => host.close());
      if (!result.hostExit || result.hostExit.code !== 0 || result.hostExit.forcedHost || result.hostExit.forcedDescendants || !result.hostExit.descendantsExited)
        failure ||= 'Host/owned descendants failed graceful verified shutdown';
      await attempt('stderr', () => writeFile(resolve(directory, 'host-stderr.log'), scrub(host.stderr()), { mode: 0o600 }));
    }
    if (provider) await attempt('fixture-close', () => provider.close());
    result.httpAttempts = await attempt('audit', async () => (await readFile(audit, 'utf8')).split('\n').filter(Boolean).length) ?? null;
    result.secretLeakDetected = await attempt('exact-key-finalization-scrub', () => scrubTree(directory, credential));
    if (result.secretLeakDetected) failure ||= 'An exact credential echo was detected and removed';
    result.finishedAt = new Date().toISOString();
    if (ledger?.reservation) await attempt('ledger-save', () => ledger.finish({ httpAttempts: result.httpAttempts, passed: !failure,
      finishedAt: result.finishedAt, usage: result.usage || [] }));
    result.passed = !failure; result.failure = failure; result.cleanupErrors = cleanupErrors;
    await attempt('result-save', () => writeFile(resolve(directory, 'result.json'), scrub(JSON.stringify(result, null, 2)) + '\n', { mode: 0o600 }));
  } finally {
    if (ledger) await attempt('ledger-close', () => ledger.close());
    process.removeListener('SIGINT', interruption); process.removeListener('SIGTERM', interruption); credential = '';
  }
  console.log(JSON.stringify({ passed: !failure, scene, inference: result.inference, checks: result.checks,
    httpAttempts: result.httpAttempts, evidence: directory, ...(failure ? { failure: 'See redacted private result.json' } : {}) }, null, 2));
  if (failure) process.exitCode = 1;
}
