// Issue #156: real Host -> Git acquisition -> Go plugin -> ACP provider boundary.
// Git and model services are loopback/local fixtures, never scientific validation.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import Ajv from 'ajv/dist/2020.js';

const root = resolve(import.meta.dirname, '../..');
const schema = JSON.parse(await readFile(join(root, 'protocol/generated/host.schema.json'), 'utf8'));
const ajv = new Ajv({ strict: false });
ajv.addSchema(schema);
const validateApps = ajv.getSchema(`${schema.$id}#/$defs/AppsResultEvent`);
const validateSession = ajv.getSchema(`${schema.$id}#/$defs/SessionCreatedEvent`);
const validateCandidates = ajv.getSchema(`${schema.$id}#/$defs/ContextCandidatesEvent`);
const validateResolved = ajv.getSchema(`${schema.$id}#/$defs/ContextResolvedEvent`);
const suffix = process.platform === 'win32' ? '.exe' : '';
const hostBinary=process.env.PERO_HOST_PATH||join(root,'target/debug/pero-host'+suffix);
const profile = await mkdtemp(join(tmpdir(), 'pero-skills-market-'));
const repo = join(profile, 'source'), workspace = join(profile, 'workspace');
const events = [], requests = [], errors = [], changed = new EventEmitter();
const sha = value => createHash('sha256').update(value).digest('hex');
const json = (path, value) => writeFile(path, JSON.stringify(value));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let host, exit, stderr = '', sequence = 0, stage = 'startup';
let publicMarker = '', publicSource;
function send(value) { host.stdin.write(JSON.stringify(value) + '\n'); }
async function wait(predicate, start = 0) {
  const deadline = Date.now() + (process.env.PERO_SKILLS_MARKET_PUBLIC==='1'?330000:45000);
  for (;;) {
    const result = events.slice(start).find(predicate);
    if (result) return result;
    assert(Date.now() < deadline, `Host event timeout: ${stderr}\n${JSON.stringify(events.slice(-5))}`);
    await new Promise((accept, reject) => {
      const timer = setTimeout(() => { changed.off('event', listener); reject(Error(`Host event timeout (${stage}): ${stderr}\n${JSON.stringify(events.slice(-6))}`)); }, deadline - Date.now());
      const listener = () => { clearTimeout(timer); accept(); };
      changed.once('event', listener);
    });
  }
}
async function app(action, fields = {}) {
  stage = `${action}: ${fields.request?.operation || ''}`;
  const id = `market-${++sequence}`;
  send({ method: 'apps', action, id, ...fields });
  return (await wait(event => event.kind === 'apps_result' && event.request_id === id)).data;
}
async function market(operation, input = {}, caller = 'skills') {
  return app('skillsmarket', { name: caller, request: { operation, ...input } });
}
async function ok(operation, input = {}) {
  const reply = await market(operation, input);
  assert(reply.ok, reply.error); return reply.value;
}
async function context(action, input) {
  stage=action;
  const request_id=`context-${++sequence}`;
  send({action, request_id, ...input});
  const response=await wait(event=>event.request_id===request_id && ['context_candidates','context_resolved','context_error'].includes(event.kind));
  assert.notEqual(response.kind,'context_error',response.text);
  return response.data;
}
async function prompt(thread, text, contexts = []) {
  stage = `prompt: ${thread}`;
  const start = events.length;
  send({ action: 'prompt', thread_id: thread, text, contexts });
  const done = await wait(event => event.thread_id === thread && ['turn_finished', 'session_error'].includes(event.kind), start);
  assert.equal(done.kind, 'turn_finished', done.text);
}

const provider = createServer(async (req, res) => {
  try {
    let text = ''; for await (const chunk of req) text += chunk;
    const input = JSON.parse(text); requests.push(input);
    const wire = JSON.stringify(input.messages);
    const ordinary = wire.includes('ordinary-after-disable');
    if (wire.includes('public-skill-check')) {
      assert(publicMarker && wire.includes(publicMarker), 'The actual catalog skill instructions must reach the provider');
    } else if (ordinary) assert(!wire.includes('MARKET_RESEARCH_AUDIT_V1'));
    else assert(wire.includes('MARKET_RESEARCH_AUDIT_V1'), 'Explicit invocation must load the actual installed skill');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"index":0,"delta":{"content":"fixture checked"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  } catch (error) { errors.push(String(error)); res.destroy(); }
});
provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
try {
  await mkdir(join(repo, 'skills/research-audit'), { recursive: true });
  await mkdir(join(repo, '.claude-plugin'), { recursive: true });
  await mkdir(workspace);
  const skill = '---\nname: research-audit\ndescription: Verify observed research measurements.\n---\nMARKET_RESEARCH_AUDIT_V1\nReport missing measurements explicitly; never invent a p-value.\n';
  await writeFile(join(repo, 'skills/research-audit/SKILL.md'), skill);
  await writeFile(join(repo, 'skills/research-audit/reference.md'), 'Observed data: [2,4,6]. Mean: 4.\n');
  await json(join(repo, '.claude-plugin/plugin.json'), { name: 'unselected-package', hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'exit 99' }] }] } });
  git('init', '-b', 'main'); git('config', 'user.name', 'Market fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.'); git('commit', '-m', 'Initial research audit');
  const revision = git('rev-parse', 'HEAD');
  const id = 'fixture/research-skills/skills/research-audit';
  const entry = {
    id, name: 'research-audit', title_zh: '科研数据核查', description: 'Verify observed data', description_zh: '核查真实数据并保留证据缺口',
    category: 'data-analysis', category_zh: '统计与实证分析', kind: 'research_skill',
    source: { repository: 'fixture/research-skills', commit: revision, path: 'skills/research-audit/SKILL.md', url: `https://github.com/fixture/research-skills/blob/${revision}/skills/research-audit/SKILL.md`, git_blob_sha: git('hash-object', 'skills/research-audit/SKILL.md'), sha256: sha(skill) },
    sources: [], license: { spdx: 'MIT', status: 'declared_in_skill', evidence_url: 'https://github.com/fixture/research-skills' },
    compatibility: { declared: [], status: 'unverified' }, dependencies: [], verification: { content: 'parsed', runtime: 'not_run', notes: [] },
  };
  const catalog = { schema_version: 1, generated_at: '2026-11-07', issue_url: 'https://github.com/phodal/pero/issues/156', source_document: '', sources: [], skills: [entry, { ...entry, id: 'unknown-license', license: { spdx: null, status: 'unknown', evidence_url: null } }], resources: [], exclusions: [], stats: {} };
  const catalogPath = join(profile, 'catalog.json'); await json(catalogPath, catalog);
  await writeFile(join(profile, 'gitconfig'), `[url "${repo.replaceAll('\\', '/')}"]\n  insteadOf = https://github.com/fixture/research-skills.git\n`);
  const source = join(profile, 'app'); await mkdir(join(source, 'dist'), { recursive: true });
  await writeFile(join(source, 'dist/index.html'), '<h1>Skills market acceptance</h1>');
  await json(join(source, 'app.json'), { schemaVersion: 1, name: 'skills', version: '1', displayName: 'Skills', permissions: { host: ['skills'] }, contributes: { panels: [{ id: 'main', title: 'Skills', entry: 'dist/index.html' }] } });
  const harness = process.env.PERO_SKILLS_HARNESS_PATH||join(root, 'target/debug/pero-agent-acp' + suffix);
  await json(join(profile, 'agents.json'), [{ id: 'pero', name: 'Pero loopback fixture', command: harness, args: ['--endpoint', `http://127.0.0.1:${provider.address().port}/v1`, '--model', 'fixture', '--workspace', '{workspace}', '--api-key-env', 'MARKET_FIXTURE_KEY', '--session-dir', join(profile, 'harness-sessions'), '--max-retries', '0', '--max-tokens', '256'], env: {} }, { id: 'other', name: 'Other protocol fixture', command: process.execPath, args: [join(root, 'tests/runtime/lifecycle-agent.mjs')], env: {PERO_FIXTURE_SCENARIO:'composer'} }]);
  async function start() {
    host = spawn(hostBinary, ['--stdio'], {
      cwd: workspace, env: { ...process.env, MARKET_FIXTURE_KEY: 'fixture-only', PERO_AGENTS_FILE: join(profile, 'agents.json'), PERO_SETTINGS_PATH: join(profile, 'settings.json'), PERO_HISTORY_PATH: join(profile, 'history.jsonl'), PERO_APPS_ROOT: join(profile, 'apps'), PERO_BUILTIN_APPS_ROOT: '', PERO_REQUIRED_APPS: '', PERO_SKILLS_CATALOG: catalogPath, GIT_CONFIG_GLOBAL: join(profile, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    exit = once(host, 'exit'); host.stderr.on('data', chunk => { stderr += chunk; });
    createInterface({ input: host.stdout }).on('line', line => {
      const event = JSON.parse(line);
      const validate = event.kind === 'apps_result' ? validateApps : event.kind === 'session_created' ? validateSession : event.kind === 'context_candidates' ? validateCandidates : event.kind === 'context_resolved' ? validateResolved : null;
      if (validate && !validate(event)) errors.push(ajv.errorsText(validate.errors));
      events.push(event); changed.emit('event');
    });
    await wait(event => event.kind === 'ready', events.length);
  }
  async function stop() {
    host.stdin.end(); const timer = setTimeout(() => host.kill('SIGKILL'), 5000);
    const [code] = await exit; clearTimeout(timer); host = null; assert.equal(code, 0, stderr);
  }
  await start();
  for (const action of ['install', 'enable']) {
    const reply = await app(action, action === 'install' ? { path: source } : { name: 'skills' }); assert(reply.ok, reply.error);
  }
  assert.equal((await ok('catalog')).skills.length, 2);
  assert.deepEqual((await ok('installed')).items, []);
  assert.equal((await market('installed', {}, 'paper-agent')).ok, false, 'A foreign App cannot manage skills');
  assert.equal((await market('install', { id: '../escape' })).ok, false);
  assert.equal((await market('install', { id: 'unknown-license' })).ok, false);
  const installed = (await ok('install', { id })).items[0];
  assert.equal(installed.revision, revision); assert.equal(installed.enabled, false);
  assert(installed.invocation, 'Installed skill must expose its exact qualified invocation');
  const choices=await context('search_context',{kind:'skill',query:'research-audit'});
  const pickerSkill=choices.find(item=>item.source.startsWith('pero-market-skill:'));
  assert(pickerSkill,'An installed skill must be discoverable before global selection is enabled');
  assert((await context('search_context',{kind:'skill',query:''})).some(item=>item.source===pickerSkill.source),'Installed skills must appear in the ordinary skill picker');
  assert((await context('search_context',{kind:'skill',query:'核查'})).some(item=>item.source===pickerSkill.source),'Search includes the reviewed Chinese description');
  const frozen=await context('resolve_context',{kind:'skill',source:pickerSkill.source});
  assert(frozen.content.text.includes('MARKET_RESEARCH_AUDIT_V1'));
  const pickerStart=events.length;
  send({action:'new_session',thread_id:'picker-selected',agent_id:'pero'});
  const pickerReady=await wait(event=>['session_ready','session_error'].includes(event.kind)&&event.thread_id==='picker-selected',pickerStart);
  assert.equal(pickerReady.kind,'session_ready',pickerReady.text);
  const pickerCreated=events.slice(pickerStart).find(event=>event.kind==='session_created'&&event.thread_id==='picker-selected');
  assert(!pickerCreated.data.skillSelections?.length,'A manual picker attachment must not globally enable the skill');
  await prompt('picker-selected','picker-context-check: inspect the observed data',[frozen]);
  assert.equal((await ok('installed')).items[0].selected,false);
  const otherStart=events.length;
  send({action:'new_session',thread_id:'picker-other',agent_id:'other'});
  const otherReady=await wait(event=>['session_ready','session_error'].includes(event.kind)&&event.thread_id==='picker-other',otherStart);
  assert.equal(otherReady.kind,'session_ready',otherReady.text);
  await prompt('picker-other','Inspect the explicitly selected skill text',[frozen]);
  assert(events.slice(otherStart).some(event=>event.kind==='session_update'&&event.thread_id==='picker-other'&&event.data.sessionUpdate==='agent_message_chunk'&&event.data.content?.text?.includes('MARKET_RESEARCH_AUDIT_V1')),'An explicitly selected skill reaches another ACP Agent without global plugin selection');
  const enabled = (await ok('enable', { id, enabled: true })).items[0]; assert(enabled.selected);
  let startIndex = events.length;
  send({ action: 'new_session', thread_id: 'selected', agent_id: 'pero' });
  const created = await wait(event => event.kind === 'session_created' && event.thread_id === 'selected', startIndex);
  assert(created.data.skillSelections?.some(item => item.id === id && item.revision === revision));
  const ready = await wait(event => ['session_ready','session_error'].includes(event.kind) && event.thread_id === 'selected', startIndex);
  assert.equal(ready.kind, 'session_ready', ready.text);
  await prompt('selected', `${installed.invocation.startsWith('/') ? '' : '/'}${installed.invocation} Check the observed research data.`);
  assert.deepEqual(errors, []); assert.equal(requests.length, 2);
  const currentCheck = await ok('check-update', { id });
  assert.equal(currentCheck.updateAvailable, false);
  assert.equal(currentCheck.latestSha256, sha(skill));
  assert.equal((await market('update', { id })).ok, false);
  await writeFile(join(repo, 'skills/research-audit/SKILL.md'), skill.replace('V1', 'V2')); git('add', '.'); git('commit', '-m', 'Revise audit');
  const nextRevision = git('rev-parse', 'HEAD');
  const observed = await ok('check-update', { id });
  assert.equal(observed.latestRevision, nextRevision);
  assert.equal(observed.latestSha256, sha(skill.replace('V1', 'V2')));
  assert.equal(observed.updateAvailable, true);
  const updated = (await ok('update', { id, revision: observed.latestRevision, sha256: observed.latestSha256 })).items[0];
  assert.equal(updated.revision, nextRevision); assert.equal(updated.previousRevision, revision);
  assert.equal((await ok('rollback', { id, revision })).items[0].revision, revision);
  // Existing selected session still has its original package after disable/remove.
  await ok('enable', { id, enabled: false }); await prompt('selected', '/'+installed.invocation.replace(/^\//, '')+' Repeat the original audit.');
  await ok('remove', { id }); assert.deepEqual((await ok('installed')).items, []);
  assert(!(await context('search_context',{kind:'skill',query:'research-audit'})).some(item=>item.source.startsWith('pero-market-skill:')));
  assert(frozen.content.text.includes('MARKET_RESEARCH_AUDIT_V1'),'Previously selected context remains frozen after removal');
  startIndex = events.length;
  send({ action: 'new_session', thread_id: 'ordinary', agent_id: 'pero' });
  await wait(event => event.kind === 'session_ready' && event.thread_id === 'ordinary', startIndex);
  await prompt('ordinary', 'ordinary-after-disable');
  await stop(); await start();
  assert.deepEqual((await ok('installed')).items, []);
  if (process.env.PERO_SKILLS_MARKET_PUBLIC === '1') {
    const actualCatalog = JSON.parse(await readFile(join(root, 'docs/design-docs/research-skills-catalog.json'), 'utf8'));
    const requested=process.env.PERO_SKILLS_MARKET_PUBLIC_ID;
    const actual = actualCatalog.skills.find(item => requested ? item.id===requested : item.source.repository === 'blader/humanizer');
    assert(actual, 'The real catalog must include the requested reviewed source');
    await json(catalogPath, { ...catalog, skills: [actual] });
    const publicInstalled = (await ok('install', { id: actual.id })).items[0];
    assert.equal(publicInstalled.revision, actual.source.commit);
    const state = JSON.parse(await readFile(join(profile, 'skill-market/state.json'), 'utf8'));
    const version = state.items[actual.id].versions[0];
    const bytes = await readFile(join(version.directory, 'source', actual.source.path));
    assert.equal(sha(bytes), actual.source.sha256);
    publicMarker = bytes.toString('utf8').split('\n').findLast(line => /^[A-Za-z][A-Za-z ,.;:-]{40,}$/.test(line.trim()))?.trim();
    assert(publicMarker, 'Actual skill must contain a distinctive instruction line');
    await ok('enable', { id: actual.id, enabled: true });
    startIndex = events.length;
    send({ action: 'new_session', thread_id: 'public-skill', agent_id: 'pero' });
    const ready = await wait(event => event.thread_id === 'public-skill' && ['session_ready','session_error'].includes(event.kind), startIndex);
    assert.equal(ready.kind, 'session_ready', ready.text);
    await prompt('public-skill', '/'+publicInstalled.invocation+' public-skill-check Rewrite this synthetic research paragraph clearly: We observed three measurements and have not assessed uncertainty.');
    publicSource = { repository: actual.source.repository, revision: actual.source.commit, sha256: actual.source.sha256, invocation: publicInstalled.invocation, evidence: 'public Git acquired, checksum checked, actual instructions loaded; provider decisions are a fixture' };
    await ok('remove', { id: actual.id });
  }
  assert.deepEqual(errors, [], 'Real Host output must match generated public contracts');
  await stop();
  const output = join(root, 'test-results/skills-market'); await mkdir(output, { recursive: true });
  const reportName=publicSource&&process.env.PERO_SKILLS_MARKET_PUBLIC_ID?'runtime-public-selected.json':publicSource?'runtime-public.json':'runtime.json';
  await json(join(output, reportName), { passed: true, issue: 156, mode: publicSource ? 'real-host-public-git-loopback-provider' : 'real-host-local-git-loopback-provider', publicSource, source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), worktree: 'development', hostSHA256: sha(await readFile(hostBinary)), harnessSHA256: sha(await readFile(harness)), providerRequests: requests.length, checks: ['installed skill discoverable without global enable', 'explicit picker context reaches the provider', 'explicit context works with another ACP identity', 'removed skill disappears and selected content stays frozen', 'caller authorization', 'pinned install', 'unknown license refused', 'isolated explicit invocation', 'update', 'rollback', 'active-session snapshot retained', 'remove', 'restart'], limitations: ['Another ACP identity uses a protocol fixture, not a real Codex model', 'Model responses are scripted over loopback; no paid model', 'Update and rollback use local Git fixture', 'No scientific acceptance or packaged/native UI acceptance'] });
  console.log('Skills market Host/Harness acceptance passed.');
} finally {
  if (host) { host.stdin.end(); const timer = setTimeout(() => host.kill('SIGKILL'), 5000); await exit; clearTimeout(timer); }
  provider.closeAllConnections(); await new Promise(done => provider.close(done));
  // This path was allocated by mkdtemp above and is never derived from catalog input.
  await rm(profile, { recursive: true, force: true });
}
